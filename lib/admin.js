// Изменение пользовательских настроек: репозитории, кнопки, переменные, оформление.
// Каждая функция правит только пользовательский конфиг; defaults.json не трогается,
// поэтому любое системное значение можно вернуть.
const fs = require('fs');
const path = require('path');
const userConfig = require('./userConfig');
const { readDefaults } = require('./config');
const stepTypes = require('./steps');
const guard = require('./guard');
const snapshots = require('./snapshots');

const PARAM_TYPES = ['gitBranch', 'stash', 'snapshot', 'text', 'file', 'select'];
const GROUP_KINDS = ['compose', 'node', 'generic'];
const THEMES_FREE = /^[a-z0-9-]{1,32}$/;

function fail(message) {
  throw Object.assign(new Error(message), { code: 400 });
}

const TRANSLIT = Object.fromEntries('а:a б:b в:v г:g д:d е:e ё:e ж:zh з:z и:i й:y к:k л:l м:m н:n о:o п:p р:r с:s т:t у:u ф:f х:h ц:c ч:ch ш:sh щ:sch ы:y э:e ю:yu я:ya'.split(' ').map(p => p.split(':')));
const slug = s => String(s).toLowerCase().replace(/[а-яё]/g, c => TRANSLIT[c] || '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'action';

// Объект, в котором хранятся правки группы: для системной — user.groups[id], для своей — сама группа
function groupStore(data, id) {
  const custom = data.customGroups.find(g => g.id === id);
  if (custom) return custom;
  if (!readDefaults().groups.some(g => g.id === id)) fail(`Неизвестная группа: ${id}`);
  return (data.groups[id] ||= {});
}

function checkDir(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) fail('Нужен абсолютный путь');
  let st;
  try { st = fs.statSync(p); } catch { fail(`Папки нет: ${p}`); }
  if (!st.isDirectory()) fail(`Это не папка: ${p}`);
  return p.replace(/\/+$/, '') || '/';
}

/* ---------- репозитории ---------- */

function addRepo(groupId, dir, effective) {
  const p = checkDir(dir);
  userConfig.update(data => {
    const g = groupStore(data, groupId);
    g.exclude = (g.exclude || []).filter(x => x !== p && x !== path.basename(p));
    const known = effective.groups.find(x => x.id === groupId)?.projects.some(x => x.path === p);
    if (!known) g.addPaths = [...new Set([...(g.addPaths || []), p])];
  });
}

function removeRepo(groupId, dir) {
  userConfig.update(data => {
    const g = groupStore(data, groupId);
    if ((g.addPaths || []).includes(dir)) g.addPaths = g.addPaths.filter(x => x !== dir);
    else g.exclude = [...new Set([...(g.exclude || []), dir])];
  });
}

// root: путь — искать репозитории в этой папке; '' — автопоиск выключен; null — вернуть значение по умолчанию
function setDiscoverRoot(groupId, root) {
  const p = root ? checkDir(root) : '';
  userConfig.update(data => {
    const g = groupStore(data, groupId);
    if (root === null && !data.customGroups.includes(g)) { delete g.discoverRoot; return; }
    if (data.customGroups.includes(g)) g.discover = p ? { root: p, requireFile: g.discover?.requireFile || '' } : undefined;
    else g.discoverRoot = p;
  });
}

function createGroup({ title, kind = 'generic' }) {
  title = String(title || '').trim();
  if (!title) fail('Назовите группу');
  if (!GROUP_KINDS.includes(kind)) fail('Неизвестный тип группы');
  let id;
  userConfig.update(data => {
    id = `g_${slug(title)}`;
    while (data.customGroups.some(g => g.id === id) || readDefaults().groups.some(g => g.id === id)) id += '_';
    data.customGroups.push({ id, title, kind, paths: [], addPaths: [], exclude: [], sections: [{ title: 'Действия', actions: ['pull', 'checkout', 'openFolder'] }], primary: 'pull' });
  });
  return { id };
}

function deleteGroup(id) {
  userConfig.update(data => {
    if (!data.customGroups.some(g => g.id === id)) fail('Системную группу удалить нельзя — её можно очистить от репозиториев');
    data.customGroups = data.customGroups.filter(g => g.id !== id);
  });
}

/* ---------- кнопки ---------- */

function sanitizeAction(a) {
  if (!a || typeof a !== 'object') fail('Пустое действие');
  const title = String(a.title || '').trim();
  if (!title) fail('Название кнопки не задано');
  if (!Array.isArray(a.steps) || !a.steps.length) fail('Добавьте хотя бы один шаг');
  const steps = a.steps.map((s, i) => {
    if (!s || typeof s !== 'object') fail(`Шаг ${i + 1}: неверный формат`);
    if (!s.type) fail(`Шаг ${i + 1}: не указан тип`);
    if (s.type !== 'action' && !stepTypes[s.type]) fail(`Шаг ${i + 1}: неизвестный тип «${s.type}»`);
    if (s.cmd !== undefined) {
      try { guard.check(s.cmd); } catch (e) { fail(`Шаг ${i + 1}: ${e.message}`); }
    }
    if (s.type === 'shell' && !String(s.cmd || '').trim()) fail(`Шаг ${i + 1}: пустая команда`);
    return s;
  });
  const params = (a.params || []).map((p, i) => {
    if (!/^\w+$/.test(p.name || '')) fail(`Параметр ${i + 1}: имя только из латинских букв, цифр и _`);
    if (!PARAM_TYPES.includes(p.type)) fail(`Параметр «${p.name}»: неизвестный тип`);
    return p;
  });
  const out = { title, steps };
  for (const k of ['icon', 'hint', 'confirm']) if (a[k]) out[k] = String(a[k]);
  if (a.danger) out.danger = true;
  if (params.length) out.params = params;
  return out;
}

// placement: [{ group, section }] — куда положить кнопку (для нового действия)
function saveAction({ id, action, placement = [] }, effective) {
  const clean = sanitizeAction(action);
  userConfig.update(data => {
    if (!id) {
      id = `custom_${slug(clean.title)}`;
      while (effective.actions[id] || data.actions[id]) id += '_';
      for (const p of placement) {
        const g = groupStore(data, p.group);
        g.extra = [...(g.extra || [])];
        const e = g.extra.find(x => x.section === p.section);
        if (e) e.actions.push(id); else g.extra.push({ section: p.section || 'Мои кнопки', actions: [id] });
      }
    }
    data.actions[id] = clean;
  });
  return { id };
}

function deleteAction(id) {
  userConfig.update(data => {
    if (readDefaults().actions[id]) fail('Системную кнопку нельзя удалить — скройте её или сбросьте правки');
    delete data.actions[id];
    for (const g of Object.values(data.groups)) {
      g.extra = (g.extra || []).map(e => ({ ...e, actions: e.actions.filter(a => a !== id) })).filter(e => e.actions.length);
      g.hidden = (g.hidden || []).filter(a => a !== id);
    }
    for (const g of data.customGroups) {
      g.extra = (g.extra || []).map(e => ({ ...e, actions: e.actions.filter(a => a !== id) })).filter(e => e.actions.length);
      for (const s of g.sections || []) s.actions = s.actions.filter(a => a !== id);
    }
  });
}

function resetAction(id) {
  userConfig.update(data => {
    if (!readDefaults().actions[id]) fail('Сбрасывать можно только системные кнопки');
    delete data.actions[id];
  });
}

function setHidden(groupId, actionId, hidden) {
  userConfig.update(data => {
    const g = groupStore(data, groupId);
    const set = new Set(g.hidden || []);
    hidden ? set.add(actionId) : set.delete(actionId);
    g.hidden = [...set];
    if (hidden && g.primary === actionId) g.primary = null;
  });
}

function place(groupId, section, actionId) {
  userConfig.update(data => {
    const g = groupStore(data, groupId);
    g.hidden = (g.hidden || []).filter(a => a !== actionId);
    g.extra = [...(g.extra || [])];
    const e = g.extra.find(x => x.section === section);
    if (e) { if (!e.actions.includes(actionId)) e.actions.push(actionId); } else g.extra.push({ section, actions: [actionId] });
  });
}

function setPrimary(groupId, actionId) {
  userConfig.update(data => { groupStore(data, groupId).primary = actionId || null; });
}

function resetGroup(groupId) {
  userConfig.update(data => {
    if (data.customGroups.some(g => g.id === groupId)) fail('Эта группа — ваша, сбрасывать нечего');
    delete data.groups[groupId];
  });
}

/* ---------- переменные и оформление ---------- */

function setVars(vars) {
  userConfig.update(data => {
    for (const [k, v] of Object.entries(vars || {})) {
      if (!/^\w+$/.test(k)) fail(`Недопустимое имя переменной: ${k}`);
      if (k === 'snapshotsDir' && v && !path.isAbsolute(snapshots.expand(v))) fail('Папка снимков должна быть абсолютным путём (например /data/snapshots) или начинаться с ~/');
      if (k === 'snapshotsEnabled' && v !== '' && v != null && typeof v !== 'boolean') fail('snapshotsEnabled: нужно да или нет');
      if (v === '' || v == null) delete data.vars[k]; else data.vars[k] = v;
    }
  });
}

function setPrefs(prefs) {
  userConfig.update(data => {
    for (const [k, v] of Object.entries(prefs || {})) {
      if (k === 'theme' && !THEMES_FREE.test(String(v))) fail('Неверное имя темы');
      data.prefs[k] = v;
    }
  });
}

/* ---------- окружения ---------- */

const relOk = p => typeof p === 'string' && p && !path.isAbsolute(p) && !p.split('/').includes('..') && !/[\0\n]/.test(p);

// Слот подмены: системный меняется поверх defaults (можно сбросить), новый требует group, title и target
function saveSwap(b, effective) {
  const id = b.id || `swap_${slug(b.title || 'file')}`;
  const system = (readDefaults().swaps || []).some(s => s.id === id);
  const patch = {};
  if (b.title !== undefined) {
    if (!String(b.title).trim()) fail('У слота должно быть название');
    patch.title = String(b.title).trim();
  }
  if (b.target !== undefined) {
    if (!relOk(b.target)) fail('Файл для подмены: путь внутри репозитория, например .env или public/config.js');
    patch.target = b.target;
  }
  if (b.patterns !== undefined) {
    const list = (Array.isArray(b.patterns) ? b.patterns : String(b.patterns).split(/[\n,]+/)).map(x => String(x).trim()).filter(Boolean);
    if (!list.length || !list.every(relOk)) fail('Маски вариантов: путь внутри репозитория, например .env_* или public/config*.js');
    patch.patterns = list;
  }
  if (b.kind !== undefined) {
    if (!['env', 'js', 'file'].includes(b.kind)) fail('Тип файла: env, js или file');
    patch.kind = b.kind;
  }
  if (b.enabled !== undefined) patch.enabled = Boolean(b.enabled);
  if (b.ideOverrides !== undefined) {
    const ov = typeof b.ideOverrides === 'string' ? Object.fromEntries(b.ideOverrides.split(/\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
      const i = l.indexOf('=');
      return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, ''];
    })) : b.ideOverrides;
    for (const k of Object.keys(ov || {})) if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(k)) fail(`Недопустимое имя переменной: ${k}`);
    patch.ideOverrides = ov || {};
  }
  if (!system) {
    if (!effective.groups.some(g => g.id === b.group)) fail('Укажите группу репозиториев для слота');
    patch.group = b.group;
  }
  userConfig.update(data => {
    data.swaps ||= {};
    const next = { ...(data.swaps[id] || {}), ...patch };
    if (!system) {
      for (const k of ['title', 'target', 'patterns', 'group']) if (!next[k]) fail(`Не заполнено: ${k}`);
      next.kind ||= 'file';
    }
    data.swaps[id] = next;
  });
  return { id };
}

function resetSwap(id) {
  userConfig.update(data => { if (data.swaps) delete data.swaps[id]; });
}

// Пресет-стенд: название и выбор варианта для каждого слота { slotId: относительный путь варианта }
function saveEnv({ id, title, picks, note, origin, ide, startUrl }) {
  if (!String(title || '').trim()) fail('Назовите окружение');
  const clean = {};
  for (const [slot, rel] of Object.entries(picks || {})) {
    if (!/^[\w.-]+$/.test(slot) || !(relOk(rel) || /^@[^\0\n/]{1,40}$/.test(rel))) fail(`Неверный выбор для слота ${slot}`);
    clean[slot] = rel;
  }
  if (!Object.keys(clean).length) fail('Выберите хотя бы один файл');
  let outId = id;
  userConfig.update(data => {
    data.envs ||= [];
    const entry = { title: String(title).trim(), picks: clean, ...(note ? { note: String(note).slice(0, 200) } : {}), ...(origin ? { origin } : {}), ...(ide ? { ide: true } : {}), ...(startUrl ? { startUrl } : {}) };
    const at = data.envs.findIndex(e => e.id === id);
    if (at >= 0) data.envs[at] = { id, ...entry };
    else {
      outId = `env_${slug(title)}`;
      let n = 1;
      while (data.envs.some(e => e.id === outId)) outId = `env_${slug(title)}_${++n}`;
      data.envs.push({ id: outId, ...entry });
    }
  });
  return { id: outId };
}

function deleteEnv(id) {
  userConfig.update(data => { data.envs = (data.envs || []).filter(e => e.id !== id); });
}

/* ---------- резервная копия ---------- */

function exportConfig() {
  return userConfig.read();
}

function importConfig(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail('Это не файл настроек Dev Panel');
  const next = { version: 1, vars: {}, groups: {}, customGroups: [], actions: {}, prefs: {}, ...obj };
  if (next.swaps && (typeof next.swaps !== 'object' || Array.isArray(next.swaps))) fail('Неверный раздел swaps');
  if (next.envs && !Array.isArray(next.envs)) fail('Неверный раздел envs');
  for (const [id, a] of Object.entries(next.actions)) next.actions[id] = sanitizeAction(a);
  userConfig.write(next);
}

/* ---------- профиль для коллег ---------- */

// Профиль — настройки, которыми можно поделиться: кнопки, группы, стенды (названия, адреса, какие файлы), оформление.
// Не входят: пути на вашем диске, пароли, значения переменных IDE и сами файлы стендов (в них ключи и пароли).
const MACHINE_VARS = new Set(['calplanRoot', 'dumpsDir', 'dbDataDir', 'browserProfile', 'browserCmd', 'snapshotsDir', 'swaggerDir', 'port']);

function exportProfile() {
  const u = userConfig.read();
  const stripGroup = ({ discoverRoot, addPaths, ...rest }) => rest;
  return {
    profile: { version: 1, exportedAt: new Date().toISOString(), note: 'Без путей, паролей и файлов стендов. Файлы стендов (.env, config.js) передайте отдельно и добавьте в «Настройки → Стенды».' },
    vars: Object.fromEntries(Object.entries(u.vars || {}).filter(([k]) => !MACHINE_VARS.has(k))),
    actions: u.actions || {},
    customGroups: (u.customGroups || []).map(g => ({ ...g, paths: [], addPaths: [] })),
    groups: Object.fromEntries(Object.entries(u.groups || {}).map(([id, g]) => [id, stripGroup(g)])),
    swaps: u.swaps || {},
    envs: (u.envs || []).map(({ ide, ...e }) => e),
    prefs: u.prefs || {},
  };
}

// Слияние профиля с текущими настройками: свои пути и пароли не трогаем, существующие стенды не перезаписываем
function importProfile(obj) {
  if (!obj?.profile || typeof obj.profile !== 'object') fail('Это не профиль Dev Panel (нужен файл из «Экспорт профиля»)');
  const added = { actions: 0, groups: 0, envs: 0, skippedEnvs: 0 };
  userConfig.update(data => {
    for (const [k, v] of Object.entries(obj.vars || {})) if (/^\w+$/.test(k) && !MACHINE_VARS.has(k) && !(k in data.vars)) data.vars[k] = v;
    for (const [id, a] of Object.entries(obj.actions || {})) { data.actions[id] = sanitizeAction(a); added.actions++; }
    for (const g of obj.customGroups || []) {
      if (!g?.id || data.customGroups.some(x => x.id === g.id)) continue;
      data.customGroups.push({ ...g, paths: [], addPaths: [] });
      added.groups++;
    }
    for (const [id, g] of Object.entries(obj.groups || {})) data.groups[id] = { ...(data.groups[id] || {}), ...g };
    data.swaps = { ...(data.swaps || {}), ...(obj.swaps || {}) };
    data.envs ||= [];
    for (const e of obj.envs || []) {
      if (!e?.id || !e.title) continue;
      if (data.envs.some(x => x.id === e.id || x.title === e.title)) { added.skippedEnvs++; continue; }
      data.envs.push({ ...e, ide: false });
      added.envs++;
    }
    data.prefs = { ...(data.prefs || {}), ...(obj.prefs || {}) };
  });
  return added;
}

module.exports = {
  exportProfile, importProfile,
  addRepo, removeRepo, setDiscoverRoot, createGroup, deleteGroup,
  saveAction, deleteAction, resetAction, setHidden, place, setPrimary, resetGroup,
  saveSwap, resetSwap, saveEnv, deleteEnv,
  setVars, setPrefs, exportConfig, importConfig, sanitizeAction,
};

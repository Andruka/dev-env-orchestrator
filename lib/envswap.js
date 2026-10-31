// Окружения: подмена файлов, которые определяют, к какому стенду подключена ветка
// (.env бэкенда, public/config.js фронтенда), и выгрузка переменных для запуска из IDE.
//
// «Слот» (swap) — один подменяемый файл проекта: target (например .env) и patterns — по каким маскам искать
// готовые варианты рядом с ним (.env_5008, config5008.js). Применение = копирование варианта поверх target.
// Если в target лежит что-то, чего нет среди вариантов (ручные правки), перед перезаписью копия уходит в бэкап.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const STATE_HOME = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
const BACKUPS = path.join(STATE_HOME, 'dev-panel', 'swap-backups');
const IDE_DIR = path.join(STATE_HOME, 'dev-panel', 'ide');
const KEEP_BACKUPS = 10;

// Библиотека стендов: готовые файлы хранятся в папке панели, вне репозиториев (рядом с её настройками).
// Вариант из библиотеки в списках называется «@имя».
const libRoot = () => path.join(path.dirname(require('./userConfig').FILE), 'stands');
const LIB_NAME = /^[\p{L}\p{N}._-]{1,40}$/u;

function fail(message, code = 400) {
  throw Object.assign(new Error(message), { code });
}

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const readIf = file => { try { return fs.readFileSync(file); } catch { return null; } };

// Путь внутри проекта: относительный, без выхода за его пределы
function inside(project, rel) {
  if (rel === '.') return path.resolve(project.path);
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.split('/').includes('..')) fail(`Недопустимый путь: ${rel}`);
  const abs = path.resolve(project.path, rel);
  if (!abs.startsWith(path.resolve(project.path) + path.sep)) fail(`Путь вне проекта: ${rel}`);
  return abs;
}

const maskRe = mask => new RegExp(`^${mask.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

// Слоты, относящиеся к проекту
function slotsFor(config, project) {
  return (config.swaps || []).filter(s => s.enabled && s.group === project.group);
}

function findSlot(config, project, slotId) {
  const s = slotsFor(config, project).find(x => x.id === slotId);
  if (!s) fail(`У проекта ${project.name} нет слота «${slotId}»`, 404);
  return s;
}

function libName(name) {
  if (!LIB_NAME.test(String(name)) || String(name).startsWith('.')) fail('Имя: буквы, цифры, точка, дефис, подчёркивание (до 40 символов)');
  return String(name);
}

function libFile(slot, name) {
  return path.join(libRoot(), libName(slot.id), libName(name));
}

function libWrite(slot, name, data) {
  const file = libFile(slot, name);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, data, { mode: 0o600 });
  return `@${name}`;
}

function libRemove(slot, rel) {
  if (!String(rel).startsWith('@')) return;
  try { fs.rmSync(libFile(slot, rel.slice(1)), { force: true }); } catch { /* имя неверное — удалять нечего */ }
}

// Файлы библиотеки для слота
function libVariants(slot) {
  let names = [];
  try { names = fs.readdirSync(path.join(libRoot(), libName(slot.id))); } catch { return []; }
  return names.sort().filter(n => LIB_NAME.test(n)).flatMap(name => {
    const abs = path.join(libRoot(), slot.id, name);
    try {
      if (!fs.statSync(abs).isFile()) return [];
      return [{ rel: `@${name}`, name, abs, lib: true, hash: sha(fs.readFileSync(abs)), mtime: fs.statSync(abs).mtimeMs }];
    } catch { return []; }
  });
}

// Готовые варианты: файлы библиотеки панели, затем файлы по маскам patterns рядом с target (кроме самого target)
function variants(project, slot) {
  const out = new Map(libVariants(slot).map(v => [v.rel, v]));
  for (const pattern of slot.patterns || []) {
    const dirRel = path.posix.dirname(pattern);
    const re = maskRe(path.posix.basename(pattern));
    let dir;
    try { dir = inside(project, dirRel === '.' ? path.posix.dirname(slot.target) : dirRel); } catch { continue; }
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names.sort()) {
      if (!re.test(name)) continue;
      const rel = path.posix.join(dirRel === '.' ? path.posix.dirname(slot.target) : dirRel, name).replace(/^\.\//, '');
      if (rel === slot.target || out.has(rel)) continue;
      const abs = path.join(dir, name);
      let st;
      try { st = fs.statSync(abs); } catch { continue; }
      if (!st.isFile()) continue;
      out.set(rel, { rel, name, abs, hash: sha(fs.readFileSync(abs)), mtime: st.mtimeMs });
    }
  }
  return [...out.values()];
}

// Состояние слота: какой вариант сейчас лежит в target
function slotState(project, slot) {
  const vs = variants(project, slot);
  const cur = readIf(inside(project, slot.target));
  const hash = cur && sha(cur);
  const active = hash ? vs.find(v => v.hash === hash) : null;
  return {
    id: slot.id, title: slot.title, target: slot.target, kind: slot.kind,
    exists: Boolean(cur),
    active: active?.rel || null,
    custom: Boolean(cur) && !active, // в target файл, не совпадающий ни с одним вариантом
    variants: vs.map(v => ({ rel: v.rel, name: v.name, lib: Boolean(v.lib), active: v.rel === active?.rel })),
  };
}

// Стенды, чьи файлы для слотов этого репозитория сейчас лежат на месте (для подписи снимков БД и журнала)
function standsForProject(config, project) {
  const slots = slotsFor(config, project);
  return (config.envs || []).filter(e => {
    const mine = Object.entries(e.picks || {}).filter(([id]) => slots.some(s => s.id === id));
    return mine.length > 0 && mine.every(([id, rel]) => slotState(project, slots.find(s => s.id === id)).active === rel);
  }).map(e => ({ id: e.id, title: e.title, origin: e.origin || null }));
}

function projectState(config, project) {
  return slotsFor(config, project).map(s => slotState(project, s));
}

function backup(project, slot, content) {
  const dir = path.join(BACKUPS, project.name.replace(/[^\w.-]+/g, '_'));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${path.basename(slot.target)}`);
  fs.writeFileSync(file, content, { mode: 0o600 });
  const all = fs.readdirSync(dir).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.rmSync(path.join(dir, old), { force: true });
  return file;
}

// Положить вариант на место target. Возвращает { changed, backup? }
function apply(project, slot, rel, config) {
  const v = variants(project, slot).find(x => x.rel === rel);
  if (!v) fail(`Вариант «${rel}» не найден в ${project.name}`, 404);
  const target = inside(project, slot.target);
  const data = fs.readFileSync(v.abs);
  const cur = readIf(target);
  if (cur && cur.equals(data)) return { changed: false };

  let saved;
  if (cur && !variants(project, slot).some(x => x.hash === sha(cur))) saved = backup(project, slot, cur);
  const tmp = `${target}.dev-panel.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, data, { mode: cur ? fs.statSync(target).mode & 0o777 : fs.statSync(v.abs).mode & 0o777 });
  fs.renameSync(tmp, target);
  if (slot.kind === 'env') writeIdeFile(project, slot, standIdeFor(config, slot.id, rel));
  return { changed: true, backup: saved };
}

// Сохранить текущее содержимое target как новый вариант в библиотеке панели (в репозитории ничего не создаётся)
function saveAs(project, slot, name) {
  const cur = readIf(inside(project, slot.target));
  if (!cur) fail(`Нет файла ${slot.target}`);
  libName(name);
  if (fs.existsSync(libFile(slot, name))) fail(`Вариант «${name}» уже есть в панели`);
  return libWrite(slot, name, cur);
}

/* ---------- переменные для IDE ---------- */

// .env: KEY=VALUE, комментарии, export, значения в кавычках (в том числе многострочные)
function parseEnv(text) {
  const vars = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    const q = val[0];
    if (q === '"' || q === "'") {
      let body = val.slice(1);
      while (!new RegExp(`${q}\\s*(#.*)?$`).test(body) && i + 1 < lines.length) body += '\n' + lines[++i];
      val = body.replace(new RegExp(`${q}\\s*(#.*)?$`), '');
    } else {
      val = val.replace(/\s+#.*$/, '');
    }
    vars.push({ key: m[1], value: val });
  }
  return vars;
}

// Пачка переменных, вставленная пользователем: .env построчно, с export и кавычками, либо одна строка KEY=V;KEY2=V2
function parseBulk(text) {
  const t = String(text).replace(/\r\n?/g, '\n').trim();
  if (!t) return [];
  if (!t.includes('\n') && t.includes(';')) {
    return t.split(';').map(x => x.trim()).filter(Boolean).flatMap(x => {
      const m = x.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=([\s\S]*)$/);
      return m ? [{ key: m[1], value: m[2].replace(/\\n/g, '\n').replace(/^(["'])([\s\S]*)\1$/, '$2') }] : [];
    });
  }
  return parseEnv(t);
}

// Переменные IDE, закреплённые за стендом, лежат в папке панели (в них бывают пароли, в config.json им не место)
const standIdeFile = id => {
  if (!/^[\w.-]+$/.test(String(id))) fail('Неверный стенд');
  return path.join(path.dirname(require('./userConfig').FILE), 'stands-ide', `${id}.json`);
};
function readStandIde(id) {
  try { return JSON.parse(fs.readFileSync(standIdeFile(id), 'utf8')); } catch { return {}; }
}
function writeStandIde(id, vars) {
  const file = standIdeFile(id);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(vars.map(v => [v.key, v.value])), null, 2), { mode: 0o600 });
}
function removeStandIde(id) {
  try { fs.rmSync(standIdeFile(id), { force: true }); } catch { /* нечего удалять */ }
}
// Стенд, в котором для этого файла выбран вариант rel и заданы переменные IDE: { title, vars }
function standIdeFor(config, slotId, rel) {
  const e = rel && (config?.envs || []).find(x => x.ide && x.picks?.[slotId] === rel);
  const vars = e && readStandIde(e.id);
  return vars && Object.keys(vars).length ? { title: e.title, vars } : null;
}

// Порядок: значения из .env, затем «свои значения» слота, затем переменные стенда
function ideVars(project, slot, extra) {
  const cur = readIf(inside(project, slot.target));
  if (!cur) fail(`Нет файла ${slot.target} — нечего выгружать`, 404);
  const map = new Map(parseEnv(cur.toString('utf8')).map(v => [v.key, v.value]));
  for (const [k, v] of Object.entries(slot.ideOverrides || {})) map.set(k, String(v));
  for (const [k, v] of Object.entries(extra?.vars || {})) map.set(k, String(v));
  return [...map].map(([key, value]) => ({ key, value }));
}

// Форматы вставки в IDE: построчно (KEY=VALUE) и в одну строку через «;» (переносы значения заменены на \n)
function ideExport(project, slot, extra) {
  const vars = ideVars(project, slot, extra);
  const one = s => s.replace(/\n/g, '\\n');
  return {
    count: vars.length,
    overrides: Object.keys(slot.ideOverrides || {}),
    stand: extra ? { title: extra.title, keys: Object.keys(extra.vars) } : null,
    lines: vars.map(v => `${v.key}=${v.value.includes('\n') ? JSON.stringify(v.value) : v.value}`).join('\n'),
    joined: vars.map(v => `${v.key}=${one(v.value)}`).join(';'),
    file: ideFile(project),
  };
}

const ideFile = project => path.join(IDE_DIR, `${project.name.replace(/[^\w.-]+/g, '_')}.env`);

// Постоянный путь для плагинов вроде EnvFile: содержимое обновляется при каждой смене окружения
function writeIdeFile(project, slot, extra) {
  try {
    fs.mkdirSync(IDE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(ideFile(project), ideExport(project, slot, extra).lines + '\n', { mode: 0o600 });
  } catch { /* нет файла/прав — выгрузка по кнопке всё равно доступна */ }
}

/* ---------- адреса стенда из config.js фронтенда ---------- */

// BACKEND_URL из активного public/config.js (строки с // пропускаем): к нему ходит и фронтенд, и логин панели
function frontendBackendUrl(content) {
  for (const line of String(content).split(/\r?\n/)) {
    if (/^\s*\/\//.test(line)) continue;
    const m = line.match(/\bBACKEND_URL\s*:\s*['"`]([^'"`]+)['"`]/);
    if (m) return m[1];
  }
  return null;
}

// Все адреса бэкендов из config.js: BACKEND_URL (базовый, стенд) и, например, BACKEND_URL_PLANS (локальный бэкенд)
function frontendBackendUrls(content) {
  const out = {};
  for (const line of String(content).split(/\r?\n/)) {
    if (/^\s*\/\//.test(line)) continue;
    for (const m of line.matchAll(/\b(BACKEND_URL\w*)\s*:\s*['"`]([^'"`]+)['"`]/g)) if (!(m[1] in out)) out[m[1]] = m[2];
  }
  return out;
}

// Для логина: активный config.js первого проекта группы с kind 'js' (предпочитаем запущенный фронтенд)
// Активный config.js первого подходящего проекта: { project, content }
function activeFrontend(config, preferProject) {
  for (const slot of (config.swaps || []).filter(x => x.enabled && x.kind === 'js')) {
    const g = config.groups.find(x => x.id === slot.group);
    const projects = (g?.projects || []).slice().sort((a, b) => (b.name === preferProject) - (a.name === preferProject));
    for (const p of projects) {
      const cur = readIf(path.join(p.path, slot.target));
      if (cur) return { project: p.name, content: cur.toString('utf8') };
    }
  }
  return null;
}

function authBase(config, preferProject) {
  for (const slot of (config.swaps || []).filter(s => s.enabled && s.kind === 'js')) {
    const g = config.groups.find(x => x.id === slot.group);
    const projects = (g?.projects || []).slice().sort((a, b) => (b.name === preferProject) - (a.name === preferProject));
    for (const p of projects) {
      const cur = readIf(path.join(p.path, slot.target));
      const url = cur && frontendBackendUrl(cur.toString('utf8'));
      if (url) return { url, project: p.name };
    }
  }
  return null;
}

/* ---------- пресеты (стенды) ---------- */

// Проект группы для применения пресета: указанный явно или единственный в группе
function pickProject(config, groupId, wantedId) {
  const g = config.groups.find(x => x.id === groupId);
  if (!g) fail(`Нет группы ${groupId}`, 404);
  const p = wantedId ? g.projects.find(x => x.id === wantedId) : g.projects.length === 1 ? g.projects[0] : null;
  if (!p) fail(`Выберите репозиторий в группе «${g.title}», к которому применить окружение`);
  return p;
}

// Применить пресет ко всем своим слотам. Сначала проверяем всё, потом меняем файлы — чтобы не остаться на полпути.
// projects: { groupId: projectId }
function applyPreset(config, preset, projects = {}) {
  const plan = [];
  for (const [slotId, rel] of Object.entries(preset.picks || {})) {
    const slot = (config.swaps || []).find(x => x.id === slotId && x.enabled);
    if (!slot) continue; // слот отключён или удалён — пропускаем
    const project = pickProject(config, slot.group, projects[slot.group]);
    if (!variants(project, slot).some(v => v.rel === rel)) fail(`В ${project.name} нет файла ${rel} — окружение «${preset.title}» не применено`);
    plan.push({ project, slot, rel });
  }
  if (!plan.length) fail('В окружении нет подходящих файлов');
  return plan.map(({ project, slot, rel }) => ({ project: project.name, projectId: project.id, slot: slot.title, file: rel, ...apply(project, slot, rel, config) }));
}

// Окружение «по факту»: какой пресет совпадает с тем, что сейчас лежит в проектах
function matchPreset(config, projects = {}) {
  return (config.envs || []).filter(e => {
    const entries = Object.entries(e.picks || {});
    return entries.length && entries.every(([slotId, rel]) => {
      const slot = (config.swaps || []).find(x => x.id === slotId && x.enabled);
      const project = slot && config.groups.find(g => g.id === slot.group)?.projects.find(p => p.id === projects[slot.group]);
      return project && slotState(project, slot).active === rel;
    });
  }).map(e => e.id);
}

// Скрыть файлы от git локально: строки в .git/info/exclude (этот файл не коммитится и не уходит в репозиторий)
function excludeFromGit(project, rels) {
  const { execFileSync } = require('child_process');
  const list = (Array.isArray(rels) ? rels : [rels]).map(r => { inside(project, r); return r; });
  let file;
  try { file = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: project.path, encoding: 'utf8' }).trim(); } catch { fail('Это не git-репозиторий'); }
  file = path.resolve(project.path, file);
  const cur = readIf(file)?.toString('utf8') || '';
  const have = new Set(cur.split(/\r?\n/));
  const add = list.filter(r => !have.has(`/${r}`));
  if (add.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${cur && !cur.endsWith('\n') ? '\n' : ''}${add.map(r => `/${r}`).join('\n')}\n`);
  }
  return { file, added: add };
}

module.exports = {
  excludeFromGit, libName, libWrite, libRemove, libVariants, libRoot, readIf, sha,
  pickProject, applyPreset, matchPreset, standsForProject, slotsFor, findSlot, variants, slotState, projectState, apply, saveAs,
  parseEnv, parseBulk, readStandIde, writeStandIde, removeStandIde, standIdeFor, ideVars, ideExport, ideFile, writeIdeFile, frontendBackendUrl, frontendBackendUrls, authBase, activeFrontend, BACKUPS, IDE_DIR,
};

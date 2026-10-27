// Итоговый конфиг = defaults.json (поставляется с панелью) + пользовательские настройки.
//   vars          — пользователь переопределяет отдельные значения
//   groups[id]    — addPaths / exclude / discoverRoot / hidden / extra / primary для группы из defaults
//   customGroups  — группы, созданные пользователем целиком
//   actions[id]   — изменённое системное действие или собственное действие
const fs = require('fs');
const os = require('os');
const path = require('path');
const { render } = require('./template');
const userConfig = require('./userConfig');

const DEFAULTS_PATH = path.join(__dirname, '..', 'defaults.json');
const CONFIG_PATH = userConfig.FILE;

const BROWSERS = ['brave-browser', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

function which(bin) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const f = path.join(dir, bin);
    try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile()) return f; } catch { /* нет */ }
  }
  return null;
}

const detectBrowser = () => BROWSERS.find(which) || '';

function readDefaults() {
  return JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'));
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// Папки группы: из paths, из addPaths и найденные в discover.root. Исключённые убираются.
function resolveProjects(group, groupId) {
  const exclude = new Set(group.exclude || []);
  const source = new Map(); // путь → откуда взят
  for (const p of group.paths || []) source.set(p, 'default');
  for (const p of group.addPaths || []) source.set(p, 'manual');
  if (group.discover?.root) {
    const { root, requireFile } = group.discover;
    for (const name of safeReaddir(root)) {
      const dir = path.join(root, name);
      if (fs.existsSync(path.join(dir, '.git')) && (!requireFile || fs.existsSync(path.join(dir, requireFile)))) {
        if (!source.has(dir)) source.set(dir, 'auto');
      }
    }
  }
  return [...source]
    .filter(([p]) => p && !exclude.has(p) && !exclude.has(path.basename(p)))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, from]) => ({
      id: `${groupId}:${path.basename(p)}`, name: path.basename(p), path: p, group: groupId,
      source: from, missing: !isDir(p),
    }));
}

// Секции группы: системные + добавленные пользователем (extra), без скрытых действий
function resolveSections(group) {
  const hidden = new Set(group.hidden || []);
  const sections = (group.sections || []).map(s => ({ title: s.title, actions: [...s.actions] }));
  for (const e of group.extra || []) {
    const target = sections.find(s => s.title === e.section) || sections[sections.push({ title: e.section, actions: [] }) - 1];
    for (const a of e.actions) if (!target.actions.includes(a)) target.actions.push(a);
  }
  return sections
    .map(s => ({ ...s, actions: s.actions.filter(a => !hidden.has(a)) }))
    .filter(s => s.actions.length);
}

function load() {
  const defaults = readDefaults();
  const user = userConfig.read();

  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const vars = { home: os.homedir(), dataHome, ...defaults.vars, ...stripEmpty(user.vars) };
  if (!vars.browserCmd) vars.browserCmd = detectBrowser();
  const resolved = render(vars, vars);

  const actions = {};
  for (const [id, a] of Object.entries(defaults.actions || {})) {
    const own = user.actions?.[id];
    actions[id] = { ...(own || a), id, system: true, modified: Boolean(own) };
  }
  for (const [id, a] of Object.entries(user.actions || {})) {
    if (!actions[id]) actions[id] = { ...a, id, system: false, modified: false };
  }

  const baseGroups = (defaults.groups || []).map(g => ({ ...g, system: true }));
  const customGroups = (user.customGroups || []).map(g => ({ ...g, system: false }));
  const groups = [...baseGroups, ...customGroups].map(g => {
    const ov = g.system ? (user.groups?.[g.id] || {}) : {};
    // пока корень проектов не задан, пути на его основе не показываем (иначе получится «/CLIENT»)
    const paths = (g.paths || []).filter(p => resolved.calplanRoot || !p.includes('{calplanRoot}'));
    const merged = {
      ...g,
      paths,
      discover: ov.discoverRoot !== undefined
        ? (ov.discoverRoot ? { ...g.discover, root: ov.discoverRoot, requireFile: g.discover?.requireFile ?? ov.requireFile } : undefined)
        : g.discover,
      addPaths: [...(g.addPaths || []), ...(ov.addPaths || [])],
      exclude: [...(g.exclude || []), ...(ov.exclude || [])],
      hidden: g.system ? (ov.hidden || []) : (g.hidden || []),
      extra: g.system ? (ov.extra || []) : (g.extra || []),
      primary: ov.primary !== undefined ? ov.primary : g.primary,
    };
    // скрытое действие не может быть главным
    if (merged.hidden.includes(merged.primary)) merged.primary = null;
    const rendered = render(merged, resolved);
    return {
      ...rendered,
      raw: { discover: g.discover, paths: g.paths || [], sections: g.sections || [], primary: g.primary },
      sections: resolveSections(rendered),
      projects: resolveProjects(rendered, g.id),
    };
  });

  return {
    port: Number(process.env.DEV_PANEL_PORT || user.vars?.port || defaults.port || 7777),
    vars: resolved,
    groups,
    actions,
    prefs: user.prefs || {},
    path: CONFIG_PATH,
    configured: Boolean(resolved.calplanRoot) || groups.some(g => !g.system) || groups.some(g => g.projects.length),
  };
}

function stripEmpty(obj = {}) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v != null));
}

module.exports = { load, readDefaults, detectBrowser, which, CONFIG_PATH, DEFAULTS_PATH };

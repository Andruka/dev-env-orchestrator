#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { load } = require('./lib/config');
const { render } = require('./lib/template');
const runner = require('./lib/runner');
const services = require('./lib/services');
const status = require('./lib/status');
const bus = require('./lib/bus');
const ws = require('./lib/ws');
const secrets = require('./lib/secrets');
const auth = require('./lib/auth');
const authKeeper = require('./lib/authKeeper');
const snapshots = require('./lib/snapshots');
const admin = require('./lib/admin');
const userConfig = require('./lib/userConfig');
const fsBrowse = require('./lib/fsBrowse');
const doctor = require('./lib/doctor');
const envswap = require('./lib/envswap');
const stands = require('./lib/stands');
const journal = require('./lib/journal');
const ports = require('./lib/ports');
const cleanup = require('./lib/cleanup');
const selfupdate = require('./lib/selfupdate');
const pkg = require('./package.json');

let config = load();
snapshots.configure(config.vars);
// Логин ходит на тот стенд, к которому сейчас подключён фронтенд (если не отключено в «Окружение»)
// Настройки с учётом активного стенда: у стенда может быть своя стартовая страница фронтенда (id объекта зависит от базы)
function effectiveVars() {
  const base = config.vars.authFollowsEnv === false ? null : envswap.authBase(config, services.get('frontend')?.project);
  let origin = null;
  try { origin = base && new URL(base.url).origin; } catch { /* адрес не разобрать — стенд не определён */ }
  const stand = origin && (config.envs || []).find(e => e.origin === origin && e.startUrl);
  return stand ? { ...config.vars, frontendUrl: stand.startUrl } : config.vars;
}
auth.setBaseResolver(() => (config.vars.authFollowsEnv === false ? null : envswap.authBase(config, services.get('frontend')?.project)));

const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain', '.md': 'text/markdown',
};

function findProject(id) {
  for (const g of config.groups) {
    const p = g.projects.find(p => p.id === id);
    if (p) return p;
  }
  throw httpError(404, `Проект не найден: ${id}`);
}

function httpError(code, message) {
  return Object.assign(new Error(message), { code });
}

// Переменные, нужные интерфейсу (остальные — пути и команды — наружу не отдаём)
const CLIENT_VARS = ['frontendUrl', 'frontendPort', 'dbPort', 'debugPort', 'calplanRoot', 'composeFile', 'swaggerUiPort', 'swaggerEditorPort', 'swaggerMockPort'];

function publicConfig() {
  return {
    version: pkg.version,
    configured: config.configured,
    prefs: config.prefs,
    swaps: config.swaps.filter(sw => sw.enabled).map(({ id, group, title, target, kind }) => ({ id, group, title, target, kind })),
    envs: config.envs,
    vars: Object.fromEntries(CLIENT_VARS.map(k => [k, config.vars[k]])),
    groups: config.groups.map(({ discover, paths, addPaths, exclude, raw, hidden, extra, ...g }) => ({
      ...g, sections: g.sections.length ? g.sections : [], primary: g.primary || null,
    })),
    actions: Object.fromEntries(Object.entries(config.actions).map(([id, a]) => [id, {
      title: a.title, hint: a.hint, icon: a.icon, danger: a.danger, confirm: a.confirm, params: a.params || [], internal: a.internal,
    }])),
  };
}

// Полная модель для окна настроек: всё, что можно менять, и откуда взято значение
function adminModel() {
  const defaults = require('./lib/config').readDefaults();
  const user = userConfig.read();
  return {
    file: userConfig.FILE,
    vars: config.vars,
    userVars: user.vars,
    defaultVars: defaults.vars,
    groups: config.groups.map(g => ({
      id: g.id, title: g.title, kind: g.kind, system: g.system,
      discoverRoot: g.discover?.root || '', requireFile: g.discover?.requireFile || '',
      projects: g.projects, hidden: g.hidden, primary: g.primary || null, defaultPrimary: g.raw.primary || null,
      sections: g.sections, defaultSections: g.raw.sections,
      customised: g.system ? Boolean(user.groups?.[g.id] && Object.keys(user.groups[g.id]).length) : false,
    })),
    actions: Object.fromEntries(Object.entries(config.actions).map(([id, a]) => [id, a])),
    defaultActions: defaults.actions,
    stepTypes: Object.keys(require('./lib/steps')),
    prefs: config.prefs,
    swaps: config.swaps,
    defaultSwaps: defaults.swaps || [],
    envs: config.envs.map(e => ({
      ...e,
      // файлы стенда в библиотеке панели, которых нет (например, после импорта профиля коллеги)
      missing: Object.entries(e.picks || {}).filter(([slotId, rel]) => {
        const slot = config.swaps.find(s => s.id === slotId);
        return slot && rel.startsWith('@') && !envswap.libVariants(slot).some(v => v.rel === rel);
      }).map(([slotId, rel]) => ({ slot: slotId, file: rel.slice(1) })),
    })),
    standCreds: secrets.publicView().stands,
    // какие файлы можно выбрать в слоте: объединение вариантов по всем репозиториям группы
    swapFiles: Object.fromEntries(config.swaps.map(sw => [sw.id, [...new Set(
      (config.groups.find(g => g.id === sw.group)?.projects || []).flatMap(p => envswap.variants(p, sw).map(v => v.rel)))]])),
  };
}

async function paramOptions(projectId, actionId, paramName) {
  const project = findProject(projectId);
  const param = (config.actions[actionId]?.params || []).find(p => p.name === paramName);
  if (!param) throw httpError(404, 'Параметр не найден');
  const p = render(param, { ...effectiveVars(), project });
  switch (p.type) {
    case 'gitBranch': return (await status.branches(project.path)).map(b => ({ value: b, label: b }));
    case 'file': return status.files(p.dir, p.ext).map(f => ({
      value: f.name, label: f.name, meta: `${(f.size / 1024 ** 2).toFixed(0)} MB · ${new Date(f.mtime).toLocaleDateString('ru-RU')}`,
    }));
    case 'stash': return status.stashes(project.path);
    case 'snapshot': return snapshots.list(p.kind).map(sn => ({
      value: sn.id, label: sn.label || sn.id,
      meta: `${sn.kind} · ${snapshots.human(sn.size)} · ${new Date(sn.createdAt).toLocaleDateString('ru-RU')}`,
    }));
    case 'text': return [];
    case 'select': return p.options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
    default: return [];
  }
}

function reload() {
  config = load();
  snapshots.configure(config.vars);
  authKeeper.start(config.vars);
  authKeeper.setStartUrlResolver(() => effectiveVars().frontendUrl);
  bus.emit('config', {});
}

// Изменение настроек: выполнить, перечитать конфиг, сообщить всем открытым окнам
const mutate = fn => async (q, body) => {
  const result = await fn(body, q);
  reload();
  return { ok: true, ...result };
};

const routes = {
  'GET /api/config': () => publicConfig(),
  'POST /api/reload': () => { reload(); return publicConfig(); },
  'GET /api/admin': () => adminModel(),
  'GET /api/fs': (q) => fsBrowse.list(q.path, { hidden: q.hidden === '1' }),
  'GET /api/doctor': () => doctor.run(config),
  'POST /api/repos/add': mutate(b => admin.addRepo(b.group, b.path, config)),
  'POST /api/repos/remove': mutate(b => admin.removeRepo(b.group, b.path)),
  'POST /api/repos/root': mutate(b => admin.setDiscoverRoot(b.group, b.root)),
  'POST /api/groups/create': mutate(b => admin.createGroup(b)),
  'POST /api/groups/delete': mutate(b => admin.deleteGroup(b.id)),
  'POST /api/groups/reset': mutate(b => admin.resetGroup(b.id)),
  'POST /api/groups/primary': mutate(b => admin.setPrimary(b.group, b.action)),
  'POST /api/actions/save': mutate(b => admin.saveAction(b, config)),
  'POST /api/actions/delete': mutate(b => admin.deleteAction(b.id)),
  'POST /api/actions/reset': mutate(b => admin.resetAction(b.id)),
  'POST /api/actions/hide': mutate(b => admin.setHidden(b.group, b.action, b.hidden !== false)),
  'POST /api/actions/place': mutate(b => admin.place(b.group, b.section, b.action)),
  'POST /api/swaps/save': mutate(b => admin.saveSwap(b, config)),
  'POST /api/swaps/reset': mutate(b => admin.resetSwap(b.id)),
  'POST /api/envs/save': mutate(b => admin.saveEnv(b)),
  'POST /api/envs/delete': mutate(b => admin.deleteEnv(b.id)),
  'GET /api/stands/ide': (q) => {
    const e = config.envs.find(x => x.id === q.id);
    if (!e) throw httpError(404, 'Стенд не найден');
    const vars = envswap.readStandIde(e.id);
    return { text: Object.entries(vars).map(([k, v]) => `${k}=${v.includes('\n') ? `"${v}"` : v}`).join('\n') };
  },
  'POST /api/stands/save': mutate(b => { const r = stands.save(config, b); journal.add('stand', `Стенд «${b.title}» ${b.id ? 'изменён' : 'создан'}`); setTimeout(() => authKeeper.tick(), 0); return r; }),
  'POST /api/stands/delete': mutate(b => { const t = (config.envs || []).find(e => e.id === b.id)?.title; stands.remove(config, b.id); journal.add('stand', `Стенд «${t || b.id}» удалён`); setTimeout(() => authKeeper.tick(), 0); return {}; }),
  'POST /api/env/apply': (q, body) => {
    const project = findProject(body.project);
    const slot = envswap.findSlot(config, project, body.slot);
    const r = envswap.apply(project, slot, body.variant, config);
    journal.add('stand', `${project.name}: ${slot.title} → ${String(body.variant).replace(/^@/, '')}`, { changed: r.changed });
    bus.emit('config', {});
    return { ...r, project: project.name, state: envswap.slotState(project, slot) };
  },
  'POST /api/env/preset': (q, body) => {
    const preset = config.envs.find(e => e.id === body.id);
    if (!preset) throw httpError(404, 'Окружение не найдено');
    const results = envswap.applyPreset(config, preset, body.projects || {});
    journal.add('stand', `Стенд «${preset.title}» применён`, { projects: [...new Set(results.map(r => r.project))].join(', '), changed: results.some(r => r.changed) });
    bus.emit('config', {});
    return { ok: true, title: preset.title, results };
  },
  'POST /api/env/exclude': (q, body) => {
    const project = findProject(body.project);
    const slot = envswap.findSlot(config, project, body.slot);
    const open = envswap.variants(project, slot).map(v => v.rel).filter(r => body.files?.includes(r));
    if (!open.length) throw httpError(400, 'Нет таких файлов-вариантов');
    return envswap.excludeFromGit(project, open);
  },
  'POST /api/env/save-as': (q, body) => {
    const project = findProject(body.project);
    const slot = envswap.findSlot(config, project, body.slot);
    const file = envswap.saveAs(project, slot, body.name);
    bus.emit('config', {});
    return { ok: true, file };
  },
  'GET /api/env/ide': (q) => {
    const project = findProject(q.project);
    const slot = envswap.findSlot(config, project, q.slot);
    const extra = envswap.standIdeFor(config, slot.id, envswap.slotState(project, slot).active);
    const out = envswap.ideExport(project, slot, extra);
    envswap.writeIdeFile(project, slot, extra);
    return out;
  },
  'POST /api/vars': mutate(b => admin.setVars(b.vars)),
  'POST /api/prefs': mutate(b => admin.setPrefs(b.prefs)),
  'GET /api/backup': () => admin.exportConfig(),
  'POST /api/backup': mutate(b => admin.importConfig(b)),
  'GET /api/status': () => status.collect(config),
  'GET /api/options': (q) => paramOptions(q.project, q.action, q.param),
  'GET /api/jobs': () => runner.list(),
  'GET /api/job': (q) => {
    const j = runner.get(q.id);
    if (!j) throw httpError(404, 'Задача не найдена');
    const { cancelHandlers, flags, ...rest } = j;
    return rest;
  },
  'POST /api/run': (q, body) => runner.start({ ...config, vars: effectiveVars() }, {
    actionId: body.action, project: findProject(body.project), params: body.params || {},
  }),
  'POST /api/cancel': (q) => ({ ok: runner.cancel(q.id) }),
  'GET /api/settings': () => {
    const view = secrets.publicView();
    const eff = auth.effective(secrets.read().auth);
    return { ...view, effective: eff.base ? { origin: eff.base.origin, project: eff.base.project, loginUrl: eff.auth.loginUrl, ownCreds: eff.base.ownCreds, login: eff.auth.login } : null };
  },
  'POST /api/settings/stand': (q, body) => { const r = secrets.updateStand(body); authKeeper.tick(); return r; },
  'POST /api/settings/stand/delete': (q, body) => { const r = secrets.deleteStand(body.origin); authKeeper.tick(); return r; },
  'POST /api/settings': (q, body) => { const r = secrets.updateAuth(body.auth || {}); authKeeper.tick(); return r; },
  'POST /api/settings/test': async () => {
    const lines = [];
    const { user } = await auth.login(l => lines.push(l));
    return { ok: true, lines, user };
  },
  'POST /api/stands/test': async (q, body) => {
    const e = (config.envs || []).find(x => x.id === body.id);
    if (!e) throw httpError(404, 'Стенд не найден');
    if (!e.origin) throw httpError(400, 'У стенда не определён адрес бэкенда — укажите его в форме стенда');
    return { title: e.title, origin: e.origin, ...(await auth.testOrigin(e.origin)) };
  },
  'GET /api/port': async (q) => ports.info(q.port),
  'POST /api/port/free': async (q, body) => {
    const r = await ports.free(body.port);
    journal.add('port', `Освобождён порт ${body.port}`, { note: r.note });
    return r;
  },
  'GET /api/cleanup': () => cleanup.scan(config),
  'POST /api/cleanup': async (q, body) => {
    const r = await cleanup.act(config, body.what, body.arg);
    journal.add('cleanup', r.note || body.what);
    return r;
  },
  'GET /api/journal': (q) => journal.list({ limit: Math.min(Number(q.limit) || 200, 800), type: q.type }),
  'GET /api/update': async (q) => ({ ...(await selfupdate.check({ fresh: q.fresh === '1' })), changelog: selfupdate.changelog() }),
  'POST /api/update/apply': async () => {
    const r = await selfupdate.apply({ busy: runner.list().some(j => j.status === 'running') });
    if (r.updated) journal.add('update', `Панель обновлена: ${r.from} → ${r.to}`, { commits: r.note });
    return r;
  },
  'GET /api/profile': () => admin.exportProfile(),
  'POST /api/profile': mutate(b => ({ added: admin.importProfile(b) })),
  'GET /api/auth': () => authKeeper.state(),
  'POST /api/auth/check': async () => { await authKeeper.tick(); return authKeeper.state(); },
  'GET /api/services': () => services.list(),
  'GET /api/service/logs': (q) => services.logs(q.name),
  'POST /api/service/stop': async (q) => ({ ok: await services.stop(q.name) }),
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 2e6) { reject(httpError(413, 'Слишком большой запрос')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(httpError(400, 'Bad JSON')); } });
  });
}

function send(res, code, body, type = 'application/json') {
  const textual = /^(text\/|application\/json|image\/svg)/.test(type);
  res.writeHead(code, { 'Content-Type': textual ? `${type}; charset=utf-8` : type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

// Панель выполняет команды от имени пользователя, поэтому открыта только самой себе:
//  - Host должен быть localhost/127.0.0.1 (защита от DNS rebinding);
//  - Origin, если он есть, должен совпадать с Host (защита от запросов с чужих сайтов).
function sameOrigin(req) {
  const host = String(req.headers.host || '');
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  if (!sameOrigin(req)) return send(res, 403, { error: 'Запрос отклонён: чужой Host/Origin' });
  const url = new URL(req.url, 'http://localhost');
  const q = Object.fromEntries(url.searchParams);

  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) {
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      send(res, 200, await handler(q, body));
    } catch (e) {
      send(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 400, { error: e.message });
    }
    return;
  }

  const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
});

server.on('upgrade', (req, socket) => {
  if (!sameOrigin(req)) return socket.destroy();
  if (new URL(req.url, 'http://localhost').pathname !== '/api/ws') return socket.destroy();
  const client = ws.accept(req, socket);
  if (client) bus.subscribe(client);
});

setInterval(() => bus.ping(), 20000);

// Журнал: итог каждой задачи (один раз, когда она завершилась)
const journaled = new Set();
runner.onFinish = job => {
  if (journaled.has(job.id)) return;
  journaled.add(job.id);
  const ok = job.status === 'done';
  journal.add('job', `${job.title} · ${job.project}: ${ok ? 'готово' : job.status === 'cancelled' ? 'отменено' : 'ошибка'}`, {
    action: job.action, status: job.status, seconds: Math.round(((job.finishedAt || Date.now()) - job.startedAt) / 1000), ...(job.error && { error: String(job.error).slice(0, 200) }),
  });
};

services.adopt();

server.listen(config.port, '127.0.0.1', () => {
  console.log(`Dev Panel: http://localhost:${config.port}`);
  authKeeper.start(config.vars);
  authKeeper.setStartUrlResolver(() => effectiveVars().frontendUrl);
});

// Сервисы (dup, npm start) не останавливаются вместе с панелью — следующий запуск их подхватит
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));

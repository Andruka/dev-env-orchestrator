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

let config = load();

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

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

function publicConfig() {
  return {
    vars: config.vars,
    groups: config.groups.map(({ discover, paths, exclude, ...g }) => ({
      ...g, sections: g.sections || [{ title: 'Действия', actions: g.actions || [] }],
    })),
    actions: Object.fromEntries(Object.entries(config.actions).map(([id, a]) => [id, {
      title: a.title, hint: a.hint, icon: a.icon, danger: a.danger, confirm: a.confirm, params: a.params || [],
    }])),
  };
}

async function paramOptions(projectId, actionId, paramName) {
  const project = findProject(projectId);
  const param = (config.actions[actionId]?.params || []).find(p => p.name === paramName);
  if (!param) throw httpError(404, 'Параметр не найден');
  const p = render(param, { ...config.vars, project });
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

const routes = {
  'GET /api/config': () => publicConfig(),
  'POST /api/reload': () => { config = load(); authKeeper.start(config.vars); return publicConfig(); },
  'GET /api/status': () => status.collect(config),
  'GET /api/options': (q) => paramOptions(q.project, q.action, q.param),
  'GET /api/jobs': () => runner.list(),
  'GET /api/job': (q) => {
    const j = runner.get(q.id);
    if (!j) throw httpError(404, 'Задача не найдена');
    const { cancelHandlers, flags, ...rest } = j;
    return rest;
  },
  'POST /api/run': (q, body) => runner.start(config, {
    actionId: body.action, project: findProject(body.project), params: body.params || {},
  }),
  'POST /api/cancel': (q) => ({ ok: runner.cancel(q.id) }),
  'GET /api/settings': () => secrets.publicView(),
  'POST /api/settings': (q, body) => { const r = secrets.updateAuth(body.auth || {}); authKeeper.tick(); return r; },
  'POST /api/settings/test': async () => {
    const lines = [];
    const { user } = await auth.login(l => lines.push(l));
    return { ok: true, lines, user };
  },
  'GET /api/auth': () => authKeeper.state(),
  'POST /api/auth/check': async () => { await authKeeper.tick(); return authKeeper.state(); },
  'GET /api/services': () => services.list(),
  'GET /api/service/logs': (q) => services.logs(q.name),
  'POST /api/service/stop': async (q) => ({ ok: await services.stop(q.name) }),
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(httpError(400, 'Bad JSON')); } });
  });
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8` });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

const server = http.createServer(async (req, res) => {
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
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
});

server.on('upgrade', (req, socket) => {
  if (new URL(req.url, 'http://localhost').pathname !== '/api/ws') return socket.destroy();
  const client = ws.accept(req, socket);
  if (client) bus.subscribe(client);
});

setInterval(() => bus.ping(), 20000);

services.adopt();

server.listen(config.port, '127.0.0.1', () => {
  console.log(`Dev Panel: http://localhost:${config.port}`);
  authKeeper.start(config.vars);
});

// Сервисы (dup, npm start) не останавливаются вместе с панелью — следующий запуск их подхватит
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));

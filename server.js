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
    groups: config.groups.map(({ discover, paths, exclude, ...g }) => g),
    actions: Object.fromEntries(Object.entries(config.actions).map(([id, a]) => [id, {
      title: a.title, hint: a.hint, icon: a.icon, primary: a.primary, confirm: a.confirm, params: a.params || [],
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
    case 'select': return p.options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
    default: return [];
  }
}

const routes = {
  'GET /api/config': () => publicConfig(),
  'POST /api/reload': () => { config = load(); return publicConfig(); },
  'GET /api/status': () => status.collect(config),
  'GET /api/options': (q) => paramOptions(q.project, q.action, q.param),
  'GET /api/jobs': () => runner.list(),
  'GET /api/job': (q) => {
    const j = runner.get(q.id);
    if (!j) throw httpError(404, 'Задача не найдена');
    const { cancelHandlers, ...rest } = j;
    return rest;
  },
  'POST /api/run': (q, body) => runner.start(config, {
    actionId: body.action, project: findProject(body.project), params: body.params || {},
  }),
  'POST /api/cancel': (q) => ({ ok: runner.cancel(q.id) }),
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

  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    bus.subscribe(res);
    return;
  }

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

setInterval(() => bus.emit('ping', {}), 15000);

server.listen(config.port, '127.0.0.1', () => {
  console.log(`Dev Panel: http://localhost:${config.port}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log('Останавливаю сервисы...');
    await services.stopAll();
    process.exit(0);
  });
}

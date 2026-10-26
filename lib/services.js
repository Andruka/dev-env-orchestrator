// Долгоживущие процессы (docker compose up, npm start). Один процесс на имя.
const { spawnShell, killTree, onLines } = require('./proc');
const bus = require('./bus');

const MAX_LINES = 3000;
const services = new Map();

function summary(s) {
  return { name: s.name, project: s.project, status: s.status, startedAt: s.startedAt, exitCode: s.exitCode };
}

function list() {
  return [...services.values()].map(summary);
}

function logs(name) {
  return services.get(name)?.lines || [];
}

function setStatus(s, status) {
  s.status = status;
  bus.emit('service', summary(s));
}

function start(name, { cmd, cwd, env, project }) {
  const prev = services.get(name);
  if (prev && prev.status !== 'stopped' && prev.status !== 'exited') {
    throw new Error(`Сервис "${name}" уже запущен (${prev.project}). Сначала остановите его.`);
  }
  const child = spawnShell(cmd, { cwd, env });
  child.stdin.end();
  const s = { name, project, child, lines: [], listeners: new Set(), startedAt: Date.now(), exitCode: null };
  services.set(name, s);
  onLines(child, line => {
    s.lines.push(line);
    if (s.lines.length > MAX_LINES) s.lines.splice(0, s.lines.length - MAX_LINES);
    bus.emit('serviceLog', { name, line });
    s.listeners.forEach(fn => fn(line));
  });
  child.on('close', code => {
    s.exitCode = code;
    s.listeners.forEach(fn => fn(null));
    setStatus(s, s.status === 'stopping' ? 'stopped' : 'exited');
  });
  setStatus(s, 'running');
  return s;
}

function stop(name, timeoutMs = 20000) {
  const s = services.get(name);
  if (!s || s.child.exitCode !== null || s.status === 'stopped' || s.status === 'exited') return Promise.resolve(false);
  setStatus(s, 'stopping');
  return new Promise(resolve => {
    const t = setTimeout(() => killTree(s.child, 'SIGKILL'), timeoutMs);
    s.child.on('close', () => { clearTimeout(t); resolve(true); });
    killTree(s.child, 'SIGINT');
  });
}

function stopAll() {
  return Promise.all([...services.keys()].map(n => stop(n, 5000)));
}

module.exports = { start, stop, stopAll, list, logs, get: n => services.get(n) };

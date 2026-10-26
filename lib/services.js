// Долгоживущие процессы (docker compose up, npm start). Один процесс на имя.
// Процессы не зависят от панели: вывод пишется в файл, а описание — в state-каталог,
// поэтому перезапуск панели их не останавливает, и новая панель подхватывает их при старте.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const guard = require('./guard');
const bus = require('./bus');

const MAX_LINES = 3000;
const STATE_DIR = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'dev-panel', 'services');
fs.mkdirSync(STATE_DIR, { recursive: true });

const services = new Map();

const metaFile = name => path.join(STATE_DIR, `${name}.json`);
const logFile = name => path.join(STATE_DIR, `${name}.log`);

// Время старта процесса из /proc защищает от повторного использования pid
function procStart(pid) {
  try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19]; } catch { return null; }
}

function alive(s) {
  return procStart(s.pid) === s.procStart;
}

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

function pushLine(s, raw) {
  const line = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  s.lines.push(line);
  if (s.lines.length > MAX_LINES) s.lines.splice(0, s.lines.length - MAX_LINES);
  bus.emit('serviceLog', { name: s.name, line });
  s.listeners.forEach(fn => fn(line));
}

// Чтение новых строк из лог-файла и проверка, жив ли процесс
function watch(s) {
  let partial = '';
  const poll = () => {
    try {
      const size = fs.statSync(s.log).size;
      if (size > s.offset) {
        const fd = fs.openSync(s.log, 'r');
        const buf = Buffer.alloc(size - s.offset);
        fs.readSync(fd, buf, 0, buf.length, s.offset);
        fs.closeSync(fd);
        s.offset = size;
        const parts = (partial + buf.toString('utf8')).split(/\r?\n|\r/);
        partial = parts.pop();
        parts.forEach(l => pushLine(s, l));
      }
    } catch { /* файл мог быть удалён */ }
    if (!alive(s) && s.status !== 'exited' && s.status !== 'stopped') {
      clearInterval(s.timer);
      if (partial) pushLine(s, partial);
      fs.rmSync(metaFile(s.name), { force: true });
      s.listeners.forEach(fn => fn(null));
      setStatus(s, s.status === 'stopping' ? 'stopped' : 'exited');
    }
  };
  s.timer = setInterval(poll, 300);
}

function isRunning(s) {
  return s && (s.status === 'running' || s.status === 'stopping');
}

function start(name, { cmd, cwd, env, project }) {
  const prev = services.get(name);
  if (isRunning(prev)) throw new Error(`Сервис "${name}" уже запущен (${prev.project}). Сначала остановите его.`);
  guard.check(cmd);
  const log = logFile(name);
  const fd = fs.openSync(log, 'w');
  const child = spawn('bash', ['-c', cmd], {
    cwd, env: { ...process.env, ...env, ...guard.ENV }, detached: true, stdio: ['ignore', fd, fd],
  });
  fs.closeSync(fd);
  child.unref();
  const s = {
    name, project, pid: child.pid, procStart: procStart(child.pid), log, offset: 0,
    lines: [], listeners: new Set(), startedAt: Date.now(), exitCode: null, status: 'running',
  };
  child.on('exit', code => { s.exitCode = code; });
  fs.writeFileSync(metaFile(name), JSON.stringify({ name, project, pid: s.pid, procStart: s.procStart, startedAt: s.startedAt, cmd }));
  services.set(name, s);
  watch(s);
  setStatus(s, 'running');
  return s;
}

function stop(name, timeoutMs = 20000) {
  const s = services.get(name);
  if (!s || !isRunning(s)) return Promise.resolve(false);
  setStatus(s, 'stopping');
  const kill = sig => { try { process.kill(-s.pid, sig); } catch { /* уже завершён */ } };
  kill('SIGINT');
  return new Promise(resolve => {
    const t = setTimeout(() => kill('SIGKILL'), timeoutMs);
    const check = setInterval(() => {
      if (s.status === 'stopped' || s.status === 'exited') { clearTimeout(t); clearInterval(check); resolve(true); }
    }, 200);
  });
}

// Подхватить процессы, запущенные предыдущим экземпляром панели
function adopt() {
  for (const f of fs.readdirSync(STATE_DIR).filter(f => f.endsWith('.json'))) {
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), 'utf8')); } catch { continue; }
    const s = { ...meta, log: logFile(meta.name), offset: 0, lines: [], listeners: new Set(), exitCode: null, status: 'running' };
    if (!alive(s)) { fs.rmSync(path.join(STATE_DIR, f), { force: true }); continue; }
    try {
      const text = fs.readFileSync(s.log, 'utf8');
      s.offset = Buffer.byteLength(text);
      s.lines = text.split(/\r?\n|\r/).slice(-MAX_LINES).map(l => l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''));
    } catch { /* лога нет */ }
    services.set(s.name, s);
    watch(s);
    console.log(`Подхвачен сервис ${s.name} (pid ${s.pid}, ${s.project})`);
  }
}

module.exports = { start, stop, list, logs, adopt, get: n => services.get(n) };

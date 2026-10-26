const { spawn, spawnSync } = require('child_process');
const guard = require('./guard');

// Долгоживущие процессы запускаем каждый в своём systemd-scope. Иначе они живут в cgroup того,
// кто запустил панель (терминал, tmux), и systemd-oomd при нехватке памяти убивает их всех разом
// вместе с самым прожорливым соседом. systemd-run --scope делает exec, так что pid не меняется.
let scopeOk;
function scoped(name, argv) {
  if (scopeOk === undefined) {
    scopeOk = spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', 'true'], { stdio: 'ignore' }).status === 0;
  }
  if (!scopeOk) return argv;
  const unit = `dev-panel-${name.replace(/[^\w-]/g, '_')}-${Date.now()}`;
  return ['systemd-run', '--user', '--scope', '--quiet', '--collect', `--unit=${unit}`, ...argv];
}

// Запуск bash-команды в отдельной группе процессов, чтобы можно было убить всё дерево.
// scope — имя для отдельного systemd-scope (для процессов, которые должны пережить панель).
function spawnShell(cmd, { cwd, env, detachedIgnore, scope } = {}) {
  guard.check(cmd);
  const argv = scope ? scoped(scope, ['bash', '-c', cmd]) : ['bash', '-c', cmd];
  return spawn(argv[0], argv.slice(1), {
    cwd,
    env: { ...process.env, ...env, ...guard.ENV },
    detached: true,
    stdio: detachedIgnore ? 'ignore' : ['pipe', 'pipe', 'pipe'],
  });
}

function killTree(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null) return;
  try { process.kill(-child.pid, signal); } catch { /* уже завершён */ }
}

// Построчное чтение stdout+stderr
function onLines(child, cb) {
  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
      buf += chunk;
      const parts = buf.split(/\r?\n|\r/);
      buf = parts.pop();
      parts.forEach(l => cb(stripAnsi(l)));
    });
    stream.on('end', () => { if (buf) cb(stripAnsi(buf)); });
  }
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

function run(cmd, opts = {}) {
  return new Promise(resolve => {
    const child = spawnShell(cmd, opts);
    let out = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (out += d));
    child.on('close', code => resolve({ code, out }));
    child.on('error', e => resolve({ code: -1, out: String(e) }));
  });
}

module.exports = { spawnShell, scoped, killTree, onLines, run };

const { spawn } = require('child_process');

// Запуск bash-команды в отдельной группе процессов, чтобы можно было убить всё дерево.
function spawnShell(cmd, { cwd, env } = {}) {
  return spawn('bash', ['-c', cmd], {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
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

module.exports = { spawnShell, killTree, onLines, run };

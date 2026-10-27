// Просмотр папок для выбора репозитория в интерфейсе («проводник»).
// Панель слушает только 127.0.0.1, а список папок отдаётся лишь после проверки Host/Origin (см. server.js).
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_ENTRIES = 600;

function markers(dir) {
  const has = f => fs.existsSync(path.join(dir, f));
  let compose = false;
  try { compose = fs.readdirSync(dir).some(f => /^(docker-)?compose.*\.ya?ml$/.test(f)); } catch { /* нет доступа */ }
  return { git: has('.git'), node: has('package.json'), compose };
}

function shortcuts() {
  const home = os.homedir();
  const list = [{ name: 'Домашняя папка', path: home }];
  for (const d of ['gitRepositories', 'projects', 'work', 'dev', 'src', 'repos', 'Documents']) {
    const p = path.join(home, d);
    try { if (fs.statSync(p).isDirectory()) list.push({ name: d, path: p }); } catch { /* нет такой */ }
  }
  return list;
}

function list(dir, { hidden = false } = {}) {
  const target = path.resolve(dir || os.homedir());
  let names;
  try { names = fs.readdirSync(target, { withFileTypes: true }); } catch (e) {
    throw Object.assign(new Error(`Нет доступа к ${target}: ${e.code || e.message}`), { code: 400 });
  }
  const entries = names
    .filter(d => (d.isDirectory() || (d.isSymbolicLink() && isDir(path.join(target, d.name)))) && (hidden || !d.name.startsWith('.')))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .slice(0, MAX_ENTRIES)
    .map(d => {
      const p = path.join(target, d.name);
      return { name: d.name, path: p, ...markers(p) };
    });
  return {
    path: target,
    parent: target === path.parse(target).root ? null : path.dirname(target),
    here: markers(target),
    entries,
    shortcuts: shortcuts(),
  };
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

module.exports = { list };

// Место на диске: что занимает панель и docker, что можно безопасно удалить.
// Ничего не удаляется без явного действия; дампы удаляются по одному и только из папки дампов.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./proc');
const snapshots = require('./snapshots');

const STATE = () => path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'dev-panel');

function dirSize(dir) {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
    }
  } catch { /* папки нет */ }
  return total;
}

function parseSize(s) {
  const m = String(s).match(/^([\d.]+)\s*([kMGT]?B)/i);
  if (!m) return 0;
  const mult = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[m[2].toUpperCase()] || 1;
  return Math.round(parseFloat(m[1]) * mult);
}

async function dockerUsage() {
  const r = await run(`docker system df --format '{{json .}}'`);
  if (r.code !== 0) return null;
  const rows = {};
  for (const l of r.out.split('\n').filter(Boolean)) {
    try {
      const j = JSON.parse(l);
      rows[j.Type] = { size: parseSize(j.Size), reclaimable: parseSize(String(j.Reclaimable).replace(/\s*\(.*/, '')), text: j.Reclaimable };
    } catch { /* строка не разобралась */ }
  }
  return rows;
}

async function scan(config) {
  const v = config.vars;
  snapshots.configure(v);
  const snaps = snapshots.list();
  const keep = { fresh: Number(v.snapshotsKeepFresh) || 8, dump: Number(v.snapshotsKeepDump) || 2 };
  const excess = ['fresh', 'dump'].flatMap(k => snapshots.list(k).slice(keep[k]));
  let dumps = [];
  try {
    dumps = fs.readdirSync(v.dumpsDir).filter(f => fs.statSync(path.join(v.dumpsDir, f)).isFile())
      .map(f => { const st = fs.statSync(path.join(v.dumpsDir, f)); return { name: f, size: st.size, mtime: st.mtimeMs }; })
      .sort((a, b) => b.mtime - a.mtime);
  } catch { /* папки дампов нет */ }
  let free = null;
  try { free = snapshots.freeBytes(fs.existsSync(snapshots.dir()) ? snapshots.dir() : os.homedir()); } catch { /* нет доступа */ }
  return {
    free,
    snapshots: { count: snaps.length, size: snaps.reduce((s, x) => s + (x.size || 0), 0), dir: snapshots.dir(), excess: { count: excess.length, size: excess.reduce((s, x) => s + (x.size || 0), 0) }, keep },
    dumps: { dir: v.dumpsDir, items: dumps, size: dumps.reduce((s, d) => s + d.size, 0) },
    backups: { size: dirSize(path.join(STATE(), 'swap-backups')) },
    docker: await dockerUsage(),
  };
}

// what: snapshotsPrune | dockerImages | dockerBuildCache | swapBackups | dumpDelete (name)
async function act(config, what, arg) {
  const v = config.vars;
  snapshots.configure(v);
  switch (what) {
    case 'snapshotsPrune': {
      const removed = [...snapshots.prune('fresh', Number(v.snapshotsKeepFresh) || 8), ...snapshots.prune('dump', Number(v.snapshotsKeepDump) || 2)];
      return { note: `Удалено снимков: ${removed.length}` };
    }
    case 'dockerImages': {
      const r = await run('docker image prune -f');
      if (r.code !== 0) throw new Error(r.out.trim());
      return { note: r.out.trim().split('\n').pop() };
    }
    case 'dockerBuildCache': {
      const r = await run('docker builder prune -f');
      if (r.code !== 0) throw new Error(r.out.trim());
      return { note: r.out.trim().split('\n').pop() };
    }
    case 'swapBackups':
      fs.rmSync(path.join(STATE(), 'swap-backups'), { recursive: true, force: true });
      return { note: 'Резервные копии файлов окружения удалены' };
    case 'dumpDelete': {
      const name = String(arg || '');
      if (!name || name !== path.basename(name) || name.startsWith('.')) throw Object.assign(new Error('Неверное имя файла'), { code: 400 });
      const file = path.join(v.dumpsDir, name);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw Object.assign(new Error('Файла нет'), { code: 404 });
      fs.rmSync(file);
      return { note: `Дамп ${name} удалён` };
    }
    default:
      throw Object.assign(new Error('Неизвестное действие'), { code: 400 });
  }
}

module.exports = { scan, act };

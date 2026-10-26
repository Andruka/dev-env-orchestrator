// Снимки каталога pgdata.
// fresh — база после миграций liquibase. Снимок подходит текущей ветке, если все его файлы миграций есть
//   в ветке без изменений: liquibase докатит только недостающие. Один снимок обслуживает много веток и копий репо.
// dump  — база сразу после импорта дампа (до миграций ветки), один на файл дампа.
// manual — сохранённые вручную, автоматически не удаляются.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { run } = require('./proc');

const DIR = process.env.DEV_PANEL_SNAPSHOTS || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'dev-panel', 'snapshots');
fs.mkdirSync(DIR, { recursive: true });

const metaPath = id => path.join(DIR, id, 'meta.json');
const dataPath = id => path.join(DIR, id, 'pgdata.tar.zst');

function list(kind) {
  return fs.readdirSync(DIR)
    .map(id => { try { return JSON.parse(fs.readFileSync(metaPath(id), 'utf8')); } catch { return null; } })
    .filter(m => m && fs.existsSync(dataPath(m.id)) && (!kind || m.kind === kind))
    .sort((a, b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt));
}

function touch(meta) {
  meta.lastUsedAt = Date.now();
  fs.writeFileSync(metaPath(meta.id), JSON.stringify(meta, null, 2));
}

function remove(id) {
  if (!/^[\w.-]+$/.test(id)) throw new Error(`Некорректный id снимка: ${id}`);
  fs.rmSync(path.join(DIR, id), { recursive: true, force: true });
}

// Манифест миграций рабочей копии: путь → хэш содержимого (с учётом незакоммиченных правок)
async function manifest(repo, dir) {
  const ls = await run(`git ls-files -s -- '${dir}'`, { cwd: repo });
  if (ls.code !== 0) throw new Error(`git ls-files: ${ls.out}`);
  const files = {};
  for (const line of ls.out.split('\n').filter(Boolean)) {
    const [, , blob, , file] = line.match(/^(\d+) (\w+) (\d)\t(.+)$/);
    files[file] = blob;
  }
  const changed = await run(`{ git diff --name-only -- '${dir}'; git ls-files -o --exclude-standard -- '${dir}'; } | sort -u`, { cwd: repo });
  if (!Object.keys(files).length) throw new Error(`Не найдены файлы миграций в ${dir}`);
  for (const f of changed.out.split('\n').filter(Boolean)) {
    const p = path.join(repo, f);
    if (!fs.existsSync(p)) { delete files[f]; continue; }
    const h = await run(`git hash-object -- '${f.replace(/'/g, "'\\''")}'`, { cwd: repo });
    files[f] = h.out.trim();
  }
  return files;
}

function manifestHash(files) {
  return crypto.createHash('sha256').update(Object.keys(files).sort().map(f => `${f} ${files[f]}`).join('\n')).digest('hex').slice(0, 16);
}

// Лучший fresh-снимок: все его файлы есть в ветке без изменений, недостающих миграций меньше всего
function bestFresh(files) {
  let best = null;
  for (const s of list('fresh')) {
    const ok = Object.entries(s.files).every(([f, h]) => files[f] === h);
    if (!ok) continue;
    const missing = Object.keys(files).filter(f => !(f in s.files)).length;
    if (!best || missing < best.missing) best = { snapshot: s, missing };
  }
  return best;
}

function findDump(dumpFile) {
  const st = fs.statSync(dumpFile);
  const key = `${path.basename(dumpFile)}|${st.size}|${Math.round(st.mtimeMs)}`;
  return { key, snapshot: list('dump').find(s => s.dumpKey === key) || null };
}

function newId(kind, label) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  return `${kind}-${stamp}-${String(label || '').replace(/[^\w.-]+/g, '_').slice(0, 40)}`.replace(/-$/, '');
}

function prune(kind, keep) {
  const removed = [];
  for (const s of list(kind).slice(keep)) { remove(s.id); removed.push(s.id); }
  return removed;
}

function freeBytes(dir) {
  const st = fs.statfsSync(dir);
  return st.bavail * st.bsize;
}

const human = b => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} ГБ` : `${Math.round(b / 1024 ** 2)} МБ`);

module.exports = { DIR, list, touch, remove, manifest, manifestHash, bestFresh, findDump, newId, prune, freeBytes, metaPath, dataPath, human };

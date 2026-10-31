// Журнал действий: что и когда делалось в панели (стенд применён, задача выполнена, снимок удалён).
// Нужен, чтобы ответить на «почему у меня сейчас не так»: ~/.local/state/dev-panel/journal.jsonl, права 600.
// Секреты (пароли, значения переменных) в журнал не пишутся — только названия и результаты.
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = () => path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'dev-panel', 'journal.jsonl');
const MAX_BYTES = 1024 * 1024;
const KEEP_LINES = 800;

function add(type, title, data = {}) {
  try {
    const file = FILE();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, JSON.stringify({ t: Date.now(), type, title, ...(Object.keys(data).length && { data }) }) + '\n', { mode: 0o600 });
    if (fs.statSync(file).size > MAX_BYTES) {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
      fs.writeFileSync(file, lines.slice(-KEEP_LINES).join('\n') + '\n', { mode: 0o600 });
    }
  } catch { /* журнал — удобство: сбой записи не должен мешать работе */ }
}

function list({ limit = 200, type } = {}) {
  try {
    const rows = fs.readFileSync(FILE(), 'utf8').trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return rows.filter(r => !type || r.type === type).slice(-limit).reverse();
  } catch { return []; }
}

module.exports = { add, list };

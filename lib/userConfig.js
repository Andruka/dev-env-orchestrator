// Пользовательские настройки: всё, что меняется под конкретного человека, лежит вне репозитория
// (~/.config/dev-panel/config.json). Поставляемые значения по умолчанию — в defaults.json.
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = process.env.DEV_PANEL_USER_CONFIG
  || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'dev-panel', 'config.json');

const EMPTY = () => ({ version: 1, vars: {}, groups: {}, customGroups: [], actions: {}, prefs: {} });

function read() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...EMPTY(), ...raw };
  } catch {
    return EMPTY();
  }
}

// Запись через временный файл: оборванная запись не должна оставить битый конфиг
function write(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

// update(draft => { ... }) — читает, даёт изменить копию и сохраняет
function update(fn) {
  const data = read();
  fn(data);
  write(data);
  return data;
}

const exists = () => fs.existsSync(FILE);

module.exports = { read, write, update, exists, FILE };

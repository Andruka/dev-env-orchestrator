// Учётные данные хранятся вне репозитория панели, файл доступен только владельцу
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = process.env.DEV_PANEL_SECRETS || path.join(os.homedir(), '.config', 'dev-panel', 'secrets.json');

const DEFAULTS = {
  auth: {
    loginUrl: 'https://10.145.1.150:5005/api/login/token',
    usersUrl: 'https://10.145.1.150:5005/api/users/{userId}',
    refreshUrl: '',
    clientId: 2,
    login: '',
    password: '',
    keepAlive: true,
  },
  // Свои логин и пароль для стендов: ключ — адрес бэкенда (https://host:port). Если для стенда записи нет, берётся auth.
  stands: {},
};

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...DEFAULTS, ...data, auth: { ...DEFAULTS.auth, ...data.auth }, stands: { ...data.stands } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function write(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.chmodSync(FILE, 0o600);
}

// Пароль наружу не отдаём — только признак, что он задан
function publicView() {
  const { auth } = read();
  const { password, ...rest } = auth;
  const stands = Object.entries(read().stands).map(([origin, v]) => ({ origin, login: v.login || '', clientId: v.clientId ?? '', hasPassword: Boolean(v.password) }));
  return { auth: { ...rest, hasPassword: Boolean(password) }, stands, file: FILE };
}

function normOrigin(value) {
  let u;
  try { u = new URL(String(value).trim()); } catch { throw Object.assign(new Error('Адрес стенда: укажите https://хост:порт'), { code: 400 }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('Адрес стенда должен начинаться с http:// или https://'), { code: 400 });
  return u.origin;
}

function updateStand(patch) {
  const data = read();
  const origin = normOrigin(patch.origin);
  const cur = data.stands[origin] || {};
  const next = { ...cur };
  if (typeof patch.login === 'string') next.login = patch.login.trim();
  if (patch.clientId !== undefined && patch.clientId !== '' && patch.clientId !== null) next.clientId = Number(patch.clientId);
  else if (patch.clientId === '') delete next.clientId;
  if (typeof patch.password === 'string' && patch.password !== '') next.password = patch.password;
  if (!next.login) throw Object.assign(new Error('Укажите логин для стенда'), { code: 400 });
  write({ ...data, stands: { ...data.stands, [origin]: next } });
  return publicView();
}

function deleteStand(origin) {
  const data = read();
  delete data.stands[normOrigin(origin)];
  write(data);
  return publicView();
}

function updateAuth(patch) {
  const data = read();
  const next = { ...data.auth };
  for (const k of ['loginUrl', 'usersUrl', 'refreshUrl', 'login']) if (typeof patch[k] === 'string') next[k] = patch[k].trim();
  if (patch.clientId !== undefined && patch.clientId !== '') next.clientId = Number(patch.clientId);
  if (typeof patch.password === 'string' && patch.password !== '') next.password = patch.password;
  if (typeof patch.keepAlive === 'boolean') next.keepAlive = patch.keepAlive;
  write({ ...data, auth: next });
  return publicView();
}

module.exports = { read, publicView, updateAuth, updateStand, deleteStand, FILE };

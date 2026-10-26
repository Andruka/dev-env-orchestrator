// Учётные данные хранятся вне репозитория панели, файл доступен только владельцу
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = process.env.DEV_PANEL_SECRETS || path.join(os.homedir(), '.config', 'dev-panel', 'secrets.json');

const DEFAULTS = {
  auth: {
    loginUrl: 'https://10.145.1.150:5005/api/login/token',
    usersUrl: 'https://10.145.1.150:5005/api/users/{userId}',
    clientId: 2,
    login: '',
    password: '',
  },
};

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...DEFAULTS, ...data, auth: { ...DEFAULTS.auth, ...data.auth } };
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
  return { auth: { ...rest, hasPassword: Boolean(password) }, file: FILE };
}

function updateAuth(patch) {
  const data = read();
  const next = { ...data.auth };
  for (const k of ['loginUrl', 'usersUrl', 'login']) if (typeof patch[k] === 'string') next[k] = patch[k].trim();
  if (patch.clientId !== undefined && patch.clientId !== '') next.clientId = Number(patch.clientId);
  if (typeof patch.password === 'string' && patch.password !== '') next.password = patch.password;
  write({ ...data, auth: next });
  return publicView();
}

module.exports = { read, publicView, updateAuth, FILE };

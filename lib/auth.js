// Получение токенов из API логина и данных пользователя (как это делает LoginDialogModal в CLIENT)
const https = require('https');
const http = require('http');
const secrets = require('./secrets');

// Адрес стенда, к которому сейчас подключён фронтенд (BACKEND_URL из его config.js). Задаёт server.js.
// Если он есть, логин, данные пользователя и refresh идут на этот же хост и порт, а путь берётся из настроек.
let resolveBase = () => null;
const setBaseResolver = fn => { resolveBase = fn; };

// Учётные данные стенда: свои, если заданы для этого адреса, иначе общие
function withStandCreds(auth, origin) {
  const own = secrets.read().stands[origin];
  if (!own?.login || !own.password) return { auth, own: false };
  return { auth: { ...auth, login: own.login, password: own.password, ...(own.clientId != null && { clientId: own.clientId }) }, own: true };
}

function effective(auth) {
  const base = resolveBase();
  if (!base) return { auth, base: null };
  let origin;
  try { origin = new URL(base.url).origin; } catch { return { auth, base: null }; }
  const creds = withStandCreds(auth, origin);
  auth = creds.auth;
  const swap = u => { if (!u) return u; try { const x = new URL(u.replace('{userId}', '0')); return u.replace(x.origin, origin); } catch { return u; } };
  return {
    auth: { ...auth, loginUrl: swap(auth.loginUrl), usersUrl: swap(auth.usersUrl), refreshUrl: swap(auth.refreshUrl) },
    base: { ...base, origin, ownCreds: creds.own },
  };
}

function request(url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = lib.request(u, {
      method,
      rejectUnauthorized: false, // внутренний стенд с самоподписанным сертификатом
      timeout: 15000,
      headers: { Accept: 'application/json', ...(payload && { 'Content-Type': 'application/json' }), ...headers },
    }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* не JSON */ }
        if (res.statusCode >= 400) return reject(new Error(`${method} ${u.pathname}: HTTP ${res.statusCode} ${data.slice(0, 200)}`));
        resolve(json ?? data);
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${method} ${u.host}: таймаут`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(log = () => {}) {
  const stored = secrets.read().auth;
  const { auth, base } = effective(stored);
  if (!auth.login || !auth.password) throw new Error('Логин и пароль не заданы — откройте «Настройки»');
  if (base && auth.loginUrl !== stored.loginUrl) log(`Стенд определён по config.js проекта ${base.project}: ${base.origin}`);
  log(`POST ${auth.loginUrl} (login: ${auth.login}${base?.ownCreds ? `, учётные данные стенда ${base.origin}` : ''})`);
  const tokens = await request(auth.loginUrl, {
    method: 'POST', body: { clientId: auth.clientId, login: auth.login, password: auth.password },
  });
  if (!tokens?.access_token) throw new Error('В ответе нет access_token');
  log(`Токен получен, user_id=${tokens.user_id}`);

  let user = null;
  if (auth.usersUrl && tokens.user_id != null) {
    const url = auth.usersUrl.replace('{userId}', tokens.user_id);
    try {
      const d = await request(url, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      user = {
        success: d.active,
        companyID: d.company?.id,
        userID: d.id,
        roleID: d.role?.id,
        partnerId: d.division?.organization?.partnerId,
        isSystem: d.company?.isSystem,
        organizationId: d.division?.organization?.id,
      };
      log(`Пользователь: ${d.fio || d.name || d.id}`);
    } catch (e) {
      log(`Не удалось получить данные пользователя: ${e.message}`);
    }
  }
  return { tokens, user, base };
}

// Обмен одноразового refresh-токена. Сервер на отказ отвечает HTTP 200 с полем error.
async function refresh(refreshToken) {
  const { auth } = effective(secrets.read().auth);
  const url = auth.refreshUrl || auth.loginUrl.replace(/\/token$/, '/refresh-token');
  const r = await request(url, { method: 'POST', body: { clientId: auth.clientId, token: refreshToken } });
  if (!r?.access_token) throw new Error(r?.message || r?.error || 'refresh не вернул токен');
  return r;
}

// Проверка стенда без побочных эффектов (токен нигде не сохраняется, браузер не трогаем):
// отвечает ли сервер, принимает ли он логин и пароль этого стенда, отдаёт ли данные пользователя
async function testOrigin(origin) {
  const stored = secrets.read().auth;
  const { auth, own } = withStandCreds(stored, origin);
  const steps = [];
  const step = (title, ok, detail) => { steps.push({ title, ok, detail }); return ok; };
  const swap = u => { if (!u) return u; try { const x = new URL(u.replace('{userId}', '0')); return u.replace(x.origin, origin); } catch { return u; } };

  const t0 = Date.now();
  const reach = await new Promise(resolve => {
    const u = new URL(origin);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', rejectUnauthorized: false, timeout: 8000 }, res => { res.resume(); resolve({ ok: true, code: res.statusCode }); });
    req.on('timeout', () => req.destroy(new Error('таймаут 8 с')));
    req.on('error', e => resolve({ ok: false, error: e.code === 'ECONNREFUSED' ? 'соединение отклонено (сервер не запущен или порт закрыт)' : e.code === 'ENOTFOUND' ? 'адрес не найден' : e.message }));
    req.end();
  });
  if (!step('Сервер отвечает', reach.ok, reach.ok ? `${origin} · HTTP ${reach.code} · ${Date.now() - t0} мс` : reach.error)) return { ok: false, steps };

  if (!auth.login || !auth.password) { step('Логин и пароль', false, 'не заданы ни у стенда, ни в общих данных'); return { ok: false, steps }; }
  step('Учётные данные', true, `${auth.login} (${own ? 'свои у стенда' : 'общие'})`);

  let tokens;
  try {
    tokens = await request(swap(auth.loginUrl), { method: 'POST', body: { clientId: auth.clientId, login: auth.login, password: auth.password } });
    if (!tokens?.access_token) throw new Error('в ответе нет access_token');
    step('Вход принят', true, `user_id=${tokens.user_id}`);
  } catch (e) {
    step('Вход принят', false, e.message.includes('HTTP 401') || e.message.includes('HTTP 403') ? 'стенд отклонил логин или пароль' : e.message);
    return { ok: false, steps };
  }
  if (auth.usersUrl && tokens.user_id != null) {
    try {
      const d = await request(swap(auth.usersUrl).replace('{userId}', tokens.user_id), { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      step('Данные пользователя', true, String(d.fio || d.name || d.id));
    } catch (e) { step('Данные пользователя', false, e.message); }
  }
  return { ok: steps.every(s => s.ok), steps };
}

module.exports = { login, refresh, request, setBaseResolver, effective, testOrigin };

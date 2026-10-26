// Поддержание входа во фронтенде.
// Клиент обновляет токен только после 401, а refresh-токен одноразовый: если обновить пытаются двое
// (две вкладки, повтор запроса), второй получает HTTP 200 с { error }, и клиент записывает в localStorage
// "undefined". Панель продлевает токен заранее, до истечения, поэтому клиент до своего refresh не доходит.
// Если сессия всё же сломалась, панель логинится заново.
const auth = require('./auth');
const cdp = require('./cdp');
const secrets = require('./secrets');
const bus = require('./bus');

const TICK_MS = 60 * 1000;
const REFRESH_BEFORE_SEC = 15 * 60;

let opts = null;
let timer = null;
let busy = false;
const state = { status: 'idle', expiresAt: null, lastAction: null, actionAt: null, lastError: null, at: null };

function set(patch) {
  Object.assign(state, patch, { at: Date.now() }, patch.lastAction && { actionAt: Date.now() });
  bus.emit('auth', { ...state });
}

function decodeExp(token) {
  try {
    const raw = String(token).replace(/^"|"$/g, '');
    return JSON.parse(Buffer.from(raw.split('.')[1], 'base64url')).exp || null;
  } catch { return null; }
}

async function findPage() {
  let list;
  try {
    list = await new Promise((resolve, reject) => {
      require('http').get({ host: '127.0.0.1', port: opts.debugPort, path: '/json/list', timeout: 1500 }, res => {
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
      }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
    });
  } catch { return null; }
  return list.find(t => t.type === 'page' && t.url.startsWith(opts.origin)) || false;
}

async function writeTokens(page, tokens, user, reload) {
  const data = { access_token: tokens.access_token, refresh_token: tokens.refresh_token };
  if (user) data.user = JSON.stringify(user);
  await cdp.evaluate(page.webSocketDebuggerUrl, `(() => {
    const d = ${JSON.stringify(data)};
    for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v);
    ${reload ? 'setTimeout(() => location.reload(), 50);' : ''}
    return true;
  })()`);
}

async function tick(force = false) {
  if (busy) return;
  const { auth: cfg } = secrets.read();
  if (cfg.keepAlive === false) return set({ status: 'off', expiresAt: null });
  if (!cfg.login || !cfg.password) return set({ status: 'no-credentials', expiresAt: null });
  busy = true;
  try {
    const page = await findPage();
    if (page === null) return set({ status: 'no-browser', expiresAt: null });
    if (page === false) return set({ status: 'no-page', expiresAt: null });

    const ls = JSON.parse(await cdp.evaluate(page.webSocketDebuggerUrl,
      'location.origin === "null" ? "{\\"down\\":true}" : JSON.stringify({ a: localStorage.getItem("access_token"), r: localStorage.getItem("refresh_token") })'));
    // вкладка показывает страницу ошибки (фронтенд не запущен) — localStorage недоступен
    if (ls.down) return set({ status: 'front-down', expiresAt: null });
    const exp = decodeExp(ls.a);
    const now = Date.now() / 1000;
    const broken = !exp || !ls.r || ['undefined', 'null', ''].includes(ls.r);

    if (broken || exp <= now) {
      const { tokens, user } = await auth.login(() => {});
      await writeTokens(page, tokens, user, true);
      return set({ status: 'ok', expiresAt: decodeExp(tokens.access_token), lastAction: broken ? 'relogin-broken' : 'relogin-expired', lastError: null });
    }
    if (force || exp - now < REFRESH_BEFORE_SEC) {
      const tokens = await auth.refresh(ls.r).catch(() => null);
      if (tokens) {
        await writeTokens(page, tokens, null, false);
        return set({ status: 'ok', expiresAt: decodeExp(tokens.access_token), lastAction: 'refresh', lastError: null });
      }
      const { tokens: t, user } = await auth.login(() => {});
      await writeTokens(page, t, user, false);
      return set({ status: 'ok', expiresAt: decodeExp(t.access_token), lastAction: 'relogin-refresh-failed', lastError: null });
    }
    set({ status: 'ok', expiresAt: exp });
  } catch (e) {
    set({ status: 'error', lastError: e.message });
  } finally {
    busy = false;
  }
}

function start({ frontendUrl, debugPort }) {
  opts = { origin: new URL(frontendUrl).origin, debugPort: Number(debugPort || 9222) };
  clearInterval(timer);
  timer = setInterval(() => tick(), TICK_MS);
  setTimeout(() => tick(), 3000);
}

module.exports = { start, tick, state: () => ({ ...state }) };

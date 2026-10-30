// Поддержание входа во фронтенде.
// Клиент обновляет токен только после 401, а refresh-токен одноразовый: если обновить пытаются двое
// (две вкладки, повтор запроса), второй получает HTTP 200 с { error }, и клиент записывает в localStorage
// "undefined". Панель продлевает токен заранее, до истечения, поэтому клиент до своего refresh не доходит.
// Если сессия всё же сломалась, панель логинится заново.
const auth = require('./auth');
const cdp = require('./cdp');
const secrets = require('./secrets');
const bus = require('./bus');
const browserState = require('./browserState');

const TICK_MS = 60 * 1000;
const REFRESH_BEFORE_SEC = 15 * 60;

let opts = null;
let timer = null;
let busy = false;
let startUrlOf = () => null; // адрес стартовой страницы активного стенда (задаёт server.js)
let loggedOrigin = null; // стенд, под который выдан токен в браузере
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

// null — браузер не отвечает, false — вкладки фронтенда нет, { down } — вкладки показывают страницу ошибки, иначе страница
async function findPage() {
  const found = await cdp.findLivePage(opts.debugPort, opts.origin);
  if (!found || found.down) return found;
  return found.page;
}

async function writeTokens(page, tokens, user, { reload, origin, navigateTo } = {}) {
  const data = { access_token: tokens.access_token, refresh_token: tokens.refresh_token };
  if (user) data.user = JSON.stringify(user);
  await cdp.evaluate(page.webSocketDebuggerUrl, browserState.script({ data, origin, reload, navigateTo }));
}

async function tick(force = false) {
  if (busy) return;
  const eff = auth.effective(secrets.read().auth);
  const cfg = eff.auth;
  const origin = eff.base?.origin || null;
  if (cfg.keepAlive === false) return set({ status: 'off', expiresAt: null });
  if (!cfg.login || !cfg.password) return set({ status: 'no-credentials', expiresAt: null });
  busy = true;
  try {
    const page = await findPage();
    if (page === null) return set({ status: 'no-browser', expiresAt: null });
    if (page === false) return set({ status: 'no-page', expiresAt: null });
    // вкладки показывают страницу ошибки (фронтенд не запущен) — localStorage недоступен
    if (page.down) return set({ status: 'front-down', expiresAt: null });

    const ls = JSON.parse(await cdp.evaluate(page.webSocketDebuggerUrl,
      'location.origin === "null" ? "{\\"down\\":true}" : JSON.stringify({ a: localStorage.getItem("access_token"), r: localStorage.getItem("refresh_token") })'));
    // вкладка показывает страницу ошибки (фронтенд не запущен) — localStorage недоступен
    if (ls.down) return set({ status: 'front-down', expiresAt: null });
    const exp = decodeExp(ls.a);
    const now = Date.now() / 1000;
    const broken = !exp || !ls.r || ['undefined', 'null', ''].includes(ls.r);
    // Стенд сменили: токен в браузере выдан другим бэкендом (другой ключ и пользователь) — входим заново
    const switched = Boolean(loggedOrigin && origin && loggedOrigin !== origin);

    if (broken || exp <= now || switched) {
      const { tokens, user, base } = await auth.login(() => {});
      // при смене стенда открываем стартовую страницу этого стенда: id объекта в адресе от другой базы
      await writeTokens(page, tokens, user, { reload: true, origin: base?.origin, navigateTo: switched ? startUrlOf() : null });
      loggedOrigin = origin;
      return set({ status: 'ok', expiresAt: decodeExp(tokens.access_token), lastAction: switched ? 'relogin-stand' : broken ? 'relogin-broken' : 'relogin-expired', lastError: null });
    }
    if (force || exp - now < REFRESH_BEFORE_SEC) {
      const tokens = await auth.refresh(ls.r).catch(() => null);
      if (tokens) {
        await writeTokens(page, tokens, null);
        return set({ status: 'ok', expiresAt: decodeExp(tokens.access_token), lastAction: 'refresh', lastError: null });
      }
      const { tokens: t, user, base } = await auth.login(() => {});
      await writeTokens(page, t, user, { origin: base?.origin });
      return set({ status: 'ok', expiresAt: decodeExp(t.access_token), lastAction: 'relogin-refresh-failed', lastError: null });
    }
    loggedOrigin = loggedOrigin || origin;
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

const setStartUrlResolver = fn => { startUrlOf = fn; };

module.exports = { start, tick, setStartUrlResolver, state: () => ({ ...state }) };

const auth = require('../auth');
const cdp = require('../cdp');
const browserState = require('../browserState');

// Логинится по API и кладёт токены в localStorage страницы фронтенда через DevTools-протокол.
// Перед входом чистит кеш: HTTP-кеш браузера (профиль dev-браузера целиком), Cache Storage и service worker адреса фронтенда.
// Куки и localStorage не трогает. Нужно, чтобы не открылась устаревшая сборка фронтенда. Отключается параметром clearCache: false.
// { url, debugPort, storage?: { access, refresh, user }, pageWaitMs?, clearCache? }
module.exports = async function browserAuth(step, ctx) {
  const port = Number(step.debugPort || 9222);
  const keys = { access: 'access_token', refresh: 'refresh_token', user: 'user', ...step.storage };
  const { tokens, user, base } = await auth.login(ctx.log);

  ctx.log(`Подключаюсь к браузеру :${port}`);
  await cdp.waitForBrowser(port, step.waitMs || 15000);
  const origin = new URL(step.url).origin;
  const wait = () => cdp.waitForPage(port, origin, step.url, { timeoutMs: step.pageWaitMs || 30000, log: ctx.log });

  const data = {
    [keys.access]: tokens.access_token,
    [keys.refresh]: tokens.refresh_token,
    ...(user && { [keys.user]: JSON.stringify(user) }),
  };
  const page = await wait();
  if (step.clearCache !== false) {
    try {
      await cdp.command(page.webSocketDebuggerUrl, 'Storage.clearDataForOrigin', { origin, storageTypes: 'cache_storage,service_workers' });
      await cdp.command(page.webSocketDebuggerUrl, 'Network.clearBrowserCache');
      ctx.log(`Кеш браузера и service worker ${origin} очищены`);
    } catch (e) {
      ctx.log(`Не удалось очистить кеш (${e.message}) — продолжаю без этого`);
    }
  }
  const cleared = await cdp.evaluate(page.webSocketDebuggerUrl, browserState.script({ data, origin: base?.origin }));
  if (cleared) ctx.log(`Браузер работал с другим стендом: сохранённое состояние приложения (последний объект, режимы) очищено${base ? `, теперь это ${base.origin}` : ''}`);
  // жёсткая перезагрузка: страница и её ресурсы берутся с сервера, а не из кеша
  await cdp.command(page.webSocketDebuggerUrl, 'Page.reload', { ignoreCache: step.clearCache !== false });
  ctx.log(`Токены записаны в localStorage ${origin}, страница перезагружается${step.clearCache !== false ? ' без кеша' : ''}`);

  // Убеждаемся, что после перезагрузки токен на месте: приложение стирает его, если сервер отклонил вход
  await ctx.sleep(800);
  const after = await wait();
  await ctx.sleep(1200);
  const kept = await cdp.evaluate(after.webSocketDebuggerUrl, `localStorage.getItem(${JSON.stringify(keys.access)})`).catch(() => null);
  if (!kept) throw new Error('Токен записан, но после перезагрузки приложение его удалило — похоже, сервер не принял вход. Проверьте логин и пароль («Проверить вход» в Настройках).');
  ctx.log('Вход подтверждён: токен сохранился после перезагрузки страницы');
};

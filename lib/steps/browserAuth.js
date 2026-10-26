const auth = require('../auth');
const cdp = require('../cdp');

// Логинится по API и кладёт токены в localStorage страницы фронтенда через DevTools-протокол.
// { url, debugPort, storage?: { access, refresh, user } }
module.exports = async function browserAuth(step, ctx) {
  const port = Number(step.debugPort || 9222);
  const keys = { access: 'access_token', refresh: 'refresh_token', user: 'user', ...step.storage };
  const { tokens, user } = await auth.login(ctx.log);

  ctx.log(`Подключаюсь к браузеру :${port}`);
  await cdp.waitForBrowser(port, step.waitMs || 15000);
  const origin = new URL(step.url).origin;
  let page = await cdp.findOrOpenPage(port, origin, step.url);
  // новая вкладка может ещё не успеть загрузить нужный origin
  for (let i = 0; i < 20 && !page.url.startsWith(origin); i++) {
    await ctx.sleep(500);
    page = await cdp.findOrOpenPage(port, origin, step.url);
  }

  const data = {
    [keys.access]: tokens.access_token,
    [keys.refresh]: tokens.refresh_token,
    ...(user && { [keys.user]: JSON.stringify(user) }),
  };
  await cdp.evaluate(page.webSocketDebuggerUrl, `(() => {
    const d = ${JSON.stringify(data)};
    for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v);
    setTimeout(() => location.reload(), 50);
    return true;
  })()`);
  ctx.log(`Токены записаны в localStorage ${origin}, страница перезагружена`);
};

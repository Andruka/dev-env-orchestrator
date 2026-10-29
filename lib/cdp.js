// Минимальный клиент Chrome DevTools Protocol (Brave запускается с --remote-debugging-port)
const http = require('http');

function getJson(port, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, timeout: 2000 }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function waitForBrowser(port, timeoutMs) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try { return await getJson(port, '/json/version'); } catch (e) {
      if (Date.now() > until) {
        throw new Error(`Браузер не отвечает на порту отладки ${port}. Если Brave уже открыт без этого флага, закройте его и запустите через панель.`);
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

// Список вкладок. null — браузер на порту отладки не отвечает
async function listPages(port) {
  try { return (await getJson(port, '/json/list')).filter(t => t.type === 'page'); } catch { return null; }
}

function command(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const t = setTimeout(() => { ws.close(); reject(new Error('CDP: таймаут')); }, 10000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== 1) return;
      clearTimeout(t);
      ws.close();
      const ex = msg.result?.exceptionDetails;
      if (msg.error) reject(new Error(`CDP: ${msg.error.message}`));
      else if (ex) reject(new Error(`CDP: ${ex.exception?.description || ex.text}`));
      else resolve(msg.result?.result?.value);
    };
    ws.onerror = () => { clearTimeout(t); reject(new Error('CDP: ошибка соединения')); };
  });
}

const evaluate = (wsUrl, expression) => command(wsUrl, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });

// Настоящее состояние документа во вкладке. url в списке вкладок не годится: у вкладки со страницей ошибки
// браузера (chrome-error://, фронтенд был выключен) там остаётся адрес фронтенда, а localStorage недоступен.
async function pageState(page) {
  try { return JSON.parse(await evaluate(page.webSocketDebuggerUrl, 'JSON.stringify({ origin: location.origin, ready: document.readyState })')); } catch { return null; }
}

// Вкладка с работающим фронтенд-документом: { page } — найдена, { down: true } — вкладки есть, но показывают ошибку,
// false — вкладок фронтенда нет, null — браузер не отвечает
async function findLivePage(port, origin) {
  const pages = await listPages(port);
  if (!pages) return null;
  const cand = pages.filter(t => t.url.startsWith(origin));
  let broken = false;
  for (const page of cand) {
    const st = await pageState(page);
    if (st?.origin === origin) return { page, ready: st.ready };
    broken = true;
  }
  return broken ? { down: true, pages: cand } : false;
}

// Ждёт, пока фронтенд реально загрузится в какой-нибудь вкладке: страницы ошибок перезагружаются, при отсутствии вкладки открывается новая
async function waitForPage(port, origin, url, { timeoutMs = 30000, log = () => {} } = {}) {
  const until = Date.now() + timeoutMs;
  let opened = false, lastNav = 0, noted = false;
  for (;;) {
    const found = await findLivePage(port, origin);
    if (found?.page && found.ready !== 'loading') return found.page;
    if (!found?.page) {
      if (found === false && !opened) { opened = true; await getJson(port, `/json/new?${encodeURI(url)}`, 'PUT').catch(() => {}); }
      else if (found?.down && Date.now() - lastNav > 2000) {
        // вкладка осталась на странице ошибки: перезагружаем её на адрес фронтенда
        if (!noted) { log('Вкладка показывает страницу ошибки (фронтенд был недоступен) — перезагружаю'); noted = true; }
        lastNav = Date.now();
        for (const p of found.pages) await command(p.webSocketDebuggerUrl, 'Page.navigate', { url }).catch(() => {});
      }
    }
    if (Date.now() > until) {
      throw new Error(`Страница фронтенда ${url} не загрузилась за ${Math.round(timeoutMs / 1000)} с. Проверьте, что npm start поднял сервер и адрес в «Настройки → Окружение» верный.`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

module.exports = { waitForBrowser, listPages, findLivePage, waitForPage, pageState, command, evaluate };

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

async function findOrOpenPage(port, origin, url) {
  const targets = await getJson(port, '/json/list');
  const page = targets.find(t => t.type === 'page' && t.url.startsWith(origin));
  if (page) return page;
  return getJson(port, `/json/new?${encodeURI(url)}`, 'PUT');
}

function evaluate(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const t = setTimeout(() => { ws.close(); reject(new Error('CDP: таймаут')); }, 10000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
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

module.exports = { waitForBrowser, findOrOpenPage, evaluate };

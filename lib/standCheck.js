// Сверка стендов: к какому стенду подключён фронтенд (и вход панели) и с каким окружением работает локальный бэкенд.
// Токен выдаёт стенд, а бэкенд проверяет его своим PUBLIC_KEY. Если бэкенд запущен (например, из IDE) со стендом 5005,
// а вход идёт на 5008, все запросы к бэкенду получат 401.
const fs = require('fs');
const envswap = require('./envswap');
const { run } = require('./proc');

const LOCAL = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

const hostPort = url => { try { const u = new URL(url); return `${u.hostname}:${u.port || (u.protocol === 'https:' ? 443 : 80)}`; } catch { return null; } };

async function pidOnPort(port) {
  const { out } = await run(`ss -ltnpH sport = :${Number(port)}`);
  const m = out.match(/users:\(\("([^"]*)",pid=(\d+)/);
  return m ? { name: m[1], pid: Number(m[2]) } : null;
}

// Стенд, с которым работает процесс: BASIC_PRODUCT_HOST и BASIC_PRODUCT_PORT из его окружения (читается только у процессов пользователя)
function processStand(pid) {
  try {
    const env = Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    return env.BASIC_PRODUCT_HOST && env.BASIC_PRODUCT_PORT ? `${env.BASIC_PRODUCT_HOST}:${env.BASIC_PRODUCT_PORT}` : null;
  } catch { return null; }
}

async function check(config, preferProject) {
  const fe = envswap.activeFrontend(config, preferProject);
  if (!fe) return null;
  const urls = envswap.frontendBackendUrls(fe.content);
  const front = urls.BACKEND_URL ? hostPort(urls.BACKEND_URL) : null;
  const titleOf = hp => (config.envs || []).find(e => e.origin && hostPort(e.origin) === hp)?.title || null;
  const backends = [];
  for (const [key, url] of Object.entries(urls)) {
    if (key === 'BACKEND_URL') continue;
    let u;
    try { u = new URL(url); } catch { continue; }
    if (!LOCAL.has(u.hostname)) continue;
    const listener = await pidOnPort(u.port || 80).catch(() => null);
    const stand = listener ? processStand(listener.pid) : null;
    backends.push({ key, url, port: Number(u.port) || 80, running: Boolean(listener), process: listener?.name || null, stand, standTitle: stand && titleOf(stand) });
  }
  return {
    project: fe.project, front, frontTitle: front && titleOf(front),
    backends,
    mismatch: backends.filter(b => b.stand && front && b.stand !== front),
  };
}

module.exports = { check, hostPort };

// Кто занимает порт и как его освободить. Освобождаем только свои процессы пользователя и контейнеры docker,
// и только по явному подтверждению в интерфейсе.
const { run } = require('./proc');

async function listener(port) {
  const { out } = await run(`ss -ltnpH sport = :${Number(port)}`);
  if (!out.trim()) return { busy: false };
  const m = out.match(/users:\(\("([^"]*)",pid=(\d+)/);
  return { busy: true, process: m?.[1] || null, pid: m ? Number(m[2]) : null };
}

async function containerOn(port) {
  const { code, out } = await run(`docker ps --format '{{.Names}}\t{{.Ports}}'`);
  if (code !== 0) return null;
  for (const line of out.split('\n').filter(Boolean)) {
    const [name, ports] = line.split('\t');
    if (new RegExp(`[:\\]](?:${Number(port)})->`).test(ports || '')) return name;
  }
  return null;
}

async function info(port) {
  port = Number(port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error('Неверный порт'), { code: 400 });
  const l = await listener(port);
  if (!l.busy) return { port, busy: false };
  const container = await containerOn(port);
  return { port, busy: true, process: l.process, pid: l.pid, container, canFree: Boolean(container || l.pid) };
}

async function free(port) {
  const i = await info(port);
  if (!i.busy) return { ok: true, note: 'Порт уже свободен' };
  if (i.container) {
    const r = await run(`docker stop ${JSON.stringify(i.container)}`);
    if (r.code !== 0) throw new Error(`docker stop: ${r.out.trim()}`);
    return { ok: true, note: `Контейнер ${i.container} остановлен` };
  }
  if (!i.pid) throw Object.assign(new Error('Процесс не принадлежит вам (или не виден) — освободите порт вручную'), { code: 403 });
  if (i.pid === process.pid) throw Object.assign(new Error('Это сама панель'), { code: 400 });
  process.kill(i.pid, 'SIGTERM');
  return { ok: true, note: `Процесс ${i.process} (pid ${i.pid}) остановлен` };
}

module.exports = { info, free };

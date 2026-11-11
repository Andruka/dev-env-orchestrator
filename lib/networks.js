// Пустые сети docker от compose-проектов: из-за фиксированной подсети в compose-файле такая сеть
// от другого клона репозитория мешает создать свою («Pool overlaps with other one»).
// Удаляем только сети с меткой compose и без контейнеров, по явному подтверждению в интерфейсе.
const fs = require('fs');
const { run } = require('./proc');

const NAME = /^[\w.-]+$/;

async function inspect(names) {
  const fmt = '{{.Name}}\t{{range .IPAM.Config}}{{.Subnet}} {{end}}\t{{len .Containers}}\t{{index .Labels "com.docker.compose.project"}}';
  const { code, out } = await run(`docker network inspect ${names.join(' ')} --format '${fmt}'`);
  if (code !== 0 && !out.trim()) return [];
  return out.split('\n').filter(Boolean).map(l => {
    const [name, subnet, n, project] = l.split('\t');
    return { name, subnet: (subnet || '').trim(), containers: Number(n), project: project && project !== '<no value>' ? project : '' };
  });
}

// Подсети, которые compose-файл просит у docker (ipam.config[].subnet)
function composeSubnets(file) {
  try { return [...fs.readFileSync(file, 'utf8').matchAll(/^\s*-?\s*subnet:\s*["']?(\d+\.\d+\.\d+\.\d+\/\d+)/gm)].map(m => m[1]); } catch { return []; }
}

function range(cidr) {
  const [ip, bits] = cidr.split('/');
  const n = ip.split('.').reduce((a, o) => a * 256 + Number(o), 0);
  const size = 2 ** (32 - Number(bits));
  const start = Math.floor(n / size) * size;
  return [start, start + size - 1];
}
const overlaps = (a, b) => { const [a0, a1] = range(a), [b0, b1] = range(b); return a0 <= b1 && b0 <= a1; };

// Кандидаты на удаление: сеть compose-проекта без контейнеров; если известны нужные подсети — только пересекающиеся с ними
async function unused(subnets = []) {
  const ls = await run(`docker network ls --format '{{.Name}}'`);
  if (ls.code !== 0) throw Object.assign(new Error('docker не отвечает'), { code: 500 });
  const names = ls.out.split('\n').map(s => s.trim()).filter(n => NAME.test(n) && !['bridge', 'host', 'none'].includes(n));
  if (!names.length) return [];
  const want = subnets.filter(c => /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(c));
  return (await inspect(names)).filter(n => n.project && n.containers === 0
    && (!want.length || n.subnet.split(' ').filter(Boolean).some(sn => want.some(w => overlaps(sn, w)))));
}

async function prune(names, subnets = []) {
  if (!Array.isArray(names) || !names.length) throw Object.assign(new Error('Не выбраны сети'), { code: 400 });
  const ok = new Set((await unused(subnets)).map(n => n.name));   // повторная проверка: за время диалога сеть могла занять
  const removed = [], skipped = [];
  for (const name of names) {
    if (!NAME.test(String(name)) || !ok.has(name)) { skipped.push(name); continue; }
    const r = await run(`docker network rm ${name}`);
    (r.code === 0 ? removed : skipped).push(name);
  }
  return { removed, skipped, note: removed.length ? `Удалено сетей: ${removed.length}` : 'Нечего удалять' };
}

module.exports = { unused, prune, composeSubnets, overlaps };

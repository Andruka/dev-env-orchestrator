const path = require('path');
const networks = require('../networks');

// Перед запуском compose: освободить подсеть, которую compose-файл просит у docker (см. lib/networks.js)
module.exports = async function freeSubnets(step, ctx) {
  const file = path.join(ctx.cwd, step.composeFile || 'docker-compose.yml');
  const { removed, busy } = await networks.freeFor(file, ctx.cwd, ctx.log);
  if (busy.length) {
    const b = busy[0];
    const who = b.containerNames.length ? `в ней работают контейнеры: ${b.containerNames.join(', ')}` : 'это не сеть compose-проекта';
    throw new Error(`Подсеть ${b.subnet} занята сетью «${b.name}» (${who}). Остановите тот проект кнопкой «Остановить (ddown)» и повторите.`);
  }
  if (!removed.length) ctx.log('Подсеть свободна');
};

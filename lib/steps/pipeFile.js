const fs = require('fs');
const { spawnShell, killTree, onLines } = require('../proc');

// Передаёт файл в stdin команды с отображением прогресса. { file, cmd }
module.exports = function pipeFile(step, ctx) {
  const total = fs.statSync(step.file).size;
  ctx.log(`$ ${step.cmd} < ${step.file} (${(total / 1024 ** 3).toFixed(2)} GB)`);
  return new Promise((resolve, reject) => {
    const child = spawnShell(step.cmd, { cwd: step.cwd || ctx.cwd, env: step.env });
    const input = fs.createReadStream(step.file, { highWaterMark: 1 << 20 });
    let sent = 0;
    let lastPct = -1;
    let errors = 0;
    input.on('data', chunk => {
      sent += chunk.length;
      const pct = Math.floor((sent / total) * 1000) / 10;
      if (pct !== lastPct) { lastPct = pct; ctx.progress(pct); }
    });
    input.pipe(child.stdin);
    child.stdin.on('error', () => {});
    ctx.onCancel(() => { input.destroy(); killTree(child); });
    onLines(child, line => {
      if (/ERROR/.test(line) && ++errors > 200) return; // не заваливаем лог
      ctx.log(line);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (errors) ctx.log(`Всего ошибок psql: ${errors}`);
      code === 0 ? resolve() : reject(new Error(`exit code ${code}`));
    });
  });
};

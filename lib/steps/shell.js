const { spawnShell, killTree, onLines } = require('../proc');

function once(step, ctx) {
  return new Promise((resolve, reject) => {
    const child = spawnShell(step.cmd, { cwd: step.cwd || ctx.cwd, env: step.env });
    child.stdin.end();
    ctx.onCancel(() => killTree(child));
    onLines(child, ctx.log);
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`exit code ${code}`))));
  });
}

// { cmd, cwd?, env?, retry?: { times, delayMs }, allowFail? }
module.exports = async function shell(step, ctx) {
  ctx.log(`$ ${step.cmd}`);
  const times = step.retry?.times || 1;
  for (let i = 1; ; i++) {
    try {
      return await once(step, ctx);
    } catch (e) {
      ctx.throwIfCancelled();
      if (i >= times) {
        if (step.allowFail) return ctx.log(`(ошибка проигнорирована: ${e.message})`);
        throw e;
      }
      await ctx.sleep(step.retry.delayMs || 1000);
    }
  }
};

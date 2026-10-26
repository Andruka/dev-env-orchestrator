const { spawnShell } = require('../proc');

// Запустить и забыть (браузер, GUI-приложения)
module.exports = async function detached(step, ctx) {
  ctx.log(`$ ${step.cmd}`);
  spawnShell(step.cmd, { cwd: step.cwd || ctx.cwd, env: step.env, detachedIgnore: true, scope: 'detached' }).unref();
};

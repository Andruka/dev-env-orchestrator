const { spawn } = require('child_process');

// Запустить и забыть (браузер, GUI-приложения)
module.exports = async function detached(step, ctx) {
  ctx.log(`$ ${step.cmd}`);
  const child = spawn('bash', ['-c', step.cmd], {
    cwd: step.cwd || ctx.cwd, env: { ...process.env, ...step.env }, detached: true, stdio: 'ignore',
  });
  child.unref();
};

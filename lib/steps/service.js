const services = require('../services');

// Запускает долгоживущий процесс. Шаг завершается, когда в логе появится readyPattern
// (или сразу, если паттерн не задан). Процесс продолжает работать после шага.
module.exports = function service(step, ctx) {
  ctx.log(`$ ${step.cmd}`);
  const s = services.start(step.service, {
    cmd: step.cmd, cwd: step.cwd || ctx.cwd, env: step.env, project: ctx.project?.name,
  });
  if (!step.readyPattern) return Promise.resolve();
  const ready = new RegExp(step.readyPattern);
  const fail = step.failPattern && new RegExp(step.failPattern);
  return new Promise((resolve, reject) => {
    const listener = line => {
      if (line === null) return done(new Error(`процесс завершился (code ${s.child.exitCode}) до готовности`));
      ctx.log(line);
      if (ready.test(line)) done();
      else if (fail && fail.test(line)) done(new Error(`ошибка: ${line}`));
    };
    const done = err => {
      s.listeners.delete(listener);
      err ? reject(err) : resolve();
    };
    s.listeners.add(listener);
    ctx.onCancel(() => done(new Error('отменено (сервис продолжает работать)')));
  });
};

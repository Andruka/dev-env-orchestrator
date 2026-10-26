const services = require('../services');

module.exports = async function stopService(step, ctx) {
  const stopped = await services.stop(step.service);
  ctx.log(stopped ? `Сервис "${step.service}" остановлен` : `Сервис "${step.service}" не был запущен`);
};

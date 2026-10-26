// Реестр типов шагов. Новый тип: положить файл в lib/steps или plugins/steps и экспортировать async (step, ctx) => {}
const fs = require('fs');
const path = require('path');

const registry = {};

function loadDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.js') && f !== 'index.js') registry[path.basename(f, '.js')] = require(path.join(dir, f));
  }
}

loadDir(__dirname);
loadDir(path.join(__dirname, '..', '..', 'plugins', 'steps'));

module.exports = registry;

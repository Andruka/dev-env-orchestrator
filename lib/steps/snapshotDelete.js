const snapshots = require('../snapshots');

module.exports = async function snapshotDelete(step, ctx) {
  snapshots.remove(step.id);
  ctx.log(`Снимок ${step.id} удалён`);
};

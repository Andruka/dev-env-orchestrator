const snapshots = require('../snapshots');
const shell = require('./shell');

// Восстанавливает pgdata из снимка, если подходящий есть, и ставит флаг (по умолчанию "restored").
// { kind: fresh|dump|manual, dataDir, migrationsDir? (fresh), dumpFile? (dump), id? (manual), flag? }
module.exports = async function snapshotRestore(step, ctx) {
  let snap = null;
  if (step.kind === 'fresh') {
    const files = await snapshots.manifest(ctx.cwd, step.migrationsDir);
    const best = snapshots.bestFresh(files);
    if (best) {
      snap = best.snapshot;
      ctx.log(`Найден снимок ${snap.id} (ветка ${snap.branch}, ${snap.project}); миграций докатить: ${best.missing}`);
    }
  } else if (step.kind === 'dump') {
    const { snapshot } = snapshots.findDump(step.dumpFile);
    snap = snapshot;
    if (snap) ctx.log(`Найден снимок дампа ${snap.id}`);
  } else if (step.kind === 'manual') {
    snap = snapshots.list().find(s => s.id === step.id);
    if (!snap) throw new Error(`Снимок не найден: ${step.id}`);
  }
  if (!snap) { ctx.log(`Подходящего снимка нет — будет полный путь${snapshots.enabled() ? ', снимок сохранится в конце' : ''}`); return; }

  await shell({
    cmd: `set -o pipefail; zstd -dc -T0 '${snapshots.dataPath(snap.id)}' | docker run -i --rm -v '${step.dataDir}':/d alpine sh -c 'rm -rf /d/pgdata && mkdir -p /d/pgdata && tar -C /d/pgdata --numeric-owner -xpf -'`,
  }, ctx);
  snapshots.touch(snap);
  ctx.flags[step.flag || 'restored'] = true;
  ctx.log(`Снимок восстановлен (${snapshots.human(snap.size)})`);
};

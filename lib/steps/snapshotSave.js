const fs = require('fs');
const path = require('path');
const snapshots = require('../snapshots');
const shell = require('./shell');
const { run } = require('../proc');

// Сохраняет pgdata в снимок. БД останавливается (stopCmd) для целостной копии и запускается снова (startCmd).
// { kind: fresh|dump|manual, dataDir, migrationsDir? (fresh), dumpFile? (dump), name? (manual), keep?, stopCmd?, startCmd? }
module.exports = async function snapshotSave(step, ctx) {
  if (!snapshots.enabled()) {
    // автоматические снимки молча пропускаем, а явное «Сохранить текущую БД» должно сказать, почему ничего не вышло
    if (step.kind === 'manual') throw new Error('Создание снимков отключено: Настройки → Окружение → Снимки БД');
    return ctx.log('Создание снимков отключено в настройках — пропускаю');
  }
  const meta = { kind: step.kind, project: ctx.project.name, createdAt: Date.now() };
  if (step.kind === 'fresh') {
    meta.files = await snapshots.manifest(ctx.cwd, step.migrationsDir);
    meta.hash = snapshots.manifestHash(meta.files);
    if (snapshots.list('fresh').some(s => s.hash === meta.hash)) return ctx.log('Снимок для этого набора миграций уже есть — пропускаю');
    meta.branch = (await run('git rev-parse --abbrev-ref HEAD', { cwd: ctx.cwd })).out.trim();
    meta.label = `${meta.branch} · ${Object.keys(meta.files).length} файлов миграций`;
  } else if (step.kind === 'dump') {
    const { key, snapshot } = snapshots.findDump(step.dumpFile);
    if (snapshot) return ctx.log('Снимок этого дампа уже есть — пропускаю');
    meta.dumpKey = key;
    meta.label = path.basename(step.dumpFile);
  } else {
    meta.branch = (await run('git rev-parse --abbrev-ref HEAD', { cwd: ctx.cwd })).out.trim();
    meta.label = step.name || `${ctx.project.name} · ${meta.branch}`;
  }
  meta.id = snapshots.newId(step.kind, step.kind === 'dump' ? meta.label.replace(/\.sql$/, '') : meta.branch || step.name);

  fs.mkdirSync(snapshots.dir(), { recursive: true });
  const du = await run(`docker run --rm -v '${step.dataDir}':/d alpine du -sb /d/pgdata`);
  if (du.code !== 0) {
    throw new Error(`В ${step.dataDir} нет папки pgdata — снимок сохранить не из чего. docker compose монтирует другую папку данных БД: `
      + 'проверьте «Корневая папка» и «Папка данных БД» в Настройки → Репозитории / Окружение (путь должен совпадать с volumes у сервиса БД в compose-файле).');
  }
  const raw = parseInt(du.out, 10) || 0;
  if (raw && snapshots.freeBytes(snapshots.dir()) < raw * 0.6 + 5 * 1024 ** 3) {
    return ctx.log(`Мало места на диске для снимка (база ${snapshots.human(raw)}) — снимок не сохранён`);
  }

  if (step.stopCmd) await shell({ cmd: step.stopCmd }, ctx);
  const dir = path.join(snapshots.dir(), meta.id);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${snapshots.dataPath(meta.id)}.part`;
  try {
    await shell({
      cmd: `set -o pipefail; docker run --rm -v '${step.dataDir}':/d alpine tar -C /d/pgdata --numeric-owner -cf - . | zstd -T0 -3 -q -o '${tmp}'`,
    }, ctx);
    fs.renameSync(tmp, snapshots.dataPath(meta.id));
    meta.size = fs.statSync(snapshots.dataPath(meta.id)).size;
    meta.rawSize = raw;
    fs.writeFileSync(snapshots.metaPath(meta.id), JSON.stringify(meta, null, 2));
    ctx.log(`Снимок ${meta.id}: ${snapshots.human(raw)} → ${snapshots.human(meta.size)}`);
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  } finally {
    if (step.startCmd) await shell({ cmd: step.startCmd }, ctx);
  }
  if (step.keep) snapshots.prune(step.kind, Number(step.keep)).forEach(id => ctx.log(`Удалён старый снимок ${id}`));
};

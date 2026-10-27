const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-snap-'));
  process.env.DEV_PANEL_USER_CONFIG = path.join(dir, 'config.json');
  for (const m of ['../lib/userConfig', '../lib/config', '../lib/admin', '../lib/snapshots', '../lib/steps/snapshotSave']) delete require.cache[require.resolve(m)];
  return { dir, cfg: require('../lib/config'), admin: require('../lib/admin'), snapshots: require('../lib/snapshots') };
}

test('по умолчанию снимки включены, папка — в данных пользователя', () => {
  const { cfg, snapshots } = setup();
  const v = cfg.load().vars;
  assert.equal(v.snapshotsEnabled, true);
  assert.match(v.snapshotsDir, /dev-panel\/snapshots$/);
  snapshots.configure(v);
  assert.equal(snapshots.dir(), v.snapshotsDir);
  assert.equal(snapshots.enabled(), true);
});

test('своя папка и отключение применяются; ~ раскрывается', () => {
  const { dir, cfg, admin, snapshots } = setup();
  const own = path.join(dir, 'снимки');
  admin.setVars({ snapshotsDir: own, snapshotsEnabled: false });
  snapshots.configure(cfg.load().vars);
  assert.equal(snapshots.dir(), own);
  assert.equal(snapshots.enabled(), false);
  admin.setVars({ snapshotsDir: '~/snaps', snapshotsEnabled: '' });
  snapshots.configure(cfg.load().vars);
  assert.equal(snapshots.dir(), path.join(os.homedir(), 'snaps'));
  assert.equal(snapshots.enabled(), true);
});

test('относительный путь не сохраняется, а вручную прописанный игнорируется', () => {
  const { dir, cfg, admin, snapshots } = setup();
  assert.throws(() => admin.setVars({ snapshotsDir: 'relative/dir' }), /абсолютным/);
  assert.throws(() => admin.setVars({ snapshotsEnabled: 'maybe' }), /да или нет/);
  const before = snapshots.dir();
  fs.writeFileSync(process.env.DEV_PANEL_USER_CONFIG, JSON.stringify({ version: 1, vars: { snapshotsDir: 'relative/dir' } }));
  snapshots.configure(require('../lib/config').load().vars);
  assert.equal(snapshots.dir(), before);
  assert.ok(dir);
});

test('при отключении шаг сохранения пропускается, а ручное сохранение сообщает причину', async () => {
  const { dir, cfg, admin, snapshots } = setup();
  admin.setVars({ snapshotsDir: path.join(dir, 's'), snapshotsEnabled: false });
  snapshots.configure(cfg.load().vars);
  const save = require('../lib/steps/snapshotSave');
  const logs = [];
  const ctx = { project: { name: 'p' }, cwd: dir, log: l => logs.push(l) };
  await save({ kind: 'fresh', dataDir: dir, migrationsDir: 'm' }, ctx);
  assert.match(logs[0], /отключено/);
  await assert.rejects(save({ kind: 'manual', dataDir: dir }, ctx), /отключено/);
  assert.equal(fs.existsSync(path.join(dir, 's')), false, 'папка не должна создаваться');
});

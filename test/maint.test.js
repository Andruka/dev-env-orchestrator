const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fresh = (...mods) => { for (const m of mods) delete require.cache[require.resolve(m)]; };
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('подсказки: занятый порт, docker, место, вход', () => {
  const { analyze } = require('../lib/hints');
  assert.deepStrictEqual(analyze(['Bind for 0.0.0.0:5432 failed: port is already allocated'])[0].fix, { kind: 'port', port: 5432 });
  assert.strictEqual(analyze(['Error: listen EADDRINUSE: address already in use :::3000'])[0].fix.port, 3000);
  assert.strictEqual(analyze(['Cannot connect to the Docker daemon at unix:///var/run/docker.sock'])[0].id, 'dockerd');
  assert.strictEqual(analyze(['write /x: no space left on device'])[0].fix.tab, 'doctor');
  assert.strictEqual(analyze(['POST /token: HTTP 401 bad'], '')[0].id, 'login');
  assert.deepStrictEqual(analyze(['всё хорошо'], ''), []);
});

test('журнал: пишется, читается с конца, фильтр по типу, права 600', () => {
  process.env.XDG_STATE_HOME = tmp('dp-jr-');
  fresh('../lib/journal');
  const j = require('../lib/journal');
  j.add('job', 'Поднять · server: готово', { status: 'done' });
  j.add('stand', 'Стенд «5005» применён');
  j.add('job', 'Остановить · server: ошибка', { status: 'failed' });
  const all = j.list();
  assert.strictEqual(all.length, 3);
  assert.strictEqual(all[0].title, 'Остановить · server: ошибка', 'свежие первыми');
  assert.strictEqual(j.list({ type: 'stand' }).length, 1);
  const file = path.join(process.env.XDG_STATE_HOME, 'dev-panel', 'journal.jsonl');
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
});

test('очистка: удаление дампа только по имени файла внутри папки дампов', async () => {
  const dir = tmp('dp-cl-');
  const dumps = path.join(dir, 'dumps');
  fs.mkdirSync(dumps);
  fs.writeFileSync(path.join(dumps, 'a.sql'), 'x');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'keep');
  process.env.XDG_STATE_HOME = path.join(dir, 'state');
  fresh('../lib/cleanup');
  const { act, scan } = require('../lib/cleanup');
  const config = { vars: { dumpsDir: dumps, snapshotsDir: path.join(dir, 'snaps') } };
  await assert.rejects(() => act(config, 'dumpDelete', '../secret.txt'), /Неверное имя/);
  await assert.rejects(() => act(config, 'dumpDelete', '.hidden'), /Неверное имя/);
  assert.ok(fs.existsSync(path.join(dir, 'secret.txt')));
  assert.ok((await scan(config)).dumps.items.some(d => d.name === 'a.sql'));
  await act(config, 'dumpDelete', 'a.sql');
  assert.ok(!fs.existsSync(path.join(dumps, 'a.sql')));
  await assert.rejects(() => act(config, 'rm -rf', ''), /Неизвестное действие/);
});

test('порты: неверный номер отклоняется, свободный порт сообщается свободным', async () => {
  const ports = require('../lib/ports');
  await assert.rejects(() => ports.info('abc'), /Неверный порт/);
  await assert.rejects(() => ports.info(70000), /Неверный порт/);
  const net = require('net');
  const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  assert.strictEqual((await ports.info(port)).busy, false);
});

test('changelog читается из CHANGELOG.md', () => {
  const { changelog, version } = require('../lib/selfupdate');
  const log = changelog();
  assert.ok(log.length >= 2);
  assert.strictEqual(log[0].version, version(), 'верхняя запись — текущая версия');
  assert.ok(log[0].items.length > 3);
});

test('профиль: без путей и паролей, импорт не затирает свои пути и существующие стенды', () => {
  const dir = tmp('dp-prof-');
  process.env.DEV_PANEL_USER_CONFIG = path.join(dir, 'config.json');
  fresh('../lib/userConfig', '../lib/admin');
  const userConfig = require('../lib/userConfig');
  userConfig.write({
    version: 1, vars: { calplanRoot: '/home/me/calplan', dbPort: 5433, swaggerDir: '/home/me/sw' }, groups: { backend: { addPaths: ['/home/me/x'], hidden: ['up'] } },
    customGroups: [{ id: 'g1', title: 'Мои', kind: 'generic', paths: ['/home/me/y'], addPaths: [], exclude: [], sections: [], primary: null }],
    actions: {}, prefs: { theme: 'dracula' },
    envs: [{ id: 'e1', title: '5005', origin: 'https://h:5005', picks: { backendEnv: '@5005' }, ide: true }],
  });
  const admin = require('../lib/admin');
  const prof = admin.exportProfile();
  const text = JSON.stringify(prof);
  assert.ok(!text.includes('/home/me'), 'в профиле нет путей');
  assert.strictEqual(prof.vars.dbPort, 5433);
  assert.ok(!('calplanRoot' in prof.vars));
  assert.strictEqual(prof.envs[0].ide, undefined, 'флаг переменных IDE не переносится');

  // у коллеги свои пути и свой стенд с тем же названием
  const dir2 = tmp('dp-prof2-');
  process.env.DEV_PANEL_USER_CONFIG = path.join(dir2, 'config.json');
  fresh('../lib/userConfig', '../lib/admin');
  require('../lib/userConfig').write({ version: 1, vars: { calplanRoot: '/home/col/calplan' }, groups: {}, customGroups: [], actions: {}, prefs: {}, envs: [{ id: 'x', title: '5005', picks: {} }] });
  const r = require('../lib/admin').importProfile(prof);
  const after = require('../lib/userConfig').read();
  assert.strictEqual(after.vars.calplanRoot, '/home/col/calplan');
  assert.strictEqual(after.vars.dbPort, 5433);
  assert.strictEqual(r.skippedEnvs, 1, 'существующий стенд не перезаписан');
  assert.strictEqual(after.envs.length, 1);
  assert.strictEqual(r.groups, 1);
  assert.throws(() => require('../lib/admin').importProfile({ vars: {} }), /не профиль/);
});

test('Swagger: группа и действия есть в настройках по умолчанию; путь берётся из переменной', () => {
  const dir = tmp('dp-sw-');
  process.env.DEV_PANEL_USER_CONFIG = path.join(dir, 'config.json');
  fresh('../lib/userConfig', '../lib/config');
  const sw = path.join(dir, 'my', 'swagger');
  fs.mkdirSync(sw, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version: 1, vars: { swaggerDir: sw }, groups: {}, customGroups: [], actions: {}, prefs: {} }));
  fresh('../lib/userConfig', '../lib/config');
  const cfg = require('../lib/config').load();
  const g = cfg.groups.find(x => x.id === 'swagger');
  assert.ok(g, 'группа swagger есть');
  assert.strictEqual(g.projects.length, 1);
  assert.strictEqual(g.projects[0].path, sw);
  assert.strictEqual(g.primary, 'swaggerBuild');
  for (const a of g.sections.flatMap(s => s.actions)) assert.ok(cfg.actions[a], `действие ${a} описано`);
  // без корня и без своей папки группа проектов не показывает «/swagger»
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version: 1, vars: {}, groups: {}, customGroups: [], actions: {}, prefs: {} }));
  fresh('../lib/userConfig', '../lib/config');
  assert.strictEqual(require('../lib/config').load().groups.find(x => x.id === 'swagger').projects.length, 0);
});

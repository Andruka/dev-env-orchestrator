const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-env-'));
  process.env.DEV_PANEL_USER_CONFIG = path.join(dir, 'config.json');
  process.env.XDG_STATE_HOME = path.join(dir, 'state');
  for (const m of ['../lib/userConfig', '../lib/config', '../lib/admin', '../lib/envswap']) delete require.cache[require.resolve(m)];
  const be = path.join(dir, 'server-copy');
  const fe = path.join(dir, 'CLIENT');
  for (const d of [be, path.join(fe, 'public')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(be, '.env'), 'A=1\nPORT=5005\n');
  fs.writeFileSync(path.join(be, '.env_5005'), 'A=1\nPORT=5005\n');
  fs.writeFileSync(path.join(be, '.env_5008'), 'A=1\nPORT=5008\n# c\nKEY="-----BEGIN\nabc\n-----END"\n');
  fs.writeFileSync(path.join(fe, 'public', 'config.js'), "window.env = {\n // BACKEND_URL: 'https://old:1',\n BACKEND_URL: 'https://10.0.0.1:5005',\n};\n");
  fs.writeFileSync(path.join(fe, 'public', 'config5008.js'), "window.env = { BACKEND_URL: 'https://10.0.0.1:5008' };\n");
  const config = require('../lib/config').load();
  const mk = (id, group, p) => ({ id, name: path.basename(p), path: p, group });
  return { dir, be: mk('b', 'backend', be), fe: mk('f', 'frontend', fe), config, es: require('../lib/envswap'), admin: require('../lib/admin') };
}

test('варианты находятся по маскам, активный определяется по содержимому', () => {
  const { be, fe, config, es } = setup();
  const slot = es.findSlot(config, be, 'backendEnv');
  assert.deepEqual(es.variants(be, slot).map(v => v.rel), ['.env_5005', '.env_5008']);
  assert.equal(es.slotState(be, slot).active, '.env_5005');
  const fslot = es.findSlot(config, fe, 'frontendConfig');
  assert.deepEqual(es.variants(fe, fslot).map(v => v.rel), ['public/config5008.js']);
  assert.equal(es.slotState(fe, fslot).custom, true); // config.js не совпадает с вариантами
});

test('подмена копирует вариант, ручные правки уходят в бэкап', () => {
  const { be, config, es } = setup();
  const slot = es.findSlot(config, be, 'backendEnv');
  assert.equal(es.apply(be, slot, '.env_5008').changed, true);
  assert.match(fs.readFileSync(path.join(be.path, '.env'), 'utf8'), /PORT=5008/);
  assert.equal(es.apply(be, slot, '.env_5008').changed, false);

  fs.appendFileSync(path.join(be.path, '.env'), 'MY_DEBUG=1\n');
  assert.equal(es.slotState(be, slot).custom, true);
  const r = es.apply(be, slot, '.env_5005');
  assert.ok(r.backup && fs.readFileSync(r.backup, 'utf8').includes('MY_DEBUG=1'));
  assert.equal(es.slotState(be, slot).active, '.env_5005');
});

test('нельзя выйти за пределы репозитория и выбрать чужой файл', () => {
  const { be, config, es } = setup();
  const slot = es.findSlot(config, be, 'backendEnv');
  assert.throws(() => es.apply(be, slot, '../../etc/passwd'), /не найден/);
  assert.throws(() => es.apply(be, slot, 'docker-compose.yml'), /не найден/);
  assert.throws(() => es.saveAs(be, { ...slot, target: '../x' }, 'a'), /Недопустимый путь/);
});

test('пресет применяется ко всем слотам или не применяется вовсе', () => {
  const { be, fe, config, es, admin } = setup();
  const projects = { backend: 'b', frontend: 'f' };
  const withProjects = { ...config, groups: config.groups.map(g => ({ ...g, projects: g.id === 'backend' ? [be] : g.id === 'frontend' ? [fe] : [] })) };
  const bad = { title: 'x', picks: { backendEnv: '.env_5008', frontendConfig: 'public/нет.js' } };
  assert.throws(() => es.applyPreset(withProjects, bad, projects), /нет файла/);
  assert.match(fs.readFileSync(path.join(be.path, '.env'), 'utf8'), /PORT=5005/, 'до проверки ничего не меняем');

  const good = { title: '5008', picks: { backendEnv: '.env_5008', frontendConfig: 'public/config5008.js' } };
  assert.equal(es.applyPreset(withProjects, good, projects).filter(r => r.changed).length, 2);
  assert.match(fs.readFileSync(path.join(fe.path, 'public', 'config.js'), 'utf8'), /5008/);
  const two = { ...withProjects, groups: withProjects.groups.map(g => (g.id === 'backend' ? { ...g, projects: [be, { ...be, id: 'b2' }] } : g)) };
  assert.throws(() => es.applyPreset(two, good, {}), /Выберите репозиторий/);
  admin.saveEnv({ title: 'Стенд 5008', picks: good.picks });
  assert.equal(require('../lib/config').load().envs[0].title, 'Стенд 5008');
});

test('разбор .env: кавычки, многострочные значения, комментарии; подмена для IDE', () => {
  const { be, config, es } = setup();
  const slot = es.findSlot(config, be, 'backendEnv');
  es.apply(be, slot, '.env_5008');
  const vars = Object.fromEntries(es.ideVars(be, slot).map(v => [v.key, v.value]));
  assert.equal(vars.PORT, '5008');
  assert.equal(vars.KEY, '-----BEGIN\nabc\n-----END');
  const out = es.ideExport(be, { ...slot, ideOverrides: { A: 'localhost' } });
  assert.match(out.joined, /A=localhost;PORT=5008/);
  assert.ok(!out.joined.includes('\n'));
  assert.ok(fs.existsSync(es.ideFile(be)), 'файл для плагина EnvFile обновляется при подмене');
});

test('BACKEND_URL берётся из config.js, закомментированные строки пропускаются', () => {
  const { fe, config, es } = setup();
  const cfg = { ...config, groups: config.groups.map(g => (g.id === 'frontend' ? { ...g, projects: [fe] } : g)) };
  assert.equal(es.authBase(cfg).url, 'https://10.0.0.1:5005');
});

test('логин следует за стендом фронтенда', () => {
  const auth = require('../lib/auth');
  auth.setBaseResolver(() => ({ url: 'https://10.0.0.1:5008/', project: 'CLIENT' }));
  const { auth: a, base } = auth.effective({
    loginUrl: 'https://10.145.1.150:5005/api/login/token', usersUrl: 'https://10.145.1.150:5005/api/users/{userId}', refreshUrl: '',
  });
  assert.equal(a.loginUrl, 'https://10.0.0.1:5008/api/login/token');
  assert.equal(a.usersUrl, 'https://10.0.0.1:5008/api/users/{userId}');
  assert.equal(base.project, 'CLIENT');
  auth.setBaseResolver(() => null);
});

test('у стенда свои логин и пароль, у остальных общие', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-cred-'));
  process.env.DEV_PANEL_SECRETS = path.join(dir, 'secrets.json');
  for (const m of ['../lib/secrets', '../lib/auth']) delete require.cache[require.resolve(m)];
  const secrets = require('../lib/secrets');
  const auth = require('../lib/auth');
  secrets.updateAuth({ login: 'common', password: 'p0' });
  secrets.updateStand({ origin: 'https://10.0.0.1:5008/api', login: 'u8', password: 'p8', clientId: 3 });
  assert.deepEqual(secrets.publicView().stands, [{ origin: 'https://10.0.0.1:5008', login: 'u8', clientId: 3, hasPassword: true }]);
  assert.throws(() => secrets.updateStand({ origin: 'не адрес', login: 'x' }), /Адрес стенда/);

  const stored = secrets.read().auth;
  auth.setBaseResolver(() => ({ url: 'https://10.0.0.1:5008', project: 'CLIENT' }));
  let e = auth.effective(stored);
  assert.equal(e.auth.login, 'u8'); assert.equal(e.auth.password, 'p8'); assert.equal(e.auth.clientId, 3); assert.equal(e.base.ownCreds, true);
  auth.setBaseResolver(() => ({ url: 'https://10.0.0.1:5006', project: 'CLIENT' }));
  e = auth.effective(stored);
  assert.equal(e.auth.login, 'common'); assert.equal(e.base.ownCreds, false);
  auth.setBaseResolver(() => null);
  secrets.deleteStand('https://10.0.0.1:5008');
  assert.equal(secrets.publicView().stands.length, 0);
});

test('варианты вне git находятся и скрываются локально, без записи в репозиторий', () => {
  const { be, fe, config, es } = setup();
  const sh = c => require('child_process').execSync(c, { cwd: be.path, stdio: 'pipe' }).toString();
  sh('git init -q && git add .env .env_5005 && git -c user.email=a@b -c user.name=t commit -qm i');
  const r = es.excludeFromGit(be, ['.env_5008']);
  assert.deepEqual(r.added, ['.env_5008']);
  assert.match(sh('git status --porcelain'), /^$/);
  assert.deepEqual(es.excludeFromGit(be, ['.env_5008']).added, [], 'повторно не дублируется');
  assert.throws(() => es.excludeFromGit(be, ['../x']), /Недопустимый путь/);
});

test('стенд: файлы уходят в библиотеку панели, адрес и логин берутся автоматически, удаление всё чистит', () => {
  const { dir, be, fe, config, es } = setup();
  process.env.DEV_PANEL_SECRETS = path.join(dir, 'secrets.json');
  for (const m of ['../lib/secrets', '../lib/stands']) delete require.cache[require.resolve(m)];
  const stands = require('../lib/stands');
  const secrets = require('../lib/secrets');
  const cfg = { ...config, groups: config.groups.map(g => ({ ...g, projects: g.id === 'backend' ? [be] : g.id === 'frontend' ? [fe] : [] })) };
  fs.writeFileSync(path.join(dir, 'outside.env'), 'PORT=5009\n');

  const r = stands.save(cfg, {
    title: 'Стенд 5008', login: 'u8', password: 'p8',
    sources: { backendEnv: '.env_5008', frontendConfig: 'public/config5008.js' },
  });
  assert.equal(r.origin, 'https://10.0.0.1:5008');
  const lib = path.join(dir, 'stands', 'backendEnv', 'Стенд_5008');
  assert.ok(fs.existsSync(lib), 'копия лежит в папке панели');
  assert.equal(fs.statSync(lib).mode & 0o777, 0o600);
  assert.ok(!fs.readdirSync(be.path).some(f => f.includes('Стенд')), 'в репозитории ничего не появилось');
  assert.equal(secrets.publicView().stands[0].login, 'u8');

  // применение из библиотеки; активный вариант определяется по содержимому, библиотека в приоритете
  const cur = require('../lib/config').load();
  const slot = es.findSlot(cur, be, 'backendEnv');
  assert.equal(es.apply(be, slot, '@Стенд_5008').changed, true);
  assert.equal(es.slotState(be, slot).active, '@Стенд_5008');

  // файл по пути вне репозитория
  const r2 = stands.save(cur, { title: 'Внешний', sources: { backendEnv: '::path' }, paths: { backendEnv: path.join(dir, 'outside.env') } });
  assert.equal(r2.origin, null);
  assert.ok(fs.existsSync(path.join(dir, 'stands', 'backendEnv', 'Внешний')));
  assert.throws(() => stands.save(cur, { title: 'x', sources: { backendEnv: '::path' }, paths: { backendEnv: 'относительный' } }), /полный путь/);
  assert.throws(() => stands.save(cur, { title: 'x', login: 'a', sources: { backendEnv: '@нет' } }), /нет файла/);

  stands.remove(require('../lib/config').load(), require('../lib/config').load().envs.find(e => e.title === 'Стенд 5008').id);
  assert.ok(!fs.existsSync(lib));
  assert.equal(secrets.publicView().stands.length, 0);
});

test('переменные IDE закреплены за стендом: пачкой, наложение на .env, хранятся вне config.json', () => {
  const { dir, be, fe, config, es } = setup();
  process.env.DEV_PANEL_SECRETS = path.join(dir, 'secrets.json');
  for (const m of ['../lib/secrets', '../lib/stands']) delete require.cache[require.resolve(m)];
  const stands = require('../lib/stands');
  const cfg = { ...config, groups: config.groups.map(g => ({ ...g, projects: g.id === 'backend' ? [be] : [] })) };

  assert.deepEqual(es.parseBulk('A=1;export B="x y";C=l1\\nl2').map(v => `${v.key}=${v.value}`), ['A=1', 'B=x y', 'C=l1\nl2']);
  assert.deepEqual(es.parseBulk('# c\nA=1\nK="a\nb"\n').map(v => v.value), ['1', 'a\nb']);
  assert.throws(() => stands.save(cfg, { title: 'S', sources: { backendEnv: '.env_5008' }, ide: 'мусор без равно' }), /не распознаны/);

  stands.save(cfg, { title: 'S8', sources: { backendEnv: '.env_5008' }, ide: 'PORT=7000\nCP_DB_HOST=localhost' });
  const loaded = require('../lib/config').load();
  assert.equal(loaded.envs[0].ide, true);
  assert.ok(!fs.readFileSync(path.join(dir, 'config.json'), 'utf8').includes('CP_DB_HOST'), 'значения не в config.json');

  const slot = es.findSlot(loaded, be, 'backendEnv');
  es.apply(be, slot, '@S8', loaded);
  const fileTxt = fs.readFileSync(es.ideFile(be), 'utf8');
  assert.match(fileTxt, /PORT=7000/);
  assert.match(fileTxt, /CP_DB_HOST=localhost/);
  const extra = es.standIdeFor(loaded, slot.id, es.slotState(be, slot).active);
  assert.equal(extra.title, 'S8');
  assert.match(es.ideExport(be, slot, extra).joined, /PORT=7000/);

  // правка стенда без поля ide не стирает переменные; пустая строка — стирает
  stands.save(loaded, { id: loaded.envs[0].id, title: 'S8', sources: { backendEnv: '@S8' } });
  assert.equal(es.readStandIde(loaded.envs[0].id).PORT, '7000');
  stands.save(require('../lib/config').load(), { id: loaded.envs[0].id, title: 'S8', sources: { backendEnv: '@S8' }, ide: '' });
  assert.deepEqual(es.readStandIde(loaded.envs[0].id), {});
});

test('адрес стенда без config.js берётся из .env бэкенда', () => {
  const { dir, be, config } = setup();
  process.env.DEV_PANEL_SECRETS = path.join(dir, 'secrets.json');
  for (const m of ['../lib/secrets', '../lib/stands']) delete require.cache[require.resolve(m)];
  fs.writeFileSync(path.join(be.path, '.env_5006'), 'BASIC_PRODUCT_HOST=10.1.1.1\nBASIC_PRODUCT_PORT=5006\n');
  const cfg = { ...config, groups: config.groups.map(g => ({ ...g, projects: g.id === 'backend' ? [be] : [] })) };
  const r = require('../lib/stands').save(cfg, { title: '5006', login: 'x', password: 'y', sources: { backendEnv: '.env_5006' } });
  assert.equal(r.origin, 'https://10.1.1.1:5006');
  assert.equal(require('../lib/secrets').publicView().stands[0].login, 'x');
});

test('состояние localStorage чистится при смене стенда, настройки языка остаются', () => {
  const { script, MARKER } = require('../lib/browserState');
  const store = new Map([['i18nextLng', 'ru-RU'], ['lastCalplanMode_630_1', 'x'], ['user', 'old'], [MARKER, 'https://a:5005']]);
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), clear: () => store.clear() };
  const run = code => new Function('localStorage', 'setTimeout', 'location', `return ${code}`)(localStorage, () => {}, {});
  assert.equal(run(script({ data: { access_token: 't' }, origin: 'https://a:5008' })), true);
  assert.deepEqual([...store.keys()].sort(), [MARKER, 'access_token', 'i18nextLng'].sort());
  assert.equal(store.get(MARKER), 'https://a:5008');
  store.set('keep', '1');
  assert.equal(run(script({ data: { access_token: 't2' }, origin: 'https://a:5008' })), false, 'тот же стенд — ничего не стираем');
  assert.equal(store.get('keep'), '1');
  assert.equal(run(script({ data: { access_token: 't3' }, origin: null })), false, 'без стенда состояние не трогаем');
});

test('у стенда своя страница фронтенда; неверный адрес отклоняется до записи файлов', () => {
  const { dir, be, config } = setup();
  process.env.DEV_PANEL_SECRETS = path.join(dir, 'secrets.json');
  for (const m of ['../lib/secrets', '../lib/stands']) delete require.cache[require.resolve(m)];
  const stands = require('../lib/stands');
  const cfg = { ...config, groups: config.groups.map(g => ({ ...g, projects: g.id === 'backend' ? [be] : [] })) };
  assert.throws(() => stands.save(cfg, { title: 'Z', sources: { backendEnv: '.env_5008' }, startUrl: 'не адрес' }), /Страница фронтенда/);
  assert.ok(!fs.existsSync(path.join(dir, 'stands', 'backendEnv', 'Z')));
  stands.save(cfg, { title: 'Z', sources: { backendEnv: '.env_5008' }, startUrl: 'http://localhost:3000/objects/1841/plans' });
  const e = require('../lib/config').load().envs[0];
  assert.equal(e.startUrl, 'http://localhost:3000/objects/1841/plans');
  stands.save(require('../lib/config').load(), { id: e.id, title: 'Z', sources: { backendEnv: '@Z' } });
  assert.equal(require('../lib/config').load().envs[0].startUrl, e.startUrl, 'без поля — не трогаем');
});

test('сверка стендов: все BACKEND_URL*, локальные бэкенды и процесс с окружением другого стенда', async () => {
  const { fe, config, es } = setup();
  fs.writeFileSync(path.join(fe.path, 'public', 'config.js'),
    "window.env = {\n BACKEND_URL_PLANS: 'http://localhost:9000',\n BACKEND_URL: 'https://10.0.0.1:5008', // базовый\n};\n");
  assert.deepEqual(es.frontendBackendUrls(fs.readFileSync(path.join(fe.path, 'public', 'config.js'), 'utf8')),
    { BACKEND_URL_PLANS: 'http://localhost:9000', BACKEND_URL: 'https://10.0.0.1:5008' });

  const net = require('net');
  const srv = net.createServer().listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  const port = srv.address().port;
  fs.writeFileSync(path.join(fe.path, 'public', 'config.js'), `window.env = { BACKEND_URL_PLANS: 'http://localhost:${port}', BACKEND_URL: 'https://10.0.0.1:5008' };\n`);
  const cfg = { ...config, groups: config.groups.map(g => ({ ...g, projects: g.id === 'frontend' ? [fe] : [] })), envs: [{ id: 'e', title: '5008', picks: {}, origin: 'https://10.0.0.1:5008' }] };
  const r = await require('../lib/standCheck').check(cfg, null);
  srv.close();
  assert.equal(r.front, '10.0.0.1:5008');
  assert.equal(r.frontTitle, '5008');
  assert.equal(r.backends[0].running, true);
  assert.equal(r.backends[0].stand, null, 'у процесса нет BASIC_PRODUCT_* — стенд неизвестен, предупреждения нет');
  assert.equal(r.mismatch.length, 0);
});

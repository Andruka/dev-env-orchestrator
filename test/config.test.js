const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Конфиг читается при загрузке модуля, поэтому каждый тест работает в свежем процессе-окружении
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-test-'));
  process.env.DEV_PANEL_USER_CONFIG = path.join(dir, 'config.json');
  for (const m of ['../lib/userConfig', '../lib/config']) delete require.cache[require.resolve(m)];
  return { dir, uc: require('../lib/userConfig'), cfg: require('../lib/config') };
}

function mkRepo(root, name, files = []) {
  const d = path.join(root, name);
  fs.mkdirSync(path.join(d, '.git'), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(d, f), '');
  return d;
}

test('без настроек панель не знает проектов и не падает', () => {
  const { cfg } = setup();
  const c = cfg.load();
  assert.equal(c.configured, false);
  assert.ok(c.groups.every(g => g.projects.length === 0));
  assert.ok(c.actions.deploy.system);
});

test('проекты находятся по корню и requireFile, exclude убирает лишние', () => {
  const { dir, uc, cfg } = setup();
  const root = path.join(dir, 'calplan');
  mkRepo(root, 'server', ['docker-compose-without-qt.yml']);
  mkRepo(root, 'server_old', ['docker-compose-without-qt.yml']);
  mkRepo(root, 'other');
  mkRepo(root, 'CLIENT');
  uc.update(u => { u.vars.calplanRoot = root; });
  const c = cfg.load();
  const be = c.groups.find(g => g.id === 'backend');
  const fe = c.groups.find(g => g.id === 'frontend');
  assert.deepEqual(be.projects.map(p => p.name), ['server']);
  assert.deepEqual(fe.projects.map(p => p.name), ['CLIENT']);
});

test('addPaths добавляет папку, exclude убирает по пути и по имени', () => {
  const { dir, uc, cfg } = setup();
  const extra = mkRepo(dir, 'extra');
  uc.update(u => { u.groups.frontend = { addPaths: [extra] }; });
  assert.deepEqual(cfg.load().groups.find(g => g.id === 'frontend').projects.map(p => p.path), [extra]);
  uc.update(u => { u.groups.frontend.exclude = ['extra']; });
  assert.equal(cfg.load().groups.find(g => g.id === 'frontend').projects.length, 0);
});

test('скрытые действия не попадают в секции, extra добавляет в нужную секцию', () => {
  const { uc, cfg } = setup();
  uc.update(u => {
    u.groups.backend = { hidden: ['pull'], extra: [{ section: 'Git', actions: ['custom_x'] }, { section: 'Мои', actions: ['custom_y'] }] };
  });
  const be = cfg.load().groups.find(g => g.id === 'backend');
  const git = be.sections.find(s => s.title === 'Git');
  assert.ok(!git.actions.includes('pull'));
  assert.ok(git.actions.includes('custom_x'));
  assert.deepEqual(be.sections.find(s => s.title === 'Мои').actions, ['custom_y']);
});

test('изменённое системное действие помечено, сброс возвращает исходное', () => {
  const { uc, cfg } = setup();
  const orig = cfg.load().actions.pull;
  assert.equal(orig.modified, false);
  uc.update(u => { u.actions.pull = { ...orig, title: 'Моё' }; });
  const changed = cfg.load().actions.pull;
  assert.equal(changed.title, 'Моё');
  assert.equal(changed.modified, true);
  assert.equal(changed.system, true);
  uc.update(u => { delete u.actions.pull; });
  assert.equal(cfg.load().actions.pull.title, orig.title);
});

test('собственное действие не помечено системным', () => {
  const { uc, cfg } = setup();
  uc.update(u => { u.actions.custom_a = { title: 'A', steps: [{ type: 'shell', cmd: 'true' }] }; });
  const a = cfg.load().actions.custom_a;
  assert.equal(a.system, false);
});

test('переменные подставляются друг в друга', () => {
  const { uc, cfg } = setup();
  uc.update(u => { u.vars.calplanRoot = '/srv/cp'; });
  const v = cfg.load().vars;
  assert.equal(v.dumpsDir, '/srv/cp/dbDumps');
  assert.equal(v.dc, 'docker compose -f docker-compose-without-qt.yml');
});

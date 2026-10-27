const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-admin-'));
  process.env.DEV_PANEL_USER_CONFIG = path.join(dir, 'config.json');
  for (const m of ['../lib/userConfig', '../lib/config', '../lib/admin']) delete require.cache[require.resolve(m)];
  return { dir, cfg: require('../lib/config'), admin: require('../lib/admin') };
}

const repo = (root, name) => { const d = path.join(root, name); fs.mkdirSync(path.join(d, '.git'), { recursive: true }); return d; };

test('добавление и удаление репозитория', () => {
  const { dir, cfg, admin } = setup();
  const r = repo(dir, 'app');
  admin.addRepo('frontend', r, cfg.load());
  assert.deepEqual(cfg.load().groups.find(g => g.id === 'frontend').projects.map(p => p.path), [r]);
  admin.removeRepo('frontend', r);
  assert.equal(cfg.load().groups.find(g => g.id === 'frontend').projects.length, 0);
  assert.throws(() => admin.addRepo('frontend', path.join(dir, 'нет'), cfg.load()), /Папки нет/);
  assert.throws(() => admin.addRepo('frontend', 'относительный/путь', cfg.load()), /абсолютный/);
});

test('новая кнопка попадает в раздел и работает, удаление чистит следы', () => {
  const { cfg, admin } = setup();
  const { id } = admin.saveAction({ action: { title: 'Мой тест', steps: [{ type: 'shell', cmd: 'npm test' }] }, placement: [{ group: 'frontend', section: 'Мои' }] }, cfg.load());
  assert.match(id, /^custom_/);
  const fe = cfg.load().groups.find(g => g.id === 'frontend');
  assert.deepEqual(fe.sections.find(s => s.title === 'Мои').actions, [id]);
  admin.deleteAction(id);
  const after = cfg.load();
  assert.ok(!after.actions[id]);
  assert.ok(!after.groups.find(g => g.id === 'frontend').sections.some(s => s.title === 'Мои'));
});

test('команды с запрещённым git отклоняются при сохранении', () => {
  const { cfg, admin } = setup();
  for (const cmd of ['git push origin main', 'git commit -am x', 'git reset --hard', 'gh pr create', 'echo ok && git merge dev']) {
    assert.throws(() => admin.saveAction({ action: { title: 't', steps: [{ type: 'shell', cmd }] } }, cfg.load()), /запрещ/, cmd);
  }
  admin.saveAction({ action: { title: 'ок', steps: [{ type: 'shell', cmd: 'git log --oneline -n 5' }] } }, cfg.load());
});

test('валидация кнопки: название, шаги, тип шага, параметры', () => {
  const { cfg, admin } = setup();
  const save = a => admin.saveAction({ action: a }, cfg.load());
  assert.throws(() => save({ title: '', steps: [{ type: 'shell', cmd: 'ls' }] }), /Название/);
  assert.throws(() => save({ title: 'x', steps: [] }), /шаг/);
  assert.throws(() => save({ title: 'x', steps: [{ type: 'nope' }] }), /неизвестный тип/);
  assert.throws(() => save({ title: 'x', steps: [{ type: 'shell', cmd: ' ' }] }), /пустая/);
  assert.throws(() => save({ title: 'x', params: [{ name: 'a b', type: 'text' }], steps: [{ type: 'shell', cmd: 'ls' }] }), /имя/);
});

test('системную кнопку нельзя удалить, но можно скрыть и сбросить', () => {
  const { cfg, admin } = setup();
  assert.throws(() => admin.deleteAction('pull'), /нельзя удалить/);
  admin.setHidden('backend', 'pull', true);
  assert.ok(!cfg.load().groups[0].sections.flatMap(s => s.actions).includes('pull'));
  admin.setHidden('backend', 'pull', false);
  assert.ok(cfg.load().groups[0].sections.flatMap(s => s.actions).includes('pull'));
  assert.throws(() => admin.resetAction('custom_x'), /системные/);
});

test('скрытие главной кнопки снимает отметку «главная»', () => {
  const { cfg, admin } = setup();
  assert.equal(cfg.load().groups[0].primary, 'deploy');
  admin.setHidden('backend', 'deploy', true);
  assert.equal(cfg.load().groups[0].primary, null);
});

test('своя группа создаётся и удаляется, системную удалить нельзя', () => {
  const { cfg, admin } = setup();
  const { id } = admin.createGroup({ title: 'Сервисы', kind: 'generic' });
  assert.ok(cfg.load().groups.some(g => g.id === id));
  assert.throws(() => admin.deleteGroup('backend'), /Системную/);
  admin.deleteGroup(id);
  assert.ok(!cfg.load().groups.some(g => g.id === id));
});

test('переменные: пустое значение возвращает умолчание; имя проверяется', () => {
  const { cfg, admin } = setup();
  admin.setVars({ dbName: 'other' });
  assert.equal(cfg.load().vars.dbName, 'other');
  admin.setVars({ dbName: '' });
  assert.equal(cfg.load().vars.dbName, 'calplanDb');
  assert.throws(() => admin.setVars({ 'bad name': 1 }), /Недопустимое/);
});

test('импорт настроек проверяет кнопки и не принимает мусор', () => {
  const { cfg, admin } = setup();
  assert.throws(() => admin.importConfig([]), /не файл/);
  assert.throws(() => admin.importConfig({ actions: { a: { title: 'a', steps: [{ type: 'shell', cmd: 'git push' }] } } }), /запрещ/);
  admin.importConfig({ vars: { dbName: 'imp' }, actions: { custom_a: { title: 'A', steps: [{ type: 'shell', cmd: 'ls' }] } } });
  assert.equal(cfg.load().vars.dbName, 'imp');
  assert.ok(cfg.load().actions.custom_a);
});

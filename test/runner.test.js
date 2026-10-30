const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = state => {
  process.env.XDG_STATE_HOME = state;
  delete require.cache[require.resolve('../lib/runner')];
  return require('../lib/runner');
};
const wait = async fn => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('таймаут'); };

test('история запусков переживает перезапуск панели', async () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-hist-'));
  const project = { id: 'p', name: 'proj', group: 'g', path: state };
  const config = { vars: {}, actions: { hello: { title: 'Привет', steps: [{ type: 'shell', title: 'Эхо', cmd: 'echo hi-there' }] } } };

  const first = load(state);
  const job = first.start(config, { actionId: 'hello', project });
  await wait(() => first.get(job.id).finishedAt && fs.existsSync(path.join(state, 'dev-panel', 'jobs.json')));

  const file = path.join(state, 'dev-panel', 'jobs.json');
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, 'история может содержать вывод команд — права 600');

  const second = load(state); // «перезапуск»
  const list = second.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].title, 'Привет');
  assert.strictEqual(list[0].status, 'done');
  assert.ok(second.get(list[0].id).log.some(l => l.includes('hi-there')), 'лог восстановлен');
  // номера продолжаются, а не начинаются с 1
  const next = second.start(config, { actionId: 'hello', project });
  assert.ok(next.id > list[0].id);
  await wait(() => second.get(next.id).finishedAt);
});

// Дымовой тест интерфейса: настоящий браузер (headless) открывает панель в песочнице и обходит основные экраны.
// Пропускается, если браузера нет или задано DEV_PANEL_SKIP_UI=1.
const test = require('node:test');
const assert = require('node:assert');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cdp = require('../lib/cdp');

const ROOT = path.join(__dirname, '..');
const BROWSER = ['google-chrome', 'google-chrome-stable', 'brave-browser', 'chromium', 'chromium-browser'].find(b => {
  try { execFileSync('which', [b], { stdio: 'ignore' }); return true; } catch { return false; }
});
const skip = process.env.DEV_PANEL_SKIP_UI === '1' ? 'DEV_PANEL_SKIP_UI=1' : !BROWSER ? 'не найден Chrome/Brave/Chromium' : false;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) { try { const v = await fn(); if (v) return v; } catch { /* ещё не готово */ } if (Date.now() > end) throw new Error('таймаут ожидания'); await sleep(200); }
}

test('интерфейс: загрузка, настройки, темы, переключатель стенда', { skip, timeout: 90000 }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-ui-'));
  const port = 7800 + Math.floor(Math.random() * 90);
  const dbg = 9300 + Math.floor(Math.random() * 90);
  const panel = spawn('bash', [path.join(ROOT, 'scripts', 'sandbox.sh'), String(port), path.join(tmp, 'sb')], { stdio: 'ignore' });
  const browser = spawn(BROWSER, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${dbg}`, `--user-data-dir=${path.join(tmp, 'br')}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
  const stopped = p => new Promise(r => { if (p.exitCode !== null) return r(); p.once('exit', r); p.kill(); setTimeout(r, 3000); });
  t.after(async () => {
    await Promise.all([stopped(panel), stopped(browser)]);
    await sleep(300); // браузер дописывает профиль после выхода
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* временная папка — не критично */ }
  });

  await until(async () => (await fetch(`http://127.0.0.1:${port}/api/config`)).ok);
  await cdp.waitForBrowser(dbg, 15000);
  const page = (await cdp.listPages(dbg))[0];
  const ev = expr => cdp.evaluate(page.webSocketDebuggerUrl, expr);
  await cdp.command(page.webSocketDebuggerUrl, 'Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await until(async () => ev(`document.querySelectorAll('#repos .repo-row, #repos .welcome').length > 0`));

  await t.test('все темы подключены и определяют токены', async () => {
    const r = await ev(`(() => {
      const need = ['bg','surface','raised','text','dim','accent','on-accent','alive','warn','danger','log-bg','log-text'];
      const bad = [];
      for (const th of THEMES) {
        document.documentElement.dataset.theme = th.id;
        const cs = getComputedStyle(document.documentElement);
        for (const k of need) if (!cs.getPropertyValue('--' + k).trim()) bad.push(th.id + ':' + k);
      }
      return JSON.stringify({ n: THEMES.length, bad });
    })()`);
    const { n, bad } = JSON.parse(r);
    assert.ok(n >= 60, `тем: ${n}`);
    assert.deepStrictEqual(bad, []);
  });

  await t.test('каждая вкладка настроек рисуется без ошибок', async () => {
    const r = await ev(`(async () => {
      const out = [];
      await openSettings('repos');
      for (const [id] of TABS) {
        S.tab = id; renderSettings(); await new Promise(r => setTimeout(r, 50));
        const body = document.querySelector('#setBody');
        out.push([id, body.innerText.length, /undefined|\\[object/.test(body.innerText)]);
      }
      return JSON.stringify(out);
    })()`);
    for (const [id, len, broken] of JSON.parse(r)) {
      assert.ok(len > 40, `вкладка ${id} пустая`);
      assert.ok(!broken, `вкладка ${id}: в тексте undefined или [object`);
    }
  });

  await t.test('выбор темы: фильтр, поиск, избранное', async () => {
    const r = await ev(`(async () => {
      S.tab = 'look'; S.themeFilter = 'all'; S.themeQ = ''; renderSettings();
      const all = document.querySelectorAll('.theme-wrap:not([hidden])').length;
      S.themeQ = 'матриц'; applyThemeSearch();
      const found = document.querySelectorAll('.theme-wrap:not([hidden])').length;
      S.themeQ = ''; applyThemeSearch();
      document.querySelector('[data-theme-fav="dracula"]').click();
      await new Promise(r => setTimeout(r, 100));
      const favFirst = document.querySelector('.theme-sec .sec-title').textContent.includes('Избранное');
      document.querySelector('[data-theme-fav="dracula"]').click();
      S.themeFilter = 'light'; renderSettings();
      const light = [...document.querySelectorAll('.theme-wrap:not([hidden]) .tag')].filter(e => e.textContent === 'тёмная').length;
      S.themeFilter = 'all'; renderSettings();
      return JSON.stringify({ all, found, favFirst, light });
    })()`);
    const o = JSON.parse(r);
    assert.ok(o.all > 60);
    assert.strictEqual(o.found, 1);
    assert.ok(o.favFirst);
    assert.strictEqual(o.light, 0);
  });

  await t.test('фильтр лога и перенос строк', async () => {
    const r = await ev(`(() => {
      state.tab = 'jobs'; state.jobId = 99; state.logs.job[99] = ['alpha one', 'beta two', 'alpha three'];
      const f = document.querySelector('#logFind');
      f.value = 'ALPHA'; f.dispatchEvent(new Event('input'));
      const lines = document.querySelector('#log').innerText.trim().split('\\n').length;
      const count = document.querySelector('#logCount').textContent;
      f.value = ''; f.dispatchEvent(new Event('input'));
      return JSON.stringify({ lines, count });
    })()`);
    const o = JSON.parse(r);
    assert.strictEqual(o.lines, 2);
    assert.strictEqual(o.count, '2 из 3');
  });

  await t.test('плашка стенда открывает меню', async () => {
    const r = await ev(`(async () => {
      state.config.envs = [{ id: 'a', title: 'Стенд А', picks: {} }, { id: 'b', title: 'Стенд Б', picks: {} }];
      renderEnv();
      const chip = document.querySelector('[data-stand-menu]');
      if (!chip) return JSON.stringify({ chip: false });
      chip.click();
      const items = document.querySelectorAll('.pop-menu [data-stand-pick]').length;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return JSON.stringify({ chip: true, items, closed: !document.querySelector('.pop-menu') });
    })()`);
    const o = JSON.parse(r);
    assert.ok(o.chip, 'плашка стенда не нарисована');
    assert.strictEqual(o.items, 2);
    assert.ok(o.closed);
  });

  await t.test('нет горизонтальной прокрутки страницы', async () => {
    assert.strictEqual(await ev(`document.documentElement.scrollWidth <= window.innerWidth`), true);
  });
});

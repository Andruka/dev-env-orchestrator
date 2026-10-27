#!/usr/bin/env node
// Командная строка панели: вспомогательные команды для bin/dev-panel.
//   port | app-browser | version | setup [--yes] [--root=ПАПКА] | doctor
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const pkg = require('../package.json');

const C = process.stdout.isTTY ? { b: '\x1b[1m', d: '\x1b[2m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', c: '\x1b[36m', x: '\x1b[0m' } : { b: '', d: '', g: '', y: '', r: '', c: '', x: '' };

const GUESSES = ['gitRepositories/adept/aus/calplan', 'gitRepositories/calplan', 'projects/calplan', 'calplan', 'work/calplan'];

function loadCfg() {
  for (const m of ['./userConfig', './config']) delete require.cache[require.resolve(m)];
  return require('./config').load();
}

function guessRoot() {
  for (const g of GUESSES) {
    const p = path.join(os.homedir(), g);
    if (fs.existsSync(p)) return p;
  }
  return '';
}

function ask(rl, question, def = '', { secret = false } = {}) {
  return new Promise(resolve => {
    const hint = def ? ` ${C.d}[${secret ? '••••' : def}]${C.x}` : '';
    if (secret) {
      const out = process.stdout;
      const write = rl._writeToOutput;
      rl.question(`${question}${hint}: `, ans => { rl._writeToOutput = write; out.write('\n'); resolve(ans.trim() || def); });
      rl._writeToOutput = s => { if (s.includes(question)) write.call(rl, s); };
    } else {
      rl.question(`${question}${hint}: `, ans => resolve(ans.trim() || def));
    }
  });
}

const yes = a => /^(y|yes|д|да)$/i.test(a.trim());

async function setup(args) {
  const auto = args.includes('--yes') || args.includes('-y');
  const argRoot = (args.find(a => a.startsWith('--root=')) || '').slice(7);
  const interactive = process.stdin.isTTY && process.stdout.isTTY && !auto;
  const userConfig = require('./userConfig');
  const secrets = require('./secrets');
  const { detectBrowser, which } = require('./config');
  const cfg = loadCfg();
  const v = cfg.vars;

  console.log(`\n${C.b}Dev Panel ${pkg.version} — настройка${C.x}`);
  console.log(`${C.d}Файл настроек: ${userConfig.FILE}\nМожно ничего не менять: Enter оставляет значение в скобках. Всё это можно поменять позже в «Настройки» панели.${C.x}\n`);

  const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true }) : null;
  const answer = async (q, def, opts) => (interactive ? ask(rl, q, def, opts) : def);
  const vars = {};
  let root;

  try {
    // 1. корневая папка
    root = argRoot || process.env.DEV_PANEL_ROOT || v.calplanRoot || guessRoot();
    for (;;) {
      root = await answer(`${C.b}1.${C.x} Папка с репозиториями CalPlan (где лежат server и CLIENT)`, root);
      root = root.replace(/^~(?=\/|$)/, os.homedir());
      if (!root) { console.log(`${C.y}Пропущено — выберите папку позже в «Настройки → Репозитории».${C.x}`); break; }
      if (fs.existsSync(root) && fs.statSync(root).isDirectory()) { vars.calplanRoot = path.resolve(root); break; }
      console.log(`${C.r}Папки «${root}» нет.${C.x}`);
      if (!interactive) { root = ''; break; }
      root = '';
    }

    // 2. пути (необязательно)
    if (vars.calplanRoot) {
      const dumps = path.join(vars.calplanRoot, 'dbDumps');
      const data = path.join(vars.calplanRoot, 'calplanDb');
      console.log(`${C.d}   Дампы: ${dumps}\n   Данные БД: ${data}${C.x}`);
      if (interactive && yes(await answer('   Изменить эти пути? (y/N)', 'n'))) {
        vars.dumpsDir = path.resolve(await answer('   Папка с дампами', dumps));
        vars.dbDataDir = path.resolve(await answer('   Папка данных БД', data));
      }
    }

    // 3. адрес фронтенда
    const url = await answer(`${C.b}2.${C.x} Адрес страницы фронтенда`, v.frontendUrl);
    if (url && url !== v.frontendUrl) {
      try { new URL(url); vars.frontendUrl = url; vars.frontendPort = Number(new URL(url).port) || (url.startsWith('https') ? 443 : 80); } catch { console.log(`${C.y}Адрес не похож на URL — оставляю прежний.${C.x}`); }
    }

    // 4. браузер
    const found = ['brave-browser', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].filter(which);
    let browser = v.browserCmd || detectBrowser();
    if (found.length) {
      console.log(`${C.b}3.${C.x} Браузер для фронтенда. Найдено: ${found.join(', ')}`);
      browser = await answer('   Какой использовать', browser || found[0]);
      if (browser && browser !== detectBrowser()) vars.browserCmd = browser;
    } else {
      console.log(`${C.y}3. Brave/Chrome/Chromium не найден — установите один из них, иначе кнопки «Браузер» и «Войти» не заработают.${C.x}`);
    }

    // 5. логин
    const cur = secrets.read().auth;
    console.log(`${C.b}4.${C.x} Логин для входа во фронтенд ${C.d}(Enter — пропустить; пароль хранится только у вас, права 600)${C.x}`);
    const login = await answer('   Логин', cur.login);
    let password = '';
    if (login) password = await answer('   Пароль', cur.password ? cur.password : '', { secret: true });
    const clientId = login ? await answer('   clientId', String(cur.clientId)) : String(cur.clientId);

    // 5. снимки БД
    console.log(`${C.b}5.${C.x} Снимки БД ${C.d}(копии базы, чтобы «Развернуть с нуля» занимало минуты; один снимок — несколько ГБ)${C.x}`);
    if (!yes(await answer('   Создавать снимки? (Y/n)', 'y'))) vars.snapshotsEnabled = false;
    if (vars.snapshotsEnabled !== false) {
      const sd = (await answer('   Папка для снимков', v.snapshotsDir)).replace(/^~(?=\/|$)/, os.homedir());
      if (sd && sd !== v.snapshotsDir) {
        if (path.isAbsolute(sd)) vars.snapshotsDir = path.resolve(sd);
        else console.log(`${C.y}Нужен абсолютный путь — оставляю ${v.snapshotsDir}.${C.x}`);
      }
    }

    if (Object.keys(vars).length) userConfig.update(d => { Object.assign(d.vars, vars); });
    if (login && (login !== cur.login || (password && password !== cur.password) || Number(clientId) !== cur.clientId)) {
      secrets.updateAuth({ login, password: password !== cur.password ? password : '', clientId });
    }
  } finally {
    rl?.close();
  }

  const after = loadCfg();
  console.log(`\n${C.g}Готово.${C.x} Найдено репозиториев: ${after.groups.map(g => `${g.title} — ${g.projects.length}`).join(', ')}`);
  await doctor({ quiet: true });
}

async function doctor({ quiet = false } = {}) {
  const items = await require('./doctor').run(loadCfg());
  const mark = { ok: `${C.g}✔${C.x}`, warn: `${C.y}!${C.x}`, fail: `${C.r}✖${C.x}` };
  const show = quiet ? items.filter(i => i.status !== 'ok') : items;
  if (quiet && !show.length) return console.log(`${C.g}Проверка окружения: всё в порядке.${C.x}`);
  if (quiet) console.log(`\n${C.b}Проверка окружения — что стоит поправить:${C.x}`);
  for (const i of show) {
    console.log(` ${mark[i.status]} ${i.title}: ${i.detail}`);
    if (i.fix && i.status !== 'ok') console.log(`   ${C.d}→ ${i.fix}${C.x}`);
  }
  const bad = items.filter(i => i.status === 'fail').length;
  if (!quiet) console.log(bad ? `\n${C.r}Проблем: ${bad}${C.x}` : `\n${C.g}Критичных проблем нет.${C.x}`);
  return bad;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'port': return console.log(loadCfg().port);
    case 'version': return console.log(pkg.version);
    case 'app-browser': {
      const cfg = loadCfg();
      return console.log(process.env.DEV_PANEL_BROWSER || cfg.vars.browserCmd || '');
    }
    case 'setup': return setup(args);
    case 'doctor': process.exitCode = (await doctor()) ? 1 : 0; return;
    default:
      console.error('Использование: cli.js port | app-browser | version | setup [--yes] [--root=ПАПКА] | doctor');
      process.exitCode = 2;
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });

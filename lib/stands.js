// «Стенд» целиком: файлы окружения (в библиотеке панели или в репозитории), адрес бэкенда, логин и пароль.
// Одна форма вместо ручной настройки слотов, пресетов и учётных данных.
const fs = require('fs');
const path = require('path');
const envswap = require('./envswap');
const admin = require('./admin');
const secrets = require('./secrets');

const fail = (m, code = 400) => { throw Object.assign(new Error(m), { code }); };

// Имя файлов стенда в библиотеке: из названия, кириллица остаётся
const fileName = title => String(title).trim().replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^[._]+|_+$/g, '').slice(0, 40);

const MAX_FILE = 1024 * 1024;

function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}

// Содержимое файла для слота по выбору в форме:
//   «@имя» — из библиотеки; «::current» — то, что лежит в репозитории сейчас; «::path» — файл по пути на диске;
//   иначе — вариант из репозитория (копируется в библиотеку, если copy !== false)
function sourceData(config, slot, src, b) {
  const pathOf = b.paths?.[slot.id];
  if (src === '::path') {
    if (!pathOf || !path.isAbsolute(pathOf)) fail(`${slot.title}: укажите полный путь к файлу`);
    let st;
    try { st = fs.statSync(pathOf); } catch { fail(`${slot.title}: файла ${pathOf} нет`); }
    if (!st.isFile() || st.size > MAX_FILE) fail(`${slot.title}: ${pathOf} — не файл или больше 1 МБ`);
    return { data: fs.readFileSync(pathOf), copy: true };
  }
  const project = envswap.pickProject(config, slot.group, b.projects?.[slot.group]);
  if (src === '::current') {
    const cur = envswap.readIf(path.join(project.path, slot.target));
    if (!cur) fail(`${slot.title}: в ${project.name} нет файла ${slot.target}`);
    return { data: cur, copy: true };
  }
  const v = envswap.variants(project, slot).find(x => x.rel === src);
  if (!v) fail(`${slot.title}: в ${project.name} нет файла ${src}`);
  return { data: fs.readFileSync(v.abs), copy: b.copy !== false, rel: src };
}

// b: { id?, title, note?, sources: {slotId: выбор}, paths?: {slotId: путь}, projects?: {group: projectId}, copy?, origin?, login?, password?, clientId? }
function save(config, b) {
  const title = String(b.title || '').trim();
  if (!title) fail('Назовите стенд');
  const name = fileName(title);
  if (!name) fail('В названии должна быть хотя бы одна буква или цифра');
  const before = b.id ? (config.envs || []).find(e => e.id === b.id) : null;

  // 1) всё проверяем и читаем, ничего не записывая
  let ideVars = null;
  if (typeof b.ide === 'string' && b.ide.trim()) {
    ideVars = envswap.parseBulk(b.ide);
    if (!ideVars.length) fail('Переменные для IDE не распознаны: нужны строки вида KEY=VALUE или одна строка KEY=VALUE;KEY2=VALUE2');
  }
  const picks = {};
  const items = [];
  for (const [slotId, src] of Object.entries(b.sources || {})) {
    if (!src) continue;
    const slot = (config.swaps || []).find(x => x.id === slotId && x.enabled);
    if (!slot) continue;
    if (src.startsWith('@')) {
      const v = envswap.libVariants(slot).find(x => x.rel === src);
      if (!v) fail(`${slot.title}: в панели нет файла «${src.slice(1)}»`);
      picks[slotId] = src;
      items.push({ slot, data: fs.readFileSync(v.abs) });
      continue;
    }
    const { data, copy, rel } = sourceData(config, slot, src, b);
    picks[slotId] = copy ? `@${name}` : rel;
    items.push({ slot, data, copy });
  }
  if (!Object.keys(picks).length) fail('Выберите хотя бы один файл');

  // адрес бэкенда: введённый вручную или из BACKEND_URL выбранного config.js
  let origin = b.origin ? originOf(b.origin) : null;
  if (b.origin && !origin) fail('Адрес бэкенда: укажите https://хост:порт');
  if (!origin) {
    for (const it of items.filter(x => x.slot.kind === 'js')) {
      origin = originOf(envswap.frontendBackendUrl(it.data.toString('utf8')));
      if (origin) break;
    }
  }
  // нет config.js — берём адрес из .env бэкенда: BASIC_PRODUCT_HOST и BASIC_PRODUCT_PORT, схема как у общего URL входа
  if (!origin) {
    for (const it of items.filter(x => x.slot.kind === 'env')) {
      const vars = Object.fromEntries(envswap.parseEnv(it.data.toString('utf8')).map(v => [v.key, v.value]));
      if (vars.BASIC_PRODUCT_HOST && vars.BASIC_PRODUCT_PORT) {
        const scheme = (() => { try { return new URL(secrets.read().auth.loginUrl).protocol; } catch { return 'https:'; } })();
        origin = originOf(`${scheme}//${vars.BASIC_PRODUCT_HOST}:${vars.BASIC_PRODUCT_PORT}`);
        if (origin) break;
      }
    }
  }
  if (b.login && !origin) fail('Не удалось определить адрес стенда по config.js или .env — укажите адрес бэкенда вручную');
  envswap.libName(name);

  // стартовая страница фронтенда: undefined — не трогать, пустая — убрать
  let startUrl = before?.startUrl || '';
  if (typeof b.startUrl === 'string') {
    startUrl = b.startUrl.trim();
    if (startUrl && !/^https?:\/\/\S+$/.test(startUrl)) fail('Страница фронтенда: укажите адрес вида http://localhost:3000/objects/1841/plans');
  }
  // 2) запись
  const written = [];
  for (const it of items) if (it.copy) written.push({ rel: envswap.libWrite(it.slot, name, it.data) });

  // ide: undefined — не трогать, пустая строка — убрать, иначе заменить пачкой
  const hasIde = ideVars ? true : typeof b.ide === 'string' ? false : Boolean(before?.ide);
  const { id } = admin.saveEnv({ id: b.id, title, picks, note: b.note, origin, ide: hasIde, startUrl });
  if (ideVars) envswap.writeStandIde(id, ideVars);
  else if (!hasIde) envswap.removeStandIde(id);
  if (b.login) secrets.updateStand({ origin, login: b.login, password: b.password, clientId: b.clientId });

  // файлы прежней версии стенда, которые больше не нужны
  if (before) {
    for (const [slotId, rel] of Object.entries(before.picks || {})) {
      const slot = (config.swaps || []).find(x => x.id === slotId);
      if (slot && rel.startsWith('@') && picks[slotId] !== rel && !(config.envs || []).some(e => e.id !== before.id && Object.values(e.picks || {}).includes(rel))) envswap.libRemove(slot, rel);
    }
  }
  return { id, origin, files: written.map(w => w.rel), ide: ideVars ? ideVars.length : 0 };
}

// Удалить стенд вместе с его файлами в библиотеке (если ими не пользуется другой стенд) и учётными данными
function remove(config, id) {
  const env = (config.envs || []).find(e => e.id === id);
  if (!env) fail('Стенд не найден', 404);
  const others = (config.envs || []).filter(e => e.id !== id);
  for (const [slotId, rel] of Object.entries(env.picks || {})) {
    const slot = (config.swaps || []).find(x => x.id === slotId);
    if (slot && rel.startsWith('@') && !others.some(e => Object.values(e.picks || {}).includes(rel))) envswap.libRemove(slot, rel);
  }
  if (env.origin && !others.some(e => e.origin === env.origin)) secrets.deleteStand(env.origin);
  envswap.removeStandIde(id);
  admin.deleteEnv(id);
}

module.exports = { save, remove, fileName };

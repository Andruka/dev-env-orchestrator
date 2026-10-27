/* ---------- окно настроек ---------- */

const S = { tab: 'repos', model: null, group: null, doctor: null, doctorBusy: false };

const TABS = [
  ['repos', 'folder-open', 'Репозитории'],
  ['buttons', 'layers', 'Кнопки'],
  ['env', 'sliders-horizontal', 'Окружение'],
  ['login', 'key-round', 'Вход'],
  ['look', 'palette', 'Оформление'],
  ['doctor', 'stethoscope', 'Проверка'],
  ['help', 'book-open', 'Справка'],
];

const KIND_LABEL = { compose: 'docker compose', node: 'node / npm', generic: 'обычная' };
const SOURCE_LABEL = { auto: 'найден автоматически', manual: 'добавлен вручную', default: 'по умолчанию' };

async function openSettings(tab) {
  const dlg = $('#settings');
  if (tab) S.tab = tab;
  if (!dlg.open) {
    dlg.innerHTML = `<nav class="settings-nav" aria-label="Разделы настроек" id="setNav"></nav>
      <div class="settings-main"><div class="settings-body" id="setBody" tabindex="-1"></div>
      <div class="settings-foot"><span class="help" id="setFile"></span><span class="spacer"></span><button class="primary" id="setClose">Готово</button></div></div>`;
    dlg.showModal();
    dlg.onclick = settingsClick;
    dlg.onchange = settingsChange;
    dlg.onkeydown = e => { if (e.key === 'Escape' && !document.querySelector('dialog#editor[open], dialog#picker[open], dialog#dialog[open]')) dlg.close(); };
  }
  await settingsRefresh();
  if (S.tab === 'doctor' && !S.doctor) runDoctor();
}

async function settingsRefresh() {
  const dlg = $('#settings');
  if (!dlg.open) return;
  try { S.model = await api('/api/admin'); } catch (e) { return toast(e.message, 'err'); }
  if (!S.model.groups.some(g => g.id === S.group)) S.group = S.model.groups[0]?.id;
  renderSettings();
}
window.settingsRefresh = settingsRefresh;

function renderSettings() {
  $('#setNav').innerHTML = `<h3>Настройки</h3>${TABS.map(([id, ic, label]) =>
    `<button type="button" data-stab="${id}" aria-selected="${S.tab === id}" ${S.tab === id ? 'aria-current="page"' : ''}>${icon(ic)}${label}</button>`).join('')}`;
  $('#setFile').textContent = S.model.file;
  const body = $('#setBody');
  const scroll = body.scrollTop;
  body.innerHTML = PANES[S.tab]();
  body.scrollTop = scroll;
  if (S.tab === 'login') loadLogin();
}

// Любое изменение настроек: отправить, перечитать конфиг панели и обновить окно
async function change(path, body, okMsg) {
  try {
    await api(path, body);
    if (okMsg) toast(okMsg, 'ok');
    await reloadConfig();
    return true;
  } catch (e) { toast(e.message, 'err'); return false; }
}

/* ---------- Репозитории ---------- */

function reposPane() {
  const m = S.model;
  const root = m.userVars.calplanRoot ?? '';
  const groups = m.groups.map(g => `
    <div class="card" data-group="${esc(g.id)}">
      <div class="card-head">
        <h4>${esc(g.title)}</h4><span class="tag">${esc(KIND_LABEL[g.kind] || g.kind)}</span>
        <span class="spacer"></span>
        <button type="button" class="sm" data-add-repo="${esc(g.id)}">${icon('plus')} Добавить репозиторий</button>
        ${g.system ? (g.customised ? `<button type="button" class="sm ghost" data-reset-group="${esc(g.id)}" title="Вернуть репозитории, кнопки и главное действие группы по умолчанию">${icon('rotate-ccw')} Сбросить</button>` : '')
    : `<button type="button" class="sm ghost danger-ghost" data-del-group="${esc(g.id)}">${icon('trash-2')} Удалить группу</button>`}
      </div>
      <div class="list">
        ${g.projects.length ? g.projects.map(p => `
          <div class="list-row ${p.missing ? 'dim' : ''}">
            ${icon(p.missing ? 'triangle-alert' : 'git-branch')}
            <div class="grow"><span class="name">${esc(p.name)}
              <span class="tag ${p.missing ? 'miss' : ''}">${p.missing ? 'папки нет' : esc(SOURCE_LABEL[p.source] || p.source)}</span></span>
              <span class="sub" title="${esc(p.path)}">${esc(p.path)}</span></div>
            <div class="row-actions"><button type="button" class="ghost sm danger-ghost" data-rm-repo="${esc(p.path)}" data-group-id="${esc(g.id)}" title="Убрать из панели (папка на диске останется)">${icon('x')} Убрать</button></div>
          </div>`).join('') : '<div class="list-empty">Пока пусто. Нажмите «Добавить репозиторий» или задайте папку автопоиска.</div>'}
      </div>
      <div class="field" style="margin:12px 0 0">
        <label>Папка автопоиска</label>
        <div class="input-btn"><input readonly value="${esc(g.discoverRoot)}" placeholder="выключен" aria-label="Папка автопоиска ${esc(g.title)}">
          <button type="button" data-set-root="${esc(g.id)}">${icon('folder')} Выбрать…</button>
          ${g.discoverRoot ? `<button type="button" class="ghost" data-clear-root="${esc(g.id)}" title="Не искать автоматически">Выключить</button>` : ''}
          ${g.system ? `<button type="button" class="ghost" data-default-root="${esc(g.id)}" title="Вернуть значение по умолчанию">По умолчанию</button>` : ''}
        </div>
        <span class="help">Все git-папки внутри${g.requireFile ? ` с файлом <span class="mono">${esc(g.requireFile)}</span>` : ''} появляются в группе автоматически.</span>
      </div>
    </div>`).join('');
  return `<h2 class="pane-title">Репозитории</h2>
    <p class="pane-lead">Какие проекты показывает панель. Добавляйте папки через проводник; убранный репозиторий остаётся на диске, его можно вернуть.</p>
    <div class="card">
      <div class="field" style="margin:0">
        <label>Корневая папка CalPlan</label>
        <div class="input-btn"><input readonly value="${esc(m.vars.calplanRoot || '')}" placeholder="не выбрана" aria-label="Корневая папка CalPlan">
          <button type="button" class="primary" data-pick-var="calplanRoot">${icon('folder-open')} Выбрать…</button></div>
        <span class="help">От неё считаются автопоиск бэкенда, папка клиента, дампы (<span class="mono">dbDumps</span>) и данные БД (<span class="mono">calplanDb</span>). Отдельные пути можно поменять в разделе «Окружение».${root ? '' : ' Пока не выбрана.'}</span>
      </div>
    </div>
    ${groups}
    <button type="button" data-new-group>${icon('plus')} Новая группа…</button>`;
}

/* ---------- Кнопки ---------- */

function buttonsPane() {
  const m = S.model;
  const g = m.groups.find(x => x.id === S.group);
  if (!g) return '<p>Нет групп</p>';
  const placed = new Set(g.sections.flatMap(s => s.actions));
  const hidden = g.hidden.filter(id => m.actions[id]);
  const unplaced = Object.values(m.actions).filter(a => !a.internal && !placed.has(a.id) && !g.hidden.includes(a.id));
  const row = (id, isHidden = false) => {
    const a = m.actions[id];
    if (!a) return '';
    const tags = [
      a.system ? '<span class="tag sys">системная</span>' : '<span class="tag">своя</span>',
      a.modified ? '<span class="tag mod">изменена</span>' : '',
      g.primary === id ? '<span class="tag pri">главная</span>' : '',
      isHidden ? '<span class="tag hid">скрыта</span>' : '',
      a.danger ? '<span class="tag miss">удаляет данные</span>' : '',
    ].join('');
    return `<div class="list-row ${isHidden ? 'dim' : ''}">
      ${icon(a.icon)}
      <div class="grow"><span class="name">${esc(a.title)} ${tags}</span><span class="sub" style="font-family:var(--sans)">${esc(a.hint || '')}</span></div>
      <div class="row-actions">
        ${isHidden ? '' : `<button type="button" class="ghost sm" data-primary="${esc(id)}" data-group-id="${esc(g.id)}" title="${g.primary === id ? 'Снять отметку «главная»' : 'Сделать главной кнопкой строки (Enter)'}" aria-label="Главная" aria-pressed="${g.primary === id}">${icon('zap')}</button>`}
        <button type="button" class="ghost sm" data-edit-action="${esc(id)}" title="Изменить" aria-label="Изменить ${esc(a.title)}">${icon('pencil')}</button>
        <button type="button" class="ghost sm" data-hide="${esc(id)}" data-hidden="${isHidden ? '0' : '1'}" data-group-id="${esc(g.id)}" title="${isHidden ? 'Показать' : 'Скрыть'}" aria-label="${isHidden ? 'Показать' : 'Скрыть'} ${esc(a.title)}">${icon(isHidden ? 'eye' : 'eye-off')}</button>
        ${a.modified ? `<button type="button" class="ghost sm" data-reset-action="${esc(id)}" title="Вернуть исходное поведение" aria-label="Сбросить ${esc(a.title)}">${icon('rotate-ccw')}</button>` : ''}
        ${a.system ? '' : `<button type="button" class="ghost sm danger-ghost" data-del-action="${esc(id)}" title="Удалить" aria-label="Удалить ${esc(a.title)}">${icon('trash-2')}</button>`}
      </div>
    </div>`;
  };
  return `<h2 class="pane-title">Кнопки</h2>
    <p class="pane-lead">Что показывается на карточке проекта. Системные кнопки можно скрывать и менять — исходное поведение всегда восстанавливается значком ↺. Свои кнопки запускают любые команды.</p>
    <div class="seg" role="group" aria-label="Группа">${m.groups.map(x => `<button type="button" data-sgroup="${esc(x.id)}" aria-pressed="${x.id === g.id}">${esc(x.title)}</button>`).join('')}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <button type="button" class="primary" data-new-action>${icon('plus')} Новая кнопка…</button>
      ${unplaced.length ? `<button type="button" data-add-existing>${icon('layers')} Добавить существующую (${unplaced.length})</button>` : ''}
    </div>
    ${g.sections.map(s => `<div class="sec-title">${esc(s.title)}</div><div class="list">${s.actions.map(id => row(id)).join('')}</div>`).join('') || '<div class="list-empty">Все кнопки скрыты</div>'}
    ${hidden.length ? `<div class="sec-title">Скрытые</div><div class="list">${hidden.map(id => row(id, true)).join('')}</div>` : ''}`;
}

/* ---------- Окружение ---------- */

const VAR_FIELDS = [
  ['Пути', [
    ['calplanRoot', 'Корневая папка CalPlan', 'dir', 'Папка, в которой лежат репозитории'],
    ['dumpsDir', 'Папка с дампами', 'dir', 'Файлы *.sql для «Накатить дамп»'],
    ['dbDataDir', 'Папка данных БД', 'dir', 'Здесь docker compose хранит pgdata'],
    ['migrationsDir', 'Миграции (внутри репозитория)', 'text', 'По ним подбирается снимок БД для ветки'],
  ]],
  ['Бэкенд', [
    ['composeFile', 'Файл compose', 'text', 'Имя файла в корне репозитория бэкенда'],
    ['dbService', 'Сервис БД в compose', 'text', ''],
    ['dbName', 'Имя базы', 'text', 'Пересоздаётся при накате дампа'],
    ['dbPort', 'Порт PostgreSQL', 'number', 'Только для индикатора сверху'],
  ]],
  ['Фронтенд и браузер', [
    ['frontendUrl', 'Адрес страницы фронтенда', 'text', 'Открывается кнопкой «Браузер»'],
    ['frontendPort', 'Порт фронтенда', 'number', 'Только для индикатора сверху'],
    ['browserCmd', 'Команда браузера', 'text', 'Пусто — выбрать автоматически (Brave, Chrome, Chromium)'],
    ['browserProfile', 'Профиль браузера', 'dir', 'Отдельный профиль для разработки'],
    ['debugPort', 'Порт отладки браузера', 'number', 'Через него панель входит во фронтенд'],
  ]],
  ['Снимки БД', [
    ['snapshotsEnabled', 'Создавать снимки БД', 'bool', 'Выключите, если не нужны или не хватает места: уже сохранённые снимки останутся и восстанавливаются'],
    ['snapshotsDir', 'Папка для снимков', 'dir', 'Один снимок занимает несколько ГБ. При смене папки старые снимки не переносятся — скопируйте их сами или создайте заново'],
    ['snapshotsKeepFresh', 'Сколько авто-снимков хранить', 'number', 'Снимки после «Развернуть с нуля»'],
    ['snapshotsKeepDump', 'Сколько снимков дампов хранить', 'number', ''],
  ]],
];

function envPane() {
  const m = S.model;
  return `<h2 class="pane-title">Окружение</h2>
    <p class="pane-lead">Пути, порты и имена, которые подставляются в команды. Пустое поле — значение по умолчанию (показано серым).</p>
    <form id="envForm">
    ${VAR_FIELDS.map(([title, fields]) => `<div class="sec-title">${title}</div><div class="var-grid">${fields.map(([k, label, type, help]) => {
    const own = m.userVars[k];
    const def = m.vars[k] ?? '';
    return `<div class="field ${own !== undefined ? 'changed' : ''}"><label for="v_${k}">${esc(label)}</label>
      ${type === 'bool'
    ? `<select id="v_${k}" name="${k}" data-vtype="bool"><option value="true" ${(own ?? def) !== false ? 'selected' : ''}>Да</option><option value="false" ${(own ?? def) === false ? 'selected' : ''}>Нет</option></select>`
    : `<div class="input-btn"><input id="v_${k}" name="${k}" data-vtype="${type}" value="${esc(own ?? '')}" placeholder="${esc(def)}" ${type === 'number' ? 'inputmode="numeric"' : ''} autocomplete="off" spellcheck="false">
      ${type === 'dir' ? `<button type="button" data-pick-input="v_${k}" aria-label="Выбрать папку для ${esc(label)}">${icon('folder')}</button>` : ''}</div>`}
      ${help ? `<span class="help">${esc(help)}</span>` : ''}</div>`;
  }).join('')}</div>`).join('')}
    <div class="modal-actions"><button type="button" class="ghost" data-env-reset>Сбросить всё к умолчанию</button><span class="spacer"></span>
      <button type="submit" class="primary">Сохранить</button></div>
    </form>`;
}

/* ---------- Вход ---------- */

function loginPane() {
  return `<h2 class="pane-title">Вход во фронтенд</h2>
    <p class="pane-lead">Кнопка «Войти» получает токен по API и записывает его в localStorage браузера; панель же продлевает токен, пока вы работаете. Пароль хранится только у вас, в файле с правами 600.</p>
    <div id="loginForm"><div class="note">Загрузка…</div></div>`;
}

async function loadLogin() {
  let s;
  try { s = (await api('/api/settings')).auth; } catch (e) { return toast(e.message, 'err'); }
  const box = $('#loginForm');
  if (!box) return;
  box.innerHTML = `<form id="loginFormEl"><div class="row2">
      <div class="field"><label for="sLogin">Логин</label><input id="sLogin" value="${esc(s.login)}" autocomplete="off"></div>
      <div class="field"><label for="sClient">clientId</label><input id="sClient" value="${esc(s.clientId)}" inputmode="numeric"></div>
    </div>
    <div class="field"><label for="sPass">Пароль</label><input id="sPass" type="password" placeholder="${s.hasPassword ? '•••••••• сохранён — оставьте пустым, чтобы не менять' : 'не задан'}" autocomplete="new-password"></div>
    <label class="check"><input type="checkbox" id="sKeep" ${s.keepAlive !== false ? 'checked' : ''}>
      <span>Поддерживать вход автоматически<br><span class="help">Панель продлевает токен в браузере за 15 минут до истечения и входит заново, если сессия слетела</span></span></label>
    <div class="field"><label for="sLoginUrl">URL получения токена</label><input id="sLoginUrl" class="mono" value="${esc(s.loginUrl)}"></div>
    <div class="field"><label for="sUsersUrl">URL данных пользователя</label><input id="sUsersUrl" class="mono" value="${esc(s.usersUrl)}">
      <span class="help">{userId} подставляется из ответа логина. Оставьте пустым, чтобы не запрашивать.</span></div>
    <div class="field"><label for="sRefreshUrl">URL обновления токена</label><input id="sRefreshUrl" class="mono" value="${esc(s.refreshUrl || '')}" placeholder="по умолчанию: URL токена с /refresh-token">
      <span class="help">Нужен только если адрес обновления отличается от обычного.</span></div>
    <div class="modal-actions"><span id="sResult" class="note" style="display:none;margin-right:auto"></span>
      <button type="button" id="sTest">Проверить вход</button><button type="submit" class="primary" id="sSave">Сохранить</button></div></form>`;
}

const readLogin = () => ({
  login: $('#sLogin').value, clientId: $('#sClient').value, password: $('#sPass').value, keepAlive: $('#sKeep').checked,
  loginUrl: $('#sLoginUrl').value, usersUrl: $('#sUsersUrl').value, refreshUrl: $('#sRefreshUrl').value,
});

/* ---------- Оформление ---------- */

function lookPane() {
  const card = (id, label, mode, hint) => `<button type="button" class="theme-card" role="radio" aria-checked="${themeState.pref === id}" data-theme-pick="${id}" title="${esc(hint)}"
    ${id === 'auto' ? '' : `data-theme="${id}" style="--pv-bg:var(--bg);--pv-surface:var(--surface);--pv-line:var(--line);--pv-line-strong:var(--line-strong);--pv-accent:var(--accent);--pv-alive:var(--alive);--pv-text:var(--text)"`}>
    <span class="pv" ${id === 'auto' ? 'style="background:linear-gradient(90deg,#0d0f14 50%,#eef1f6 50%);height:112px"' : ''}>
      ${id === 'auto' ? '' : `<span class="pv-bar"><i></i><i></i><i></i></span><span class="pv-body"><span class="pv-side"><span class="pv-line a"></span><span class="pv-line s"></span><span class="pv-line s"></span></span><span class="pv-main"><span class="pv-line g"></span><span class="pv-line"></span><span class="pv-line s"></span></span></span>`}
    </span>
    <span class="meta"><b>${esc(label)}</b><span class="tag">${esc(mode)}</span></span>
    <span class="tick">${icon('check')}</span></button>`;
  return `<h2 class="pane-title">Оформление</h2>
    <p class="pane-lead">Тема применяется сразу и запоминается. Все темы проверены на контраст текста (WCAG AA); для плохого зрения или бликов есть «Контраст».</p>
    <div class="theme-grid" role="radiogroup" aria-label="Тема">
      ${card('auto', 'Как в системе', 'авто', 'День или Графит — по настройке ОС')}
      ${THEMES.filter(t => !t.soft).map(t => card(t.id, t.label, t.mode, t.hint)).join('')}
    </div>
    <div class="sec-title">Мягкие, для долгой работы</div>
    <p class="help" style="margin:0 0 10px">Приглушённый контраст, без чисто белого и чёрного, тёплые тона — меньше нагрузка на глаза.</p>
    <div class="theme-grid" role="radiogroup" aria-label="Мягкие темы">
      ${THEMES.filter(t => t.soft).map(t => card(t.id, t.label, t.mode, t.hint)).join('')}
    </div>
    <div class="sec-title">Плотность</div>
    <div class="seg" role="group" aria-label="Плотность">
      <button type="button" data-set-density="comfortable" aria-pressed="${themeState.density === 'comfortable'}">Обычная</button>
      <button type="button" data-set-density="compact" aria-pressed="${themeState.density === 'compact'}">Компактная</button>
    </div>
    <p class="help">Компактная плотность помещает больше проектов на экран.</p>`;
}

/* ---------- Проверка окружения ---------- */

async function runDoctor() {
  S.doctorBusy = true;
  if (S.tab === 'doctor') renderSettings();
  try { S.doctor = await api('/api/doctor'); } catch (e) { toast(e.message, 'err'); }
  S.doctorBusy = false;
  if (S.tab === 'doctor' && $('#settings').open) renderSettings();
}

function doctorPane() {
  const d = S.doctor;
  const bad = d?.filter(i => i.status === 'fail').length || 0;
  const warn = d?.filter(i => i.status === 'warn').length || 0;
  const ICON = { ok: 'circle-check', warn: 'triangle-alert', fail: 'circle-x' };
  return `<h2 class="pane-title">Проверка окружения</h2>
    <p class="pane-lead">Что нужно панели для работы. Красное — без этого не заработает, жёлтое — часть функций недоступна.</p>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
      <button type="button" data-run-doctor ${S.doctorBusy ? 'disabled' : ''}>${icon('refresh-cw')} ${S.doctorBusy ? 'Проверяю…' : 'Проверить снова'}</button>
      ${d ? `<span class="note ${bad ? 'err' : warn ? 'warn' : 'ok'}">${bad ? `Проблем: ${bad}` : warn ? 'Работать можно, есть замечания' : 'Всё в порядке'}${warn && bad ? `, замечаний: ${warn}` : ''}</span>` : ''}
    </div>
    <div class="list">${d ? d.map(i => `<div class="doc-row ${i.status}">${icon(ICON[i.status])}<div><div class="t">${esc(i.title)}</div><div class="d">${esc(i.detail)}</div>${i.fix ? `<div class="f">Что сделать: ${esc(i.fix)}</div>` : ''}</div></div>`).join('') : '<div class="list-empty">Проверяю…</div>'}</div>
    <div class="sec-title">Нужно сделать вручную</div>
    <div class="card"><ol style="margin:0;padding-left:20px;display:grid;gap:6px;color:var(--dim)">
      <li>Установить <b>Node.js 22+</b>, <b>git</b>, <b>docker</b> с плагином compose и <b>zstd</b> (панель их не ставит).</li>
      <li>Добавить себя в группу docker: <span class="mono">sudo usermod -aG docker $USER</span> и перезайти в систему.</li>
      <li>Один раз открыть Brave/Chrome и принять условия первого запуска, если браузер ещё не использовался.</li>
      <li>Указать корневую папку CalPlan и логин — в разделах «Репозитории» и «Вход».</li>
    </ol></div>`;
}

/* ---------- Справка ---------- */

function helpPane() {
  const m = S.model;
  const k = (...keys) => keys.map(x => `<kbd>${x}</kbd>`).join(' ');
  return `<h2 class="pane-title">Справка</h2>
    <p class="pane-lead">Dev Panel версии ${esc(state.config.version)}. Полная инструкция — файл <span class="mono">docs/GUIDE.md</span> рядом с панелью.</p>
    <div class="sec-title">Как пользоваться</div>
    <div class="card"><ol style="margin:0;padding-left:20px;display:grid;gap:6px;color:var(--dim)">
      <li>Слева — проекты. Клик по строке раскрывает карточку с кнопками, главная кнопка есть прямо в строке.</li>
      <li>Справа — ход выполнения задачи и лог. Вкладки <span class="mono">compose</span> и <span class="mono">frontend</span> показывают долгоживущие процессы: они не зависят от панели и переживают её перезапуск.</li>
      <li>Красные кнопки удаляют данные — перед ними всегда спрашивается подтверждение.</li>
      <li>Панель не умеет коммитить, пушить, мержить и сбрасывать — только fetch, смену ветки, <span class="mono">pull --ff-only</span> и stash. Это проверяется и для ваших кнопок.</li>
    </ol></div>
    <div class="sec-title">Горячие клавиши</div>
    <dl class="help-grid">
      <dt>${k('Ctrl', 'K')}</dt><dd>палитра команд: любое действие для любого проекта, смена темы, настройки</dd>
      <dt>${k('↑', '↓')}</dt><dd>выбрать проект</dd>
      <dt>${k('Enter')}</dt><dd>запустить главное действие выбранного проекта</dd>
      <dt>${k('Esc')}</dt><dd>свернуть карточку / закрыть окно</dd>
      <dt>${k('Ctrl', ',')}</dt><dd>настройки</dd>
      <dt>${k('?')}</dt><dd>эта справка</dd>
    </dl>
    <div class="sec-title">Где что лежит</div>
    <dl class="help-grid">
      <dt>Ваши настройки</dt><dd class="mono">${esc(m.file)}</dd>
      <dt>Пароль</dt><dd class="mono">~/.config/dev-panel/secrets.json</dd>
      <dt>Логи процессов</dt><dd class="mono">~/.local/state/dev-panel/</dd>
      <dt>Снимки БД</dt><dd class="mono">${esc(S.model.vars.snapshotsDir || "")}</dd>
    </dl>
    <div class="sec-title">Резервная копия настроек</div>
    <p class="help" style="margin-top:0">Репозитории, кнопки, переменные и тема — одним файлом. Пароль в копию не попадает. Удобно, чтобы перенести настройки на другой компьютер или поделиться кнопками с коллегой.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" data-export>${icon('download')} Сохранить в файл</button>
      <button type="button" data-import>${icon('upload')} Загрузить из файла…</button>
      <button type="button" class="ghost" data-reload-config>${icon('refresh-cw')} Перечитать настройки</button>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
    </div>`;
}

const PANES = { repos: reposPane, buttons: buttonsPane, env: envPane, login: loginPane, look: lookPane, doctor: doctorPane, help: helpPane };

/* ---------- обработчики ---------- */

async function settingsClick(e) {
  const t = e.target;
  const root = e.currentTarget;
  // closest() не должен выходить за пределы окна: у <html> есть data-theme и data-density, и клик в любое поле ловился как выбор плотности
  const q = sel => { const r = t.closest(sel); return r && root.contains(r) ? r : null; };
  let el;
  if (q('#setClose')) return $('#settings').close();
  if ((el = q('[data-stab]'))) { S.tab = el.dataset.stab; renderSettings(); if (S.tab === 'doctor' && !S.doctor) runDoctor(); return; }

  // репозитории
  if ((el = q('[data-add-repo]'))) {
    const g = S.model.groups.find(x => x.id === el.dataset.addRepo);
    const start = g.discoverRoot || S.model.vars.calplanRoot || '';
    const dir = await pickFolder({ title: `Добавить репозиторий в «${g.title}»`, start, mode: 'repo' });
    if (dir) await change('/api/repos/add', { group: g.id, path: dir }, 'Репозиторий добавлен');
    return;
  }
  if ((el = q('[data-rm-repo]'))) {
    if (!(await confirmDialog('Убрать репозиторий', `«${el.dataset.rmRepo}» перестанет показываться в панели. Папка на диске не затрагивается.`, false, 'Убрать'))) return;
    return change('/api/repos/remove', { group: el.dataset.groupId, path: el.dataset.rmRepo });
  }
  if ((el = q('[data-set-root]'))) {
    const g = S.model.groups.find(x => x.id === el.dataset.setRoot);
    const dir = await pickFolder({ title: `Папка автопоиска для «${g.title}»`, start: g.discoverRoot || S.model.vars.calplanRoot || '' });
    if (dir) await change('/api/repos/root', { group: g.id, root: dir }, 'Папка автопоиска изменена');
    return;
  }
  if ((el = q('[data-clear-root]'))) return change('/api/repos/root', { group: el.dataset.clearRoot, root: '' });
  if ((el = q('[data-default-root]'))) return change('/api/repos/root', { group: el.dataset.defaultRoot, root: null });
  if ((el = q('[data-pick-var]'))) {
    const key = el.dataset.pickVar;
    const dir = await pickFolder({ title: 'Корневая папка CalPlan', start: S.model.vars[key] || '' });
    if (dir) await change('/api/vars', { vars: { [key]: dir } }, 'Корневая папка сохранена');
    return;
  }
  if ((el = q('[data-reset-group]'))) {
    if (!(await confirmDialog('Сбросить группу', 'Добавленные и убранные репозитории, скрытые и добавленные кнопки группы вернутся к значениям по умолчанию. Ваши собственные кнопки останутся в списке.', false, 'Сбросить'))) return;
    return change('/api/groups/reset', { id: el.dataset.resetGroup }, 'Группа сброшена');
  }
  if ((el = q('[data-del-group]'))) {
    if (!(await confirmDialog('Удалить группу', 'Группа исчезнет из панели. Папки на диске не затрагиваются.', true, 'Удалить'))) return;
    return change('/api/groups/delete', { id: el.dataset.delGroup });
  }
  if (q('[data-new-group]')) return newGroup();

  // кнопки
  if ((el = q('[data-sgroup]'))) { S.group = el.dataset.sgroup; return renderSettings(); }
  if (q('[data-new-action]')) return editAction({ group: S.group });
  if ((el = q('[data-edit-action]'))) return editAction({ id: el.dataset.editAction, group: S.group });
  if ((el = q('[data-hide]'))) return change('/api/actions/hide', { group: el.dataset.groupId, action: el.dataset.hide, hidden: el.dataset.hidden === '1' });
  if ((el = q('[data-primary]'))) {
    const g = S.model.groups.find(x => x.id === el.dataset.groupId);
    return change('/api/groups/primary', { group: g.id, action: g.primary === el.dataset.primary ? null : el.dataset.primary });
  }
  if ((el = q('[data-reset-action]'))) {
    if (!(await confirmDialog('Сбросить кнопку', 'Правки будут отменены, кнопка вернётся к исходному поведению.', false, 'Сбросить'))) return;
    return change('/api/actions/reset', { id: el.dataset.resetAction }, 'Кнопка сброшена');
  }
  if ((el = q('[data-del-action]'))) {
    if (!(await confirmDialog('Удалить кнопку', `Кнопка «${S.model.actions[el.dataset.delAction]?.title}» будет удалена из всех групп.`, true, 'Удалить'))) return;
    return change('/api/actions/delete', { id: el.dataset.delAction });
  }
  if (q('[data-add-existing]')) return addExisting();

  // окружение
  if (q('[data-env-reset]')) {
    if (!(await confirmDialog('Сбросить окружение', 'Все пути, порты и имена вернутся к значениям по умолчанию (корневая папка CalPlan тоже).', true, 'Сбросить'))) return;
    const known = new Set(VAR_FIELDS.flatMap(([, fields]) => fields.map(f => f[0])));
    const vars = Object.fromEntries(Object.keys(S.model.userVars).filter(k => known.has(k)).map(k => [k, '']));
    return change('/api/vars', { vars }, 'Сброшено');
  }
  if ((el = q('[data-pick-input]'))) {
    const input = $(`#${el.dataset.pickInput}`);
    const dir = await pickFolder({ title: 'Выберите папку', start: input.value || input.placeholder });
    if (dir) input.value = dir;
    return;
  }

  // вход
  if (q('#sTest')) return testLogin();

  // оформление
  if ((el = q('[data-theme-pick]'))) { setTheme(el.dataset.themePick); return renderSettings(); }
  if ((el = q('[data-set-density]'))) { setDensity(el.dataset.setDensity); return renderSettings(); }

  // проверка и справка
  if (q('[data-run-doctor]')) return runDoctor();
  if (q('[data-reload-config]')) { await reloadConfig(); return toast('Настройки перечитаны', 'ok'); }
  if (q('[data-export]')) return exportBackup();
  if (q('[data-import]')) return $('#importFile').click();
}

async function settingsChange(e) {
  if (e.target.id === 'importFile') return importBackup(e.target.files[0]);
}

document.addEventListener('submit', async e => {
  if (e.target.id === 'loginFormEl') {
    e.preventDefault();
    try { await api('/api/settings', { auth: readLogin() }); toast('Сохранено', 'ok'); await loadLogin(); } catch (err) { toast(err.message, 'err'); }
    return;
  }
  if (e.target.id !== 'envForm') return;
  e.preventDefault();
  const vars = {};
  for (const input of e.target.querySelectorAll('[name]')) {
    const v = input.value.trim();
    if (input.dataset.vtype === 'bool') { vars[input.name] = v === String(S.model.defaultVars[input.name] ?? true) ? '' : v === 'true'; continue; }
    if (input.dataset.vtype === 'number' && v && !/^\d+$/.test(v)) return toast(`«${input.name}»: нужно целое число`, 'err');
    // значение, равное тому, что уже действует по умолчанию, не фиксируем — пусть следует за умолчанием
    vars[input.name] = v === '' || v === String(S.model.defaultVars[input.name] ?? '') ? '' : (input.dataset.vtype === 'number' ? Number(v) : v);
  }
  await change('/api/vars', { vars }, 'Окружение сохранено');
});

async function testLogin() {
  const r = $('#sResult');
  r.style.display = '';
  r.className = 'note';
  r.textContent = 'Сохраняю и проверяю…';
  try {
    await api('/api/settings', { auth: readLogin() });
    $('#sPass').value = '';
    const t = await api('/api/settings/test', {});
    r.className = 'note ok';
    r.textContent = `✓ ${t.lines.slice(-1)[0] || 'Вход выполнен'}`;
  } catch (err) { r.className = 'note err'; r.textContent = err.message; }
}

async function newGroup() {
  const res = await openDialog({
    title: 'Новая группа', okLabel: 'Создать',
    html: `<div class="field"><label for="ngTitle">Название</label><input id="ngTitle" autocomplete="off" placeholder="Например: Сервисы"></div>
      <div class="field"><label for="ngKind">Тип</label><select id="ngKind">
        <option value="generic">обычная — только git и свои кнопки</option>
        <option value="node">node / npm — показывает «npm start» как живое</option>
        <option value="compose">docker compose — показывает состояние контейнеров</option></select></div>`,
    onOpen: () => $('#ngTitle').focus(),
    getValue: () => ({ title: $('#ngTitle').value.trim(), kind: $('#ngKind').value }),
  });
  if (res?.title) await change('/api/groups/create', res, 'Группа создана');
}

async function addExisting() {
  const m = S.model;
  const g = m.groups.find(x => x.id === S.group);
  const placed = new Set(g.sections.flatMap(s => s.actions));
  const list = Object.values(m.actions).filter(a => !a.internal && !placed.has(a.id) && !g.hidden.includes(a.id));
  const res = await openDialog({
    title: `Добавить кнопку в «${g.title}»`, okLabel: 'Добавить',
    html: `<div class="field"><label for="aeAct">Кнопка</label><select id="aeAct">${list.map(a => `<option value="${esc(a.id)}">${esc(a.title)}${a.system ? '' : ' (своя)'}</option>`).join('')}</select></div>
      <div class="field"><label for="aeSec">Раздел</label><input id="aeSec" list="aeSecs" value="Мои кнопки" autocomplete="off"><datalist id="aeSecs">${g.sections.map(s => `<option value="${esc(s.title)}">`).join('')}</datalist></div>`,
    getValue: () => ({ action: $('#aeAct').value, section: $('#aeSec').value.trim() || 'Мои кнопки' }),
  });
  if (res) await change('/api/actions/place', { group: g.id, ...res });
}

async function exportBackup() {
  try {
    const data = await api('/api/backup');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `dev-panel-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (err) { toast(err.message, 'err'); }
}

async function importBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!(await confirmDialog('Загрузить настройки', 'Текущие репозитории, кнопки, переменные и тема будут заменены содержимым файла. Продолжить?', true, 'Заменить'))) return;
    await change('/api/backup', data, 'Настройки загружены');
  } catch (err) { toast(`Не удалось прочитать файл: ${err.message}`, 'err'); }
  $('#importFile').value = '';
}

/* ---------- редактор кнопки ---------- */

const STEP_KINDS = [
  ['shell', 'Команда (bash)'],
  ['service', 'Запустить фоновый процесс'],
  ['stopService', 'Остановить фоновый процесс'],
  ['detached', 'Запустить и не ждать (GUI, браузер)'],
  ['action', 'Выполнить другую кнопку'],
  ['json', 'Другое (JSON)'],
];
const SIMPLE_TYPES = ['shell', 'service', 'stopService', 'detached', 'action'];
const PARAM_KINDS = [['text', 'Текст'], ['gitBranch', 'Ветка git'], ['stash', 'Запись stash'], ['file', 'Файл из папки'], ['select', 'Выбор из списка'], ['snapshot', 'Снимок БД']];

const PRESETS = [
  { name: 'Открыть в VS Code', icon: 'code', hint: 'Открыть папку проекта в VS Code', steps: [{ type: 'detached', title: 'code', cmd: 'code "{project.path}"' }] },
  { name: 'Терминал в папке', icon: 'terminal', hint: 'Открыть терминал в папке проекта (gnome-terminal; поменяйте команду под вашу систему)', steps: [{ type: 'detached', title: 'terminal', cmd: 'gnome-terminal --working-directory="{project.path}"' }] },
  { name: 'История коммитов', icon: 'scroll-text', hint: 'Последние 30 коммитов', steps: [{ type: 'shell', title: 'git log', cmd: 'git log --oneline --decorate -n 30' }] },
  { name: 'Статус git', icon: 'git-branch', hint: 'git status', steps: [{ type: 'shell', title: 'git status', cmd: 'git status -sb' }] },
  { name: 'npm test', icon: 'flask-conical', hint: 'Запустить тесты', steps: [{ type: 'shell', title: 'npm test', cmd: 'npm test' }] },
  { name: 'Логи compose', icon: 'scroll-text', hint: 'Последние 200 строк логов контейнеров', steps: [{ type: 'shell', title: 'docker compose logs', cmd: '{dc} logs --tail 200' }] },
  { name: 'Список контейнеров', icon: 'container', hint: 'docker ps', steps: [{ type: 'shell', title: 'docker ps', cmd: 'docker ps' }] },
];

let E = null; // состояние редактора

async function editAction({ id, group }) {
  const m = S.model;
  const src = id ? m.actions[id] : null;
  const clone = x => JSON.parse(JSON.stringify(x));
  const draft = src
    ? (({ id: _i, system: _s, modified: _m, internal: _n, ...rest }) => clone(rest))(src)
    : { title: '', icon: 'terminal', hint: '', steps: [{ type: 'shell', cmd: '' }] };
  E = { id, draft, group, json: false, jsonText: '', error: '', iconsOpen: false,
    place: Object.fromEntries(m.groups.map(g => [g.id, g.id === group])), section: 'Мои кнопки' };
  const dlg = $('#editor');
  dlg.onclick = editorClick;
  dlg.oninput = editorInput;
  dlg.onchange = editorInput;
  dlg.onclose = () => { E = null; };
  renderEditor();
  if (!dlg.open) dlg.showModal();
  $('#edTitle')?.focus();
}

function paramRow(p, i) {
  return `<div class="step-card"><div class="head"><span class="num">${i + 1}</span>
    <input data-p="${i}" data-k="name" value="${esc(p.name)}" placeholder="имя (латиницей)" aria-label="Имя параметра" class="mono" style="max-width:150px">
    <input data-p="${i}" data-k="title" value="${esc(p.title || '')}" placeholder="как спросить" aria-label="Заголовок параметра">
    <select data-p="${i}" data-k="type" aria-label="Тип параметра" style="max-width:170px">${PARAM_KINDS.map(([v, l]) => `<option value="${v}" ${p.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <button type="button" class="ghost sm danger-ghost" data-p-del="${i}" aria-label="Удалить параметр">${icon('x')}</button></div>
    ${p.type === 'select' ? `<div class="field" style="margin:0 0 6px"><input data-p="${i}" data-k="options" value="${esc((p.options || []).join(', '))}" placeholder="варианты через запятую" aria-label="Варианты"></div>` : ''}
    ${p.type === 'file' ? `<div class="row-fields"><div class="field" style="margin:0 0 6px"><input data-p="${i}" data-k="dir" value="${esc(p.dir || '')}" placeholder="папка, например {dumpsDir}" aria-label="Папка" class="mono"></div>
      <div class="field" style="margin:0 0 6px"><input data-p="${i}" data-k="ext" value="${esc(p.ext || '')}" placeholder="расширение, например .sql" aria-label="Расширение"></div></div>` : ''}
    <label class="check" style="margin:0"><input type="checkbox" data-p="${i}" data-k="optional" ${p.optional ? 'checked' : ''}><span>Необязательный (можно оставить пустым)</span></label></div>`;
}

function stepRow(s, i, n) {
  const kind = SIMPLE_TYPES.includes(s.type) ? s.type : 'json';
  const f = (k, label, ph = '', mono = true) => `<div class="field" style="margin:0 0 6px"><label>${label}</label><input data-s="${i}" data-k="${k}" value="${esc(s[k] || '')}" placeholder="${esc(ph)}" ${mono ? 'class="mono"' : ''} spellcheck="false"></div>`;
  let body = '';
  if (kind === 'shell' || kind === 'detached') {
    body = `<div class="field" style="margin:0 0 6px"><label>Команда</label><textarea data-s="${i}" data-k="cmd" rows="2" spellcheck="false" placeholder="например: git log --oneline -n 20">${esc(s.cmd || '')}</textarea></div>`;
    if (kind === 'shell') body += `<label class="check" style="margin:0"><input type="checkbox" data-s="${i}" data-k="allowFail" ${s.allowFail ? 'checked' : ''}><span>Не останавливать кнопку, если команда завершилась с ошибкой</span></label>`;
  } else if (kind === 'service') {
    body = f('service', 'Имя процесса', 'например: frontend') + `<div class="field" style="margin:0 0 6px"><label>Команда</label><textarea data-s="${i}" data-k="cmd" rows="2" spellcheck="false">${esc(s.cmd || '')}</textarea></div>`
      + f('readyPattern', 'Считать готовым, когда в логе появится (regexp)', 'например: Local:\\s+http') + f('failPattern', 'Считать ошибкой, когда появится (regexp)', 'необязательно');
  } else if (kind === 'stopService') {
    body = f('service', 'Имя процесса', 'например: frontend');
  } else if (kind === 'action') {
    body = `<div class="field" style="margin:0"><label>Кнопка</label><select data-s="${i}" data-k="action">${Object.values(S.model.actions).filter(a => a.id !== E.id).map(a => `<option value="${esc(a.id)}" ${s.action === a.id ? 'selected' : ''}>${esc(a.title)}</option>`).join('')}</select></div>`;
  } else {
    body = `<div class="field" style="margin:0"><label>Шаг в формате JSON</label><textarea data-s="${i}" data-k="__json" rows="6" spellcheck="false">${esc(JSON.stringify(s, null, 2))}</textarea></div>`;
  }
  return `<div class="step-card"><div class="head"><span class="num">${i + 1}</span>
    <select data-s="${i}" data-k="__type" aria-label="Тип шага">${STEP_KINDS.map(([v, l]) => `<option value="${v}" ${kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <button type="button" class="ghost sm" data-s-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Выше">${icon('arrow-up')}</button>
    <button type="button" class="ghost sm" data-s-down="${i}" ${i === n - 1 ? 'disabled' : ''} aria-label="Ниже">${icon('arrow-down')}</button>
    <button type="button" class="ghost sm danger-ghost" data-s-del="${i}" aria-label="Удалить шаг">${icon('x')}</button></div>${body}</div>`;
}

function renderEditor() {
  const m = S.model;
  const d = E.draft;
  const isNew = !E.id;
  const src = E.id ? m.actions[E.id] : null;
  const vars = Object.keys(m.vars).filter(k => !['home'].includes(k));
  let body;
  if (E.json) {
    body = `<div class="field"><label for="edJson">Кнопка в формате JSON</label><textarea id="edJson" rows="22" spellcheck="false">${esc(E.jsonText)}</textarea>
      <span class="help">Для опытных: любые типы шагов, <span class="mono">if</span>/<span class="mono">unless</span>, <span class="mono">retry</span>, <span class="mono">env</span>. Описание — в docs/GUIDE.md.</span></div>`;
  } else {
    body = `
      ${isNew ? `<div class="sec-title" style="margin-top:0">Начать с шаблона</div><div class="preset-row">${PRESETS.map((p, i) => `<button type="button" class="sm" data-preset="${i}">${icon(p.icon)} ${esc(p.name)}</button>`).join('')}</div>` : ''}
      <div class="row-fields">
        <div class="field"><label for="edTitle">Название кнопки</label><input id="edTitle" data-f="title" value="${esc(d.title)}" autocomplete="off"></div>
        <div class="field"><label>Иконка</label>
          <button type="button" data-icons-toggle aria-expanded="${E.iconsOpen}" style="justify-content:flex-start">${icon(d.icon || 'terminal')} ${esc(d.icon || 'terminal')}</button></div>
      </div>
      ${E.iconsOpen ? `<div class="icon-grid" style="margin-bottom:12px" role="group" aria-label="Иконки">${Object.keys(ICONS).map(n => `<button type="button" data-icon-pick="${n}" aria-pressed="${d.icon === n}" title="${n}" aria-label="${n}">${icon(n)}</button>`).join('')}</div>` : ''}
      <div class="field"><label for="edHint">Подсказка (появляется при наведении)</label><input id="edHint" data-f="hint" value="${esc(d.hint || '')}" autocomplete="off"></div>
      <label class="check"><input type="checkbox" data-f="danger" ${d.danger ? 'checked' : ''}><span>Опасная — красная кнопка, перед запуском спросит подтверждение<br><span class="help">Отметьте, если кнопка удаляет данные</span></span></label>
      ${d.danger || d.confirm ? `<div class="field"><label for="edConfirm">Текст подтверждения</label><input id="edConfirm" data-f="confirm" value="${esc(d.confirm || '')}" placeholder="Например: Удалить {project.name}?" autocomplete="off"></div>` : ''}

      <div class="sec-title">Параметры — что спросить перед запуском</div>
      ${(d.params || []).map(paramRow).join('')}
      <button type="button" class="sm" data-p-add>${icon('plus')} Параметр</button>
      <span class="help"> В командах параметр доступен как <span class="mono">"$P_имя"</span> (так он безопасно передаётся в bash), в заголовках — как <span class="mono">{имя}</span>.</span>

      <div class="sec-title">Шаги — выполняются по порядку, при ошибке цепочка останавливается</div>
      ${d.steps.map((s, i) => stepRow(s, i, d.steps.length)).join('')}
      <button type="button" class="sm" data-s-add>${icon('plus')} Шаг</button>

      <details style="margin-top:14px"><summary class="help" style="cursor:pointer">Какие переменные можно использовать в командах</summary>
        <div class="note" style="margin-top:6px;line-height:1.9"><span class="mono">{project.path}</span> <span class="mono">{project.name}</span> ${vars.map(v => `<span class="mono">{${esc(v)}}</span>`).join(' ')}</div></details>

      ${isNew ? `<div class="sec-title">Где показывать</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px">${m.groups.map(g => `<label class="check" style="margin:0"><input type="checkbox" data-place="${esc(g.id)}" ${E.place[g.id] ? 'checked' : ''}><span>${esc(g.title)}</span></label>`).join('')}</div>
        <div class="field"><label for="edSection">Раздел на карточке</label><input id="edSection" data-section value="${esc(E.section)}" list="edSecs" autocomplete="off"><datalist id="edSecs">${[...new Set(m.groups.flatMap(g => g.sections.map(s => s.title)))].map(s => `<option value="${esc(s)}">`).join('')}</datalist></div>` : ''}`;
  }
  $('#editor').innerHTML = `<h3>${isNew ? 'Новая кнопка' : `Кнопка «${esc(src.title)}»`}${src?.system ? ' <span class="tag sys">системная</span>' : ''}</h3>
    <div class="editor-body">${body}</div>
    ${E.error ? `<div class="note err" role="alert" style="margin-top:10px">${esc(E.error)}</div>` : ''}
    <div class="modal-actions">
      <button type="button" class="ghost" data-json-toggle>${icon('code')} ${E.json ? 'Форма' : 'JSON'}</button>
      <span class="spacer"></span>
      <button type="button" class="ghost" data-ed-cancel>Отмена</button>
      <button type="button" class="primary" data-ed-save>Сохранить</button>
    </div>`;
}

function syncJsonToDraft() {
  if (!E.json) return true;
  try { E.draft = JSON.parse($('#edJson').value); E.error = ''; return true; } catch (err) { E.error = `JSON: ${err.message}`; renderEditor(); return false; }
}

function editorInput(e) {
  const t = e.target;
  if (!E || E.json) return;
  const d = E.draft;
  if (t.dataset.f) {
    d[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value;
    if (t.dataset.f === 'danger') renderEditor();
  } else if (t.dataset.p !== undefined) {
    const p = d.params[+t.dataset.p];
    const k = t.dataset.k;
    if (k === 'optional') p.optional = t.checked;
    else if (k === 'options') p.options = t.value.split(',').map(x => x.trim()).filter(Boolean);
    else p[k] = t.value;
    if (k === 'type' && e.type === 'change') renderEditor();
  } else if (t.dataset.s !== undefined) {
    const i = +t.dataset.s;
    const s = d.steps[i];
    const k = t.dataset.k;
    if (k === '__type') {
      if (e.type !== 'change') return;
      d.steps[i] = t.value === 'json' ? { ...s } : { type: t.value, ...(t.value === 'action' ? { action: Object.values(S.model.actions).find(a => a.id !== E.id)?.id } : {}) };
      renderEditor();
    } else if (k === '__json') {
      try { d.steps[i] = JSON.parse(t.value); E.error = ''; } catch { /* ждём корректный JSON */ }
    } else if (t.type === 'checkbox') {
      s[k] = t.checked;
    } else if (t.value === '' && !['cmd'].includes(k)) {
      delete s[k];
    } else {
      s[k] = t.value;
    }
  } else if (t.dataset.place !== undefined) {
    E.place[t.dataset.place] = t.checked;
  } else if (t.dataset.section !== undefined) {
    E.section = t.value;
  }
}

async function editorClick(e) {
  const t = e.target;
  const q = sel => t.closest(sel);
  let el;
  if (!E) return;
  if (q('[data-ed-cancel]')) return $('#editor').close();
  if (q('[data-json-toggle]')) {
    if (E.json) { if (!syncJsonToDraft()) return; E.json = false; } else { E.jsonText = JSON.stringify(E.draft, null, 2); E.json = true; }
    return renderEditor();
  }
  if (E.json) { if (q('[data-ed-save]')) return saveEditor(); return; }
  const d = E.draft;
  if ((el = q('[data-preset]'))) {
    const p = PRESETS[+el.dataset.preset];
    E.draft = { title: p.name, icon: p.icon, hint: p.hint, steps: JSON.parse(JSON.stringify(p.steps)) };
    return renderEditor();
  }
  if (q('[data-icons-toggle]')) { E.iconsOpen = !E.iconsOpen; return renderEditor(); }
  if ((el = q('[data-icon-pick]'))) { d.icon = el.dataset.iconPick; E.iconsOpen = false; return renderEditor(); }
  if (q('[data-p-add]')) { (d.params ||= []).push({ name: '', title: '', type: 'text' }); return renderEditor(); }
  if ((el = q('[data-p-del]'))) { d.params.splice(+el.dataset.pDel, 1); if (!d.params.length) delete d.params; return renderEditor(); }
  if (q('[data-s-add]')) { d.steps.push({ type: 'shell', cmd: '' }); return renderEditor(); }
  if ((el = q('[data-s-del]'))) { d.steps.splice(+el.dataset.sDel, 1); return renderEditor(); }
  if ((el = q('[data-s-up]'))) { const i = +el.dataset.sUp; [d.steps[i - 1], d.steps[i]] = [d.steps[i], d.steps[i - 1]]; return renderEditor(); }
  if ((el = q('[data-s-down]'))) { const i = +el.dataset.sDown; [d.steps[i + 1], d.steps[i]] = [d.steps[i], d.steps[i + 1]]; return renderEditor(); }
  if (q('[data-ed-save]')) return saveEditor();
}

async function saveEditor() {
  if (!syncJsonToDraft()) return;
  const body = { id: E.id, action: E.draft };
  if (!E.id) {
    body.placement = S.model.groups.filter(g => E.place[g.id]).map(g => ({ group: g.id, section: E.section.trim() || 'Мои кнопки' }));
  }
  try {
    await api('/api/actions/save', body);
  } catch (err) { E.error = err.message; return renderEditor(); }
  $('#editor').close();
  toast('Кнопка сохранена', 'ok');
  await reloadConfig();
}

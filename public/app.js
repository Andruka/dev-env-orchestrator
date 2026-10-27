const state = {
  config: null,
  status: null,
  jobs: [],
  services: [],
  sel: store.get('sel', null),
  tab: 'jobs',
  jobId: null,
  logs: { job: {}, svc: {} },
  openChanges: new Set(),
  auth: null,
};

/* ---------- модель ---------- */

const allProjects = () => state.config.groups.flatMap(g => g.projects.map(p => ({ ...p, groupObj: g })));
const findProject = id => allProjects().find(p => p.id === id);
const projectStatus = id => state.status?.groups.flatMap(g => g.projects).find(p => p.id === id) || {};
const runningJob = groupId => state.jobs.find(j => j.group === groupId && j.status === 'running');
const isUp = st => st.compose && /running/.test(st.compose.status);
const frontService = () => state.services.find(s => s.name === 'frontend' && s.status === 'running');
const frontPort = () => state.config.vars.frontendPort || 3000;

function isAlive(p) {
  if (p.groupObj.kind === 'compose') return isUp(projectStatus(p.id));
  if (p.groupObj.kind === 'node') return state.services.some(s => s.project === p.name && s.status === 'running');
  return false;
}

/* ---------- верхняя полоса: что запущено ---------- */

function renderEnv() {
  if (!state.status || !state.config) return;
  const items = [];
  const hasCompose = state.config.groups.some(g => g.kind === 'compose' && g.projects.length);
  const hasNode = state.config.groups.some(g => g.kind === 'node' && g.projects.length);
  const upProject = allProjects().find(p => p.groupObj.kind === 'compose' && isUp(projectStatus(p.id)));
  if (upProject) {
    const st = projectStatus(upProject.id);
    items.push(`<div class="env-item"><span class="dot alive"></span><span class="k">Бэкенд</span>
      <span class="v">${esc(upProject.name)}</span><span class="v mono">${esc(st.git?.branch || '')}</span>
      <button class="ghost" data-action="down" data-project="${esc(upProject.id)}" title="Остановить контейнеры (ddown)">${icon('square')} Стоп</button></div>`);
  } else if (hasCompose) {
    items.push(`<div class="env-item off"><span class="dot"></span><span class="k">Бэкенд</span><span class="v">не запущен</span></div>`);
  }
  const fs = frontService();
  if (fs) {
    items.push(`<div class="env-item"><span class="dot alive"></span><span class="k">Фронт</span><span class="v mono">:${frontPort()}</span>
      <button class="ghost" data-stop-svc="frontend" title="Остановить npm start">${icon('square')} Стоп</button></div>`);
  } else if (state.status.ports.frontend) {
    items.push(`<div class="env-item off" title="Порт ${frontPort()} занят процессом, запущенным не из панели"><span class="dot warn"></span><span class="k">Фронт</span><span class="v">:${frontPort()} вне панели</span></div>`);
  } else if (hasNode) {
    items.push(`<div class="env-item off"><span class="dot"></span><span class="k">Фронт</span><span class="v">не запущен</span></div>`);
  }
  if (hasCompose) {
    items.push(`<div class="env-item off"><span class="dot ${state.status.ports.db ? 'alive' : ''}"></span><span class="k">PostgreSQL</span><span class="v mono">:${state.config.vars.dbPort || 5432}</span></div>`);
  }
  if (hasNode) items.push(authChip());
  const job = state.jobs.find(j => j.status === 'running');
  if (job) {
    const st = job.steps.find(s => s.status === 'running');
    items.push(`<div class="env-item off click" data-job="${job.id}" role="button" tabindex="0"><span class="dot busy"></span>
      <span class="v">${esc(job.title)}</span><span class="k">${esc(job.project)}${st?.progress != null ? ` · ${st.progress}%` : ''}</span></div>`);
  }
  setHtml($('#env'), items.join(''));

  const pst = job?.steps.find(s => s.status === 'running');
  document.title = job ? `◌ ${pst?.progress != null ? pst.progress + '% · ' : ''}${job.title} — Dev Panel` : 'Dev Panel';
}

const authText = () => ({
  'no-browser': ['', 'браузер не открыт', 'Браузер с портом отладки не запущен — откройте его кнопкой «Браузер»'],
  'no-page': ['', `нет вкладки :${frontPort()}`, 'Не найдена вкладка фронтенда в браузере'],
  'front-down': ['warn', 'фронт не запущен', 'Вкладка открыта, но фронтенд не отвечает — запустите npm start'],
  'no-credentials': ['warn', 'не настроен', 'Задайте логин и пароль в настройках'],
  off: ['', 'выключено', 'Автоподдержание входа выключено в настройках'],
  idle: ['', '…', ''],
});

function authChip() {
  const a = state.auth;
  if (!a) return '';
  let dot, text, title;
  if (a.status === 'ok') {
    const left = a.expiresAt ? Math.round((a.expiresAt * 1000 - Date.now()) / 60000) : null;
    dot = 'alive';
    text = left != null ? `продлится через ${Math.max(left - 15, 0)} мин` : 'ок';
    title = `Токен до ${a.expiresAt ? new Date(a.expiresAt * 1000).toLocaleTimeString('ru-RU') : '?'}. Панель продлевает его за 15 минут до истечения.`
      + (a.lastAction ? `\nПоследнее действие: ${a.lastAction} в ${new Date(a.actionAt).toLocaleTimeString('ru-RU')}` : '')
      + '\nКлик — проверить сейчас';
  } else if (a.status === 'error') {
    [dot, text, title] = ['err', 'ошибка', a.lastError || ''];
  } else {
    [dot, text, title] = authText()[a.status] || ['', a.status, ''];
  }
  const action = a.status === 'no-credentials' ? 'data-open-settings="login"' : 'data-auth-check';
  return `<div class="env-item off click" role="button" tabindex="0" title="${esc(title)}" ${action}><span class="dot ${dot}"></span><span class="k">Вход</span><span class="v">${esc(text)}</span></div>`;
}

/* ---------- проекты ---------- */

function actionButton(actionId, project, { primary = false } = {}) {
  const a = state.config.actions[actionId];
  if (!a) return '';
  const busy = runningJob(project.group);
  const cls = [primary && 'primary', a.danger && 'danger'].filter(Boolean).join(' ');
  const title = busy ? `Занято: выполняется «${busy.title}» (${busy.project})` : a.hint || '';
  return `<button class="${cls}" ${busy ? 'disabled' : ''} data-project="${esc(project.id)}" data-action="${esc(actionId)}" title="${esc(title)}">
    <span class="btn-ic">${icon(a.icon)}</span>${esc(a.title)}</button>`;
}

function welcomeHtml() {
  return `<div class="welcome">
    <h2>Добро пожаловать в Dev Panel</h2>
    <p>Панель собирает рутину разработки в одном окне: ветки, docker compose, дампы и снимки БД, фронтенд и вход в него. Чтобы начать, сделайте три вещи.</p>
    <ol>
      <li><b>Укажите папку с репозиториями CalPlan</b> — остальные пути вычислятся сами.</li>
      <li><b>Проверьте окружение</b> — панель покажет, чего не хватает (docker, zstd, браузер).</li>
      <li><b>Введите логин</b> для входа во фронтенд (по желанию).</li>
    </ol>
    <div class="row">
      <button class="primary" data-open-settings="repos">${icon('folder-open')} Выбрать папку и репозитории</button>
      <button data-open-settings="doctor">${icon('stethoscope')} Проверить окружение</button>
      <button class="ghost" data-open-settings="help">${icon('book-open')} Как это работает</button>
    </div>
  </div>`;
}

function renderRepos() {
  if (!state.config) return;
  const noProjects = !allProjects().length;
  const html = (noProjects ? welcomeHtml() : '') + state.config.groups.map(g => `
    <div class="group">
      <h2 class="group-title">${esc(g.title)} <span class="count">${g.projects.length}</span></h2>
      ${g.projects.length ? g.projects.map(p0 => {
    const p = { ...p0, groupObj: g };
    const st = projectStatus(p.id);
    const git = st.git || {};
    const alive = isAlive(p);
    const sel = state.sel === p.id;
    const job = runningJob(g.id);
    const mine = job && job.project === p.name;
    const detached = git.branch === '(detached)';
    const badges = [
      p.missing ? '<span class="badge err" title="Папка не найдена">нет папки</span>' : '',
      git.error && !p.missing ? '<span class="badge err" title="Не git-репозиторий или нет доступа">не git</span>' : '',
      git.dirty ? `<span class="badge warn" title="Незакоммиченных файлов: ${git.dirty}">${icon('pencil')}${git.dirty}</span>` : '',
      git.behind ? `<span class="badge warn" title="Отстаёт от ${esc(git.upstream)} на ${git.behind}">${icon('arrow-down')}${git.behind}</span>` : '',
      git.ahead ? `<span class="badge" title="Впереди ${esc(git.upstream)} на ${git.ahead}">${icon('arrow-up')}${git.ahead}</span>` : '',
      git.stashes ? `<span class="badge" title="Записей в stash: ${git.stashes}">${icon('archive')}${git.stashes}</span>` : '',
      mine ? `<span class="badge busy"><span class="spin">${icon('loader')}</span> ${esc(job.title)}</span>` : '',
      alive && !mine ? `<span class="badge alive">${g.kind === 'compose' ? 'запущен' : 'npm start'}</span>` : '',
    ].join('');
    return `
        <article class="repo ${sel ? 'sel' : ''} ${alive ? 'alive' : ''} ${p.missing ? 'missing' : ''}" data-repo="${esc(p.id)}" data-key="${esc(p.id)}">
          <div class="repo-row" role="button" tabindex="0" aria-expanded="${sel}" aria-label="${esc(p.name)}">
            <span class="dot ${mine ? 'busy' : alive ? 'alive' : ''}"></span>
            <span class="repo-name">${esc(p.name)}</span>
            <span class="repo-branch ${detached ? 'detached' : ''}" title="${esc(git.branch)}">${git.branch ? icon('git-branch') : ''}${esc(git.branch || '—')}</span>
            <span class="badges">${badges}</span>
            <span class="primary-slot">${g.primary ? actionButton(g.primary, p, { primary: sel }) : ''}</span>
          </div>
          ${sel ? renderDetail(p, st) : ''}
        </article>`;
  }).join('') : `<div class="group-empty"><span>В группе пока нет репозиториев</span>
        <button data-open-settings="repos">${icon('plus')} Добавить</button></div>`}
    </div>`).join('');
  setHtml($('#repos'), html);
}

function renderDetail(p, st) {
  const git = st.git || {};
  const meta = [
    `<span class="mono">${esc(p.path)}</span>`,
    git.upstream ? `<span>↔ <span class="mono">${esc(git.upstream)}</span></span>` : '<span>нет upstream</span>',
  ];
  const changes = git.dirty ? `
    <details class="changes" data-changes="${esc(p.id)}" ${state.openChanges.has(p.id) ? 'open' : ''}>
      <summary>Изменённых файлов: ${git.dirty}</summary>
      <pre>${esc(git.changes.join('\n'))}${git.dirty > git.changes.length ? '\n…' : ''}</pre>
    </details>` : '';
  const ctrs = st.containers?.length ? `<div class="ctrs">${st.containers.map(c =>
    `<span class="ctr" title="${esc(c.status)}"><span class="dot ${c.state === 'running' ? 'alive' : c.state === 'exited' ? '' : 'warn'}"></span>${esc(c.name.replace(st.compose.name + '-', '').replace(/-1$/, ''))}</span>`).join('')}</div>` : '';
  const sections = p.groupObj.sections.map(s => `
    <div class="section">
      <div class="section-label">${esc(s.title)}</div>
      <div class="section-actions">${s.actions.filter(a => a !== p.groupObj.primary).map(a => actionButton(a, p)).join('')}</div>
    </div>`).join('');
  const snaps = p.groupObj.kind === 'compose' && state.config.actions.snapSave ? renderSnapshots(p) : '';
  return `<div class="repo-detail"><div class="meta-line">${meta.join('')}</div>${changes}${ctrs}${sections}${snaps}</div>`;
}

const SNAP_KIND = {
  fresh: ['авто', 'Создан автоматически после миграций. Используется «Развернуть с нуля» для веток с теми же миграциями'],
  dump: ['дамп', 'Создан автоматически после импорта дампа. Используется «Накатить дамп» для этого же файла'],
  manual: ['ручной', 'Сохранён кнопкой «Сохранить текущую БД»'],
};

function renderSnapshots(p) {
  const list = state.status?.snapshots || [];
  const busy = runningJob(p.group);
  const total = list.reduce((n, s) => n + (s.size || 0), 0);
  const rows = list.map(sn => {
    const [kind, kindHint] = SNAP_KIND[sn.kind] || [sn.kind, ''];
    const date = new Date(sn.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<div class="snap" title="${esc(sn.id)}" data-key="${esc(sn.id)}">
      <span class="badge ${sn.kind === 'manual' ? 'alive' : ''}" title="${esc(kindHint)}">${esc(kind)}</span>
      <span class="snap-label">${esc(sn.kind === 'fresh' ? sn.branch : sn.label)}</span>
      <span class="snap-meta">${esc(sn.kind === 'fresh' ? `${sn.migrations} файлов миграций · ` : sn.kind === 'manual' ? `${sn.project} · ` : '')}${fmtSize(sn.size)} · ${date}</span>
      <span class="snap-actions">
        <button class="ghost" ${busy ? 'disabled' : ''} data-snap-restore="${esc(sn.id)}" data-project="${esc(p.id)}" title="Заменить текущую базу этим снимком">${icon('history')} Восстановить</button>
        <button class="ghost danger-ghost" ${busy ? 'disabled' : ''} data-snap-delete="${esc(sn.id)}" data-project="${esc(p.id)}" title="Удалить этот снимок" aria-label="Удалить снимок">${icon('x')}</button>
      </span>
    </div>`;
  }).join('');
  return `<div class="section"><div class="section-label">Снимки</div>
    <div class="snaps">${rows || '<div class="snap-empty">Снимков пока нет. Они появятся после «Развернуть с нуля», «Накатить дамп» или «Сохранить текущую БД».</div>'}
    ${list.length ? `<div class="snap-total">${list.length} шт. · занято ${fmtSize(total)}</div>` : ''}</div></div>`;
}

function select(id, { scroll = false } = {}) {
  state.sel = state.sel === id && !scroll ? null : id;
  store.set('sel', state.sel);
  renderRepos();
  if (scroll && state.sel) document.querySelector(`[data-repo="${CSS.escape(state.sel)}"]`)?.scrollIntoView({ block: 'nearest' });
}

/* ---------- запуск действий ---------- */

async function runAction(projectId, actionId, preset = {}) {
  const action = state.config.actions[actionId];
  const project = findProject(projectId);
  if (!action || !project) return;
  const params = { ...preset };
  for (const p of action.params.filter(p => !(p.name in params))) {
    const v = await askParam(project, actionId, action, p);
    if (v == null) return;
    params[p.name] = v;
  }
  if (action.confirm || action.danger) {
    const shown = { ...params };
    const snap = params.snapshot && (state.status?.snapshots || []).find(x => x.id === params.snapshot);
    if (snap) shown.snapshot = snap.label || snap.id;
    const msg = tpl(action.confirm || `${action.title}: ${action.hint || ''}`, { ...state.config.vars, ...shown, project });
    if (!(await confirmDialog(`${action.title} · ${project.name}`, msg, action.danger))) return;
  }
  try {
    const job = await api('/api/run', { project: projectId, action: actionId, params });
    upsertJob(job);
    state.tab = 'jobs';
    state.jobId = job.id;
    renderAll();
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- палитра команд ---------- */

let palItems = [];
let palIdx = 0;

function paletteItems() {
  const sel = state.sel;
  const items = [];
  for (const p of allProjects()) {
    const ids = [...new Set([p.groupObj.primary, ...p.groupObj.sections.flatMap(s => s.actions)].filter(Boolean))];
    for (const a of ids) {
      const act = state.config.actions[a];
      if (act) items.push({ kind: 'action', project: p, actionId: a, act, text: `${act.title} ${p.name} ${act.hint || ''}`.toLowerCase(), boost: p.id === sel ? 1 : 0 });
    }
  }
  const nav = [
    ['repos', 'folder-open', 'Репозитории', 'настройки репозитории добавить удалить папка проводник'],
    ['buttons', 'layers', 'Кнопки и команды', 'настройки кнопки команды добавить скрыть изменить сбросить'],
    ['env', 'sliders-horizontal', 'Окружение и пути', 'настройки пути переменные порты браузер дампы'],
    ['login', 'key-round', 'Вход во фронтенд', 'настройки вход логин пароль'],
    ['look', 'palette', 'Оформление', 'настройки тема цвет оформление плотность'],
    ['doctor', 'stethoscope', 'Проверка окружения', 'диагностика проверка docker zstd окружение'],
    ['help', 'book-open', 'Справка и горячие клавиши', 'справка помощь клавиши инструкция'],
  ];
  for (const [tab, ic, title, text] of nav) items.push({ kind: 'settings', tab, ic, title: `Настройки: ${title}`, text: `${title} ${text}`.toLowerCase(), boost: -1 });
  for (const t of THEMES) items.push({ kind: 'theme', theme: t.id, title: `Тема: ${t.label}`, text: `тема оформление ${t.label} ${t.mode}`.toLowerCase(), boost: -2 });
  items.push({ kind: 'theme', theme: 'auto', title: 'Тема: как в системе', text: 'тема оформление система авто', boost: -2 });
  return items.sort((x, y) => y.boost - x.boost);
}

function openPalette() {
  const dlg = $('#palette');
  const items = paletteItems();
  const input = $('#paletteInput');
  input.value = '';
  const draw = () => {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    palItems = items.filter(i => words.every(w => i.text.includes(w))).slice(0, 60);
    palIdx = Math.min(palIdx, Math.max(palItems.length - 1, 0));
    $('#paletteList').innerHTML = palItems.map((i, n) => {
      const cls = `pal-item ${n === palIdx ? 'sel' : ''}`;
      if (i.kind === 'action') {
        return `<div class="${cls} ${i.act.danger ? 'danger' : ''}" role="option" aria-selected="${n === palIdx}" data-n="${n}">${icon(i.act.icon)}<span class="t">${esc(i.act.title)}</span><span class="proj">${esc(i.project.name)}</span></div>`;
      }
      return `<div class="${cls}" role="option" aria-selected="${n === palIdx}" data-n="${n}">${icon(i.kind === 'theme' ? 'palette' : i.ic)}<span class="t">${esc(i.title)}</span></div>`;
    }).join('') || '<div class="pal-item muted">Ничего не найдено</div>';
    $('#paletteList .sel')?.scrollIntoView({ block: 'nearest' });
  };
  input.oninput = () => { palIdx = 0; draw(); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); palIdx = Math.min(palIdx + 1, palItems.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palIdx = Math.max(palIdx - 1, 0); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); runPalette(palItems[palIdx]); }
  };
  $('#paletteList').onclick = e => { const el = e.target.closest('[data-n]'); if (el) runPalette(palItems[+el.dataset.n]); };
  dlg.onclick = e => { if (e.target === dlg) dlg.close(); };
  palIdx = 0;
  draw();
  dlg.showModal();
  input.focus();
}

function runPalette(item) {
  if (!item) return;
  $('#palette').close();
  if (item.kind === 'settings') return openSettings(item.tab);
  if (item.kind === 'theme') return setTheme(item.theme);
  state.sel = item.project.id;
  store.set('sel', state.sel);
  renderRepos();
  runAction(item.project.id, item.actionId);
}

/* ---------- консоль ---------- */

function upsertJob(job) {
  const i = state.jobs.findIndex(j => j.id === job.id);
  if (i >= 0 && (state.jobs[i].rev || 0) > (job.rev || 0)) return;
  if (i >= 0) state.jobs[i] = { ...state.jobs[i], ...job };
  else state.jobs.unshift(job);
}

const STEP_IC = {
  pending: '', running: `<span class="spin">${icon('loader')}</span>`, done: icon('check'), failed: icon('x'), skipped: '–', cancelled: icon('x'),
};
const JOB_IC = { running: '<span class="dot busy"></span>', done: '<span class="dot alive"></span>', failed: '<span class="dot err"></span>', cancelled: '<span class="dot"></span>' };

function renderTabs() {
  const svcTabs = state.services.map(s => `
    <button class="tab" role="tab" aria-selected="${state.tab === 'svc:' + s.name}" data-tab="svc:${esc(s.name)}">
      <span class="dot ${s.status === 'running' ? 'alive' : s.exitCode ? 'err' : ''}"></span>${esc(s.name)}<span class="sub">${esc(s.project || '')}</span></button>`).join('');
  const running = state.jobs.filter(j => j.status === 'running').length;
  setHtml($('#tabs'), `<button class="tab" role="tab" aria-selected="${state.tab === 'jobs'}" data-tab="jobs">Задачи${running ? ` <span class="dot busy"></span>` : ''}</button>${svcTabs}`);
}

function renderJobView() {
  const el = $('#jobView');
  if (state.tab.startsWith('svc:')) {
    const s = state.services.find(x => 'svc:' + x.name === state.tab);
    setHtml(el, s ? `
      <div class="job-head" style="margin:0">
        <span class="dot ${s.status === 'running' ? 'alive' : ''}"></span>
        <span class="title">${esc(s.name)}</span>
        <span class="sub">${esc(s.project || '')} · запущен в ${fmtTime(s.startedAt)} · ${esc(s.status)}${s.exitCode != null ? ` (код ${s.exitCode})` : ''}</span>
        <span class="spacer"></span>
        ${s.status === 'running' ? `<button class="danger" data-stop-svc="${esc(s.name)}">${icon('square')} Остановить</button>` : ''}
      </div>` : '');
    return;
  }
  const job = state.jobs.find(j => j.id === state.jobId) || state.jobs[0];
  if (!job) {
    setHtml(el, `<div class="empty">Здесь появится ход выполнения и лог.<br>
      Выберите проект слева (<kbd>↑</kbd><kbd>↓</kbd>), <kbd>Enter</kbd> запускает главное действие,
      <kbd>Ctrl</kbd>+<kbd>K</kbd> открывает все команды, <kbd>?</kbd> — справка.</div>`);
    return;
  }
  state.jobId = job.id;
  const params = job.params && Object.values(job.params).filter(Boolean).join(', ');
  const others = state.jobs.filter(j => j.id !== job.id).slice(0, 6);
  setHtml(el, `
    <div class="job-head">
      ${JOB_IC[job.status] || ''}
      <span class="title">${esc(job.title)}</span>
      <span class="sub">${esc(job.project)}${params ? ' · ' + esc(params) : ''} · ${fmtDur(job)}</span>
      <span class="spacer"></span>
      ${job.status === 'running' ? `<button class="danger" data-cancel="${job.id}">Отменить</button>` : ''}
    </div>
    <ol class="steps">
      ${job.steps.map(s => `<li class="step ${s.status}"><span class="ic-wrap">${STEP_IC[s.status]}</span><span>${esc(s.title)}</span>
        ${s.progress != null && s.status === 'running' ? `<span class="progress"><span class="bar"><i style="width:${s.progress}%"></i></span>${s.progress}%</span>` : '<span></span>'}</li>`).join('')}
    </ol>
    ${job.error ? `<div class="job-error">${esc(job.error)}</div>` : ''}
    ${others.length ? `<div class="history">${others.map(j => `
      <div class="history-row" role="button" tabindex="0" data-job="${j.id}">${JOB_IC[j.status] || ''} ${esc(j.title)} <span style="color:var(--faint)">${esc(j.project)}</span><span class="time">${fmtTime(j.startedAt)}</span></div>`).join('')}</div>` : ''}`);
}

function lineClass(l) {
  if (l.startsWith('━━')) return 'l-sec';
  if (l.startsWith('$ ')) return 'l-cmd';
  if (l.startsWith('✔')) return 'l-ok';
  if (/^✖|\bERROR\b|error:|fatal:/i.test(l)) return 'l-err';
  return '';
}
const lineHtml = l => { const c = lineClass(l); return c ? `<span class="${c}">${esc(l)}</span>` : esc(l); };

const currentLog = () => (state.tab.startsWith('svc:') ? state.logs.svc[state.tab.slice(4)] : state.logs.job[state.jobId]);

async function ensureLog() {
  try {
    if (state.tab.startsWith('svc:')) {
      const name = state.tab.slice(4);
      if (!state.logs.svc[name]) state.logs.svc[name] = await api(`/api/service/logs?name=${encodeURIComponent(name)}`);
    } else if (state.jobId && !state.logs.job[state.jobId]) {
      state.logs.job[state.jobId] = (await api(`/api/job?id=${state.jobId}`)).log;
    }
  } catch { /* задача могла исчезнуть из истории */ }
  renderLogTail(true);
}

// Лог может приходить тысячами строк в секунду (liquibase, скрипты БД). Строки копятся в буфере
// и вставляются одной пачкой раз за кадр; в DOM держим только хвост, иначе браузер отстаёт на минуты.
const MAX_DOM_LINES = 2000;
const MAX_STORED_LINES = 5000;
const pendingLines = [];
let flushRaf = null;
let domLines = 0;

function renderLogTail(scrollToEnd) {
  pendingLines.length = 0;
  const el = $('#log');
  const lines = (currentLog() || []).slice(-MAX_DOM_LINES);
  el.innerHTML = lines.map(lineHtml).join('\n');
  domLines = lines.length;
  if (scrollToEnd) el.scrollTop = el.scrollHeight;
}

function appendLog(line) {
  pendingLines.push(line);
  if (!flushRaf) flushRaf = requestAnimationFrame(flushLog);
}

function flushLog() {
  flushRaf = null;
  if (!pendingLines.length) return;
  const el = $('#log');
  const stick = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  if (domLines + pendingLines.length > MAX_DOM_LINES) {
    renderLogTail(false);
  } else {
    el.insertAdjacentHTML('beforeend', (domLines ? '\n' : '') + pendingLines.map(lineHtml).join('\n'));
    domLines += pendingLines.length;
    pendingLines.length = 0;
  }
  if (stick) el.scrollTop = el.scrollHeight;
}

function storeLine(arr, line) {
  arr.push(line);
  if (arr.length > MAX_STORED_LINES) arr.splice(0, arr.length - MAX_STORED_LINES);
}

// Под открытым модальным окном страницу не трогаем (лишние перерисовки мерцают), после закрытия догоняем
const modalOpen = () => !!document.querySelector('dialog[open]');
document.addEventListener('close', () => { if (!modalOpen()) scheduleRender(); }, true);

function renderAll() {
  renderEnv();
  renderRepos();
  renderTabs();
  renderJobView();
  ensureLog();
}

let raf;
function scheduleRender() {
  if (raf || modalOpen()) return;
  raf = requestAnimationFrame(() => { raf = null; renderEnv(); renderRepos(); renderTabs(); renderJobView(); });
}

function notifyDone(job) {
  const ok = job.status === 'done';
  const text = `${job.title} · ${job.project}: ${ok ? 'готово' : job.status === 'cancelled' ? 'отменено' : 'ошибка'} за ${fmtDur(job)}`;
  toast(text, ok ? 'ok' : 'err');
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('Dev Panel', { body: text + (job.error ? `\n${job.error}` : '') });
  }
}

/* ---------- конфиг ---------- */

async function loadConfig() {
  state.config = await api('/api/config');
  syncPrefs(state.config.prefs);
  if (state.sel && !findProject(state.sel)) state.sel = null;
  if (!state.sel) state.sel = allProjects()[0]?.id ?? null;
}

// Конфиг изменили (в этом окне или в другом): перечитать и перерисовать
async function reloadConfig() {
  try { await loadConfig(); await refreshStatus(); renderAll(); window.settingsRefresh?.(); } catch (e) { toast(e.message, 'err'); }
}

/* ---------- события ---------- */

document.addEventListener('click', e => {
  const t = e.target;
  const sr = t.closest('[data-snap-restore]');
  if (sr) return runAction(sr.dataset.project, 'snapRestore', { snapshot: sr.dataset.snapRestore });
  const sd = t.closest('[data-snap-delete]');
  if (sd) return runAction(sd.dataset.project, 'snapDelete', { snapshot: sd.dataset.snapDelete });
  const btn = t.closest('button[data-action]');
  if (btn) { e.stopPropagation(); return runAction(btn.dataset.project, btn.dataset.action); }
  const os = t.closest('[data-open-settings]');
  if (os) return openSettings(os.dataset.openSettings);
  const stop = t.closest('[data-stop-svc]');
  if (stop) return api(`/api/service/stop?name=${encodeURIComponent(stop.dataset.stopSvc)}`, {}).catch(err => toast(err.message, 'err'));
  const cancel = t.closest('[data-cancel]');
  if (cancel) return api(`/api/cancel?id=${cancel.dataset.cancel}`, {}).catch(err => toast(err.message, 'err'));
  if (t.closest('[data-auth-check]')) {
    return api('/api/auth/check', {}).then(a => { state.auth = a; renderEnv(); }).catch(err => toast(err.message, 'err'));
  }
  const tab = t.closest('[data-tab]');
  if (tab) { state.tab = tab.dataset.tab; renderTabs(); renderJobView(); return ensureLog(); }
  const jr = t.closest('[data-job]');
  if (jr) { state.tab = 'jobs'; state.jobId = Number(jr.dataset.job); renderTabs(); renderJobView(); return ensureLog(); }
  const row = t.closest('.repo-row');
  if (row) return select(row.parentElement.dataset.repo);
});

document.addEventListener('toggle', e => {
  const d = e.target.closest?.('[data-changes]');
  if (d) d.open ? state.openChanges.add(d.dataset.changes) : state.openChanges.delete(d.dataset.changes);
}, true);

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
    e.preventDefault();
    if (!$('#palette').open && !document.querySelector('dialog[open]')) openPalette();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    if (!document.querySelector('dialog[open]')) openSettings();
    return;
  }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  // Enter/Space на «кнопках-строках» (role=button, но не <button>) работает как клик
  if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.matches?.('[role="button"]:not(button)')) {
    e.preventDefault();
    return document.activeElement.click();
  }
  if (document.querySelector('dialog[open]') || typing) return;
  if (e.key === '?') { e.preventDefault(); return openSettings('help'); }
  if (!state.config) return;
  const ids = allProjects().map(p => p.id);
  if (!ids.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const i = ids.indexOf(state.sel);
    const next = e.key === 'ArrowDown' ? (i + 1) % ids.length : (i <= 0 ? ids.length - 1 : i - 1);
    select(ids[next], { scroll: true });
  } else if (e.key === 'Enter' && state.sel && document.activeElement === document.body) {
    const p = findProject(state.sel);
    if (p?.groupObj.primary && !runningJob(p.group)) runAction(p.id, p.groupObj.primary);
  } else if (e.key === 'Escape' && state.sel) {
    select(state.sel);
  }
});

$('#paletteBtn').onclick = openPalette;
$('#settingsBtn').onclick = () => openSettings();
$('#themeBtn').onclick = () => openSettings('look');
$('#helpBtn').onclick = () => openSettings('help');
$('#logEnd').onclick = () => { const el = $('#log'); el.scrollTop = el.scrollHeight; };
$('#logCopy').onclick = async () => {
  const text = (currentLog() || []).join('\n');
  try { await navigator.clipboard.writeText(text); toast('Лог скопирован', 'ok'); } catch { toast('Не удалось скопировать — выделите текст вручную', 'err'); }
};

/* разделитель колонок */
(function initSplitter() {
  const layout = $('#layout');
  const sp = $('#splitter');
  const apply = px => layout.style.setProperty('--left-w', `${Math.round(Math.min(Math.max(px, 380), window.innerWidth - 400))}px`);
  const saved = store.get('leftW', null);
  if (saved) apply(saved);
  sp.addEventListener('pointerdown', e => {
    sp.setPointerCapture(e.pointerId);
    sp.classList.add('drag');
    const move = ev => apply(ev.clientX - layout.getBoundingClientRect().left);
    const up = () => {
      sp.classList.remove('drag');
      sp.removeEventListener('pointermove', move);
      sp.removeEventListener('pointerup', up);
      store.set('leftW', parseInt(layout.style.getPropertyValue('--left-w'), 10));
    };
    sp.addEventListener('pointermove', move);
    sp.addEventListener('pointerup', up);
  });
  sp.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const cur = $('#repos').getBoundingClientRect().width;
    apply(cur + (e.key === 'ArrowRight' ? 24 : -24));
    store.set('leftW', parseInt(layout.style.getPropertyValue('--left-w'), 10));
  });
})();

let statusTimer;
async function refreshStatus() {
  clearTimeout(statusTimer);
  try { state.status = await api('/api/status'); if (!modalOpen()) { renderEnv(); renderRepos(); } } catch { /* сервер недоступен */ }
  statusTimer = setTimeout(refreshStatus, document.hidden ? 15000 : 4000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStatus(); });

// WebSocket, а не EventSource: SSE держит одно из 6 HTTP-соединений браузера на хост,
// и при нескольких открытых вкладках панели новые запросы вставали в очередь (белая страница).
let reconnectDelay = 500;
function connect() {
  const es = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`);
  es.onclose = () => {
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 5000);
  };
  es.onmessage = ev => {
    const m = JSON.parse(ev.data);
    switch (m.type) {
      case 'job': {
        const { type, ...job } = m;
        const prev = state.jobs.find(j => j.id === job.id);
        upsertJob(job);
        if (!prev && state.tab === 'jobs') { state.jobId = job.id; ensureLog(); }
        if (job.finishedAt && prev && !prev.finishedAt) { notifyDone(job); refreshStatus(); }
        scheduleRender();
        break;
      }
      case 'jobLog':
        storeLine(state.logs.job[m.id] ||= [], m.line);
        if (state.tab === 'jobs' && state.jobId === m.id) appendLog(m.line);
        break;
      case 'jobProgress': {
        const job = state.jobs.find(j => j.id === m.id);
        if (job) { job.steps[m.step].progress = m.pct; scheduleRender(); }
        break;
      }
      case 'service': {
        const { type, ...svc } = m;
        const i = state.services.findIndex(s => s.name === svc.name);
        if (i >= 0 && state.services[i].startedAt !== svc.startedAt) state.logs.svc[svc.name] = [];
        if (i >= 0) state.services[i] = svc; else state.services.push(svc);
        scheduleRender();
        break;
      }
      case 'config':
        debouncedReload();
        break;
      case 'auth': {
        const { type, ...a } = m;
        const prev = state.auth;
        state.auth = a;
        if (prev && a.actionAt && a.actionAt !== prev.actionAt && a.lastAction.startsWith('relogin')) {
          toast('Сессия во фронтенде слетела — панель вошла заново', 'ok');
        }
        renderEnv();
        break;
      }
      case 'serviceLog':
        if (state.logs.svc[m.name]) storeLine(state.logs.svc[m.name], m.line);
        if (state.tab === 'svc:' + m.name) appendLog(m.line);
        break;
    }
  };
  es.onopen = async () => {
    reconnectDelay = 500;
    state.jobs = await api('/api/jobs');
    state.services = await api('/api/services');
    state.auth = await api('/api/auth').catch(() => null);
    state.logs = { job: {}, svc: {} };
    renderAll();
  };
}
const debouncedReload = debounce(reloadConfig, 150);

(async () => {
  hydrateIcons();
  try { await loadConfig(); } catch (e) { toast(`Не удалось загрузить конфиг: ${e.message}`, 'err'); return; }
  renderAll();
  await refreshStatus();
  connect();
  setInterval(() => { if (!modalOpen() && state.jobs.some(j => j.status === 'running')) { renderJobView(); renderEnv(); } }, 1000);
})();

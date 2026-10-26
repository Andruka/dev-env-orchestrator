const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('devpanel.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('devpanel.' + k, JSON.stringify(v)); } catch { /* нет хранилища */ } },
};

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
};

/* ---------- утилиты ---------- */

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 7000 : 4000);
}

function tpl(str, ctx) {
  return String(str).replace(/\{([A-Za-z_][\w.]*)\}/g, (m, k) => k.split('.').reduce((o, p) => o?.[p], ctx) ?? m);
}

function setHtml(el, html) {
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}

const fmtTime = ts => (ts ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
function fmtDur(j) {
  const s = Math.round(((j.finishedAt || Date.now()) - j.startedAt) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} мин ${s % 60} с` : `${s} с`;
}

/* ---------- модель ---------- */

const allProjects = () => state.config.groups.flatMap(g => g.projects.map(p => ({ ...p, groupObj: g })));
const findProject = id => allProjects().find(p => p.id === id);
const projectStatus = id => state.status?.groups.flatMap(g => g.projects).find(p => p.id === id) || {};
const runningJob = groupId => state.jobs.find(j => j.group === groupId && j.status === 'running');
const isUp = st => st.compose && /running/.test(st.compose.status);
const frontService = () => state.services.find(s => s.name === 'frontend' && s.status === 'running');

function isAlive(p) {
  if (p.groupObj.kind === 'compose') return isUp(projectStatus(p.id));
  return state.services.some(s => s.project === p.name && s.status === 'running');
}

/* ---------- верхняя полоса: что запущено ---------- */

function renderEnv() {
  if (!state.status) return;
  const items = [];
  const upProject = allProjects().find(p => p.groupObj.kind === 'compose' && isUp(projectStatus(p.id)));
  if (upProject) {
    const st = projectStatus(upProject.id);
    items.push(`<div class="env-item"><span class="dot alive"></span><span class="k">Бэкенд</span>
      <span class="v">${esc(upProject.name)}</span><span class="v mono">${esc(st.git?.branch || '')}</span>
      <button class="ghost" data-action="down" data-project="${esc(upProject.id)}" title="ddown">■ Стоп</button></div>`);
  } else {
    items.push(`<div class="env-item off"><span class="dot"></span><span class="k">Бэкенд</span><span class="v">не запущен</span></div>`);
  }
  const fs = frontService();
  if (fs) {
    items.push(`<div class="env-item"><span class="dot alive"></span><span class="k">Фронт</span><span class="v mono">:3000</span>
      <button class="ghost" data-stop-svc="frontend">■ Стоп</button></div>`);
  } else if (state.status.ports.frontend) {
    items.push(`<div class="env-item off" title="Порт 3000 занят процессом, запущенным не из панели"><span class="dot warn"></span><span class="k">Фронт</span><span class="v">:3000 вне панели</span></div>`);
  } else {
    items.push(`<div class="env-item off"><span class="dot"></span><span class="k">Фронт</span><span class="v">не запущен</span></div>`);
  }
  items.push(`<div class="env-item off"><span class="dot ${state.status.ports.db ? 'alive' : ''}"></span><span class="k">PostgreSQL</span><span class="v mono">:5432</span></div>`);
  const job = state.jobs.find(j => j.status === 'running');
  if (job) {
    const st = job.steps.find(s => s.status === 'running');
    items.push(`<div class="env-item off" style="cursor:pointer" data-job="${job.id}"><span class="dot busy"></span>
      <span class="v">${esc(job.title)}</span><span class="k">${esc(job.project)}${st?.progress != null ? ` · ${st.progress}%` : ''}</span></div>`);
  }
  setHtml($('#env'), items.join(''));

  const pst = job?.steps.find(s => s.status === 'running');
  document.title = job ? `◌ ${pst?.progress != null ? pst.progress + '% · ' : ''}${job.title} — Dev Panel` : 'Dev Panel';
}

/* ---------- проекты ---------- */

function actionButton(actionId, project, { primary = false } = {}) {
  const a = state.config.actions[actionId];
  if (!a) return '';
  const busy = runningJob(project.group);
  const cls = [primary && 'primary', a.danger && 'danger'].filter(Boolean).join(' ');
  const title = busy ? `Занято: выполняется «${busy.title}» (${busy.project})` : a.hint || '';
  return `<button class="${cls}" ${busy ? 'disabled' : ''} data-project="${esc(project.id)}" data-action="${esc(actionId)}" title="${esc(title)}">
    <span class="btn-ic">${esc(a.icon || '')}</span> ${esc(a.title)}</button>`;
}

function renderRepos() {
  const html = state.config.groups.map(g => `
    <div class="group">
      <h2 class="group-title">${esc(g.title)} <span>${g.projects.length}</span></h2>
      ${g.projects.map(p0 => {
        const p = { ...p0, groupObj: g };
        const st = projectStatus(p.id);
        const git = st.git || {};
        const alive = isAlive(p);
        const sel = state.sel === p.id;
        const job = runningJob(g.id);
        const mine = job && job.project === p.name;
        const detached = git.branch === '(detached)';
        const badges = [
          git.dirty ? `<span class="badge warn" title="Незакоммиченных файлов: ${git.dirty}">±${git.dirty}</span>` : '',
          git.behind ? `<span class="badge warn" title="Отстаёт от ${esc(git.upstream)} на ${git.behind}">↓${git.behind}</span>` : '',
          git.ahead ? `<span class="badge" title="Впереди ${esc(git.upstream)} на ${git.ahead}">↑${git.ahead}</span>` : '',
          git.stashes ? `<span class="badge" title="Записей в stash: ${git.stashes}">stash ${git.stashes}</span>` : '',
          mine ? `<span class="badge busy"><span class="spin">◌</span> ${esc(job.title)}</span>` : '',
          alive && !mine ? `<span class="badge alive">${g.kind === 'compose' ? 'запущен' : 'npm start'}</span>` : '',
        ].join('');
        return `
        <article class="repo ${sel ? 'sel' : ''} ${alive ? 'alive' : ''}" data-repo="${esc(p.id)}">
          <div class="repo-row">
            <span class="dot ${mine ? 'busy' : alive ? 'alive' : ''}"></span>
            <span class="repo-name">${esc(p.name)}</span>
            <span class="repo-branch ${detached ? 'detached' : ''}" title="${esc(git.branch)}">${esc(git.branch || '—')}</span>
            <span class="badges">${badges}</span>
            <span class="primary-slot">${g.primary ? actionButton(g.primary, p, { primary: sel }) : ''}</span>
          </div>
          ${sel ? renderDetail(p, st) : ''}
        </article>`;
      }).join('')}
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
  return `<div class="repo-detail"><div class="meta-line">${meta.join('')}</div>${changes}${ctrs}${sections}</div>`;
}

function select(id, { scroll = false } = {}) {
  state.sel = state.sel === id && !scroll ? null : id;
  store.set('sel', state.sel);
  renderRepos();
  if (scroll && state.sel) document.querySelector(`[data-repo="${CSS.escape(state.sel)}"]`)?.scrollIntoView({ block: 'nearest' });
}

/* ---------- запуск действий ---------- */

async function runAction(projectId, actionId) {
  const action = state.config.actions[actionId];
  const project = findProject(projectId);
  if (!action || !project) return;
  const params = {};
  for (const p of action.params) {
    const v = await askParam(project, actionId, action, p);
    if (v == null) return;
    params[p.name] = v;
  }
  if (action.confirm || action.danger) {
    const msg = tpl(action.confirm || `${action.title}: ${action.hint || ''}`, { ...state.config.vars, ...params, project });
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

function openDialog({ title, html, okLabel = 'Запустить', danger = false, onOpen, getValue }) {
  const dlg = $('#dialog');
  $('#dialogTitle').textContent = title;
  $('#dialogBody').innerHTML = html;
  const ok = $('#dialogOk');
  ok.textContent = okLabel;
  ok.className = danger ? 'primary danger' : 'primary';
  dlg.returnValue = '';
  dlg.showModal();
  onOpen?.();
  return new Promise(resolve => {
    dlg.onclose = () => resolve(dlg.returnValue === 'ok' ? getValue() : null);
  });
}

function confirmDialog(title, text, danger) {
  return openDialog({ title, html: `<p>${esc(text)}</p>`, okLabel: 'Выполнить', danger, getValue: () => true,
    onOpen: () => $('#dialogOk').focus() });
}

async function askParam(project, actionId, action, param) {
  const label = `${esc(param.title || param.name)} · <span class="mono">${esc(project.name)}</span>`;
  if (param.type === 'text') {
    return openDialog({
      title: action.title,
      html: `<div class="field"><label>${label}</label><input id="textParam" autocomplete="off"></div>`,
      onOpen: () => $('#textParam').focus(),
      getValue: () => $('#textParam').value.trim(),
    });
  }
  let options;
  try {
    options = await api(`/api/options?project=${encodeURIComponent(project.id)}&action=${encodeURIComponent(actionId)}&param=${encodeURIComponent(param.name)}`);
  } catch (e) { toast(e.message, 'err'); return null; }
  if (!options.length && param.type !== 'gitBranch') { toast(`Нет вариантов для «${param.title || param.name}»`, 'err'); return null; }
  const current = param.type === 'gitBranch' ? projectStatus(project.id).git?.branch : null;
  let shown = options;
  let idx = 0;
  return openDialog({
    title: action.title,
    html: `<div class="field"><label>${label}</label>
      <input id="optFilter" placeholder="Поиск…   ↑↓ выбрать · Enter запустить" autocomplete="off">
      <div class="options" id="optList"></div></div>`,
    getValue: () => shown[idx]?.value ?? (param.type === 'gitBranch' ? $('#optFilter').value.trim() || null : null),
    onOpen: () => {
      const input = $('#optFilter');
      const list = $('#optList');
      const draw = () => {
        const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
        shown = options.filter(o => words.every(w => o.label.toLowerCase().includes(w)));
        idx = Math.min(idx, Math.max(shown.length - 1, 0));
        list.innerHTML = shown.length ? shown.slice(0, 300).map((o, i) =>
          `<div class="opt ${i === idx ? 'sel' : ''} ${o.value === current ? 'current' : ''}" data-i="${i}">${esc(o.label)}${o.meta ? `<span class="meta">${esc(o.meta)}</span>` : ''}</div>`).join('')
          : `<div class="opt muted">${param.type === 'gitBranch' && input.value ? `Ветка «${esc(input.value)}» будет взята как есть` : 'Ничего не найдено'}</div>`;
        list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
      };
      input.oninput = () => { idx = 0; draw(); };
      input.onkeydown = e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, shown.length - 1); draw(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); draw(); }
        else if (e.key === 'Enter') { e.preventDefault(); $('#dialogOk').click(); }
      };
      list.onclick = e => { const el = e.target.closest('[data-i]'); if (el) { idx = +el.dataset.i; draw(); input.focus(); } };
      list.ondblclick = e => { if (e.target.closest('[data-i]')) $('#dialogOk').click(); };
      draw();
      input.focus();
    },
  });
}

/* ---------- настройки входа ---------- */

async function openSettings() {
  let s;
  try { s = (await api('/api/settings')).auth; } catch (e) { return toast(e.message, 'err'); }
  const dlg = $('#dialog');
  const result = await openDialog({
    title: 'Настройки входа',
    okLabel: 'Сохранить',
    html: `
      <p>Используются кнопкой «Войти»: панель получает токен по API и записывает его в localStorage браузера.
      Данные хранятся локально в файле с правами 600.</p>
      <div class="row2">
        <div class="field"><label>Логин</label><input id="sLogin" value="${esc(s.login)}" autocomplete="off"></div>
        <div class="field"><label>clientId</label><input id="sClient" value="${esc(s.clientId)}" inputmode="numeric"></div>
      </div>
      <div class="field"><label>Пароль</label><input id="sPass" type="password" placeholder="${s.hasPassword ? '•••••••• сохранён — оставьте пустым, чтобы не менять' : 'не задан'}" autocomplete="new-password"></div>
      <div class="field"><label>URL получения токена</label><input id="sLoginUrl" class="mono" value="${esc(s.loginUrl)}"></div>
      <div class="field"><label>URL данных пользователя</label><input id="sUsersUrl" class="mono" value="${esc(s.usersUrl)}">
        <span class="help">{userId} подставляется из ответа логина. Оставьте пустым, чтобы не запрашивать.</span></div>
      <div style="display:flex;gap:8px;align-items:center">
        <button type="button" id="sTest">Проверить вход</button><span id="sResult" class="note" style="flex:1;display:none"></span>
      </div>`,
    onOpen: () => {
      $('#sLogin').focus();
      $('#sTest').onclick = async () => {
        const r = $('#sResult');
        r.style.display = '';
        r.className = 'note';
        r.textContent = 'Сохраняю и проверяю…';
        try {
          await api('/api/settings', { auth: readSettingsForm() });
          $('#sPass').value = '';
          const t = await api('/api/settings/test', {});
          r.className = 'note ok';
          r.textContent = `✓ ${t.lines.slice(-1)[0] || 'Вход выполнен'}`;
        } catch (e) { r.className = 'note err'; r.textContent = e.message; }
      };
    },
    getValue: () => readSettingsForm(),
  });
  if (!result) return;
  try { await api('/api/settings', { auth: result }); toast('Настройки сохранены', 'ok'); } catch (e) { toast(e.message, 'err'); }
  void dlg;
}

function readSettingsForm() {
  return {
    login: $('#sLogin').value, clientId: $('#sClient').value, password: $('#sPass').value,
    loginUrl: $('#sLoginUrl').value, usersUrl: $('#sUsersUrl').value,
  };
}

/* ---------- палитра команд ---------- */

let palItems = [];
let palIdx = 0;

function openPalette() {
  const dlg = $('#palette');
  const sel = state.sel;
  const items = [];
  for (const p of allProjects()) {
    const ids = [...new Set([p.groupObj.primary, ...p.groupObj.sections.flatMap(s => s.actions)].filter(Boolean))];
    for (const a of ids) {
      const act = state.config.actions[a];
      if (act) items.push({ kind: 'action', project: p, actionId: a, act, text: `${act.title} ${p.name} ${act.hint || ''}`.toLowerCase(), boost: p.id === sel ? 1 : 0 });
    }
  }
  items.push({ kind: 'settings', text: 'настройки вход логин пароль', boost: 0 });
  items.sort((x, y) => y.boost - x.boost);
  const input = $('#paletteInput');
  input.value = '';
  const draw = () => {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    palItems = items.filter(i => words.every(w => i.text.includes(w))).slice(0, 60);
    palIdx = Math.min(palIdx, Math.max(palItems.length - 1, 0));
    $('#paletteList').innerHTML = palItems.map((i, n) => i.kind === 'settings'
      ? `<div class="pal-item ${n === palIdx ? 'sel' : ''}" data-n="${n}"><span class="btn-ic">⚙</span><span class="t">Настройки входа</span></div>`
      : `<div class="pal-item ${n === palIdx ? 'sel' : ''} ${i.act.danger ? 'danger' : ''}" data-n="${n}"><span class="btn-ic">${esc(i.act.icon || '')}</span>
          <span class="t">${esc(i.act.title)}</span><span class="proj">${esc(i.project.name)}</span></div>`).join('')
      || '<div class="pal-item muted">Ничего не найдено</div>';
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
  if (item.kind === 'settings') return openSettings();
  state.sel = item.project.id;
  store.set('sel', state.sel);
  renderRepos();
  runAction(item.project.id, item.actionId);
}

/* ---------- консоль ---------- */

function upsertJob(job) {
  const i = state.jobs.findIndex(j => j.id === job.id);
  if (i >= 0) state.jobs[i] = { ...state.jobs[i], ...job };
  else state.jobs.unshift(job);
}

const STEP_IC = { pending: '', running: '<span class="spin">◌</span>', done: '✓', failed: '✕', skipped: '–', cancelled: '⊘' };
const JOB_IC = { running: '<span class="dot busy"></span>', done: '<span class="dot alive"></span>', failed: '<span class="dot err"></span>', cancelled: '<span class="dot"></span>' };

function renderTabs() {
  const svcTabs = state.services.map(s => `
    <button class="tab ${state.tab === 'svc:' + s.name ? 'sel' : ''}" data-tab="svc:${esc(s.name)}">
      <span class="dot ${s.status === 'running' ? 'alive' : s.exitCode ? 'err' : ''}"></span>${esc(s.name)}<span class="sub">${esc(s.project || '')}</span></button>`).join('');
  const running = state.jobs.filter(j => j.status === 'running').length;
  setHtml($('#tabs'), `<button class="tab ${state.tab === 'jobs' ? 'sel' : ''}" data-tab="jobs">Задачи${running ? ` <span class="dot busy"></span>` : ''}</button>${svcTabs}`);
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
        ${s.status === 'running' ? `<button class="danger" data-stop-svc="${esc(s.name)}">■ Остановить</button>` : ''}
      </div>` : '');
    return;
  }
  const job = state.jobs.find(j => j.id === state.jobId) || state.jobs[0];
  if (!job) {
    setHtml(el, `<div class="empty">Здесь появится ход выполнения и лог.<br>
      Выберите проект слева (<kbd>↑</kbd><kbd>↓</kbd>), <kbd>Enter</kbd> запускает главное действие,
      <kbd>Ctrl</kbd>+<kbd>K</kbd> открывает все команды.</div>`);
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
      ${job.steps.map(s => `<li class="step ${s.status}"><span class="ic">${STEP_IC[s.status]}</span><span>${esc(s.title)}</span>
        ${s.progress != null && s.status === 'running' ? `<span class="progress"><span class="bar"><i style="width:${s.progress}%"></i></span>${s.progress}%</span>` : '<span></span>'}</li>`).join('')}
    </ol>
    ${job.error ? `<div class="job-error">${esc(job.error)}</div>` : ''}
    ${others.length ? `<div class="history">${others.map(j => `
      <div class="history-row" data-job="${j.id}">${JOB_IC[j.status] || ''} ${esc(j.title)} <span style="color:var(--faint)">${esc(j.project)}</span><span class="time">${fmtTime(j.startedAt)}</span></div>`).join('')}</div>` : ''}`);
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
  const el = $('#log');
  el.innerHTML = (currentLog() || []).map(lineHtml).join('\n');
  el.scrollTop = el.scrollHeight;
}

function appendLog(line) {
  const el = $('#log');
  const stick = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  el.insertAdjacentHTML('beforeend', (el.childNodes.length ? '\n' : '') + lineHtml(line));
  if (stick) el.scrollTop = el.scrollHeight;
}

function renderAll() {
  renderEnv();
  renderRepos();
  renderTabs();
  renderJobView();
  ensureLog();
}

let raf;
function scheduleRender() {
  if (raf) return;
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

/* ---------- события ---------- */

document.addEventListener('click', e => {
  const t = e.target;
  const btn = t.closest('button[data-action]');
  if (btn) { e.stopPropagation(); return runAction(btn.dataset.project, btn.dataset.action); }
  const stop = t.closest('[data-stop-svc]');
  if (stop) return api(`/api/service/stop?name=${encodeURIComponent(stop.dataset.stopSvc)}`, {}).catch(err => toast(err.message, 'err'));
  const cancel = t.closest('[data-cancel]');
  if (cancel) return api(`/api/cancel?id=${cancel.dataset.cancel}`, {}).catch(err => toast(err.message, 'err'));
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
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' || (e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
    e.preventDefault();
    if (!$('#palette').open && !$('#dialog').open) openPalette();
    return;
  }
  if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  const ids = allProjects().map(p => p.id);
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
$('#settingsBtn').onclick = openSettings;
$('#reloadBtn').onclick = async () => {
  try { state.config = await api('/api/reload', {}); await refreshStatus(); renderAll(); toast('Конфиг перечитан', 'ok'); } catch (e) { toast(e.message, 'err'); }
};

let statusTimer;
async function refreshStatus() {
  clearTimeout(statusTimer);
  try { state.status = await api('/api/status'); renderEnv(); renderRepos(); } catch { /* сервер недоступен */ }
  statusTimer = setTimeout(refreshStatus, document.hidden ? 15000 : 4000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStatus(); });

function connect() {
  const es = new EventSource('/api/events');
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
        (state.logs.job[m.id] ||= []).push(m.line);
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
      case 'serviceLog':
        state.logs.svc[m.name]?.push(m.line);
        if (state.tab === 'svc:' + m.name) appendLog(m.line);
        break;
    }
  };
  es.onopen = async () => {
    state.jobs = await api('/api/jobs');
    state.services = await api('/api/services');
    state.logs = { job: {}, svc: {} };
    renderAll();
  };
}

(async () => {
  state.config = await api('/api/config');
  if (state.sel && !findProject(state.sel)) state.sel = null;
  if (!state.sel) state.sel = allProjects()[0]?.id ?? null;
  await refreshStatus();
  renderAll();
  connect();
  setInterval(() => { if (state.jobs.some(j => j.status === 'running')) { renderJobView(); renderEnv(); } }, 1000);
})();

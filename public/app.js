const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = {
  config: null,
  status: null,
  jobs: [],
  services: [],
  tab: 'jobs',
  jobId: null,
  logs: { job: {}, svc: {} },
};

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 4500);
}

function render(tpl, ctx) {
  return String(tpl).replace(/\{([A-Za-z_][\w.]*)\}/g, (m, k) => k.split('.').reduce((o, p) => o?.[p], ctx) ?? m);
}

/* ---------- Карточки проектов ---------- */

function projectStatus(groupId, projectId) {
  return state.status?.groups.find(g => g.id === groupId)?.projects.find(p => p.id === projectId);
}

function runningJob(groupId) {
  return state.jobs.find(j => j.group === groupId && j.status === 'running');
}

function renderGroups() {
  const { groups, actions } = state.config;
  $('#groups').innerHTML = groups.map(g => {
    const busy = runningJob(g.id);
    return `
    <div class="group">
      <h2>${esc(g.title)}</h2>
      <div class="cards">
        ${g.projects.map(p => {
          const st = projectStatus(g.id, p.id) || {};
          const git = st.git || {};
          const up = st.compose && /running/.test(st.compose.status);
          const svc = g.kind === 'node' && state.services.find(s => s.project === p.name && s.status === 'running');
          const active = up || svc;
          const mine = busy && busy.project === p.name;
          return `
          <div class="card ${active ? 'active' : ''}">
            <div class="card-head">
              <span class="dot ${active ? 'ok' : ''}"></span>
              <span class="card-name">${esc(p.name)}</span>
              <span class="branch" title="${esc(git.branch)}">⎇ ${esc(git.branch || '—')}</span>
              ${git.dirty ? `<span class="badge warn" title="Незакоммиченные файлы">±${git.dirty}</span>` : ''}
              ${git.behind ? `<span class="badge warn" title="Отстаёт от remote">↓${git.behind}</span>` : ''}
              ${git.ahead ? `<span class="badge" title="Опережает remote">↑${git.ahead}</span>` : ''}
              <span class="spacer"></span>
              ${mine ? `<span class="badge"><span class="spin">◌</span> ${esc(busy.title)}</span>` : ''}
              ${st.compose ? `<span class="badge ${up ? 'ok' : ''}">${esc(st.compose.status)}</span>` : ''}
              ${svc ? `<span class="badge ok">npm start</span>` : ''}
            </div>
            ${st.containers?.length ? `<div class="ctrs">${st.containers.map(c =>
              `<span class="ctr" title="${esc(c.status)}"><span class="dot ${c.state === 'running' ? 'ok' : c.state === 'exited' ? '' : 'warn'}"></span>${esc(c.name.replace(st.compose.name + '-', ''))}</span>`).join('')}</div>` : ''}
            <div class="card-actions">
              ${g.actions.map(a => {
                const act = actions[a];
                if (!act) return '';
                return `<button class="${act.primary ? 'primary' : ''}" ${busy ? 'disabled' : ''}
                  data-project="${esc(p.id)}" data-action="${esc(a)}" title="${esc(act.hint || '')}">${esc(act.icon || '')} ${esc(act.title)}</button>`;
              }).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

function renderChips() {
  const s = state.status;
  if (!s) return;
  const upProjects = s.groups.flatMap(g => g.projects).filter(p => p.compose && /running/.test(p.compose.status));
  const chips = [
    [s.ports.db, `PostgreSQL :5432`],
    [s.ports.frontend, `Фронт :3000`],
    [upProjects.length, upProjects.length ? `Docker: ${upProjects.map(p => p.compose.name).join(', ')}` : 'Docker: ничего не поднято'],
  ];
  if (s.foreignContainers.length) chips.push(['warn', `Прочие контейнеры: ${s.foreignContainers.length}`]);
  $('#chips').innerHTML = chips.map(([ok, label]) =>
    `<span class="chip"><span class="dot ${ok === 'warn' ? 'warn' : ok ? 'ok' : ''}"></span>${esc(label)}</span>`).join('');
}

/* ---------- Запуск действий ---------- */

function findProject(id) {
  for (const g of state.config.groups) for (const p of g.projects) if (p.id === id) return p;
}

async function runAction(projectId, actionId) {
  const action = state.config.actions[actionId];
  const project = findProject(projectId);
  const params = {};
  for (const p of action.params) {
    const v = await pickParam(project, actionId, action, p);
    if (v == null) return;
    params[p.name] = v;
  }
  if (action.confirm) {
    const msg = render(action.confirm, { ...state.config.vars, ...params, project });
    if (!(await confirmDialog(`${action.title} · ${project.name}`, msg))) return;
  }
  try {
    const job = await api('/api/run', { project: projectId, action: actionId, params });
    state.tab = 'jobs';
    state.jobId = job.id;
    upsertJob(job);
    renderAll();
  } catch (e) { toast(e.message); }
}

function confirmDialog(title, text) {
  return openDialog(title, `<p>${esc(text)}</p>`, () => true, 'Да, выполнить');
}

async function pickParam(project, actionId, action, param) {
  let options;
  try {
    options = await api(`/api/options?project=${encodeURIComponent(project.id)}&action=${actionId}&param=${param.name}`);
  } catch (e) { toast(e.message); return null; }
  let selected = options[0]?.value;
  const body = `
    <div class="field">
      <label>${esc(param.title || param.name)} — ${esc(project.name)}</label>
      <input id="optFilter" placeholder="Поиск… (Enter — выбрать)" autocomplete="off">
      <div class="options" id="optList"></div>
    </div>`;
  return openDialog(action.title, body, () => {
    const typed = $('#optFilter').value.trim();
    return selected ?? (typed || null);
  }, 'Запустить', () => {
    const draw = () => {
      const f = $('#optFilter').value.toLowerCase();
      const shown = options.filter(o => o.label.toLowerCase().includes(f));
      if (!shown.some(o => o.value === selected)) selected = shown[0]?.value;
      $('#optList').innerHTML = shown.length ? shown.map(o =>
        `<div class="opt ${o.value === selected ? 'sel' : ''}" data-v="${esc(o.value)}">${esc(o.label)}${o.meta ? `<span class="meta">${esc(o.meta)}</span>` : ''}</div>`).join('')
        : `<div class="opt muted">${param.type === 'gitBranch' && f ? 'Будет использовано введённое имя' : 'Ничего не найдено'}</div>`;
      if (!shown.length) selected = undefined;
    };
    $('#optFilter').oninput = draw;
    $('#optFilter').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#dialogOk').click(); } };
    $('#optList').onclick = e => {
      const el = e.target.closest('[data-v]');
      if (el) { selected = el.dataset.v; draw(); }
    };
    $('#optList').ondblclick = e => { if (e.target.closest('[data-v]')) $('#dialogOk').click(); };
    draw();
    $('#optFilter').focus();
  });
}

function openDialog(title, html, getValue, okLabel, onOpen) {
  const dlg = $('#dialog');
  $('#dialogTitle').textContent = title;
  $('#dialogBody').innerHTML = html;
  $('#dialogOk').textContent = okLabel;
  dlg.returnValue = '';
  dlg.showModal();
  onOpen?.();
  return new Promise(resolve => {
    dlg.onclose = () => resolve(dlg.returnValue === 'ok' ? getValue() : null);
  });
}

/* ---------- Панель активности ---------- */

function upsertJob(job) {
  const i = state.jobs.findIndex(j => j.id === job.id);
  if (i >= 0) state.jobs[i] = { ...state.jobs[i], ...job };
  else state.jobs.unshift(job);
}

const STEP_ICON = { pending: '○', running: '<span class="spin">◌</span>', done: '✓', failed: '✗', skipped: '–', cancelled: '⊘' };
const JOB_ICON = { running: '<span class="spin">◌</span>', done: '<span style="color:var(--ok)">✓</span>', failed: '<span style="color:var(--err)">✗</span>', cancelled: '⊘' };

function fmtTime(ts) { return ts ? new Date(ts).toLocaleTimeString('ru-RU') : ''; }
function fmtDur(j) {
  const s = Math.round(((j.finishedAt || Date.now()) - j.startedAt) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}м ${s % 60}с` : `${s}с`;
}

function renderTabs() {
  const svcTabs = state.services.map(s =>
    `<button class="tab ${state.tab === 'svc:' + s.name ? 'sel' : ''}" data-tab="svc:${esc(s.name)}">
      <span class="dot ${s.status === 'running' ? 'ok' : s.status === 'exited' && s.exitCode ? 'err' : ''}"></span>${esc(s.name)} <span class="muted">${esc(s.project || '')}</span></button>`).join('');
  $('#tabs').innerHTML = `<button class="tab ${state.tab === 'jobs' ? 'sel' : ''}" data-tab="jobs">Задачи</button>${svcTabs}`;
}

function renderJobView() {
  if (state.tab.startsWith('svc:')) {
    const s = state.services.find(x => 'svc:' + x.name === state.tab);
    $('#jobView').innerHTML = s ? `
      <div class="job-title">
        <strong>${esc(s.name)}</strong><span class="muted">${esc(s.project || '')} · с ${fmtTime(s.startedAt)}</span>
        <span class="badge ${s.status === 'running' ? 'ok' : ''}">${esc(s.status)}${s.exitCode != null ? ' (' + s.exitCode + ')' : ''}</span>
        <span class="spacer"></span>
        ${s.status === 'running' ? `<button class="danger" data-stop-svc="${esc(s.name)}">■ Остановить</button>` : ''}
      </div>` : '';
    return;
  }
  const job = state.jobs.find(j => j.id === state.jobId) || state.jobs[0];
  if (!job) { $('#jobView').innerHTML = '<span class="muted">Задач пока не было. Выберите действие слева.</span>'; return; }
  state.jobId = job.id;
  const others = state.jobs.filter(j => j.id !== job.id).slice(0, 8);
  $('#jobView').innerHTML = `
    <div class="job-title">
      ${JOB_ICON[job.status] || ''} <strong>#${job.id} ${esc(job.title)}</strong>
      <span class="muted">${esc(job.project)}${job.params && Object.keys(job.params).length ? ' · ' + esc(Object.values(job.params).join(', ')) : ''} · ${fmtDur(job)}</span>
      <span class="spacer"></span>
      ${job.status === 'running' ? `<button class="danger" data-cancel="${job.id}">Отменить</button>` : ''}
    </div>
    <ul class="steps">
      ${job.steps.map(s => `<li class="step ${s.status}"><span class="ic">${STEP_ICON[s.status]}</span>${esc(s.title)}
        ${s.progress != null && s.status !== 'done' ? `<span class="bar"><i style="width:${s.progress}%"></i></span><span>${s.progress}%</span>` : ''}</li>`).join('')}
    </ul>
    ${job.error ? `<div style="color:var(--err);margin-top:6px">${esc(job.error)}</div>` : ''}
    ${others.length ? `<div class="jobs-list" style="margin-top:12px"><span class="muted" style="font-size:12px">История</span>
      ${others.map(j => `<div class="job-row" data-job="${j.id}">${JOB_ICON[j.status] || ''} #${j.id} ${esc(j.title)} <span class="muted">${esc(j.project)}</span><span class="time">${fmtTime(j.startedAt)}</span></div>`).join('')}</div>` : ''}`;
}

function lineClass(l) {
  if (l.startsWith('━━')) return 'l-sec';
  if (l.startsWith('$ ')) return 'l-cmd';
  if (l.startsWith('✔')) return 'l-ok';
  if (/^✖|\bERROR\b|error:|fatal:/i.test(l)) return 'l-err';
  return '';
}

function currentLog() {
  if (state.tab.startsWith('svc:')) return state.logs.svc[state.tab.slice(4)];
  return state.logs.job[state.jobId];
}

async function ensureLog() {
  if (state.tab.startsWith('svc:')) {
    const name = state.tab.slice(4);
    if (!state.logs.svc[name]) state.logs.svc[name] = await api(`/api/service/logs?name=${encodeURIComponent(name)}`);
  } else if (state.jobId && !state.logs.job[state.jobId]) {
    state.logs.job[state.jobId] = (await api(`/api/job?id=${state.jobId}`)).log;
  }
  renderLog();
}

function renderLog() {
  const el = $('#log');
  const lines = currentLog() || [];
  el.innerHTML = lines.map(l => { const c = lineClass(l); return c ? `<span class="${c}">${esc(l)}</span>` : esc(l); }).join('\n');
  el.scrollTop = el.scrollHeight;
}

function appendLog(line) {
  const el = $('#log');
  const stick = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  const c = lineClass(line);
  el.insertAdjacentHTML('beforeend', (el.innerHTML ? '\n' : '') + (c ? `<span class="${c}">${esc(line)}</span>` : esc(line)));
  if (stick) el.scrollTop = el.scrollHeight;
}

function renderActivity() {
  renderTabs();
  renderJobView();
}

function renderAll() {
  renderChips();
  renderGroups();
  renderActivity();
  ensureLog();
}

/* ---------- События ---------- */

document.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if (btn) return runAction(btn.dataset.project, btn.dataset.action);
  const tab = e.target.closest('[data-tab]');
  if (tab) { state.tab = tab.dataset.tab; renderActivity(); return ensureLog(); }
  const jr = e.target.closest('[data-job]');
  if (jr) { state.jobId = Number(jr.dataset.job); renderActivity(); return ensureLog(); }
  const cancel = e.target.closest('[data-cancel]');
  if (cancel) return api(`/api/cancel?id=${cancel.dataset.cancel}`, {}).catch(err => toast(err.message));
  const stop = e.target.closest('[data-stop-svc]');
  if (stop) return api(`/api/service/stop?name=${encodeURIComponent(stop.dataset.stopSvc)}`, {}).catch(err => toast(err.message));
});

$('#reload').onclick = async () => {
  try { state.config = await api('/api/reload', {}); await refreshStatus(); toast('Конфиг перечитан'); } catch (e) { toast(e.message); }
};

let statusTimer;
async function refreshStatus() {
  clearTimeout(statusTimer);
  try { state.status = await api('/api/status'); renderChips(); renderGroups(); } catch {}
  statusTimer = setTimeout(refreshStatus, 4000);
}

let renderPending;
function scheduleActivity() {
  if (renderPending) return;
  renderPending = requestAnimationFrame(() => { renderPending = null; renderActivity(); renderGroups(); });
}

function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = ev => {
    const m = JSON.parse(ev.data);
    switch (m.type) {
      case 'job': {
        const { type, ...job } = m;
        const isNew = !state.jobs.some(j => j.id === job.id);
        upsertJob(job);
        if (isNew && state.tab === 'jobs') { state.jobId = job.id; ensureLog(); }
        if (job.finishedAt) refreshStatus();
        scheduleActivity();
        break;
      }
      case 'jobLog':
        (state.logs.job[m.id] ||= []).push(m.line);
        if (state.tab === 'jobs' && state.jobId === m.id) appendLog(m.line);
        break;
      case 'jobProgress': {
        const job = state.jobs.find(j => j.id === m.id);
        if (job) { job.steps[m.step].progress = m.pct; scheduleActivity(); }
        break;
      }
      case 'service': {
        const { type, ...svc } = m;
        const i = state.services.findIndex(s => s.name === svc.name);
        if (i >= 0 && state.services[i].startedAt !== svc.startedAt) state.logs.svc[svc.name] = [];
        if (i >= 0) state.services[i] = svc; else state.services.push(svc);
        scheduleActivity();
        break;
      }
      case 'serviceLog':
        if (state.logs.svc[m.name]) state.logs.svc[m.name].push(m.line);
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
  await refreshStatus();
  connect();
  setInterval(() => { if (runningJob('backend') || runningJob('frontend') || state.jobs.some(j => j.status === 'running')) renderJobView(); }, 1000);
})();

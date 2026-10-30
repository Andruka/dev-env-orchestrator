/* ---------- стенды: подмена .env / config.js, пресеты, переменные для IDE ---------- */

// Репозитории, к которым применяется пресет: свой, а в других группах — единственный, выбранный или запущенный
function standProjects(p) {
  const map = {};
  for (const g of state.config.groups) {
    if (g.id === p.group) { map[g.id] = p.id; continue; }
    const sel = g.projects.find(x => x.id === state.sel);
    const alive = g.projects.filter(x => isAlive({ ...x, groupObj: g }));
    const pick = sel || (g.projects.length === 1 ? g.projects[0] : alive.length === 1 ? alive[0] : null);
    if (pick) map[g.id] = pick.id;
  }
  return map;
}

// Пресет «включён», если все его файлы для слотов этого репозитория уже лежат на месте
const standIsOn = (env, slots) => {
  const mine = Object.entries(env.picks).filter(([id]) => slots.some(s => s.id === id));
  return mine.length > 0 && mine.every(([id, rel]) => slots.find(s => s.id === id).active === rel);
};

function renderStands(p, st) {
  const slots = st.swaps || [];
  if (!slots.length) return '';
  const busy = runningJob(p.group);
  const envs = state.config.envs || [];
  const chips = envs.length ? `<div class="stand-chips" role="group" aria-label="Стенды">${envs.map(e => {
    const on = standIsOn(e, slots);
    return `<button type="button" class="chip ${on ? 'on' : ''}" ${busy ? 'disabled' : ''} aria-pressed="${on}" data-stand="${esc(e.id)}" data-project="${esc(p.id)}"
      title="${esc(e.note || Object.entries(e.picks).map(([k, v]) => `${k}: ${v}`).join('\n'))}">${on ? icon('check') : ''}${esc(e.title)}</button>`;
  }).join('')}</div>` : '';
  const rows = slots.map(s => {
    const open = s.variants.filter(v => v.vcs === 'open').map(v => v.rel);
    const state0 = !s.exists ? 'файла нет' : s.custom ? 'своё содержимое' : '';
    return `<div class="swap" data-key="swap-${esc(p.id)}-${esc(s.id)}">
      <span class="swap-label" title="${esc(s.target)}">${esc(s.title)}</span>
      <select class="swap-select" ${busy ? 'disabled' : ''} data-swap="${esc(s.id)}" data-project="${esc(p.id)}" aria-label="${esc(s.title)}">
        ${state0 ? `<option value="" selected disabled>— ${state0} —</option>` : ''}
        ${s.variants.some(v => v.lib) ? `<optgroup label="Хранятся в панели">${s.variants.filter(v => v.lib).map(v => `<option value="${esc(v.rel)}" ${v.active ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</optgroup>` : ''}
        ${s.variants.some(v => !v.lib) ? `<optgroup label="В репозитории">${s.variants.filter(v => !v.lib).map(v => `<option value="${esc(v.rel)}" ${v.active ? 'selected' : ''}>${esc(v.name)}${v.vcs === 'open' ? ' · не отслеживается git' : ''}</option>`).join('')}</optgroup>` : ''}
        ${s.variants.length ? '' : '<option value="" disabled selected>вариантов нет</option>'}
      </select>
      <span class="swap-tools">
        ${s.tracked ? `<span class="badge warn" title="${esc(s.target)} отслеживается git: смена стенда видна в git как изменённый файл. Панель ничего не коммитит — перед коммитом верните исходный.">${esc(s.target.split('/').pop())} отслеживается git</span>` : ''}
        ${open.length ? `<button type="button" class="ghost sm warn" data-swap-exclude="${esc(s.id)}" data-project="${esc(p.id)}" title="${esc(`Файлы ${open.join(', ')} не отслеживаются и не скрыты: git предложит добавить их в коммит, а в них пароли и ключи. Кнопка добавит их в .git/info/exclude — это локальный файл, он не попадает в репозиторий.`)}">${icon('eye-off')} Скрыть варианты от git (${open.length})</button>` : ''}
        ${s.custom ? `<button type="button" class="ghost sm" data-swap-saveas="${esc(s.id)}" data-project="${esc(p.id)}" title="Сохранить текущий файл в панели (вне репозитория), чтобы к нему можно было вернуться">${icon('save')} Сохранить в панель…</button>` : ''}
        ${s.kind === 'env' && s.exists ? `<button type="button" class="ghost sm" data-swap-ide="${esc(s.id)}" data-project="${esc(p.id)}" title="Переменные текущего окружения для запуска из IDE">${icon('terminal')} Для IDE</button>` : ''}
      </span>
    </div>`;
  }).join('');
  return `<div class="section"><div class="section-label">Стенд</div>
    <div class="swaps">${chips}${rows}</div></div>`;
}

function standNote(results, p) {
  const changed = results.filter(r => r.changed);
  if (!changed.length) return 'Уже стоит это окружение';
  const names = changed.map(r => r.project).filter((v, i, a) => a.indexOf(v) === i);
  const live = names.filter(n => {
    const proj = allProjects().find(x => x.name === n);
    return proj && isAlive(proj);
  });
  const back = changed.some(r => r.backup) ? ' Ваши ручные правки сохранены в бэкап.' : '';
  return `Окружение применено: ${names.join(', ')}.${live.length ? ` Запущено сейчас: ${live.join(', ')} — перезапустите, чтобы изменения вступили в силу.` : ''}${back}`;
}

async function applyStand(id, projectId) {
  const p = findProject(projectId);
  try {
    const r = await api('/api/env/preset', { id, projects: standProjects(p) });
    toast(standNote(r.results, p), 'ok');
    await refreshStatus();
    renderAll();
  } catch (e) { toast(e.message, 'err'); }
}

async function applySwap(slot, projectId, variant) {
  try {
    const r = await api('/api/env/apply', { project: projectId, slot, variant });
    toast(standNote([{ ...r, project: r.project }], findProject(projectId)), 'ok');
  } catch (e) { toast(e.message, 'err'); }
  await refreshStatus();
  renderAll();
}

async function showIde(projectId, slotId) {
  let out;
  try { out = await api(`/api/env/ide?project=${encodeURIComponent(projectId)}&slot=${encodeURIComponent(slotId)}`); } catch (e) { return toast(e.message, 'err'); }
  const p = findProject(projectId);
  openDialog({
    title: `Переменные для IDE · ${p.name}`, okLabel: 'Закрыть', getValue: () => true,
    html: `<p class="help" style="margin-bottom:10px">Текущее окружение (${out.count} переменных)${out.overrides.length ? `, с вашими заменами: <span class="mono">${esc(out.overrides.join(', '))}</span>` : ''}${out.stand ? `; переменные стенда «${esc(out.stand.title)}» (${out.stand.keys.length}) наложены поверх` : ''}.
      Вставьте в настройки запуска (Environment variables) или подключите файл плагином EnvFile — он обновляется при каждой смене окружения в панели.</p>
      <div class="field"><label for="ideLines">По одной на строку</label><textarea id="ideLines" rows="8" readonly spellcheck="false">${esc(out.lines)}</textarea></div>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" data-ide-copy="lines">${icon('copy')} Копировать строки</button>
        <button type="button" data-ide-copy="joined">${icon('copy')} В одну строку через «;»</button>
        <button type="button" data-ide-copy="file">${icon('copy')} Путь к файлу</button>
      </div>
      <p class="help mono" style="margin-top:10px;word-break:break-all">${esc(out.file)}</p>`,
    onOpen: () => {
      $('#dialogBody').onclick = async e => {
        const b = e.target.closest('[data-ide-copy]');
        if (!b) return;
        try { await navigator.clipboard.writeText(out[b.dataset.ideCopy]); toast('Скопировано', 'ok'); } catch { toast('Не удалось скопировать — выделите текст вручную', 'err'); }
      };
    },
  });
}

async function excludeSwap(projectId, slotId) {
  const slot = (projectStatus(projectId).swaps || []).find(x => x.id === slotId);
  const files = (slot?.variants || []).filter(v => v.vcs === 'open').map(v => v.rel);
  if (!files.length) return;
  if (!await confirmDialog(`Скрыть от git: ${files.join(', ')}?`, 'Файлы попадут в .git/info/exclude этого репозитория. Это локальный файл: он не коммитится и никуда не отправляется. Сами файлы не меняются.')) return;
  try {
    await api('/api/env/exclude', { project: projectId, slot: slotId, files });
    toast('Скрыто от git. В «git status» этих файлов больше не будет', 'ok');
    await refreshStatus();
    renderAll();
  } catch (e) { toast(e.message, 'err'); }
}

async function saveSwapAs(projectId, slotId) {
  const name = await promptText('Сохранить в панель', 'Имя варианта. Файл сохранится в папке панели, в репозитории ничего не появится', '', 'Сохранить');
  if (!name) return;
  try {
    const r = await api('/api/env/save-as', { project: projectId, slot: slotId, name });
    toast(`Сохранено в панели: ${r.file.slice(1)}`, 'ok');
    await refreshStatus();
    renderAll();
  } catch (e) { toast(e.message, 'err'); }
}

document.addEventListener('click', e => {
  const t = e.target;
  let el;
  if ((el = t.closest('[data-stand]'))) return applyStand(el.dataset.stand, el.dataset.project);
  if ((el = t.closest('[data-swap-exclude]'))) return excludeSwap(el.dataset.project, el.dataset.swapExclude);
  if ((el = t.closest('[data-swap-ide]'))) return showIde(el.dataset.project, el.dataset.swapIde);
  if ((el = t.closest('[data-swap-saveas]'))) return saveSwapAs(el.dataset.project, el.dataset.swapSaveas);
});

document.addEventListener('change', e => {
  const el = e.target.closest?.('[data-swap]');
  if (el && el.value) applySwap(el.dataset.swap, el.dataset.project, el.value);
});

/* ---------- настройки: раздел «Стенды» ---------- */

const KIND_SWAP = { env: '.env (KEY=VALUE, есть выгрузка для IDE)', js: 'js-конфиг', file: 'любой файл' };

const fileLabel = rel => (String(rel).startsWith('@') ? `«${rel.slice(1)}» (в панели)` : rel);

function swapSummary(env, m) {
  return Object.entries(env.picks).map(([id, rel]) => `${esc(m.swaps.find(s => s.id === id)?.title || id)}: <span class="mono">${esc(fileLabel(rel))}</span>`).join(' · ');
}

// Репозиторий группы, из которого берутся файлы: выбранный в форме, открытый в списке или единственный/запущенный
function standProject(group, d) {
  const g = state.config.groups.find(x => x.id === group);
  const list = g?.projects || [];
  return list.find(p => p.id === d.projects?.[group]) || list.find(p => p.id === state.sel)
    || list.find(p => isAlive({ ...p, groupObj: g })) || list[0] || null;
}

// Ошибки формы стенда: рядом с полем, с aria-invalid, а не только во всплывающем сообщении
const errOf = id => S.stand.errors?.[id];
const invalidAttr = id => (errOf(id) ? `aria-invalid="true" aria-describedby="err_${id}"` : '');
const errMsg = id => (errOf(id) ? `<span class="field-err" id="err_${id}" role="alert">${esc(errOf(id))}</span>` : '');

// Какому полю формы относится сообщение сервера
function standFieldFor(msg, m) {
  const d = S.stand;
  if (/Назовите стенд|названии/.test(msg)) return 'stTitle';
  if (/Страница фронтенда/.test(msg)) return 'stStart';
  if (/Адрес бэкенда|адрес стенда/i.test(msg)) return 'stOrigin';
  if (/IDE/.test(msg)) return 'stIde';
  if (/логин/i.test(msg)) return 'stLogin';
  if (/полный путь|не файл|больше 1 МБ|^[^:]+: файла /.test(msg)) {
    const id = Object.keys(d.sources).find(k => d.sources[k] === '::path');
    return id ? `stPath_${id}` : null;
  }
  const slot = m.swaps.find(x => msg.startsWith(`${x.title}:`));
  if (slot) return `stSrc_${slot.id}`;
  if (/Выберите хотя бы один файл/.test(msg)) return `stSrc_${m.swaps.find(x => x.enabled)?.id}`;
  return null;
}

function standEditor(m) {
  const d = S.stand;
  const slots = m.swaps.filter(s => s.enabled);
  const rows = slots.map(s => {
    const g = m.groups.find(x => x.id === s.group);
    const proj = standProject(s.group, d);
    const mine = ((proj && projectStatus(proj.id).swaps) || []).find(x => x.id === s.id);
    const vars = mine?.variants || [];
    const lib = [...new Set([...vars.filter(v => v.lib).map(v => v.rel), ...(m.swapFiles[s.id] || []).filter(f => f.startsWith('@'))])];
    const repo = vars.filter(v => !v.lib);
    const cur = d.sources[s.id] || '';
    const multi = (state.config.groups.find(x => x.id === s.group)?.projects.length || 0) > 1;
    const sid = `stSrc_${s.id}`, pid = `stPath_${s.id}`;
    return `<div class="stand-slot">
      <div class="field"><label for="${esc(sid)}">${esc(s.title)} <span class="tag">${esc(g?.title || s.group)}</span></label>
        <select id="${esc(sid)}" data-stand-src="${esc(s.id)}" ${invalidAttr(sid)}>
          <option value="">— не менять —</option>
          ${mine?.exists ? '<option value="::current"' + (cur === '::current' ? ' selected' : '') + '>Взять то, что лежит в репозитории сейчас</option>' : ''}
          <option value="::path" ${cur === '::path' ? 'selected' : ''}>Файл с диска (указать путь)…</option>
          ${lib.length ? `<optgroup label="Хранятся в панели">${lib.map(f => `<option value="${esc(f)}" ${cur === f ? 'selected' : ''}>${esc(f.slice(1))}</option>`).join('')}</optgroup>` : ''}
          ${repo.length ? `<optgroup label="Найдены в репозитории">${repo.map(v => `<option value="${esc(v.rel)}" ${cur === v.rel ? 'selected' : ''}>${esc(v.rel)}</option>`).join('')}</optgroup>` : ''}
        </select>${errMsg(sid)}</div>
      ${cur === '::path' ? `<div class="field"><label for="${esc(pid)}">Путь к файлу</label><input id="${esc(pid)}" class="mono" data-stand-path="${esc(s.id)}" value="${esc(d.paths[s.id] || '')}" placeholder="/home/user/secrets/.env_5008" spellcheck="false" autocomplete="off" ${invalidAttr(pid)}>${errMsg(pid)}</div>` : ''}
      ${multi && (cur === '::current' || (cur && !cur.startsWith('@') && cur !== '::path')) ? `<div class="field"><label for="stProj_${esc(s.group)}">Из репозитория</label>
        <select id="stProj_${esc(s.group)}" data-stand-proj="${esc(s.group)}">${state.config.groups.find(x => x.id === s.group).projects.map(p => `<option value="${esc(p.id)}" ${proj?.id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` : ''}
    </div>`;
  }).join('');

  // необязательное сворачиваем: открыто, если заполнено или есть ошибка
  const sec = (key, title, hint, filled, bad, body) => `<details class="sec" data-sec="${key}" ${(d.open?.[key] ?? filled) || bad ? 'open' : ''}>
    <summary>${title}<span class="help">${filled ? 'заполнено' : hint}</span></summary><div class="sec-body">${body}</div></details>`;

  return `<div class="card inset" id="standEditor">
    <div class="field"><label for="stTitle">Название стенда</label><input id="stTitle" value="${esc(d.title)}" placeholder="Например, 5008" autocomplete="off" ${invalidAttr('stTitle')}>${errMsg('stTitle')}</div>
    <div class="sec-title">Файлы</div>
    ${rows}
    <label class="check"><input type="checkbox" id="stCopy" ${d.copy ? 'checked' : ''}><span>Хранить файлы в панели<br><span class="help">Копии лягут в <span class="mono">~/.config/dev-panel/stands</span> (права 600). В репозитории ничего не создаётся и не меняется, а исходные файлы из репозитория потом можно удалить.</span></span></label>
    ${sec('login', 'Вход и адрес бэкенда', 'необязательно', Boolean(d.login || d.origin || d.hasPassword), errOf('stLogin') || errOf('stOrigin'), `
      <div class="row2 even"><div class="field"><label for="stLogin">Логин</label><input id="stLogin" value="${esc(d.login)}" autocomplete="off" ${invalidAttr('stLogin')}>${errMsg('stLogin')}</div>
        <div class="field"><label for="stPass">Пароль</label><input id="stPass" type="password" autocomplete="new-password" placeholder="${d.hasPassword ? '•••••• сохранён' : ''}"></div></div>
      <div class="field"><label for="stOrigin">Адрес бэкенда</label><input id="stOrigin" class="mono" value="${esc(d.origin || '')}" placeholder="определится по config.js или .env" spellcheck="false" autocomplete="off" ${invalidAttr('stOrigin')}>${errMsg('stOrigin')}
        <span class="help">Логин и пароль подставятся, когда фронтенд подключён к этому адресу. Без логина используются общие данные из «Общий вход» (вкладка рядом со списком стендов). Пароль: пусто — не менять.</span></div>`)}
    ${sec('start', 'Страница фронтенда', 'как в «Пути и порты»', Boolean(d.startUrl), errOf('stStart'), `
      <div class="field"><label for="stStart">Адрес страницы</label><input id="stStart" class="mono" value="${esc(d.startUrl || '')}" placeholder="http://localhost:3000/objects/1841/plans" spellcheck="false" autocomplete="off" ${invalidAttr('stStart')}>${errMsg('stStart')}
        <span class="help">Что открывают «Браузер» и «Запустить и войти» на этом стенде. Id объекта зависит от базы, поэтому на разных стендах он разный.</span></div>`)}
    ${sec('ide', 'Переменные для IDE', 'необязательно', Boolean((d.ide || '').trim()), errOf('stIde'), `
      <div class="field"><label for="stIde">Вставьте пачкой</label>
        <textarea id="stIde" rows="6" spellcheck="false" placeholder="CP_DB_HOST=localhost&#10;CP_REDIS_HOST=localhost&#10;или одной строкой: A=1;B=2" ${invalidAttr('stIde')}>${esc(d.ide || '')}</textarea>${errMsg('stIde')}
        <span class="help">Строки <span class="mono">KEY=VALUE</span>, целый <span class="mono">.env</span> или одна строка через «;». Накладываются на значения из <span class="mono">.env</span> в кнопке «Для IDE» и в файле для EnvFile, пока стенд включён. Хранятся в папке панели.</span></div>`)}
    <div class="field"><label for="stNote">Заметка (необязательно)</label><input id="stNote" value="${esc(d.note || '')}" autocomplete="off"></div>
    <div class="modal-actions"><span class="spacer"></span>
      <button type="button" class="ghost" data-stand-cancel>Отмена</button><button type="button" class="primary" data-stand-save>Сохранить стенд</button></div>
  </div>`;
}

function swapEditor(s, m) {
  const g = m.groups.find(x => x.id === s.group);
  const ov = Object.entries(s.ideOverrides || {}).map(([k, v]) => `${k}=${v}`).join('\n');
  return `<div class="card" data-swap-card="${esc(s.id)}">
    <div class="card-head"><h4>${esc(s.title)}</h4><span class="tag">${esc(g?.title || s.group)}</span>
      ${s.enabled ? '' : '<span class="tag miss">выключен</span>'}<span class="spacer"></span>
      <label class="check"><input type="checkbox" data-sw-enabled="${esc(s.id)}" ${s.enabled ? 'checked' : ''}> включён</label>
    </div>
    <div class="var-grid">
      <div class="field"><label for="sw_${esc(s.id)}_title">Название</label><input id="sw_${esc(s.id)}_title" value="${esc(s.title)}" autocomplete="off"></div>
      <div class="field"><label for="sw_${esc(s.id)}_target">Файл, который подменяется</label><input id="sw_${esc(s.id)}_target" value="${esc(s.target)}" spellcheck="false" autocomplete="off"><span class="help">Путь внутри репозитория.</span></div>
      <div class="field"><label for="sw_${esc(s.id)}_patterns">Где искать варианты</label><input id="sw_${esc(s.id)}_patterns" value="${esc((s.patterns || []).join(', '))}" spellcheck="false" autocomplete="off"><span class="help">Маски через запятую, <span class="mono">*</span> — любой текст. Сам подменяемый файл в варианты не попадает.</span></div>
      <div class="field"><label for="sw_${esc(s.id)}_kind">Тип файла</label><select id="sw_${esc(s.id)}_kind">${Object.entries(KIND_SWAP).map(([k, l]) => `<option value="${k}" ${s.kind === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    </div>
    ${s.kind === 'env' ? `<div class="field"><label for="sw_${esc(s.id)}_ide">Свои значения для IDE</label>
      <textarea id="sw_${esc(s.id)}_ide" rows="3" placeholder="CP_DB_HOST=localhost&#10;CP_REDIS_HOST=localhost" spellcheck="false">${esc(ov)}</textarea>
      <span class="help">Переменные, которые в IDE отличаются от файла (например, хосты docker-сервисов заменяются на localhost). Добавляются к выгрузке поверх значений из файла.</span></div>` : ''}
    <div class="modal-actions"><button type="button" class="ghost" data-sw-reset="${esc(s.id)}">${s.system ? 'Сбросить' : 'Удалить'}</button><span class="spacer"></span>
      <button type="button" class="primary" data-sw-save="${esc(s.id)}">Сохранить</button></div>
  </div>`;
}

function newSwapEditor(m) {
  return `<div class="card inset" id="newSwap">
    <div class="var-grid">
      <div class="field"><label for="nsGroup">Группа репозиториев</label><select id="nsGroup">${m.groups.map(g => `<option value="${esc(g.id)}">${esc(g.title)}</option>`).join('')}</select></div>
      <div class="field"><label for="nsTitle">Название</label><input id="nsTitle" placeholder="Например, appsettings" autocomplete="off"></div>
      <div class="field"><label for="nsTarget">Файл, который подменяется</label><input id="nsTarget" placeholder="config/app.json" spellcheck="false" autocomplete="off"></div>
      <div class="field"><label for="nsPatterns">Где искать варианты</label><input id="nsPatterns" placeholder="config/app.*.json" spellcheck="false" autocomplete="off"></div>
    </div>
    <div class="modal-actions"><span class="spacer"></span><button type="button" class="ghost" data-ns-cancel>Отмена</button><button type="button" class="primary" data-ns-save>Добавить</button></div>
  </div>`;
}

function standsPane() {
  const m = S.model;
  S.stand ||= null;
  const creds = o => m.standCreds.find(c => c.origin === o);
  const list = m.envs.map(e => {
    const c = e.origin && creds(e.origin);
    return `<div class="list-row">
      ${icon('server')}<div class="grow"><span class="name">${esc(e.title)}</span>
        <span class="sub">${swapSummary(e, m) || '—'}</span>
        <span class="sub">${e.origin ? `<span class="mono">${esc(e.origin)}</span> · ` : ''}${c ? `логин ${esc(c.login)}` : 'общий логин'}${e.ide ? ' · есть переменные для IDE' : ''}${e.startUrl ? ` · <span class="mono">${esc(e.startUrl.replace(/^https?:\/\/[^/]+/, ''))}</span>` : ''}${e.note ? ` · ${esc(e.note)}` : ''}</span></div>
      <div class="row-actions"><button type="button" class="ghost sm" data-stand-edit="${esc(e.id)}">${icon('pencil')} Изменить</button>
      <button type="button" class="ghost sm danger-ghost" data-stand-del="${esc(e.id)}" aria-label="Удалить стенд ${esc(e.title)}">${icon('trash-2')}</button></div></div>`;
  }).join('');
  return `<h2 class="pane-title">Стенды</h2>
    <p class="pane-lead">Стенд — это окружение, к которому подключена ветка: <span class="mono">.env</span> бэкенда, <span class="mono">config.js</span> фронтенда и логин с паролем. Создайте стенд один раз, а потом переключайте его одной кнопкой в карточке репозитория.
    Файлы стенда можно хранить в панели, вне репозитория: в git они не попадут.</p>
    <div class="card">
      <div class="card-head"><h4>Мои стенды</h4><span class="spacer"></span><button type="button" class="sm" data-stand-new ${S.stand ? 'disabled' : ''}>${icon('plus')} Новый стенд</button></div>
      <div class="list">${list || '<div class="list-empty">Пока нет. Настройте репозитории так, как нужно для стенда (или выберите готовые файлы), и нажмите «Новый стенд».</div>'}</div>
      ${S.stand ? standEditor(m) : ''}
    </div>
    <details class="adv" ${S.advOpen ? 'open' : ''}><summary>Дополнительно: какие файлы подменяются</summary>
    ${m.swaps.map(s => swapEditor(s, m)).join('')}
    ${S.newSwap ? newSwapEditor(m) : `<button type="button" data-ns-new>${icon('plus')} Добавить файл…</button>`}
    </details>
    <div class="note" style="margin-top:14px">Вход во фронтенд следует за стендом: адрес логина берётся из <span class="mono">BACKEND_URL</span> активного config.js (переключатель — «Пути и порты → Фронтенд и браузер»).
      Перед перезаписью файла с вашими ручными правками копия сохраняется в <span class="mono">~/.local/state/dev-panel/swap-backups</span> (последние 10).</div>`;
}

function blankStand() {
  const sources = {};
  for (const s of S.model.swaps.filter(x => x.enabled)) {
    const proj = standProject(s.group, {});
    if ((proj && projectStatus(proj.id).swaps || []).find(x => x.id === s.id)?.exists) sources[s.id] = '::current';
  }
  return { id: null, title: '', note: '', origin: '', login: '', hasPassword: false, copy: true, ide: '', startUrl: '', sources, paths: {}, projects: {}, open: {}, errors: {} };
}

// Слепок введённого: по нему видно, есть ли несохранённые изменения
const standSnap = d => JSON.stringify([d.title, d.note, d.origin, d.login, Boolean(d.password), d.startUrl, d.ide, d.copy, d.sources, d.paths]);
const openStand = d => { d.base = standSnap(d); S.stand = d; };
function standDirty() {
  if (!S.stand) return false;
  syncStand();
  return standSnap(S.stand) !== S.stand.base;
}
window.standDirty = standDirty;

const val = id => document.getElementById(id)?.value ?? '';

// Возвращает промис, если клик относится к этому разделу
function standsClick(q) {
  let el;
  if (q('[data-stand-new]')) { openStand(blankStand()); return renderSettings(); }
  if ((el = q('[data-stand-edit]'))) {
    const e = S.model.envs.find(x => x.id === el.dataset.standEdit);
    const c = e.origin && S.model.standCreds.find(x => x.origin === e.origin);
    return (e.ide ? api(`/api/stands/ide?id=${encodeURIComponent(e.id)}`).catch(() => ({ text: '' })) : Promise.resolve({ text: '' })).then(r => {
      openStand({ ...blankStand(), id: e.id, title: e.title, note: e.note || '', origin: e.origin || '', login: c?.login || '', hasPassword: Boolean(c?.hasPassword), sources: { ...e.picks }, ide: r.text, startUrl: e.startUrl || '' });
      renderSettings();
    });
  }
  if (q('[data-stand-cancel]')) { S.stand = null; return renderSettings(); }
  if (q('[data-stand-save]')) {
    syncStand();
    const d = S.stand, projects = {};
    for (const g of state.config.groups) { const p = standProject(g.id, d); if (p) projects[g.id] = p.id; }
    const body = { id: d.id, title: d.title, note: d.note, origin: d.origin, login: d.login, password: d.password, copy: d.copy, ide: d.ide ?? '', startUrl: d.startUrl ?? '', sources: d.sources, paths: d.paths, projects };
    d.errors = {};
    return api('/api/stands/save', body).then(async () => {
      toast('Стенд сохранён', 'ok');
      S.stand = null;
      await reloadConfig();
    }).catch(err => {
      const field = standFieldFor(err.message, S.model);
      if (!field) return toast(err.message, 'err');
      d.errors[field] = err.message;
      renderSettings();
      document.getElementById(field)?.focus();
    });
  }
  if ((el = q('[data-stand-del]'))) {
    return confirmDialog('Удалить стенд', 'Исчезнут стенд, его файлы в панели и сохранённые для него логин с паролем. Файлы в репозиториях не затрагиваются.', true, 'Удалить')
      .then(ok => ok && change('/api/stands/delete', { id: el.dataset.standDel }));
  }
  if ((el = q('[data-sw-save]'))) {
    const id = el.dataset.swSave;
    const body = { id, title: val(`sw_${id}_title`), target: val(`sw_${id}_target`), patterns: val(`sw_${id}_patterns`), kind: val(`sw_${id}_kind`) };
    if (document.getElementById(`sw_${id}_ide`)) body.ideOverrides = val(`sw_${id}_ide`);
    return change('/api/swaps/save', body, 'Сохранено');
  }
  if ((el = q('[data-sw-reset]'))) {
    const s = S.model.swaps.find(x => x.id === el.dataset.swReset);
    return confirmDialog(s.system ? 'Сбросить слот' : 'Удалить слот', s.system ? 'Файл, маски и значения для IDE вернутся к исходным.' : 'Подмена этого файла исчезнет из панели; сами файлы не затрагиваются.', !s.system, s.system ? 'Сбросить' : 'Удалить')
      .then(ok => ok && change('/api/swaps/reset', { id: s.id }));
  }
  if (q('[data-ns-new]')) { S.newSwap = true; return renderSettings(); }
  if (q('[data-ns-cancel]')) { S.newSwap = false; return renderSettings(); }
  if (q('[data-ns-save]')) {
    const body = { group: val('nsGroup'), title: val('nsTitle'), target: val('nsTarget'), patterns: val('nsPatterns'), kind: /(^|\/)\.env/.test(val('nsTarget')) ? 'env' : 'file' };
    return change('/api/swaps/save', body, 'Файл добавлен').then(ok => { if (ok) { S.newSwap = false; renderSettings(); } });
  }
  return null;
}

function syncStand() {
  const d = S.stand;
  if (!d || !document.getElementById('stTitle')) return;
  d.title = val('stTitle'); d.note = val('stNote'); d.login = val('stLogin'); d.password = val('stPass'); d.origin = val('stOrigin');
  d.copy = document.getElementById('stCopy').checked;
  d.ide = val('stIde'); d.startUrl = val('stStart');
  for (const sel of document.querySelectorAll('[data-stand-src]')) {
    if (sel.value) d.sources[sel.dataset.standSrc] = sel.value; else delete d.sources[sel.dataset.standSrc];
  }
  for (const i of document.querySelectorAll('[data-stand-path]')) d.paths[i.dataset.standPath] = i.value;
  for (const sel of document.querySelectorAll('[data-stand-proj]')) d.projects[sel.dataset.standProj] = sel.value;
  for (const det of document.querySelectorAll('#standEditor details[data-sec]')) (d.open ||= {})[det.dataset.sec] = det.open;
}

// Как только поле правят, его ошибка исчезает
document.addEventListener('input', e => {
  const id = e.target.id;
  if (!S.stand?.errors?.[id]) return;
  delete S.stand.errors[id];
  e.target.removeAttribute('aria-invalid');
  e.target.removeAttribute('aria-describedby');
  document.getElementById(`err_${id}`)?.remove();
});

function standsChange(e) {
  const t = e.target;
  if (t.dataset?.swEnabled) return change('/api/swaps/save', { id: t.dataset.swEnabled, enabled: t.checked });
  if (t.dataset?.standSrc || t.dataset?.standProj) { syncStand(); return renderSettings(); }
  return null;
}

/* ---------- переключатель стенда в шапке ---------- */

// Стенд «включён», если все его файлы для слотов выбранного репозитория (и репозиториев из других групп) уже лежат на месте
function standActive(env) {
  const entries = Object.entries(env.picks || {});
  const p = findProject(state.sel) || allProjects()[0];
  if (!entries.length || !p) return false;
  const slots = Object.values(standProjects(p)).flatMap(id => projectStatus(id).swaps || []);
  const mine = entries.filter(([id]) => slots.some(s => s.id === id));
  return mine.length > 0 && mine.every(([id, rel]) => slots.find(s => s.id === id).active === rel);
}

function closeStandMenu() {
  document.querySelector('.pop-menu')?.remove();
  document.querySelector('[data-stand-menu]')?.setAttribute('aria-expanded', 'false');
}

function toggleStandMenu(anchor) {
  if (document.querySelector('.pop-menu')) return closeStandMenu();
  const p = findProject(state.sel) || allProjects()[0];
  const busy = p && runningJob(p.group);
  const menu = document.createElement('div');
  menu.className = 'pop-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Стенд');
  menu.innerHTML = `${(state.config.envs || []).map(e => {
    const on = standActive(e);
    return `<button type="button" role="menuitemradio" aria-checked="${on}" ${busy ? 'disabled' : ''} data-stand-pick="${esc(e.id)}" title="${esc(e.note || '')}">
      <span class="chk">${on ? icon('check') : ''}</span>${esc(e.title)}${e.origin ? `<span class="sub mono">${esc(e.origin.replace(/^https?:\/\//, ''))}</span>` : ''}</button>`;
  }).join('')}${busy ? `<div class="pop-note">Занято: выполняется «${esc(busy.title)}»</div>` : ''}
    <hr><button type="button" role="menuitem" data-open-settings="stands">${icon('settings')}Настроить стенды…</button>`;
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 320))}px`;
  document.body.appendChild(menu);
  anchor.setAttribute('aria-expanded', 'true');
  const items = () => [...menu.querySelectorAll('button:not(:disabled)')];
  (menu.querySelector('[aria-checked="true"]:not(:disabled)') || items()[0])?.focus();
  menu.onclick = async e => {
    const b = e.target.closest('[data-stand-pick]');
    if (b) { closeStandMenu(); await applyStand(b.dataset.standPick, p.id); anchor.focus?.(); }
  };
  menu.onkeydown = e => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Tab') closeStandMenu();
  };
}

/* ---------- «Обслуживание»: проверка, место на диске, журнал, обновления и профиль ---------- */

const MAINT_SUBS = [['check', 'stethoscope', 'Проверка'], ['disk', 'hard-drive', 'Место на диске'], ['journal', 'history', 'Журнал'], ['about', 'info', 'Обновления и профиль']];
const maint = { disk: null, journal: null, update: null, jFilter: 'all', busy: false };

function maintPane() {
  const sub = S.maintSub || 'check';
  const seg = `<div class="seg" role="group" aria-label="Раздел обслуживания">${MAINT_SUBS.map(([id, ic, label]) =>
    `<button type="button" data-maint-sub="${id}" aria-pressed="${sub === id}">${icon(ic)} ${label}</button>`).join('')}</div>`;
  const body = sub === 'disk' ? diskPane() : sub === 'journal' ? journalPane() : sub === 'about' ? aboutPane() : doctorPane();
  return seg + body;
}

async function loadMaint(sub) {
  try {
    if (sub === 'disk') maint.disk = await api('/api/cleanup');
    else if (sub === 'journal') maint.journal = await api('/api/journal?limit=300');
    else if (sub === 'about') maint.update = await api('/api/update');
  } catch (e) { toast(e.message, 'err'); }
  if (S.tab === 'doctor' && (S.maintSub || 'check') === sub && $('#settings').open) renderSettings();
}

/* --- место на диске --- */

function diskPane() {
  const d = maint.disk;
  if (!d) return `<h2 class="pane-title">Место на диске</h2><div class="note">Считаю…</div>`;
  const row = (title, sub, size, btn) => `<div class="list-row"><div class="grow"><span class="name">${esc(title)}</span><span class="sub">${sub}</span></div>
    <span class="mono" style="color:var(--dim)">${size != null ? fmtSize(size) : ''}</span>${btn || ''}</div>`;
  const cl = (what, label, danger = true, arg = '') => `<button type="button" class="sm ${danger ? 'danger' : ''}" data-cl="${what}" ${arg ? `data-arg="${esc(arg)}"` : ''} ${maint.busy ? 'disabled' : ''}>${label}</button>`;
  const dock = d.docker;
  const dRow = (key, title, hint, what) => dock?.[key] ? row(title, `${hint}${dock[key].text ? ` · можно освободить ${esc(dock[key].text)}` : ''}`, dock[key].size, what ? cl(what, 'Очистить') : '') : '';
  return `<h2 class="pane-title">Место на диске</h2>
    <p class="pane-lead">Что занимает место и что можно удалить. Ничего не удаляется само: каждое действие просит подтверждение.${d.free != null ? ` Свободно на диске со снимками: <b>${fmtSize(d.free)}</b>.` : ''}</p>
    <div class="sec-title">Снимки БД</div>
    <div class="list">${row(`Снимки (${d.snapshots.count})`, `<span class="mono">${esc(d.snapshots.dir)}</span> · хранить свежих ${d.snapshots.keep.fresh}, дампов ${d.snapshots.keep.dump} (меняется в «Пути и порты»)`, d.snapshots.size,
    d.snapshots.excess.count ? cl('snapshotsPrune', `Удалить лишние (${d.snapshots.excess.count} · ${fmtSize(d.snapshots.excess.size)})`) : '<span class="help">лишних нет</span>')}</div>
    <div class="sec-title">Дампы</div>
    <div class="list">${d.dumps.items.length ? d.dumps.items.map(f => row(f.name, `изменён ${new Date(f.mtime).toLocaleDateString('ru-RU')}`, f.size, cl('dumpDelete', icon('trash-2'), true, f.name))).join('')
    : '<div class="list-empty">В папке дампов ничего нет</div>'}</div>
    <p class="help">Папка: <span class="mono">${esc(d.dumps.dir || '—')}</span>. Дамп удаляется безвозвратно — убедитесь, что он есть у коллег или на сервере.</p>
    <div class="sec-title">Docker</div>
    <div class="list">${dock ? `${dRow('Images', 'Образы', 'Неиспользуемые образы без тега удаляются, нужные остаются', 'dockerImages')}${dRow('Build Cache', 'Кэш сборки', 'Пересоберётся при следующей сборке', 'dockerBuildCache')}${dRow('Containers', 'Контейнеры', 'Остановленные контейнеры не удаляются отсюда')}${dRow('Local Volumes', 'Тома', 'Данные БД лежат в папке, а не в томе')}` : '<div class="list-empty">Docker недоступен</div>'}</div>
    <div class="sec-title">Прочее</div>
    <div class="list">${row('Резервные копии файлов окружения', 'Копии ваших ручных правок перед подменой .env и config.js', d.backups.size, d.backups.size ? cl('swapBackups', 'Удалить') : '')}</div>`;
}

/* --- журнал --- */

const J_ICON = { job: 'play', stand: 'server', port: 'zap', cleanup: 'hard-drive', update: 'arrow-down-to-line' };
const J_LABEL = { all: 'Все', job: 'Задачи', stand: 'Стенды', other: 'Прочее' };

function journalPane() {
  const rows = maint.journal;
  if (!rows) return `<h2 class="pane-title">Журнал</h2><div class="note">Загружаю…</div>`;
  const f = maint.jFilter;
  const shown = rows.filter(r => f === 'all' || (f === 'other' ? !['job', 'stand'].includes(r.type) : r.type === f));
  return `<h2 class="pane-title">Журнал действий</h2>
    <p class="pane-lead">Что и когда делалось в панели: выполненные задачи, смена стенда, освобождение портов, очистка диска и обновления. Пароли и значения переменных сюда не попадают. Файл: <span class="mono">~/.local/state/dev-panel/journal.jsonl</span>.</p>
    <div class="seg" role="group" aria-label="Фильтр журнала">${Object.entries(J_LABEL).map(([v, l]) => `<button type="button" data-jfilter="${v}" aria-pressed="${f === v}">${l}</button>`).join('')}</div>
    <div class="list journal">${shown.length ? shown.map(r => {
    const bad = r.data?.status === 'failed';
    return `<div class="list-row jr ${bad ? 'bad' : ''}">${icon(J_ICON[r.type] || 'info')}<div class="grow"><span class="name">${esc(r.title)}</span>${r.data?.error ? `<span class="sub">${esc(r.data.error)}</span>` : r.data?.projects ? `<span class="sub">${esc(r.data.projects)}</span>` : ''}</div>
      <span class="mono jr-time">${esc(fmtWhen(r.t))}</span></div>`;
  }).join('') : '<div class="list-empty">Записей пока нет</div>'}</div>`;
}

/* --- обновления, версия, профиль --- */

function aboutPane() {
  const u = maint.update || health.update;
  const status = !u ? 'Проверяю…' : !u.git ? esc(u.note) : u.error ? esc(u.error) : u.dirty ? 'В папке панели есть ваши правки — автообновление отключено, чтобы их не потерять.'
    : u.behind ? `Доступно обновление: новых коммитов ${u.behind}.` : u.note ? esc(u.note) : 'Установлена последняя версия.';
  const log = u?.changelog || [];
  return `<h2 class="pane-title">Обновления и профиль</h2>
    <div class="card"><div class="card-head"><h4>Dev Panel ${esc(state.config.version)}</h4><span class="spacer"></span>
      <button type="button" class="sm" data-maint-check>${icon('refresh-cw')} Проверить сейчас</button>
      ${u?.git && u.behind && !u.dirty ? `<button type="button" class="sm primary" data-update-apply>${icon('arrow-down-to-line')} Обновить</button>` : ''}</div>
      <p class="help" style="margin:0">${status}${u?.git && u.branch ? ` Ветка <span class="mono">${esc(u.branch)}</span>, коммит <span class="mono">${esc(u.commit)}</span>.` : ''}</p>
      ${u?.subjects?.length ? `<ul class="whatsnew" style="margin-top:8px">${u.subjects.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}</div>
    <div class="sec-title">Что нового</div>
    ${log.length ? log.map(v => `<div class="card inset"><div class="card-head"><h4>${esc(v.version)}</h4><span class="help">${esc(v.date)}</span></div><ul class="whatsnew">${v.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('') : '<p class="help">Список изменений недоступен.</p>'}
    <div class="sec-title">Профиль для коллег</div>
    <p class="help" style="margin-top:0">Кнопки, группы, стенды (названия, адреса, какие файлы), оформление и необязательные настройки — одним файлом. <b>Без</b> путей на вашем диске, паролей, переменных IDE и самих файлов стендов (в них ключи): их коллега добавит у себя. Импорт не перезаписывает его пути, пароли и уже существующие стенды.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" data-profile-export>${icon('download')} Экспорт профиля</button>
      <button type="button" data-profile-import>${icon('upload')} Импорт профиля…</button>
      <input type="file" id="profileFile" accept="application/json,.json" hidden>
    </div>`;
}

async function exportProfile() {
  try {
    const data = await api('/api/profile');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `dev-panel-profile-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Профиль сохранён (без паролей и путей)', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function importProfile(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!(await confirmDialog('Импорт профиля', `Из файла будут добавлены кнопки, группы и стенды (существующие стенды не меняются). Ваши пути, пароли и репозитории останутся. Добавить?`, false, 'Добавить'))) return;
    const r = await api('/api/profile', data);
    toast(`Добавлено: кнопок ${r.added.actions}, групп ${r.added.groups}, стендов ${r.added.envs}${r.added.skippedEnvs ? ` (пропущено существующих: ${r.added.skippedEnvs})` : ''}. Файлы стендов добавьте в «Стенды».`, 'ok');
    await reloadConfig();
  } catch (e) { toast(`Не удалось: ${e.message}`, 'err'); }
  $('#profileFile') && ($('#profileFile').value = '');
}

/* --- обработчики --- */

document.addEventListener('click', async e => {
  const t = e.target;
  if (!t.closest('#settings')) return;
  let el;
  if ((el = t.closest('[data-maint-sub]'))) {
    S.maintSub = el.dataset.maintSub;
    renderSettings();
    if (S.maintSub === 'check' && !S.doctor) runDoctor(); else loadMaint(S.maintSub);
    return;
  }
  if ((el = t.closest('[data-jfilter]'))) { maint.jFilter = el.dataset.jfilter; return renderSettings(); }
  if (t.closest('[data-maint-check]')) { maint.update = null; renderSettings(); const u = await checkUpdate(true); maint.update = u; return renderSettings(); }
  if (t.closest('[data-profile-export]')) return exportProfile();
  if (t.closest('[data-profile-import]')) return $('#profileFile').click();
  if ((el = t.closest('[data-cl]'))) {
    const what = el.dataset.cl, arg = el.dataset.arg || '';
    const text = {
      snapshotsPrune: 'Будут удалены снимки БД сверх лимита (самые старые). Ручные снимки не затрагиваются.',
      dumpDelete: `Дамп «${arg}» будет удалён безвозвратно.`,
      dockerImages: 'Будут удалены неиспользуемые образы docker без тега (docker image prune).',
      dockerBuildCache: 'Будет очищен кэш сборки docker (docker builder prune): следующая сборка будет дольше.',
      swapBackups: 'Копии ваших ручных правок файлов окружения будут удалены.',
    }[what];
    if (!(await confirmDialog('Освободить место', text, true, 'Удалить'))) return;
    maint.busy = true; renderSettings();
    try { const r = await api('/api/cleanup', { what, arg }); toast(r.note || 'Готово', 'ok'); } catch (err) { toast(err.message, 'err'); }
    maint.busy = false;
    await loadMaint('disk');
  }
});

document.addEventListener('change', e => { if (e.target.id === 'profileFile') importProfile(e.target.files[0]); });

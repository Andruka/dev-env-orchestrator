/* ---------- самодиагностика, обновления, подсказки по ошибкам, исправление стенда ---------- */

const health = { fails: [], update: null, dismissed: new Set(), whatsNew: null };

// Баннеры под шапкой: проблемы окружения и доступное обновление панели
function renderBanners() {
  const el = $('#banners');
  if (!el) return;
  const out = [];
  if (health.fails.length && !health.dismissed.has('health')) {
    const names = health.fails.slice(0, 3).map(i => i.title).join(', ');
    out.push(`<div class="banner err" role="alert">${icon('triangle-alert')}<span><b>Окружение не готово:</b> ${esc(names)}${health.fails.length > 3 ? ` и ещё ${health.fails.length - 3}` : ''}</span><span class="spacer"></span>
      <button class="sm" data-open-settings="doctor">Открыть проверку</button><button class="ghost sm" data-banner-close="health" aria-label="Скрыть">${icon('x')}</button></div>`);
  }
  const u = health.update;
  if (u?.git && u.behind > 0 && !u.dirty && !health.dismissed.has('update')) {
    out.push(`<div class="banner" role="status">${icon('arrow-down-to-line')}<span><b>Есть обновление Dev Panel:</b> новых коммитов ${u.behind}${u.subjects?.[0] ? ` — «${esc(u.subjects[0])}»` : ''}</span><span class="spacer"></span>
      <button class="sm primary" data-update-apply>Обновить</button><button class="sm" data-open-settings="doctor" data-sub="about">Подробнее</button><button class="ghost sm" data-banner-close="update" aria-label="Скрыть">${icon('x')}</button></div>`);
  }
  setHtml(el, out.join(''));
}

async function checkHealth() {
  try {
    const items = await api('/api/doctor');
    health.fails = items.filter(i => i.status === 'fail');
    health.items = items;
  } catch { /* сервер перезапускается */ }
  renderBanners();
}

async function checkUpdate(fresh = false) {
  try { health.update = await api(`/api/update${fresh ? '?fresh=1' : ''}`); } catch { /* нет сети — не страшно */ }
  renderBanners();
  return health.update;
}

async function applyUpdate() {
  const u = health.update;
  if (!(await confirmDialog('Обновить Dev Panel', `Будет выполнен git pull (только fast-forward, без merge) и перезапуск панели. Новых коммитов: ${u?.behind ?? '?'}. Запущенные docker и npm start не остановятся; страница перезагрузится сама.`, false, 'Обновить и перезапустить'))) return;
  let r;
  try { r = await api('/api/update/apply', {}); } catch (e) { return toast(e.message, 'err'); }
  if (!r.updated) { toast(r.note || 'Уже последняя версия', 'ok'); return checkUpdate(true); }
  const veil = document.createElement('div');
  veil.className = 'veil';
  veil.innerHTML = `<div class="veil-box"><span class="spin">${icon('loader')}</span> Обновлено ${esc(r.from)} → ${esc(r.to)}. Перезапускаю панель…</div>`;
  document.body.appendChild(veil);
  let down = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(res => setTimeout(res, 1000));
    try { await fetch('/api/config'); if (down) break; } catch { down = true; }
    if (i > 6 && !down && !r.restarting) break;
  }
  location.reload();
}

// «Что нового» после обновления панели
async function maybeWhatsNew() {
  const v = state.config.version;
  const seen = store.get('seenVersion', null);
  store.set('seenVersion', v);
  if (!seen || seen === v) return;
  let log = [];
  try { log = (await api('/api/update')).changelog || []; } catch { /* без списка */ }
  const entry = log.find(x => x.version === v);
  if (!entry) return;
  openDialog({
    title: `Dev Panel обновлена до ${v}`, okLabel: 'Понятно', getValue: () => true,
    html: `<p class="help" style="margin-bottom:8px">Что нового (было ${esc(seen)}):</p><ul class="whatsnew">${entry.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`,
  });
}

/* ---------- подсказки в ошибках задач ---------- */

function hintHtml(h) {
  const f = h.fix;
  const btn = !f ? '' : f.kind === 'port' ? `<button class="sm" data-hint-port="${f.port}">Кто занимает порт ${f.port}?</button>`
    : f.kind === 'tab' ? `<button class="sm" data-open-settings="${esc(f.tab)}" ${f.sub ? `data-sub="${esc(f.sub)}"` : ''}>Открыть настройки</button>`
      : f.kind === 'copy' ? `<code class="mono">${esc(f.text)}</code><button class="sm" data-hint-copy="${esc(f.text)}">${icon('copy')} Копировать</button>` : '';
  return `<div class="hint-box">${icon('info')}<div><b>${esc(h.title)}</b><p>${esc(h.text)}</p>${btn ? `<div class="hint-fix">${btn}</div>` : ''}</div></div>`;
}

async function showPort(port) {
  let i;
  try { i = await api(`/api/port?port=${port}`); } catch (e) { return toast(e.message, 'err'); }
  if (!i.busy) return toast(`Порт ${port} уже свободен — повторите запуск`, 'ok');
  const who = i.container ? `контейнер docker «${i.container}»` : i.process ? `процесс ${i.process} (pid ${i.pid})` : 'процесс, который панель не видит (чужой или системный)';
  if (!i.canFree) { await openDialog({ title: `Порт ${port} занят`, okLabel: 'Понятно', getValue: () => true, html: `<p>Занят: ${esc(who)}. Освободите его вручную: <span class="mono">sudo ss -ltnp 'sport = :${port}'</span></p>` }); return; }
  if (!(await confirmDialog(`Освободить порт ${port}`, `Занят: ${who}. ${i.container ? 'Контейнер будет остановлен (данные в томах и папках сохранятся).' : 'Процесс получит сигнал завершения (SIGTERM).'} Продолжить?`, true, 'Освободить'))) return;
  try { const r = await api('/api/port/free', { port }); toast(r.note || 'Порт освобождён', 'ok'); await refreshStatus(); } catch (e) { toast(e.message, 'err'); }
}

/* ---------- несовпадение стенда: исправление в один шаг ---------- */

const hostPortOf = url => { try { const u = new URL(url); return `${u.hostname}:${u.port || (u.protocol === 'https:' ? 443 : 80)}`; } catch { return null; } };

async function standFix() {
  const sc = state.status?.stand;
  const bad = sc?.mismatch?.[0];
  if (!bad) return;
  const front = sc.frontTitle || sc.front, back = bad.standTitle || bad.stand;
  const backEnv = (state.config.envs || []).find(e => e.origin && hostPortOf(e.origin) === bad.stand);
  const backend = allProjects().find(p => p.groupObj.kind === 'compose');
  const envSlot = backend && (projectStatus(backend.id).swaps || []).find(s => s.kind === 'env' && s.exists);
  let pick = null;
  await openDialog({
    title: 'Стенды фронтенда и бэкенда не совпадают', okLabel: 'Закрыть', getValue: () => 'close',
    html: `<p>Фронтенд и вход идут на стенд <b>${esc(front)}</b>, а бэкенд на <span class="mono">:${bad.port}</span> (${esc(bad.process || 'процесс')}) запущен с окружением <b>${esc(back)}</b>. Токен стенда ${esc(front)} такой бэкенд не примет — запросы получат 401.</p>
      <div class="fix-list">
        ${backEnv ? `<button type="button" data-fix="switch">${icon('server')}<span><b>Переключить фронтенд и вход на ${esc(back)}</b><small>Подходит, если бэкенд так и должен работать</small></span></button>` : ''}
        ${envSlot ? `<button type="button" data-fix="ide">${icon('terminal')}<span><b>Показать переменные для IDE стенда ${esc(front)}</b><small>Вставьте их в запуск бэкенда и перезапустите его</small></span></button>` : ''}
        <button type="button" data-fix="kill" class="danger">${icon('square')}<span><b>Остановить процесс на :${bad.port}</b><small>${esc(bad.process || 'процесс')} получит SIGTERM; потом запустите бэкенд с нужным окружением</small></span></button>
      </div>`,
    onOpen: () => {
      $('#dialogBody').onclick = e => {
        const b = e.target.closest('[data-fix]');
        if (!b) return;
        pick = b.dataset.fix;
        $('#dialog').close('ok');
      };
    },
  });
  if (!pick) return;
  if (pick === 'switch' && backEnv) { const p = findProject(state.sel) || allProjects()[0]; return applyStand(backEnv.id, p.id); }
  if (pick === 'ide') return showIde(backend.id, envSlot.id);
  if (pick === 'kill') return showPort(bad.port);
}

/* ---------- проверка стенда ---------- */

async function testStand(id, btn) {
  btn.disabled = true;
  const prev = btn.innerHTML;
  btn.innerHTML = `<span class="spin">${icon('loader')}</span> Проверяю…`;
  try {
    const r = await api('/api/stands/test', { id });
    await openDialog({
      title: `Проверка стенда «${r.title}»`, okLabel: 'Закрыть', getValue: () => true,
      html: `<p class="mono" style="margin-bottom:10px">${esc(r.origin)}</p><div class="list">${r.steps.map(s => `<div class="doc-row ${s.ok ? 'ok' : 'fail'}">${icon(s.ok ? 'circle-check' : 'circle-x')}<div><div class="t">${esc(s.title)}</div><div class="d">${esc(s.detail || '')}</div></div></div>`).join('')}</div>
        <div class="note ${r.ok ? 'ok' : 'err'}" style="margin-top:12px">${r.ok ? 'Стенд доступен, вход работает.' : 'Есть проблема — см. красный пункт выше.'}</div>`,
    });
  } catch (e) { toast(e.message, 'err'); }
  btn.disabled = false;
  btn.innerHTML = prev;
}

document.addEventListener('click', async e => {
  const t = e.target;
  let el;
  if ((el = t.closest('[data-banner-close]'))) { health.dismissed.add(el.dataset.bannerClose); return renderBanners(); }
  if (t.closest('[data-update-apply]')) return applyUpdate();
  if ((el = t.closest('[data-hint-port]'))) return showPort(Number(el.dataset.hintPort));
  if ((el = t.closest('[data-hint-copy]'))) { try { await navigator.clipboard.writeText(el.dataset.hintCopy); toast('Команда скопирована', 'ok'); } catch { toast('Не удалось скопировать — выделите текст вручную', 'err'); } return; }
  if (t.closest('[data-stand-fix]')) return standFix();
  if ((el = t.closest('[data-open-settings][data-sub]'))) { S.maintSub = el.dataset.sub; }
}, true);

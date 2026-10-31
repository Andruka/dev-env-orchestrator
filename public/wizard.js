/* ---------- мастер первого запуска: пять шагов вместо длинных настроек ---------- */

const WZ_STEPS = [['root', 'Папка'], ['env', 'Окружение'], ['login', 'Вход'], ['stand', 'Стенды'], ['swagger', 'Swagger']];
const wz = { step: 0, busy: false, doctor: null, msg: null, done: new Set() };

function wzDialog() {
  let d = $('#wizard');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'wizard';
    d.className = 'modal wizard';
    d.setAttribute('aria-label', 'Мастер настройки');
    d.addEventListener('click', wzClick);
    d.addEventListener('cancel', e => { e.preventDefault(); wzClose(); });
    document.body.appendChild(d);
  }
  return d;
}

function openWizard(step = 0) {
  wz.step = step; wz.msg = null; wz.doctor = null;
  const d = wzDialog();
  if (!d.open) d.showModal();
  wzRender();
  if (WZ_STEPS[wz.step][0] === 'env') wzRunDoctor();
}

function wzClose() {
  store.set('wizardDone', true);
  $('#wizard')?.close();
}

const wzSwagger = () => allProjects().find(p => p.groupObj.id === 'swagger');

function wzBody() {
  const id = WZ_STEPS[wz.step][0];
  const v = state.config.vars;
  if (id === 'root') {
    const n = allProjects().length;
    return `<h3>Где лежат репозитории CalPlan?</h3>
      <p class="help">Укажите папку, внутри которой лежат <span class="mono">server-copy</span>, <span class="mono">CLIENT</span> и другие репозитории. От неё панель сама найдёт бэкенд, фронтенд, дампы и Swagger.</p>
      <div class="field"><label for="wzRoot">Корневая папка</label>
        <div class="input-btn"><input id="wzRoot" value="${esc(v.calplanRoot || '')}" placeholder="/home/user/projects/calplan" autocomplete="off" spellcheck="false"><button type="button" data-wz-pick aria-label="Выбрать папку">${icon('folder')}</button></div></div>
      ${v.calplanRoot ? `<div class="note ${n ? 'ok' : 'warn'}">${n ? `Найдено репозиториев: ${n} (${allProjects().map(p => esc(p.name)).join(', ')})` : 'В этой папке пока не найдено репозиториев — проверьте путь или добавьте их позже в «Настройки → Репозитории».'}</div>` : ''}`;
  }
  if (id === 'env') {
    const d = wz.doctor;
    return `<h3>Всё ли нужное установлено?</h3>
      <p class="help">Панель не ставит системные программы — но покажет, чего не хватает, и что именно сделать.</p>
      ${d ? `<div class="list">${d.filter(i => i.status !== 'ok').map(i => `<div class="doc-row ${i.status}">${icon(i.status === 'fail' ? 'circle-x' : 'triangle-alert')}<div><div class="t">${esc(i.title)}</div><div class="d">${esc(i.detail)}</div>${i.fix ? `<div class="f">Что сделать: ${esc(i.fix)}</div>` : ''}</div></div>`).join('') || '<div class="doc-row ok">' + icon('circle-check') + '<div><div class="t">Всё в порядке</div></div></div>'}</div>
        <p class="help">Проблем: ${d.filter(i => i.status === 'fail').length}, замечаний: ${d.filter(i => i.status === 'warn').length}. Красное нужно исправить до работы, жёлтое — по желанию.</p>` : '<div class="note">Проверяю…</div>'}
      <button type="button" data-wz-recheck ${wz.busy ? 'disabled' : ''}>${icon('refresh-cw')} Проверить снова</button>`;
  }
  if (id === 'login') {
    return `<h3>Логин для входа во фронтенд <span class="help">(по желанию)</span></h3>
      <p class="help">Нужен для кнопок «Войти» и «Запустить и войти». Пароль хранится только у вас, в файле с правами 600. Для разных стендов логины можно задать позже в «Стенды».</p>
      <div class="field"><label for="wzLogin">Логин</label><input id="wzLogin" autocomplete="off"></div>
      <div class="field"><label for="wzPass">Пароль</label><input id="wzPass" type="password" autocomplete="new-password"></div>
      ${wz.msg ? `<div class="note ${wz.msg.ok ? 'ok' : 'err'}">${esc(wz.msg.text)}</div>` : ''}`;
  }
  if (id === 'stand') {
    const n = (state.config.envs || []).length;
    return `<h3>Стенды</h3>
      <p class="help">Стенд — окружение, к которому подключена ветка: файл <span class="mono">.env</span> бэкенда, <span class="mono">config.js</span> фронтенда, логин и пароль. Создайте стенд один раз — дальше он переключается одним кликом на плашке «Стенд» вверху.</p>
      <div class="note ${n ? 'ok' : ''}">${n ? `Стендов уже создано: ${n}.` : 'Пока нет ни одного. Это можно сделать позже; если вы работаете с одним окружением, стенды не нужны.'}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button type="button" data-wz-open="stands">${icon('server')} Открыть «Стенды»</button>
      <button type="button" data-wz-open="about">${icon('upload')} Загрузить профиль коллеги</button></div>`;
  }
  const sw = wzSwagger();
  return `<h3>Swagger <span class="help">(по желанию)</span></h3>
    <p class="help">Если у вас есть репозиторий swagger, панель соберёт спецификацию, поднимет Swagger UI и mock и откроет их в браузере. Путь у каждого свой.</p>
    <div class="field"><label for="wzSwagger">Папка репозитория swagger</label>
      <div class="input-btn"><input id="wzSwagger" value="${esc(sw ? sw.path : '')}" placeholder="${esc(v.swaggerDir || '')}" autocomplete="off" spellcheck="false"><button type="button" data-wz-pick-sw aria-label="Выбрать папку">${icon('folder')}</button></div></div>
    <div class="note ${sw ? 'ok' : ''}">${sw ? `Найден: ${esc(sw.path)}. Группа «Swagger» появилась в списке проектов.` : 'Репозиторий не найден — это нормально, если он вам не нужен.'}</div>`;
}

function wzRender() {
  const last = wz.step === WZ_STEPS.length - 1;
  $('#wizard').innerHTML = `<div class="wz-head"><h2>Мастер настройки</h2><button type="button" class="ghost icon-btn" data-wz-close aria-label="Закрыть">${icon('x')}</button></div>
    <ol class="wz-steps" aria-label="Шаги">${WZ_STEPS.map(([id, label], i) => `<li class="${i === wz.step ? 'cur' : i < wz.step ? 'done' : ''}" ${i === wz.step ? 'aria-current="step"' : ''}><span>${i < wz.step ? icon('check') : i + 1}</span>${label}</li>`).join('')}</ol>
    <div class="wz-body">${wzBody()}</div>
    <div class="modal-actions">
      ${wz.step ? '<button type="button" class="ghost" data-wz-back>Назад</button>' : ''}
      <span class="spacer"></span>
      ${WZ_STEPS[wz.step][0] === 'login' ? '<button type="button" class="ghost" data-wz-next>Пропустить</button>' : ''}
      <button type="button" class="primary" data-wz-${last ? 'finish' : 'save-next'} ${wz.busy ? 'disabled' : ''}>${last ? 'Готово' : 'Далее'}</button>
    </div>`;
}

async function wzRunDoctor() {
  wz.busy = true; wzRender();
  try { wz.doctor = await api('/api/doctor'); } catch (e) { toast(e.message, 'err'); }
  wz.busy = false;
  if ($('#wizard').open) wzRender();
}

async function wzSave() {
  const id = WZ_STEPS[wz.step][0];
  try {
    if (id === 'root') {
      const root = $('#wzRoot').value.trim();
      if (root && root !== state.config.vars.calplanRoot) { await api('/api/vars', { vars: { calplanRoot: root } }); await reloadConfig(); }
    } else if (id === 'login') {
      const login = $('#wzLogin').value.trim(), password = $('#wzPass').value;
      if (login || password) {
        await api('/api/settings', { auth: { login, ...(password && { password }) } });
        try { await api('/api/settings/test', {}); } catch (e) { toast(`Данные сохранены, но вход не удался: ${e.message}. Проверьте их позже в «Стенды → Общий вход».`, 'err'); }
      }
    } else if (id === 'swagger') {
      const dir = $('#wzSwagger').value.trim();
      if (dir && dir !== wzSwagger()?.path) { await api('/api/vars', { vars: { swaggerDir: dir } }); await reloadConfig(); }
    }
  } catch (e) { toast(e.message, 'err'); return false; }
  return true;
}

async function wzClick(e) {
  const t = e.target;
  let el;
  if (t.closest('[data-wz-close]')) return wzClose();
  if (t.closest('[data-wz-back]')) { wz.step--; wz.msg = null; return wzRender(); }
  if (t.closest('[data-wz-next]')) { wz.step++; wz.msg = null; wzRender(); if (WZ_STEPS[wz.step][0] === 'env') wzRunDoctor(); return; }
  if (t.closest('[data-wz-save-next]')) {
    if (!(await wzSave())) return;
    wz.step++; wz.msg = null; wzRender();
    if (WZ_STEPS[wz.step][0] === 'env') wzRunDoctor();
    return;
  }
  if (t.closest('[data-wz-finish]')) { if (await wzSave()) { toast('Настройка завершена. Всё можно изменить в «Настройки».', 'ok'); wzClose(); } return; }
  if (t.closest('[data-wz-recheck]')) return wzRunDoctor();
  if (t.closest('[data-wz-pick]')) { const dir = await pickFolder({ title: 'Корневая папка CalPlan', start: $('#wzRoot').value }); if (dir) { $('#wzRoot').value = dir; } return; }
  if (t.closest('[data-wz-pick-sw]')) { const dir = await pickFolder({ title: 'Папка репозитория swagger', start: $('#wzSwagger').value || state.config.vars.calplanRoot || '', mode: 'repo' }); if (dir) $('#wzSwagger').value = dir; return; }
  if ((el = t.closest('[data-wz-open]'))) { const tab = el.dataset.wzOpen; $('#wizard').close(); if (tab === 'about') { S.maintSub = 'about'; return openSettings('doctor'); } return openSettings(tab); }
}

// Мастер сам открывается при самом первом запуске: нет ни папки, ни репозиториев
function maybeStartWizard() {
  if (store.get('wizardDone', false) || state.config.configured) return;
  openWizard(0);
}

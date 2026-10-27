/* ---------- общие диалоги: подтверждение, параметры, выбор папки ---------- */

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

function confirmDialog(title, text, danger, okLabel = 'Выполнить') {
  return openDialog({ title, html: `<p>${esc(text)}</p>`, okLabel, danger, getValue: () => true,
    onOpen: () => $('#dialogOk').focus() });
}

function promptText(title, label, value = '', okLabel = 'Готово') {
  return openDialog({
    title, okLabel,
    html: `<div class="field"><label for="promptInput">${esc(label)}</label><input id="promptInput" value="${esc(value)}" autocomplete="off"></div>`,
    onOpen: () => { const i = $('#promptInput'); i.focus(); i.select(); },
    getValue: () => $('#promptInput').value.trim(),
  });
}

async function askParam(project, actionId, action, param) {
  const label = `${esc(param.title || param.name)} · <span class="mono">${esc(project.name)}</span>`;
  if (param.type === 'text') {
    return openDialog({
      title: action.title,
      html: `<div class="field"><label for="textParam">${label}</label><input id="textParam" autocomplete="off"></div>`,
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
    html: `<div class="field"><label for="optFilter">${label}</label>
      <input id="optFilter" placeholder="Поиск…   ↑↓ выбрать · Enter запустить" autocomplete="off">
      <div class="options" id="optList" role="listbox"></div></div>`,
    getValue: () => shown[idx]?.value ?? (param.type === 'gitBranch' ? $('#optFilter').value.trim() || null : null),
    onOpen: () => {
      const input = $('#optFilter');
      const list = $('#optList');
      const draw = () => {
        const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
        shown = options.filter(o => words.every(w => o.label.toLowerCase().includes(w)));
        idx = Math.min(idx, Math.max(shown.length - 1, 0));
        list.innerHTML = shown.length ? shown.slice(0, 300).map((o, i) =>
          `<div class="opt ${i === idx ? 'sel' : ''} ${o.value === current ? 'current' : ''}" role="option" aria-selected="${i === idx}" data-i="${i}">${esc(o.label)}${o.meta ? `<span class="meta">${esc(o.meta)}</span>` : ''}</div>`).join('')
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

/* ---------- выбор папки («проводник») ---------- */

// pickFolder({ title, start, mode }) → путь или null.
// mode 'repo' — подсказывает git-папки и позволяет выбрать их кнопкой «+» в строке.
function pickFolder({ title = 'Выберите папку', start = '', mode = 'any' } = {}) {
  const dlg = $('#picker');
  let showHidden = false;
  let data = null;

  dlg.innerHTML = `
    <h3>${esc(title)}</h3>
    <div class="picker-shortcuts" id="pkShort"></div>
    <div class="picker-path">
      <button type="button" class="icon-btn" id="pkUp" title="На уровень выше" aria-label="Выше"></button>
      <input id="pkPath" spellcheck="false" aria-label="Путь">
      <button type="button" class="icon-btn" id="pkHidden" title="Показать скрытые папки" aria-label="Скрытые папки" aria-pressed="false"></button>
    </div>
    <div class="picker-list" id="pkList" role="listbox" aria-label="Папки"></div>
    <p class="help" style="margin:8px 0 0">${mode === 'repo' ? 'Откройте папку двойным кликом или Enter. Кнопка «+» в строке выбирает репозиторий сразу.' : 'Откройте папку двойным кликом или Enter, затем нажмите «Выбрать эту папку».'}</p>
    <div class="modal-actions">
      <span class="note" id="pkCur" style="margin-right:auto;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
      <button type="button" class="ghost" id="pkCancel">Отмена</button>
      <button type="button" class="primary" id="pkOk">Выбрать эту папку</button>
    </div>`;
  $('#pkUp').innerHTML = icon('arrow-up');
  $('#pkHidden').innerHTML = icon('eye');

  const draw = async (target) => {
    try {
      data = await api(`/api/fs?path=${encodeURIComponent(target || '')}${showHidden ? '&hidden=1' : ''}`);
    } catch (e) { toast(e.message, 'err'); return; }
    $('#pkPath').value = data.path;
    $('#pkCur').textContent = data.path;
    $('#pkUp').disabled = !data.parent;
    $('#pkShort').innerHTML = data.shortcuts.map(s => `<button type="button" class="sm ghost" data-go="${esc(s.path)}">${icon('folder')} ${esc(s.name)}</button>`).join('');
    const rows = data.entries.map(e => {
      const marks = [e.git && '<span class="tag ok">git</span>', e.compose && '<span class="tag">compose</span>', e.node && '<span class="tag">node</span>'].filter(Boolean).join(' ');
      return `<div class="picker-row" role="option" tabindex="0" data-open="${esc(e.path)}">
        ${icon(e.git ? 'git-branch' : 'folder')}<span class="nm">${esc(e.name)}</span>${marks}
        ${mode === 'repo' && e.git ? `<button type="button" class="sm" data-pick="${esc(e.path)}" title="Выбрать этот репозиторий" aria-label="Выбрать ${esc(e.name)}">${icon('plus')}</button>` : ''}
      </div>`;
    }).join('');
    $('#pkList').innerHTML = rows || '<div class="list-empty">Вложенных папок нет</div>';
  };

  dlg.showModal();
  draw(start);

  return new Promise(resolve => {
    let result = null;
    dlg.onclose = () => resolve(result);
    dlg.onclick = e => {
      const pick = e.target.closest('[data-pick]');
      if (pick) { result = pick.dataset.pick; return dlg.close(); }
      const go = e.target.closest('[data-go]');
      if (go) return draw(go.dataset.go);
      if (e.target.closest('#pkUp')) return data?.parent && draw(data.parent);
      if (e.target.closest('#pkHidden')) {
        showHidden = !showHidden;
        $('#pkHidden').setAttribute('aria-pressed', showHidden);
        $('#pkHidden').innerHTML = icon(showHidden ? 'eye-off' : 'eye');
        return draw(data.path);
      }
      if (e.target.closest('#pkCancel')) return dlg.close();
      if (e.target.closest('#pkOk')) { result = data?.path || null; return dlg.close(); }
      const row = e.target.closest('[data-open]');
      if (row) { dlg.querySelectorAll('.picker-row.sel').forEach(r => r.classList.remove('sel')); row.classList.add('sel'); }
    };
    dlg.ondblclick = e => { const row = e.target.closest('[data-open]'); if (row && !e.target.closest('[data-pick]')) draw(row.dataset.open); };
    dlg.onkeydown = e => {
      if (e.target.id === 'pkPath' && e.key === 'Enter') { e.preventDefault(); draw(e.target.value); }
      else if (e.key === 'Enter' && e.target.matches?.('.picker-row')) { e.preventDefault(); draw(e.target.dataset.open); }
      else if (e.key === 'Backspace' && !/INPUT/.test(e.target.tagName) && data?.parent) { e.preventDefault(); draw(data.parent); }
    };
  });
}

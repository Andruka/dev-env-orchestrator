const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('devpanel.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('devpanel.' + k, JSON.stringify(v)); } catch { /* нет хранилища */ } },
};

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

// Точечное обновление DOM вместо замены innerHTML: меняются только отличающиеся атрибуты и текст.
// Иначе при каждом обновлении статуса элементы пересоздаются — проигрываются анимации появления,
// сбрасываются наведение мыши и фокус, и интерфейс «моргает».
function setHtml(el, html) {
  if (el._html === html) return;
  el._html = html;
  const t = document.createElement('template');
  t.innerHTML = html;
  morphChildren(el, t.content);
}

function morphChildren(from, to) {
  const next = [...to.childNodes];
  const cur = [...from.childNodes];
  next.forEach((node, i) => {
    if (i >= cur.length) from.appendChild(node);
    else morphNode(cur[i], node);
  });
  for (let i = next.length; i < cur.length; i++) cur[i].remove();
}

function morphNode(a, b) {
  const sameKind = a.nodeType === b.nodeType && a.nodeName === b.nodeName
    && (a.nodeType !== 1 || a.getAttribute('data-key') === b.getAttribute('data-key'));
  if (!sameKind) { a.replaceWith(b); return; }
  if (a.nodeType !== 1) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return;
  }
  // значение полей ввода не трогаем — пользователь может печатать
  if (a.nodeName === 'INPUT' || a.nodeName === 'TEXTAREA') return;
  if (a.nodeName === 'SELECT') {
    // пока список открыт, не трогаем; иначе подтягиваем новые варианты и выбранное значение
    if (a === document.activeElement) return;
    if (a.innerHTML !== b.innerHTML || a.disabled !== b.disabled) a.replaceWith(b);
    return;
  }
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  morphChildren(a, b);
}

const fmtTime = ts => (ts ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
function fmtDur(j) {
  const s = Math.round(((j.finishedAt || Date.now()) - j.startedAt) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} мин ${s % 60} с` : `${s} с`;
}
const fmtSize = n => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} ГБ` : `${Math.max(1, Math.round(n / 1024 ** 2))} МБ`);

// <span data-ic="имя"> в статической разметке → inline-SVG
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-ic]').forEach(el => { el.outerHTML = icon(el.dataset.ic); });
}

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

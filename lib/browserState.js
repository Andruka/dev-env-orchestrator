// Запись входа в localStorage страницы фронтенда с учётом стенда.
// Состояние приложения в localStorage (последний открытый объект, режимы, пользователь) относится к базе конкретного стенда.
// Поэтому при входе под другим стендом всё лишнее стирается; по метке devpanel:stand панель знает, чей это localStorage.
const MARKER = 'devpanel:stand';
const KEEP = ['i18nextLng']; // настройки, не связанные со стендом

// JS для выполнения на странице. origin — адрес стенда (null — не следим за стендом).
function script({ data, origin, navigateTo, reload }) {
  return `(() => {
    const d = ${JSON.stringify(data)};
    const origin = ${JSON.stringify(origin || null)};
    let cleared = false;
    if (origin && localStorage.getItem(${JSON.stringify(MARKER)}) !== origin) {
      const keep = ${JSON.stringify(KEEP)}.map(k => [k, localStorage.getItem(k)]).filter(([, v]) => v !== null);
      localStorage.clear();
      for (const [k, v] of keep) localStorage.setItem(k, v);
      cleared = true;
    }
    if (origin) localStorage.setItem(${JSON.stringify(MARKER)}, origin);
    for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v);
    ${navigateTo ? `setTimeout(() => { location.href = ${JSON.stringify(navigateTo)}; }, 50);` : reload ? 'setTimeout(() => location.reload(), 50);' : ''}
    return cleared;
  })()`;
}

module.exports = { script, MARKER };

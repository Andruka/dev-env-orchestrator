// Темы оформления. Сами цвета — в themes.css; здесь только список для выбора и применение.
const THEMES = [
  { id: 'graphite', label: 'Графит', mode: 'тёмная', hint: 'Нейтральный графит с индиго-акцентом. Тема по умолчанию' },
  { id: 'midnight', label: 'Полночь', mode: 'тёмная', hint: 'Глубокий синий и голубой акцент — спокойно для долгой работы вечером' },
  { id: 'console', label: 'Консоль', mode: 'тёмная', hint: 'Сланцевый фон и бирюзовый акцент, как в IDE и терминалах' },
  { id: 'violet', label: 'Фиолет', mode: 'тёмная', hint: 'Тёплый тёмный с лавандовым акцентом' },
  { id: 'frost', label: 'Иней', mode: 'тёмная', hint: 'Приглушённая арктическая палитра, мягкий контраст' },
  { id: 'daylight', label: 'День', mode: 'светлая', hint: 'Чистая светлая тема для яркого освещения' },
  { id: 'paper', label: 'Бумага', mode: 'светлая', hint: 'Тёплый кремовый фон — меньше нагрузка на глаза днём' },
  { id: 'amber', soft: true, label: 'Янтарь', mode: 'тёмная', hint: 'Тёплый коричневатый полумрак и янтарный акцент: минимум синего света, для вечера' },
  { id: 'forest', soft: true, label: 'Лес', mode: 'тёмная', hint: 'Приглушённый зелёный сумрак с шалфейным акцентом — спокойно для глаз' },
  { id: 'lagoon', soft: true, label: 'Лагуна', mode: 'тёмная', hint: 'Глубокий сине-зелёный фон и бирюзовый акцент, мягкий контраст' },
  { id: 'berry', soft: true, label: 'Брусника', mode: 'тёмная', hint: 'Тёплый сливовый полумрак с пыльно-розовым акцентом' },
  { id: 'mint', soft: true, label: 'Мята', mode: 'светлая', hint: 'Светло-зелёный фон без бликов: свежо и мягко днём' },
  { id: 'fog', soft: true, label: 'Туман', mode: 'светлая', hint: 'Серо-голубая светлая тема с пониженной яркостью, без слепящего белого' },
  { id: 'sand', soft: true, label: 'Песок', mode: 'светлая', hint: 'Песочный фон и сине-зелёный акцент, мягкая светлая тема' },
  { id: 'contrast', label: 'Контраст', mode: 'тёмная', hint: 'Максимальный контраст и толстые рамки для плохого зрения и бликов' },
];

const themeState = { pref: store.get('theme', 'auto'), density: store.get('density', 'comfortable') };

function resolveTheme(pref) {
  if (pref === 'auto') return matchMedia('(prefers-color-scheme: light)').matches ? 'daylight' : 'graphite';
  return THEMES.some(t => t.id === pref) ? pref : 'graphite';
}

function applyTheme() {
  document.documentElement.dataset.theme = resolveTheme(themeState.pref);
  document.documentElement.dataset.density = themeState.density;
}

// Запоминаем и в браузере (без мигания при загрузке), и на сервере (общий для окон и профилей)
function setTheme(pref) {
  themeState.pref = pref;
  store.set('theme', pref);
  applyTheme();
  api('/api/prefs', { prefs: { theme: pref } }).catch(() => {});
}

function setDensity(density) {
  themeState.density = density;
  store.set('density', density);
  applyTheme();
  api('/api/prefs', { prefs: { density } }).catch(() => {});
}

// Настройки с сервера главнее локальных: в окне-приложении свой профиль браузера, localStorage там пустой
function syncPrefs(prefs = {}) {
  let changed = false;
  if (prefs.theme && prefs.theme !== themeState.pref) { themeState.pref = prefs.theme; store.set('theme', prefs.theme); changed = true; }
  if (prefs.density && prefs.density !== themeState.density) { themeState.density = prefs.density; store.set('density', prefs.density); changed = true; }
  if (changed) applyTheme();
}

matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (themeState.pref === 'auto') applyTheme(); });
applyTheme();

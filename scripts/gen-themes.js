#!/usr/bin/env node
// Генератор дополнительных тем: из 4–9 опорных цветов выводит все токены и подгоняет их под WCAG AA.
// Результат: public/themes-extra.css и public/themes-extra.js (не править руками — править список ниже и запускать `npm run themes`).
// Палитры — переработанные вариации известных открытых схем (см. docs/GUIDE.md, «Темы»): оттенки подогнаны так, чтобы проходить контраст.
const fs = require('fs');
const path = require('path');

// id, группа, подпись, режим, подсказка, bg (самый дальний фон), surface (панели), raised (кнопки/карточки),
// text, accent, alive (работает), warn, danger
const SRC = [
  // ── Классика редакторов
  ['catppuccin-mocha', 'editor', 'Catppuccin Mocha', 'dark', 'Бархатный тёмный с мальвовым акцентом, самый популярный из «пастельных»', '#181825', '#1e1e2e', '#313244', '#cdd6f4', '#cba6f7', '#a6e3a1', '#f9e2af', '#f38ba8'],
  ['catppuccin-macchiato', 'editor', 'Catppuccin Macchiato', 'dark', 'Чуть светлее Mocha, голубой акцент, мягкий сине-серый фон', '#1e2030', '#24273a', '#363a4f', '#cad3f5', '#8aadf4', '#a6da95', '#eed49f', '#ed8796'],
  ['catppuccin-frappe', 'editor', 'Catppuccin Frappé', 'dark', 'Самый светлый из тёмных Catppuccin: приглушённый, дымчатый', '#292c3c', '#303446', '#414559', '#c6d0f5', '#ca9ee6', '#a6d189', '#e5c890', '#e78284'],
  ['catppuccin-latte', 'editor', 'Catppuccin Latte', 'light', 'Светлая «латте»: холодный лавандовый фон и фиолетовый акцент', '#dce0e8', '#eff1f5', '#e6e9ef', '#4c4f69', '#8839ef', '#40a02b', '#df8e1d', '#d20f39'],
  ['tokyo-night', 'editor', 'Tokyo Night', 'dark', 'Ночной Токио: индиго-фон и неоново-голубой акцент', '#1f2335', '#24283b', '#292e42', '#c0caf5', '#7aa2f7', '#9ece6a', '#e0af68', '#f7768e'],
  ['tokyo-day', 'editor', 'Tokyo Day', 'light', 'Дневной Токио: прохладный серо-голубой, синий акцент', '#d0d5e3', '#e6e7ec', '#dadde9', '#3760bf', '#2e7de9', '#587539', '#8c6c3e', '#f52a65'],
  ['gruvbox-dark', 'editor', 'Gruvbox Dark', 'dark', 'Ретро-тёплый «табачный» фон и оранжевый акцент, любимец терминалов', '#1d2021', '#282828', '#3c3836', '#ebdbb2', '#fe8019', '#b8bb26', '#fabd2f', '#fb4934'],
  ['gruvbox-light', 'editor', 'Gruvbox Light', 'light', 'Кремовая бумага и бирюзово-синий акцент — тёплая ретро-классика', '#ebdbb2', '#fbf1c7', '#f2e5bc', '#3c3836', '#076678', '#79740e', '#b57614', '#9d0006'],
  ['dracula', 'editor', 'Dracula', 'dark', 'Тёмный пурпур с сиреневым акцентом и кислотно-зелёным «живым»', '#21222c', '#282a36', '#343746', '#f8f8f2', '#bd93f9', '#50fa7b', '#f1fa8c', '#ff5555'],
  ['solarized-dark', 'editor', 'Solarized Dark', 'dark', 'Зелёно-бирюзовый сумрак с выверенной, малоконтрастной палитрой', '#00212b', '#002b36', '#073642', '#93a1a1', '#268bd2', '#859900', '#b58900', '#dc322f'],
  ['solarized-light', 'editor', 'Solarized Light', 'light', 'Кремовый фон, холодный синий акцент — классика для чтения', '#eee8d5', '#fdf6e3', '#f5eedb', '#586e75', '#268bd2', '#859900', '#b58900', '#dc322f'],
  ['one-dark', 'editor', 'One Dark', 'dark', 'Редакторская классика: серо-синий фон и голубой акцент', '#21252b', '#282c34', '#2c313a', '#abb2bf', '#61afef', '#98c379', '#e5c07b', '#e06c75'],
  ['everforest-dark', 'editor', 'Everforest Dark', 'dark', 'Лесной сумрак: тёплый зелёно-серый, спокойный для глаз', '#232a2e', '#2d353b', '#343f44', '#d3c6aa', '#7fbbb3', '#a7c080', '#dbbc7f', '#e67e80'],
  ['everforest-light', 'editor', 'Everforest Light', 'light', 'Светлый «лес»: бежево-зелёный фон, мягкий контраст', '#f4f0d9', '#fdf6e3', '#efebd4', '#5c6a72', '#3a94c5', '#8da101', '#dfa000', '#f85552'],
  ['kanagawa', 'editor', 'Kanagawa', 'dark', 'Японская гравюра: тушь, рисовая бумага и кристально-синий акцент', '#16161d', '#1f1f28', '#2a2a37', '#dcd7ba', '#7e9cd8', '#98bb6c', '#e6c384', '#e46876'],
  ['kanagawa-lotus', 'editor', 'Kanagawa Lotus', 'light', 'Светлая «Канагава»: пергаментный фон и сине-индиго акцент', '#e5ddb0', '#f2ecbc', '#dcd5ac', '#545464', '#4d699b', '#6f894e', '#836f4a', '#c84053'],
  ['rose-pine', 'editor', 'Rosé Pine', 'dark', 'Тёмная слива, лавандовый акцент и розовые детали — уютно и элегантно', '#191724', '#1f1d2e', '#26233a', '#e0def4', '#c4a7e7', '#9ccfd8', '#f6c177', '#eb6f92'],
  ['rose-pine-dawn', 'editor', 'Rosé Pine Dawn', 'light', 'Рассветная пудра: кремово-розовый фон и сиреневый акцент', '#f2e9e1', '#fffaf3', '#faf4ed', '#575279', '#907aa9', '#286983', '#ea9d34', '#b4637a'],
  ['flexoki-dark', 'editor', 'Flexoki Dark', 'dark', 'Тёплая «чернильная» палитра, как печатная краска на бумаге', '#100f0f', '#1c1b1a', '#282726', '#cecdc3', '#4385be', '#879a39', '#d0a215', '#d14d41'],
  ['flexoki-light', 'editor', 'Flexoki Light', 'light', 'Кремовая бумага и чернильный синий — для долгого чтения', '#f2f0e5', '#fffcf0', '#e6e4d9', '#282726', '#205ea6', '#66800b', '#ad8301', '#af3029'],
  // ── Современные и яркие
  ['monokai-pro', 'neon', 'Monokai Pro', 'dark', 'Тёплый графит и жёлтый акцент — узнаваемая «мокко» из редакторов', '#221f22', '#2d2a2e', '#403e41', '#fcfcfa', '#ffd866', '#a9dc76', '#fc9867', '#ff6188'],
  ['synthwave', 'neon', 'Synthwave', 'dark', 'Ретро-футуризм 80-х: пурпурная ночь, розовый неон и мятный', '#1a1033', '#241b3f', '#30254f', '#f4eefc', '#ff7edb', '#72f1b8', '#fede5d', '#fe4450'],
  ['oxocarbon', 'neon', 'Oxocarbon', 'dark', 'Строгий IBM-стиль: нейтральный уголь и лазурный акцент', '#161616', '#262626', '#393939', '#f2f4f8', '#78a9ff', '#42be65', '#f1c21b', '#ee5396'],
  ['poimandres', 'neon', 'Poimandres', 'dark', 'Холодный тёмно-синий и мятная бирюза — современно и свежо', '#1b1e28', '#252b37', '#303340', '#e4f0fb', '#5de4c7', '#5de4c7', '#fffac2', '#d0679d'],
  ['vesper', 'neon', 'Vesper', 'dark', 'Почти чёрный минимализм с персиковым акцентом — вечер без лишнего', '#101010', '#161616', '#232323', '#e5e5e5', '#ffc799', '#99ffe4', '#ffc799', '#ff8080'],
  // ── Модные оттенки
  ['cloud-dancer', 'trend', 'Cloud Dancer', 'light', 'Мягкий белый «облачный» — оттенок года Pantone 2026; сланцевый акцент', '#ebeae6', '#f6f5f2', '#e3e1dc', '#2b2a28', '#4f6272', '#3f7a52', '#85602a', '#b4443a'],
  ['mocha-mousse', 'trend', 'Mocha Mousse', 'dark', 'Какао-мусс: тёплый шоколад и карамельный акцент (по мотивам Pantone 2025)', '#1f1815', '#2a211d', '#372b26', '#efe2d8', '#cf9d84', '#9fb58a', '#e0b86e', '#e57f6f'],
  ['terracotta', 'trend', 'Терракота', 'light', 'Тёплая глина, песок и кирпичный акцент — уютная светлая тема', '#efe3d6', '#faf3ea', '#f1e5d8', '#3a2a22', '#b0502f', '#5c7a3a', '#8a5a12', '#a82b2b'],
  ['lavender-haze', 'trend', 'Лавандовая дымка', 'light', 'Нежная сиреневая светлая тема с насыщенным фиолетовым акцентом', '#e6e1f2', '#f4f1fb', '#ebe6f6', '#2b2640', '#6b4fc4', '#2f7a57', '#85590a', '#b0284a'],
  ['aurora', 'trend', 'Северное сияние', 'dark', 'Глубокий ночной бирюзовый и мерцающий аквамарин', '#0b1a1f', '#11262c', '#183239', '#dff3ee', '#5eead4', '#7ee787', '#f6d365', '#ff7b8a'],
  ['sunset', 'trend', 'Закат', 'dark', 'Сливово-коралловый полумрак с тёплым оранжевым акцентом', '#1c1218', '#271a21', '#34232b', '#f6e6e2', '#ff8f6b', '#8fd19e', '#ffd479', '#ff6f7d'],
  // ── Для прикола
  ['matrix', 'fun', 'Матрица', 'dark', 'Зелёный код на чёрном — «есть только Матрица»', '#000a00', '#021402', '#062406', '#b6ffb6', '#00ff41', '#00ff41', '#d6ff4a', '#ff5f5f'],
  ['crt-amber', 'fun', 'Янтарный монитор', 'dark', 'Старый CRT-терминал: янтарные буквы на тёмно-коричневом', '#120a00', '#1a1000', '#271800', '#ffcf7a', '#ffb000', '#9cff57', '#ffd24a', '#ff6a3d'],
  ['dos', 'fun', 'DOS', 'dark', 'Синий экран 90-х и жёлтый курсор — ностальгия по Norton Commander', '#000080', '#0000a0', '#1010b8', '#ffffff', '#ffff55', '#55ff55', '#ffff55', '#ff5555'],
  ['gameboy', 'fun', 'Game Boy', 'light', 'Четыре оттенка зелёного LCD из 1989 года', '#8bac0f', '#9bbc0f', '#8fb00f', '#0f380f', '#306230', '#1f5a1f', '#5a4a00', '#7a1a1a'],
  ['barbie', 'fun', 'Барби', 'light', 'Всё розовое: светлая тема для хорошего настроения', '#fbd3e6', '#fff0f7', '#fde1ee', '#3d0f2a', '#e0218a', '#1f7a4d', '#8a5a00', '#b00020'],
  ['cyberpunk', 'fun', 'Киберпанк', 'dark', 'Ночной город: кислотно-жёлтый акцент на почти чёрном', '#0a0a12', '#12121f', '#1c1c30', '#f2f2ff', '#fcee09', '#00f0c8', '#ff9f1c', '#ff2a6d'],
  ['vaporwave', 'fun', 'Вейпорвейв', 'dark', 'Эстетика 80-х: пурпур, голубой неон и розовые ошибки', '#1b1035', '#241548', '#331d63', '#ffe8ff', '#01cdfe', '#05ffa1', '#fffb96', '#ff71ce'],
  ['blueprint', 'fun', 'Синька', 'dark', 'Чертёж: тёмно-синяя калька и светло-голубые линии', '#0b2a4a', '#0f3560', '#164274', '#e6f2ff', '#8fd0ff', '#7dffb0', '#ffe08a', '#ff9aa8'],
  ['halloween', 'fun', 'Хэллоуин', 'dark', 'Фиолетовая ночь и тыквенно-оранжевый акцент', '#130a1c', '#1c1028', '#2a1a3a', '#f5e6ff', '#ff7a1a', '#9be564', '#ffc83d', '#ff4d6d'],
  ['newyear', 'fun', 'Новый год', 'dark', 'Ёлочно-зелёный фон и красный акцент, как гирлянда', '#0c1f1a', '#112b24', '#18382f', '#f4f1e8', '#ff5a5a', '#7ee08a', '#ffd86b', '#ff7b7b'],
  ['coffee', 'fun', 'Кофе с молоком', 'light', 'Тёплая светлая тема цвета капучино', '#e3d2bf', '#f3e8da', '#ead9c4', '#3b2616', '#7a4a25', '#4f6b2a', '#86570c', '#a3271f'],
  ['noir', 'fun', 'Нуар', 'dark', 'Чёрно-белое кино: только серые, красный — для ошибок', '#0a0a0a', '#141414', '#1f1f1f', '#e8e8e8', '#d9d9d9', '#a0e0a0', '#e0d080', '#ff5a5a'],
  ['ultraviolet', 'fun', 'Ультрафиолет', 'dark', 'Глубокий фиолетовый и светящийся сиреневый акцент', '#0e0420', '#170832', '#230d4a', '#efe6ff', '#b46cff', '#5ff0b0', '#ffd36b', '#ff6b9a'],
  ['radioactive', 'fun', 'Радиоактивный', 'dark', 'Токсично-салатовый на мшистом чёрном — осторожно, светится', '#0d1100', '#151b02', '#202a04', '#eaffc0', '#c6ff00', '#6bff6b', '#ffd400', '#ff5a3c'],
];

const GROUPS = { editor: 'Классика редакторов', neon: 'Современные и яркие', trend: 'Модные оттенки', fun: 'Для прикола' };

const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const hex = a => '#' + a.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = h => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const worst = (fg, bgs) => Math.min(...bgs.map(b => ratio(fg, b)));
// Сдвигаем цвет к `toward`, пока контраст со всеми фонами не дойдёт до min (с небольшим запасом)
function fit(fg, bgs, min, toward) {
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const c = t === 0 ? fg : mix(fg, toward, t);
    if (worst(c, bgs) >= min + 0.05) return c;
  }
  return toward;
}
const rgba = (h, a) => `rgba(${rgb(h).join(', ')}, ${a})`;

let adjusted = 0;
const css = [`/* СГЕНЕРИРОВАНО scripts/gen-themes.js — не править руками. Токены те же, что в themes.css. */`];
const list = [];
for (const [id, group, label, mode, hint, bg, surface, raised, text0, accent0, alive0, warn0, danger0] of SRC) {
  const dark = mode === 'dark';
  const toward = dark ? '#ffffff' : '#000000';
  const away = dark ? '#000000' : '#ffffff';
  const raisedHover = mix(raised, toward, 0.07);
  const base = [bg, surface, raised];
  const text = fit(text0, [...base, raisedHover], 7, toward);
  const dim = fit(mix(text, bg, 0.32), base, 4.6, text);
  const faint = fit(mix(text, bg, 0.46), base, 4.6, text);
  const accent = fit(accent0, base, 4.6, toward);
  const accentHover = mix(accent, toward, 0.14);
  const onAccent = fit(dark ? mix(bg, '#000000', 0.5) : '#ffffff', [accent, accentHover], 4.6, away);
  const [alive, warn, danger] = [alive0, warn0, danger0].map(c => fit(c, base, 4.6, toward));
  const onDanger = fit(dark ? mix(bg, '#000000', 0.6) : '#ffffff', [danger], 4.6, away);
  const lineStrong = fit(mix(surface, text, 0.35), [bg, surface], 3.1, text);
  const line = mix(surface, text, 0.13);
  const logBg = dark ? mix(bg, '#000000', 0.35) : mix(bg, '#ffffff', 0.5);
  const logText = fit(mix(text, logBg, 0.1), [logBg], 4.6, text);
  for (const [a, b] of [[text, text0], [accent, accent0], [alive, alive0], [warn, warn0], [danger, danger0]]) if (a !== b) adjusted++;
  css.push(`
[data-theme="${id}"] {
  color-scheme: ${dark ? 'dark' : 'light'};
  --bg: ${bg}; --surface: ${surface}; --raised: ${raised}; --raised-hover: ${raisedHover};
  --line: ${line}; --line-strong: ${lineStrong}; --focus: ${accent};
  --text: ${text}; --dim: ${dim}; --faint: ${faint};
  --accent: ${accent}; --accent-hover: ${accentHover}; --on-accent: ${onAccent};
  --alive: ${alive}; --warn: ${warn}; --danger: ${danger}; --on-danger: ${onDanger};
  --log-bg: ${logBg}; --log-text: ${logText}; --overlay: ${rgba(dark ? mix(bg, '#000000', 0.6) : text, dark ? 0.62 : 0.35)}; --shadow: ${dark ? '0 24px 80px rgba(0, 0, 0, .5)' : `0 20px 60px ${rgba(text, 0.2)}`};
}`);
  list.push(`  { id: '${id}', group: '${group}', label: '${label}', mode: '${dark ? 'тёмная' : 'светлая'}', hint: '${hint.replace(/'/g, "\\'")}' },`);
}

const out = path.join(__dirname, '..', 'public');
fs.writeFileSync(path.join(out, 'themes-extra.css'), css.join('\n') + '\n');
fs.writeFileSync(path.join(out, 'themes-extra.js'), `// СГЕНЕРИРОВАНО scripts/gen-themes.js — не править руками. Цвета — в themes-extra.css.\nconst THEME_GROUPS = ${JSON.stringify(GROUPS)};\nconst THEMES_EXTRA = [\n${list.join('\n')}\n];\n`);
console.log(`Тем: ${SRC.length}, подогнано опорных цветов под AA: ${adjusted}`);

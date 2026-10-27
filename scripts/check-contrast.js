#!/usr/bin/env node
// Проверка контраста пар «текст — фон» во всех темах (WCAG 2.2 AA). Выходит с кодом 1, если что-то не проходит.
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'themes.css'), 'utf8');
const themes = {};
for (const m of css.matchAll(/\[data-theme="([\w-]+)"\]\s*\{([^}]*)\}/g)) {
  themes[m[1]] = Object.fromEntries([...m[2].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map(x => [x[1], x[2]]));
}

const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = hex => {
  const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [передний план, фон, минимум]
const PAIRS = [
  ['text', 'bg', 4.5], ['text', 'surface', 4.5], ['text', 'raised', 4.5], ['text', 'raised-hover', 4.5],
  ['dim', 'bg', 4.5], ['dim', 'surface', 4.5], ['dim', 'raised', 4.5],
  ['faint', 'bg', 4.5], ['faint', 'surface', 4.5], ['faint', 'raised', 4.5],
  ['accent', 'bg', 4.5], ['accent', 'surface', 4.5], ['accent', 'raised', 4.5],
  ['on-accent', 'accent', 4.5], ['on-accent', 'accent-hover', 4.5],
  ['alive', 'surface', 4.5], ['warn', 'surface', 4.5], ['danger', 'surface', 4.5], ['danger', 'raised', 4.5],
  ['alive', 'bg', 4.5], ['warn', 'bg', 4.5], ['danger', 'bg', 4.5],
  ['on-danger', 'danger', 4.5],
  ['log-text', 'log-bg', 4.5],
  ['line-strong', 'surface', 3], ['line-strong', 'bg', 3], ['focus', 'surface', 3], ['focus', 'raised', 3],
];

let bad = 0;
for (const [name, t] of Object.entries(themes)) {
  const fails = [];
  for (const [fg, bgName, min] of PAIRS) {
    if (!t[fg] || !t[bgName]) { fails.push(`${fg}/${bgName}: токен не задан`); continue; }
    const r = ratio(t[fg], t[bgName]);
    if (r < min) fails.push(`${fg} на ${bgName}: ${r.toFixed(2)} < ${min}`);
  }
  console.log(`${fails.length ? '✖' : '✔'} ${name}`);
  fails.forEach(f => console.log(`    ${f}`));
  bad += fails.length;
}
if (bad) { console.log(`\nПроблем: ${bad}`); process.exit(1); }
console.log(`\nВсе темы (${Object.keys(themes).length}) проходят AA`);

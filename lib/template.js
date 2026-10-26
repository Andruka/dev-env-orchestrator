// Подстановка {name} и {a.b} из контекста. Неизвестные плейсхолдеры остаются как есть.
function lookup(ctx, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
}

function render(value, ctx, depth = 0) {
  if (typeof value === 'string') {
    const out = value.replace(/\{([A-Za-z_][\w.]*)\}/g, (m, key) => {
      const v = lookup(ctx, key);
      return v === undefined || typeof v === 'object' ? m : String(v);
    });
    // переменные могут ссылаться на другие переменные
    return out !== value && depth < 5 ? render(out, ctx, depth + 1) : out;
  }
  if (Array.isArray(value)) return value.map(v => render(v, ctx, depth));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, ctx, depth)]));
  }
  return value;
}

module.exports = { render };

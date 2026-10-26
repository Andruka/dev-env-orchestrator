const fs = require('fs');
const path = require('path');
const { render } = require('./template');

const CONFIG_PATH = process.env.DEV_PANEL_CONFIG || path.join(__dirname, '..', 'config.json');

function load() {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const vars = render(raw.vars || {}, raw.vars || {});
  const groups = (raw.groups || []).map(g => {
    const group = render(g, vars);
    const paths = new Set(group.paths || []);
    if (group.discover) {
      const { root, requireFile } = group.discover;
      for (const name of safeReaddir(root)) {
        const dir = path.join(root, name);
        if (fs.existsSync(path.join(dir, '.git')) && (!requireFile || fs.existsSync(path.join(dir, requireFile)))) {
          paths.add(dir);
        }
      }
    }
    const exclude = new Set(group.exclude || []);
    const projects = [...paths]
      .filter(p => !exclude.has(path.basename(p)))
      .sort()
      .map(p => ({ id: `${group.id}:${path.basename(p)}`, name: path.basename(p), path: p, group: group.id }));
    return { ...group, projects };
  });
  return { port: raw.port || 7777, vars, groups, actions: raw.actions || {}, path: CONFIG_PATH };
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

module.exports = { load, CONFIG_PATH };

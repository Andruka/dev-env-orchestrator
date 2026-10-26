// Сбор состояния: git, docker compose, сервисы, порты
const fs = require('fs');
const path = require('path');
const net = require('net');
const { run } = require('./proc');
const services = require('./services');
const snapshots = require('./snapshots');

async function gitInfo(dir) {
  const { code, out } = await run('git status --porcelain=v2 --branch', { cwd: dir });
  if (code !== 0) return { error: out.trim() };
  const info = { branch: null, upstream: null, ahead: 0, behind: 0, dirty: 0, changes: [], stashes: 0 };
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) info.branch = line.slice(14);
    else if (line.startsWith('# branch.upstream ')) info.upstream = line.slice(18);
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) { info.ahead = +m[1]; info.behind = +m[2]; }
    } else if (line && !line.startsWith('#')) {
      info.dirty++;
      if (info.changes.length < 30) info.changes.push(line.startsWith('?') ? `? ${line.slice(2)}` : `${line.split(' ')[1]} ${line.split(' ').slice(8).join(' ')}`);
    }
  }
  const st = await run('git stash list --format=%gd', { cwd: dir });
  info.stashes = st.out.trim() ? st.out.trim().split('\n').length : 0;
  return info;
}

async function composeProjects() {
  const { code, out } = await run('docker compose ls -a --format json');
  if (code !== 0) return [];
  try {
    return JSON.parse(out).map(p => ({
      name: p.Name, status: p.Status, dirs: p.ConfigFiles.split(',').map(f => path.dirname(f)),
    }));
  } catch { return []; }
}

async function containers() {
  const { code, out } = await run(`docker ps -a --format '{{json .}}'`);
  if (code !== 0) return [];
  return out.trim().split('\n').filter(Boolean).map(l => {
    const c = JSON.parse(l);
    return { name: c.Names, state: c.State, status: c.Status, ports: c.Ports, project: c.Labels.match(/com\.docker\.compose\.project=([^,]+)/)?.[1] };
  });
}

function portOpen(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const s = net.connect({ port, host, timeout: 500 });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

async function collect(config) {
  const [compose, ctrs] = await Promise.all([composeProjects(), containers()]);
  const groups = await Promise.all(config.groups.map(async g => ({
    id: g.id,
    projects: await Promise.all(g.projects.map(async p => {
      const cp = compose.find(c => c.dirs.includes(p.path));
      return {
        id: p.id,
        git: await gitInfo(p.path),
        compose: cp ? { name: cp.name, status: cp.status } : null,
        containers: cp ? ctrs.filter(c => c.project === cp.name) : [],
      };
    })),
  })));
  return {
    groups,
    services: services.list(),
    snapshots: snapshots.list().map(({ files, ...m }) => ({ ...m, migrations: files ? Object.keys(files).length : undefined })),
    ports: { frontend: await portOpen(3000), db: await portOpen(5432) },
    foreignContainers: ctrs.filter(c => !c.project),
  };
}

async function branches(dir) {
  const { out } = await run(`git for-each-ref --sort=-committerdate --format='%(refname:short)' refs/heads refs/remotes`, { cwd: dir });
  const seen = new Set();
  return out.split('\n').map(b => b.trim()).filter(b => b && !b.endsWith('/HEAD') && b !== 'origin')
    .map(b => b.replace(/^origin\//, ''))
    .filter(b => !seen.has(b) && seen.add(b));
}

async function stashes(dir) {
  const { out } = await run(`git stash list --format='%gd%x09%cr%x09%gs'`, { cwd: dir });
  return out.trim().split('\n').filter(Boolean).map(l => {
    const [ref, when, msg] = l.split('\t');
    return { value: ref, label: msg, meta: when };
  });
}

function files(dir, ext) {
  try {
    return fs.readdirSync(dir)
      .filter(f => !ext || f.endsWith(ext))
      .map(f => { const st = fs.statSync(path.join(dir, f)); return { name: f, size: st.size, mtime: st.mtimeMs }; })
      .sort((a, b) => b.mtime - a.mtime);
  } catch { return []; }
}

module.exports = { collect, branches, files, stashes };

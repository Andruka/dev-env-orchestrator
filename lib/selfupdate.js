// Обновление самой панели: если она установлена из git-репозитория — проверка новых коммитов (git fetch)
// и обновление «fast-forward» (git pull --ff-only) с перезапуском. Панель не коммитит и не пушит.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { run } = require('./proc');

const DIR = path.join(__dirname, '..');
const isGit = () => fs.existsSync(path.join(DIR, '.git'));
const version = () => JSON.parse(fs.readFileSync(path.join(DIR, 'package.json'), 'utf8')).version;

let cache = null;
const TTL = 6 * 3600 * 1000;

async function git(args, timeout) {
  return run(`git ${args}`, { cwd: DIR, timeout });
}

async function state() {
  const base = { version: version(), git: isGit(), checkedAt: Date.now() };
  if (!base.git) return { ...base, note: 'Панель установлена из установщика (.run): для обновления запустите новую версию установщика — настройки сохранятся.' };
  const [branch, up, dirty, head] = await Promise.all([
    git('rev-parse --abbrev-ref HEAD'), git('rev-parse --abbrev-ref --symbolic-full-name @{u}'),
    git('status --porcelain'), git('rev-parse --short HEAD'),
  ]);
  const out = { ...base, branch: branch.out.trim(), commit: head.out.trim(), dirty: Boolean(dirty.out.trim()) };
  if (up.code !== 0) return { ...out, behind: 0, ahead: 0, note: 'У ветки нет upstream — проверять обновления не с чем.' };
  const [counts, log] = await Promise.all([git('rev-list --left-right --count HEAD...@{u}'), git(`log --format=%s HEAD..@{u} -n 15`)]);
  const [ahead, behind] = counts.out.trim().split(/\s+/).map(Number);
  return { ...out, upstream: up.out.trim(), ahead: ahead || 0, behind: behind || 0, subjects: log.out.split('\n').filter(Boolean) };
}

async function check({ fresh = false } = {}) {
  if (cache && !fresh && Date.now() - cache.checkedAt < TTL) return cache;
  if (isGit()) {
    const f = await git('fetch --quiet', 25000);
    cache = { ...(await state()), ...(f.code !== 0 && { error: `git fetch не удался: ${f.out.trim().split('\n').pop()}` }) };
  } else cache = await state();
  return cache;
}

// Обновить и перезапустить панель. Не трогаем, если выполняется задача или в папке панели есть свои правки.
async function apply({ busy }) {
  if (!isGit()) throw Object.assign(new Error('Панель установлена не из git — обновите её установщиком'), { code: 400 });
  if (busy) throw Object.assign(new Error('Сейчас выполняется задача — дождитесь её завершения'), { code: 409 });
  const s = await state();
  if (s.dirty) throw Object.assign(new Error('В папке панели есть незакоммиченные изменения — обновление остановлено, чтобы их не потерять'), { code: 409 });
  if (s.ahead) throw Object.assign(new Error('В локальной ветке панели есть свои коммиты — fast-forward невозможен'), { code: 409 });
  if (!s.behind) return { ok: true, updated: false, note: 'Уже последняя версия' };
  const pull = await git('pull --ff-only', 60000);
  if (pull.code !== 0) throw new Error(`git pull: ${pull.out.trim().split('\n').pop()}`);
  cache = null;
  const after = version();
  setTimeout(() => {
    const launcher = path.join(DIR, 'bin', 'dev-panel');
    if (fs.existsSync(launcher)) spawn('bash', [launcher, 'restart'], { detached: true, stdio: 'ignore' }).unref();
  }, 600);
  return { ok: true, updated: true, from: s.version, to: after, restarting: fs.existsSync(path.join(DIR, 'bin', 'dev-panel')), note: `Получено коммитов: ${s.behind}` };
}

// Список изменений из CHANGELOG.md: [{ version, date, items: [] }]
function changelog(limit = 8) {
  let text;
  try { text = fs.readFileSync(path.join(DIR, 'CHANGELOG.md'), 'utf8'); } catch { return []; }
  const out = [];
  for (const block of text.split(/^## /m).slice(1)) {
    const [head, ...rest] = block.split('\n');
    const m = head.match(/^\[?([\d.]+)\]?\s*(?:[—-]\s*(.+))?$/);
    if (!m) continue;
    out.push({ version: m[1], date: (m[2] || '').trim(), items: rest.map(l => l.match(/^\s*[-*]\s+(.*)$/)?.[1]).filter(Boolean) });
  }
  return out.slice(0, limit);
}

module.exports = { check, state, apply, changelog, version };

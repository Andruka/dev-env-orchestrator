const { render } = require('./template');
const stepTypes = require('./steps');
const hints = require('./hints');
const networks = require('./networks');
const bus = require('./bus');

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_JOBS = 50;
const MAX_LOG = 5000;
const SAVED_LOG = 1500; // строк лога на задачу в сохранённой истории
const jobs = [];
const busyGroups = new Map(); // group -> jobId
let seq = 0;

// История запусков переживает перезапуск панели: ~/.local/state/dev-panel/jobs.json (права 600, в логах могут быть пути и вывод команд)
const HISTORY = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'dev-panel', 'jobs.json');

function saveHistory() {
  try {
    fs.mkdirSync(path.dirname(HISTORY), { recursive: true, mode: 0o700 });
    const data = jobs.filter(j => j.status !== 'running').map(j => ({ ...summary(j), log: j.log.slice(-SAVED_LOG) }));
    const tmp = `${HISTORY}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, HISTORY);
  } catch { /* история — удобство, а не данные: сбой записи не должен ронять задачу */ }
}

function loadHistory() {
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY, 'utf8'));
    for (const j of data.slice(0, MAX_JOBS)) {
      jobs.push({ ...j, cancelHandlers: [], flags: {}, restored: true });
      seq = Math.max(seq, j.id);
    }
  } catch { /* истории ещё нет или файл повреждён */ }
}

// Разворачивает вложенные action-шаги в плоский список
function expand(actions, actionId, depth = 0) {
  const action = actions[actionId];
  if (!action) throw new Error(`Неизвестное действие: ${actionId}`);
  if (depth > 10) throw new Error('Слишком глубокая вложенность действий');
  return action.steps.flatMap(step =>
    step.type === 'action'
      ? expand(actions, step.action, depth + 1).map(s => ({
        ...s, if: s.if || step.if, unless: s.unless || step.unless,
      }))
      : [{ ...step, title: step.title || action.title }]
  );
}

// Значения параметров попадают в команды только через переменные окружения P_<name>,
// а в шаблоны {name} — для заголовков. Дополнительно проверяем формат по типу.
const VALIDATORS = {
  gitBranch: v => /^(?!-)(?!\.+$)[\w./@+-]+$/.test(v),
  stash: v => /^stash@\{\d+\}$/.test(v),
  file: v => !v.includes('/') && !v.startsWith('.'),
  snapshot: v => /^[\w.-]+$/.test(v),
};

function validateParams(action, params) {
  for (const p of action.params || []) {
    const v = params[p.name];
    if ((v === undefined || v === '') && !p.optional) throw new Error(`Не задан параметр «${p.title || p.name}»`);
    if (v && VALIDATORS[p.type] && !VALIDATORS[p.type](String(v))) throw new Error(`Недопустимое значение «${p.title || p.name}»: ${v}`);
  }
}

// rev растёт с каждым изменением: клиент по нему отбрасывает устаревшие состояния
// (например, ответ на /api/run, пришедший позже события о завершении быстрой задачи)
function emitJob(job) {
  job.rev = (job.rev || 0) + 1;
  bus.emit('job', summary(job));
}

function summary(j) {
  const { log, cancelHandlers, flags, ...rest } = j;
  return rest;
}

function list() {
  return jobs.map(summary);
}

function get(id) {
  return jobs.find(j => j.id === Number(id));
}

function start(config, { actionId, project, params = {} }) {
  const action = config.actions[actionId];
  if (!action) throw new Error(`Неизвестное действие: ${actionId}`);
  if (busyGroups.has(project.group)) {
    throw new Error(`В группе уже выполняется задача #${busyGroups.get(project.group)}`);
  }
  validateParams(action, params);
  const tctx = { ...config.vars, ...params, project };
  const penv = Object.fromEntries(Object.entries(params).map(([k, v]) => [`P_${k}`, String(v ?? '')]));
  const steps = expand(config.actions, actionId)
    .map(s => render(s, tctx))
    .map(s => ({ ...s, env: { ...penv, ...s.env } }));
  const job = {
    id: ++seq,
    action: actionId,
    title: action.title,
    project: project.name,
    group: project.group,
    params,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    steps: steps.map(s => ({ title: s.title, type: s.type, status: 'pending', progress: null })),
    log: [],
    cancelHandlers: [],
    cancelled: false,
    flags: {},
  };
  jobs.unshift(job);
  if (jobs.length > MAX_JOBS) jobs.pop();
  busyGroups.set(project.group, job.id);
  emitJob(job);
  execute(job, steps, project, config).finally(() => {
    busyGroups.delete(project.group);
    job.finishedAt = Date.now();
    if (job.status === 'failed') {
      job.hints = hints.analyze(job.log, job.error);
      for (const h of job.hints) if (h.fix?.kind === 'networks') h.fix.subnets = networks.composeSubnets(path.join(project.path, config.vars?.composeFile || 'docker-compose.yml'));
    }
    emitJob(job);
    saveHistory();
    try { module.exports.onFinish?.(summary(job)); } catch { /* журнал не должен ломать задачу */ }
  });
  return summary(job);
}

async function execute(job, steps, project, config) {
  const log = line => {
    job.log.push(line);
    if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG);
    bus.emit('jobLog', { id: job.id, line });
  };
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const st = job.steps[i];
    if (job.cancelled) { st.status = 'skipped'; continue; }
    // Условные шаги: if / unless — имя флага, который выставил предыдущий шаг (например, snapshotRestore)
    if ((step.if && !job.flags[step.if]) || (step.unless && job.flags[step.unless])) {
      st.status = 'skipped';
      log(`━━ [${i + 1}/${steps.length}] ${step.title} — пропущено`);
      emitJob(job);
      continue;
    }
    st.status = 'running';
    emitJob(job);
    log(`━━ [${i + 1}/${steps.length}] ${step.title}`);
    const ctx = {
      cwd: project.path,
      project,
      config,
      flags: job.flags,
      log,
      progress: pct => { st.progress = pct; bus.emit('jobProgress', { id: job.id, step: i, pct }); },
      onCancel: fn => job.cancelHandlers.push(fn),
      throwIfCancelled: () => { if (job.cancelled) throw new Error('отменено'); },
      sleep: ms => new Promise(r => setTimeout(r, ms)),
    };
    try {
      const impl = stepTypes[step.type];
      if (!impl) throw new Error(`Неизвестный тип шага: ${step.type}`);
      await impl(step, ctx);
      ctx.throwIfCancelled();
      st.status = 'done';
    } catch (e) {
      st.status = job.cancelled ? 'cancelled' : 'failed';
      job.status = job.cancelled ? 'cancelled' : 'failed';
      job.error = e.message;
      log(`✖ ${e.message}`);
      for (let k = i + 1; k < steps.length; k++) job.steps[k].status = 'skipped';
      return;
    } finally {
      job.cancelHandlers = [];
    }
  }
  job.status = 'done';
  log('✔ Готово');
}

function cancel(id) {
  const job = get(id);
  if (!job || job.status !== 'running') return false;
  job.cancelled = true;
  job.cancelHandlers.forEach(fn => fn());
  return true;
}

loadHistory();

module.exports = { start, list, get, cancel };

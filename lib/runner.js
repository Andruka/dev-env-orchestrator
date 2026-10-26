const { render } = require('./template');
const stepTypes = require('./steps');
const bus = require('./bus');

const MAX_JOBS = 50;
const MAX_LOG = 5000;
const jobs = [];
const busyGroups = new Map(); // group -> jobId
let seq = 0;

// Разворачивает вложенные action-шаги в плоский список
function expand(actions, actionId, depth = 0) {
  const action = actions[actionId];
  if (!action) throw new Error(`Неизвестное действие: ${actionId}`);
  if (depth > 10) throw new Error('Слишком глубокая вложенность действий');
  return action.steps.flatMap(step =>
    step.type === 'action'
      ? expand(actions, step.action, depth + 1)
      : [{ ...step, title: step.title || action.title }]
  );
}

function summary(j) {
  const { log, cancelHandlers, ...rest } = j;
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
  const tctx = { ...config.vars, ...params, project };
  const steps = expand(config.actions, actionId).map(s => render(s, tctx));
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
  };
  jobs.unshift(job);
  if (jobs.length > MAX_JOBS) jobs.pop();
  busyGroups.set(project.group, job.id);
  bus.emit('job', summary(job));
  execute(job, steps, project).finally(() => {
    busyGroups.delete(project.group);
    job.finishedAt = Date.now();
    bus.emit('job', summary(job));
  });
  return summary(job);
}

async function execute(job, steps, project) {
  const log = line => {
    job.log.push(line);
    if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG);
    bus.emit('jobLog', { id: job.id, line });
  };
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const st = job.steps[i];
    if (job.cancelled) { st.status = 'skipped'; continue; }
    st.status = 'running';
    bus.emit('job', summary(job));
    log(`━━ [${i + 1}/${steps.length}] ${step.title}`);
    const ctx = {
      cwd: project.path,
      project,
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

module.exports = { start, list, get, cancel };

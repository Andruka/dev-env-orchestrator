// Проверка окружения: что нужно панели для работы и чего не хватает.
// Каждый пункт: { id, title, status: ok|warn|fail, detail, fix? }. fail — без этого не заработает,
// warn — часть возможностей недоступна.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { execFile } = require('child_process');
const { which } = require('./config');
const snapshots = require('./snapshots');
const secrets = require('./secrets');

function exec(cmd, args, timeout = 6000) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim(), err }));
  });
}

const item = (id, title, status, detail, fix) => ({ id, title, status, detail, ...(fix && { fix }) });

function portBusy(port) {
  return new Promise(resolve => {
    const s = net.connect({ port, host: '127.0.0.1', timeout: 400 });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

async function run(config) {
  const v = config.vars;
  const out = [];

  const major = Number(process.versions.node.split('.')[0]);
  out.push(major >= 22
    ? item('node', 'Node.js', 'ok', `v${process.versions.node}`)
    : item('node', 'Node.js', 'fail', `v${process.versions.node}, нужна 22+`, 'Установите Node.js 22 LTS: https://nodejs.org или через nvm (nvm install 22)'));

  const [git, docker, compose, dockerInfo] = await Promise.all([
    exec('git', ['--version']), exec('docker', ['--version']), exec('docker', ['compose', 'version']),
    which('docker') ? exec('docker', ['info', '--format', '{{.ServerVersion}}'], 10000) : { ok: false, out: '' },
  ]);
  out.push(git.ok ? item('git', 'git', 'ok', git.out) : item('git', 'git', 'fail', 'не найден', 'sudo apt install git'));
  out.push(docker.ok ? item('docker', 'docker', 'ok', docker.out) : item('docker', 'docker', 'fail', 'не найден', 'Установите Docker Engine: https://docs.docker.com/engine/install/'));
  out.push(compose.ok ? item('compose', 'docker compose', 'ok', compose.out) : item('compose', 'docker compose', 'fail', 'плагин compose не найден', 'sudo apt install docker-compose-plugin'));
  if (docker.ok) {
    out.push(dockerInfo.ok
      ? item('dockerd', 'Доступ к docker', 'ok', `сервер ${dockerInfo.out}`)
      : item('dockerd', 'Доступ к docker', 'fail', dockerInfo.out.split('\n').pop().slice(0, 160),
        'Добавьте себя в группу docker: sudo usermod -aG docker $USER — затем выйдите из системы и войдите снова. Проверьте, что служба docker запущена'));
  }

  out.push(which('zstd') ? item('zstd', 'zstd', 'ok', 'есть') : item('zstd', 'zstd', 'fail', 'нужен для снимков БД', 'sudo apt install zstd'));
  out.push(which('tar') ? item('tar', 'tar', 'ok', 'есть') : item('tar', 'tar', 'fail', 'не найден', 'sudo apt install tar'));

  const browser = v.browserCmd && (which(v.browserCmd) || fs.existsSync(v.browserCmd));
  out.push(browser
    ? item('browser', 'Браузер для фронтенда', 'ok', v.browserCmd)
    : item('browser', 'Браузер для фронтенда', 'warn', 'Brave/Chrome/Chromium не найден — кнопки «Браузер» и «Войти» не заработают',
      'Установите Brave или Chromium либо укажите команду браузера в Настройки → Окружение'));
  out.push(which('xdotool') ? item('xdotool', 'xdotool', 'ok', 'есть') : item('xdotool', 'xdotool', 'warn', 'повторный запуск не будет поднимать уже открытое окно', 'sudo apt install xdotool'));
  out.push(which('systemd-run') ? item('systemd', 'systemd --user', 'ok', 'процессы запускаются в своих scope') : item('systemd', 'systemd --user', 'warn', 'нет systemd-run: процессы не защищены от systemd-oomd'));
  out.push(which('xhost') ? item('xhost', 'xhost', 'ok', 'есть') : item('xhost', 'xhost', 'warn', 'dup вызывает xhost (доступ контейнера к экрану); без него это просто пропускается', 'sudo apt install x11-xserver-utils'));

  if (!v.calplanRoot) {
    out.push(item('root', 'Папка с репозиториями CalPlan', 'fail', 'не указана', 'Настройки → Репозитории → «Корневая папка»'));
  } else if (!fs.existsSync(v.calplanRoot)) {
    out.push(item('root', 'Папка с репозиториями CalPlan', 'fail', `нет папки ${v.calplanRoot}`, 'Укажите существующую папку в Настройки → Окружение'));
  } else {
    out.push(item('root', 'Папка с репозиториями CalPlan', 'ok', v.calplanRoot));
  }
  const projects = config.groups.flatMap(g => g.projects);
  out.push(projects.length
    ? item('projects', 'Репозитории в панели', 'ok', `${projects.length}`)
    : item('projects', 'Репозитории в панели', 'warn', 'ни одного', 'Настройки → Репозитории → «Добавить»'));
  const backend = config.groups.find(g => g.kind === 'compose');
  if (backend?.projects.length) {
    const missing = backend.projects.filter(p => !fs.existsSync(path.join(p.path, v.composeFile)));
    out.push(missing.length
      ? item('composefile', 'Файл compose', 'warn', `нет ${v.composeFile} в: ${missing.map(p => p.name).join(', ')}`, 'Укажите имя файла в Настройки → Окружение')
      : item('composefile', 'Файл compose', 'ok', v.composeFile));
  }
  for (const [id, key, title, hint] of [['dumps', 'dumpsDir', 'Папка с дампами', 'нужна только для «Накатить дамп»'], ['dbdata', 'dbDataDir', 'Папка данных БД', 'создаётся docker compose при первом запуске']]) {
    if (v[key]) out.push(fs.existsSync(v[key]) ? item(id, title, 'ok', v[key]) : item(id, title, 'warn', `${v[key]} — папки пока нет (${hint})`));
  }

  snapshots.configure(v);
  const snapDir = snapshots.dir();
  if (v.snapshotsDir && !require('path').isAbsolute(snapshots.expand(v.snapshotsDir))) {
    out.push(item('disk', 'Папка снимков БД', 'warn', `${v.snapshotsDir} — путь не абсолютный, используется ${snapDir}`, 'Укажите полный путь в Настройки → Окружение → Снимки БД'));
  } else if (!snapshots.enabled()) {
    out.push(item('disk', 'Снимки БД', 'ok', `создание отключено в настройках (уже сохранённые: ${snapDir})`));
  } else {
    try {
      fs.mkdirSync(snapDir, { recursive: true });
      const st = fs.statfsSync(snapDir);
      const freeGb = (st.bavail * st.bsize) / 1024 ** 3;
      out.push(freeGb >= 20
        ? item('disk', 'Место под снимки БД', 'ok', `свободно ${freeGb.toFixed(0)} ГБ в ${snapDir}`)
        : item('disk', 'Место под снимки БД', 'warn', `свободно ${freeGb.toFixed(1)} ГБ в ${snapDir}`, 'Снимок БД занимает несколько гигабайт; освободите место, выберите другую папку или отключите снимки (Настройки → Окружение)'));
    } catch (e) {
      out.push(item('disk', 'Место под снимки БД', 'warn', e.message, 'Выберите доступную для записи папку в Настройки → Окружение → Снимки БД'));
    }
  }

  const { auth } = secrets.read();
  out.push(auth.login && auth.password
    ? item('creds', 'Логин для фронтенда', 'ok', auth.login)
    : item('creds', 'Логин для фронтенда', 'warn', 'не задан — кнопка «Войти» и автопродление не работают', 'Настройки → Вход'));

  const ports = [[Number(v.frontendPort), 'фронтенд'], [Number(v.dbPort), 'PostgreSQL']];
  const busy = await Promise.all(ports.map(([p]) => portBusy(p)));
  ports.forEach(([p, what], i) => out.push(item(`port${p}`, `Порт ${p} (${what})`, 'ok', busy[i] ? 'занят — вероятно, уже запущено' : 'свободен')));

  out.push(item('platform', 'Система', os.platform() === 'linux' ? 'ok' : 'warn', `${os.platform()} ${os.release()}`, os.platform() === 'linux' ? undefined : 'Панель рассчитана на Linux'));
  return out;
}

module.exports = { run };

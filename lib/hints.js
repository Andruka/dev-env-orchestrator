// Подсказки по типичным ошибкам: по тексту лога и ошибки находим понятную причину и, если можно, готовое действие.
// fix: { kind: 'port', port } — освободить порт; { kind: 'tab', tab, sub? } — открыть раздел настроек; { kind: 'copy', text } — команда для терминала.
const RULES = [
  {
    id: 'port',
    re: /(?:Bind for [\d.:[\]]*?:(\d+) failed: port is already allocated|address already in use[^\n]*?:(\d+)|EADDRINUSE[^\n]*?:(\d+)|port (\d+) is already (?:in use|allocated))/i,
    make: m => {
      const port = Number(m.slice(1).find(Boolean));
      return { title: `Порт ${port} занят`, text: 'Другая программа уже слушает этот порт. Посмотрите, кто это, и при желании освободите.', fix: { kind: 'port', port } };
    },
  },
  { id: 'dockerd', re: /Cannot connect to the Docker daemon|Is the docker daemon running/i,
    make: () => ({ title: 'Docker не запущен', text: 'Служба docker не отвечает. Запустите её и повторите.', fix: { kind: 'copy', text: 'sudo systemctl start docker' } }) },
  { id: 'dockergroup', re: /permission denied[^\n]*docker\.sock|permission denied while trying to connect to the (?:Docker|docker) daemon/i,
    make: () => ({ title: 'Нет доступа к docker', text: 'Ваш пользователь не в группе docker. Добавьте его, затем выйдите из системы и войдите снова.', fix: { kind: 'copy', text: 'sudo usermod -aG docker $USER' } }) },
  { id: 'space', re: /no space left on device/i,
    make: () => ({ title: 'Закончилось место на диске', text: 'Освободите место: старые снимки БД, дампы и образы docker можно удалить в разделе «Место на диске».', fix: { kind: 'tab', tab: 'doctor', sub: 'disk' } }) },
  { id: 'overwrite', re: /Your local changes to the following files would be overwritten|Please commit your changes or stash them/i,
    make: () => ({ title: 'В репозитории есть несохранённые изменения', text: 'Git не даёт переключиться, пока файлы изменены. Уберите изменения в stash кнопкой «В stash» в карточке проекта и повторите.' }) },
  { id: 'nobranch', re: /pathspec '([^']+)' did not match/i,
    make: m => ({ title: `Нет ветки «${m[1]}»`, text: 'Такой ветки нет локально и в origin. Нажмите «Подтянуть», чтобы получить новые ветки, и выберите её из списка.' }) },
  { id: 'ssh', re: /Permission denied \(publickey\)|Authentication failed for|could not read Username/i,
    make: () => ({ title: 'Git не пустил в репозиторий', text: 'Проверьте SSH-ключ или токен для этого репозитория: git должен работать без ввода пароля.' }) },
  { id: 'login', re: /HTTP 40[13][^\n]*|Неверн\w+ (?:логин|пароль)/i,
    make: () => ({ title: 'Вход не принят', text: 'Стенд отклонил логин или пароль. Проверьте их у стенда и нажмите «Проверить соединение».', fix: { kind: 'tab', tab: 'stands' } }) },
  { id: 'pgdata', re: /нет папки pgdata/i,
    make: () => ({ title: 'Папка данных БД указана неверно', text: 'В указанной папке нет pgdata. Сверьте «Корневую папку» и «Папку данных БД» с volumes у сервиса БД в compose-файле.', fix: { kind: 'tab', tab: 'env' } }) },
  { id: 'zstd', re: /zstd: (?:command )?not found|zstd: команда не найдена/i,
    make: () => ({ title: 'Не установлен zstd', text: 'Он нужен для снимков БД.', fix: { kind: 'copy', text: 'sudo apt install zstd' } }) },
  { id: 'watchers', re: /ENOSPC: System limit for number of file watchers/i,
    make: () => ({ title: 'Лимит наблюдателей за файлами', text: 'Увеличьте fs.inotify.max_user_watches.', fix: { kind: 'copy', text: 'echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p' } }) },
  { id: 'npmeacces', re: /npm (?:ERR!|error) (?:code )?EACCES/i,
    make: () => ({ title: 'npm: нет прав на запись', text: 'Файлы в node_modules созданы другим пользователем (например, root). Удалите папку node_modules и выполните «npm ci (заново)».' }) },
  { id: 'migration', re: /liquibase[^\n]*(?:ERROR|Exception)|Migration failed/i,
    make: () => ({ title: 'Ошибка миграции БД', text: 'Скорее всего, база не подходит этой ветке. Восстановите подходящий снимок БД («Снимки БД») или накатите дамп заново.' }) },
];

// Ищем в хвосте лога и в тексте ошибки; один и тот же совет не повторяем
function analyze(log = [], error = '') {
  const text = `${log.slice(-250).join('\n')}\n${error || ''}`;
  const out = [];
  for (const r of RULES) {
    const m = text.match(r.re);
    if (m) out.push({ id: r.id, ...r.make(m) });
  }
  return out.slice(0, 3);
}

module.exports = { analyze, RULES };

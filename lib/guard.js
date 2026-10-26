// Защита от изменений в удалённых репозиториях и истории.
// Панель может только переключать ветки, подтягивать изменения (fast-forward) и работать со stash.

const ALLOWED = new Set([
  'status', 'fetch', 'checkout', 'switch', 'pull', 'stash', 'log', 'show', 'diff',
  'branch', 'rev-parse', 'for-each-ref', 'submodule', 'ls-files', 'describe', 'rev-list',
]);

// Запрещённые формы разрешённых команд
const DENIED_ARGS = {
  checkout: args => /(^|\s)(--|\.|-f|--force|-p|--patch|--ours|--theirs)(\s|$)/.test(args) && 'git checkout разрешён только для переключения веток (для отмены изменений используйте stash)',
  switch: args => /(^|\s)(-f|--force|--discard-changes)(\s|$)/.test(args) && 'принудительное переключение запрещено',
  stash: args => /^\s*clear\b/.test(args) && 'git stash clear запрещён',
  pull: args => !/(^|\s)--ff-only(\s|$)/.test(args) && 'git pull разрешён только с --ff-only',
  branch: args => /(^|\s)-(d|D|m|M|c|C|f|u)\b|--(delete|move|copy|force|set-upstream|unset-upstream)/.test(args) && 'изменение веток через git branch запрещено',
  submodule: args => /\b(add|deinit|set-url|set-branch|foreach)\b/.test(args) && 'разрешены только submodule update/status/sync',
};

// git [глобальные опции] <подкоманда> <аргументы до ; & | или конца строки>
const GIT_RE = /(?:^|[\s;&|(`$])git((?:\s+(?:-C\s+\S+|-c\s+\S+|--[\w-]+(?:=\S+)?|-[a-zA-Z]))*)\s+([a-z][\w-]*)([^;&|\n)`]*)/g;

function check(cmd) {
  for (const m of String(cmd).matchAll(GIT_RE)) {
    const [, , sub, args] = m;
    if (!ALLOWED.has(sub)) throw new Error(`Команда "git ${sub}" запрещена в панели (только чтение, ветки, pull, stash)`);
    const why = DENIED_ARGS[sub]?.(args);
    if (why) throw new Error(why);
  }
  if (/\b(gh|glab)\s/.test(cmd)) throw new Error('CLI GitHub/GitLab запрещены в панели');
}

// Подмена push-адреса для всех git-процессов панели: даже если команда проскочит проверку, push не уйдёт
const ENV = {
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'remote.origin.pushurl',
  GIT_CONFIG_VALUE_0: 'disabled://push-is-disabled-in-dev-panel',
  GIT_CONFIG_KEY_1: 'remote.pushDefault',
  GIT_CONFIG_VALUE_1: 'push-is-disabled-in-dev-panel',
  GIT_TERMINAL_PROMPT: '0',
};

module.exports = { check, ENV };

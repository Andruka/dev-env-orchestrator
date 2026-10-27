#!/usr/bin/env bash
# Установщик Dev Panel @VERSION@ (самораспаковывающийся: архив с панелью лежит в конце этого файла).
#
#   ./dev-panel-@VERSION@.run              установить или обновить (с интерактивной настройкой)
#   ./dev-panel-@VERSION@.run --yes        без вопросов (значения по умолчанию)
#   ./dev-panel-@VERSION@.run --no-setup   только скопировать файлы
#   ./dev-panel-@VERSION@.run --uninstall  удалить панель (настройки и снимки БД остаются)
#   ./dev-panel-@VERSION@.run --uninstall --purge   удалить вместе с настройками и состоянием
#   --prefix ДИР   куда ставить (по умолчанию ~/.local/share/dev-panel)
set -euo pipefail

VERSION="@VERSION@"
PREFIX="${XDG_DATA_HOME:-$HOME/.local/share}/dev-panel"
BINDIR="$HOME/.local/bin"
YES=0 SETUP=1 START=1 UNINSTALL=0 PURGE=0

if [[ -t 1 ]]; then B=$'\e[1m' D=$'\e[2m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' X=$'\e[0m'; else B= D= G= Y= R= X=; fi
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✔%s %s\n' "$G" "$X" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$X" "$*"; }
die()  { printf '%s✖ %s%s\n' "$R" "$*" "$X" >&2; exit 1; }
ask()  { # ask "вопрос" y|n → 0, если да
  [[ $YES -eq 1 || ! -t 0 ]] && { [[ "$2" == y ]]; return; }
  local a; read -r -p "$1 [$([[ $2 == y ]] && echo Y/n || echo y/N)] " a || true
  a="${a:-$2}"; [[ "$a" =~ ^([yYдД]|yes|да)$ ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) YES=1 ;;
    --no-setup) SETUP=0 ;;
    --no-start) START=0 ;;
    --uninstall) UNINSTALL=1 ;;
    --purge) PURGE=1 ;;
    --prefix) PREFIX="$(readlink -m "${2:?нужна папка}")"; shift ;;
    --version) echo "$VERSION"; exit 0 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) die "Неизвестный параметр: $1 (см. --help)" ;;
  esac
  shift
done

APP="$PREFIX/app"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/dev-panel"
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/dev-panel"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/dev-panel"

[[ "$(uname -s)" == Linux ]] || die "Dev Panel рассчитана на Linux."
[[ $EUID -ne 0 ]] || die "Не запускайте установщик от root: панель ставится в вашу домашнюю папку."

if [[ $UNINSTALL -eq 1 ]]; then
  say "${B}Удаление Dev Panel${X}"
  if [[ -x "$APP/bin/dev-panel" ]]; then
    "$APP/bin/dev-panel" stop || true
    "$APP/bin/dev-panel" autostart off || true
    "$APP/bin/dev-panel" desktop off || true
  fi
  [[ -L "$BINDIR/dev-panel" ]] && rm -f "$BINDIR/dev-panel"
  rm -rf "$APP"
  ok "Панель удалена из $PREFIX"
  if [[ $PURGE -eq 1 ]]; then
    if ask "Удалить ВСЕ настройки, пароль, логи и снимки БД ($CONF, $STATE, $DATA/snapshots)?" n; then
      rm -rf "$CONF" "$STATE" "$DATA/snapshots"; ok "Настройки и состояние удалены"
    fi
  else
    say "${D}Настройки ($CONF) и снимки БД ($DATA/snapshots) оставлены. Убрать всё: --uninstall --purge${X}"
  fi
  exit 0
fi

say "${B}Установка Dev Panel $VERSION${X}"

# --- что нужно для работы ---
if ! command -v node >/dev/null; then
  die "Не найден Node.js. Нужна версия 22 или новее.
  Установка: https://nodejs.org (LTS) или через nvm:  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash && nvm install 22"
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 22 ]] || die "Node.js $(node -v) слишком старый, нужна версия 22+ (nvm install 22)."
ok "Node.js $(node -v)"
for t in tar gzip curl; do command -v "$t" >/dev/null || die "Не найден $t — установите его (sudo apt install $t)."; done
for t in git docker zstd; do
  if command -v "$t" >/dev/null; then ok "$t"; else warn "$t не найден — без него часть функций не заработает (подробности: dev-panel doctor)"; fi
done

# --- распаковка ---
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
LINE="$(awk '/^__ARCHIVE_BELOW__$/ { print NR + 1; exit }' "$0")"
[[ -n "$LINE" ]] || die "Повреждён установщик: нет архива."
tail -n +"$LINE" "$0" | tar -xz -C "$TMP" || die "Не удалось распаковать архив (файл скачан не полностью?)."
[[ -f "$TMP/app/server.js" ]] || die "В архиве нет панели."

# --- установка поверх старой версии: сначала остановить её, сервисы (dup, npm start) не трогаем ---
if [[ -x "$APP/bin/dev-panel" ]]; then
  OLD="$("$APP/bin/dev-panel" version 2>/dev/null || echo '?')"
  say "Найдена установленная версия $OLD — обновляю."
  "$APP/bin/dev-panel" stop >/dev/null 2>&1 || true
  rm -rf "$APP.old"; mv "$APP" "$APP.old"
fi
mkdir -p "$PREFIX" "$BINDIR"
mv "$TMP/app" "$APP"
rm -rf "$APP.old"
ln -sfn "$APP/bin/dev-panel" "$BINDIR/dev-panel"
ok "Файлы установлены в $APP"
ok "Команда dev-panel: $BINDIR/dev-panel"
case ":$PATH:" in *":$BINDIR:"*) ;; *) warn "$BINDIR нет в PATH. Добавьте в ~/.bashrc:  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;; esac

"$APP/bin/dev-panel" desktop on >/dev/null && ok "Значок «Dev Panel» добавлен в меню приложений" || warn "Не удалось добавить значок в меню"

# --- настройка ---
if [[ $SETUP -eq 1 ]]; then
  if [[ $YES -eq 1 || ! -t 0 ]]; then
    "$APP/bin/dev-panel" setup --yes || warn "Настройка не завершена — запустите: dev-panel setup"
  else
    "$APP/bin/dev-panel" setup || warn "Настройка не завершена — запустите: dev-panel setup"
  fi
fi

if ask "Запускать Dev Panel автоматически при входе в систему?" n; then "$APP/bin/dev-panel" autostart on; fi

say ""
ok "${B}Готово.${X} Запуск: ${B}dev-panel${X}  (или значок в меню приложений)"
say "${D}Проверка окружения: dev-panel doctor · настройка: dev-panel setup · инструкция: $APP/docs/GUIDE.md${X}"
if [[ $START -eq 1 ]] && ask "Запустить сейчас?" y; then
  nohup "$APP/bin/dev-panel" >/dev/null 2>&1 &
fi
exit 0
__ARCHIVE_BELOW__

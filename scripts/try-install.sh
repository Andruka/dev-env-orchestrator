#!/usr/bin/env bash
# Проба установщика «с нуля» в одноразовой «домашней папке»: ничего не попадает в ваш настоящий HOME,
# рабочая панель на :7777 не затрагивается (пробная слушает DEV_PANEL_PORT, по умолчанию 7791).
# Использование: scripts/try-install.sh [путь-к-.run] [каталог]      Убрать всё:  scripts/try-install.sh --clean [каталог]
# Не изолирован docker: кнопки docker compose работают с настоящим демоном — не нажимайте «Развернуть с нуля».
set -euo pipefail
DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
if [[ "${1:-}" == --clean ]]; then
  T="${2:-${TMPDIR:-/tmp}/dev-panel-trial}"
  if [[ -x "$T/home/.local/share/dev-panel/app/bin/dev-panel" ]]; then
    HOME="$T/home" XDG_CONFIG_HOME="$T/home/.config" XDG_STATE_HOME="$T/home/.local/state" XDG_DATA_HOME="$T/home/.local/share" \
      DEV_PANEL_PORT="${DEV_PANEL_PORT:-7791}" "$T/home/.local/share/dev-panel/app/bin/dev-panel" stop || true
  fi
  rm -rf "$T"; echo "Пробная среда удалена: $T"; exit 0
fi
RUN="${1:-$(ls -t "$DIR"/dist/dev-panel-*.run | head -1)}"
T="${2:-${TMPDIR:-/tmp}/dev-panel-trial}"
[[ -f "$RUN" ]] || { echo "Нет установщика: $RUN (соберите: npm run build:installer)"; exit 1; }
rm -rf "$T"; mkdir -p "$T/home/work/calplan"
for r in server CLIENT; do
  mkdir -p "$T/home/work/calplan/$r"
  git -C "$T/home/work/calplan/$r" init -q -b main
  git -C "$T/home/work/calplan/$r" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
done
export HOME="$T/home" XDG_CONFIG_HOME="$T/home/.config" XDG_STATE_HOME="$T/home/.local/state" XDG_DATA_HOME="$T/home/.local/share"
export DEV_PANEL_PORT="${DEV_PANEL_PORT:-7791}" PATH="$T/home/.local/bin:$PATH"
cat <<MSG
Пробная среда: $T   (HOME=$HOME)
Папка с тестовыми репозиториями, её можно указать в вопросе №1: $T/home/work/calplan
Панель после установки откроется на http://localhost:$DEV_PANEL_PORT
MSG
bash "$RUN"
echo
echo "Готово. Этот терминал работает в пробной среде: dev-panel status | doctor | stop."
echo "Убрать всё: $DIR/scripts/try-install.sh --clean   (или закройте терминал и удалите $T)"
exec bash

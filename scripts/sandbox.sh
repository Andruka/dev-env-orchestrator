#!/usr/bin/env bash
# Изолированный экземпляр панели для проверок: свой HOME, свои конфиги/состояние, свой порт.
# Не трогает рабочую панель и её данные. Использование: scripts/sandbox.sh [порт] [каталог]
set -euo pipefail
PORT="${1:-7790}"
SB="${2:-${TMPDIR:-/tmp}/dev-panel-sandbox}"
DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
rm -rf "$SB"; mkdir -p "$SB/home/work/calplan"
for r in server server_old CLIENT misc; do
  mkdir -p "$SB/home/work/calplan/$r"
  git -C "$SB/home/work/calplan/$r" init -q -b main
  git -C "$SB/home/work/calplan/$r" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
done
touch "$SB/home/work/calplan/server/docker-compose-without-qt.yml" "$SB/home/work/calplan/server_old/docker-compose-without-qt.yml"
export HOME="$SB/home" XDG_CONFIG_HOME="$SB/home/.config" XDG_STATE_HOME="$SB/home/.local/state" XDG_DATA_HOME="$SB/home/.local/share"
mkdir -p "$XDG_CONFIG_HOME/dev-panel"
echo "{\"vars\":{\"port\":$PORT}}" > "$XDG_CONFIG_HOME/dev-panel/config.json"
echo "sandbox: http://localhost:$PORT  (HOME=$HOME)"
cd "$DIR" && exec node server.js

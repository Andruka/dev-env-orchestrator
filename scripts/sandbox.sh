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
# файлы для проверки «Стендов»: .env отслеживается git (как в настоящем бэкенде), config.js во фронтенде — нет
R="$SB/home/work/calplan"
printf 'CP_DB_HOST=calplanDb\nBASIC_PRODUCT_PORT=5005\nPUBLIC_KEY="-----BEGIN\nAAA\n-----END"\n' > "$R/server/.env"
cp "$R/server/.env" "$R/server/.env_5005"
sed 's/5005/5008/; s/AAA/BBB/' "$R/server/.env" > "$R/server/.env_5008"
git -C "$R/server" add .env && git -C "$R/server" -c user.email=t@t -c user.name=t commit -q -m env
mkdir -p "$R/CLIENT/public"
printf "window.env = {\n  BACKEND_URL: 'https://10.0.0.1:5005',\n};\n" > "$R/CLIENT/public/config.js"
printf "window.env = {\n  BACKEND_URL: 'https://10.0.0.1:5008',\n};\n" > "$R/CLIENT/public/config5008.js"
touch "$SB/home/work/calplan/server/docker-compose-without-qt.yml" "$SB/home/work/calplan/server_old/docker-compose-without-qt.yml"
export HOME="$SB/home" XDG_CONFIG_HOME="$SB/home/.config" XDG_STATE_HOME="$SB/home/.local/state" XDG_DATA_HOME="$SB/home/.local/share"
mkdir -p "$XDG_CONFIG_HOME/dev-panel"
# репозиторий swagger для проверки группы Swagger (скрипты-пустышки)
mkdir -p "$R/swagger"; git -C "$R/swagger" init -q -b main; git -C "$R/swagger" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
printf '#!/usr/bin/env bash\necho build-ok\n' > "$R/swagger/build.sh"; printf '#!/bin/sh\necho start-ok\n' > "$R/swagger/start.sh"; touch "$R/swagger/docker-compose.yml"
# SANDBOX_ROOT=1 — сразу указать корневую папку (иначе панель стартует «с нуля», как у нового пользователя)
if [[ "${SANDBOX_ROOT:-}" == 1 ]]; then ROOTVAR=",\"calplanRoot\":\"$R\""; else ROOTVAR=""; fi
echo "{\"vars\":{\"port\":$PORT$ROOTVAR}}" > "$XDG_CONFIG_HOME/dev-panel/config.json"
echo "sandbox: http://localhost:$PORT  (HOME=$HOME)"
cd "$DIR" && exec node server.js

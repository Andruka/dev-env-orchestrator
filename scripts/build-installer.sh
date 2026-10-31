#!/usr/bin/env bash
# Собирает самораспаковывающийся установщик: dist/dev-panel-<версия>.run
# Внутри — всё, что нужно для работы (внешних зависимостей у панели нет), без тестов и служебных файлов.
set -euo pipefail
DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
cd "$DIR"
VERSION="$(node -p "require('./package.json').version")"
OUT="$DIR/dist/dev-panel-$VERSION.run"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

node --test test/*.test.js >/dev/null 2>&1 || { echo "Тесты не проходят — установщик не собран (npm test)" >&2; exit 1; }
node scripts/check-contrast.js >/dev/null || { echo "Контраст тем не проходит (node scripts/check-contrast.js)" >&2; exit 1; }

mkdir -p "$STAGE/app" dist
cp -r bin lib public assets docs defaults.json package.json README.md CHANGELOG.md server.js "$STAGE/app/"
[[ -f LICENSE ]] && cp LICENSE "$STAGE/app/"
mkdir -p "$STAGE/app/plugins/steps"
echo "$VERSION" > "$STAGE/app/VERSION"
chmod +x "$STAGE/app/bin/dev-panel"

sed "s/@VERSION@/$VERSION/g" scripts/installer-header.sh > "$OUT"
tar -C "$STAGE" --owner=0 --group=0 -czf - app >> "$OUT"
chmod +x "$OUT"
( cd dist && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
echo "Собрано: $OUT ($(du -h "$OUT" | cut -f1))"
echo "SHA-256: $(cut -d' ' -f1 "$OUT.sha256")"

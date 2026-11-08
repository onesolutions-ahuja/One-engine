#!/usr/bin/env bash
set -euo pipefail
SCRIPT=$(realpath "$(dirname "$0")/retain-frontend-assets.sh")
TEMP=$(mktemp -d)
trap 'rm -rf "$TEMP"' EXIT
for n in 1 2 3 4 5; do mkdir -p "$TEMP/$n/assets"; echo "$n" > "$TEMP/$n/assets/chunk-$n.js"; done
bash "$SCRIPT" "$TEMP/2" "$TEMP/1"
bash "$SCRIPT" "$TEMP/3" "$TEMP/2" "$TEMP/1"
bash "$SCRIPT" "$TEMP/4" "$TEMP/3" "$TEMP/2" "$TEMP/1"
bash "$SCRIPT" "$TEMP/5" "$TEMP/4" "$TEMP/3" "$TEMP/2" "$TEMP/1"
test -f "$TEMP/5/assets/chunk-2.js"
test -f "$TEMP/5/assets/chunk-3.js"
test -f "$TEMP/5/assets/chunk-4.js"
test -f "$TEMP/5/assets/chunk-5.js"
test ! -e "$TEMP/5/assets/chunk-1.js"
test "$(cat "$TEMP/5/assets/chunk-5.js")" = 5
test "$(wc -l < "$TEMP/5/.native-assets")" = 1
bash "$SCRIPT" "$TEMP/5" "$TEMP/4" "$TEMP/3" "$TEMP/2"
test "$(wc -l < "$TEMP/5/.native-assets")" = 1
echo 'PASS: previous-build chunks retained, current assets preserved, retention bounded and idempotent'

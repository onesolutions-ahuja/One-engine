#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT="$(cd "$(dirname "$0")" && pwd)/prune-inactive-api-releases.sh"
root="$(mktemp -d)"
trap 'rm -rf -- "$root"' EXIT
sha1="$(printf '1%.0s' {1..40})"
sha2="$(printf '2%.0s' {1..40})"
sha3="$(printf '3%.0s' {1..40})"
sha4="$(printf '4%.0s' {1..40})"
active="$root/gh-$sha1"
worker="$root/gh-$sha2"
target="$root/gh-$sha3"
unused="$root/gh-$sha4"
mkdir -p "$active" "$worker" "$target" "$unused" "$root/tenant-records"
ln -s "$unused" "$root/gh-$(printf '5%.0s' {1..40})"
touch "$root/tenant-records/saved.txt"
bash "$SCRIPT" "$root" "$active" "$worker" "$target"
[[ -d "$active" && -d "$worker" && -d "$target" && ! -e "$unused" ]]
[[ -f "$root/tenant-records/saved.txt" ]]
# Unverified working directories MUST never authorise deletion.
mkdir -p "$unused"
bash "$SCRIPT" "$root" "/unrecognised/active" "$worker" "$target"
[[ -d "$unused" ]]
# After both processes switched, earlier snapshots can be removed safely.
bash "$SCRIPT" "$root" "$target" "$target"
[[ ! -e "$active" && ! -e "$worker" && ! -e "$unused" && -d "$target" ]]
[[ -f "$root/tenant-records/saved.txt" ]]
echo "Oracle inactive-release cleanup tests passed."

#!/usr/bin/env bash
set -euo pipefail
# Retain native assets from three preceding builds for tabs opened before deployment.
# Native manifests prevent copied legacy files accumulating across every release.
RELEASE="${1:?new release required}"
shift
test -d "$RELEASE/assets"
if [ ! -f "$RELEASE/.native-assets" ]; then
  (cd "$RELEASE" && find assets -type f -print) > "$RELEASE/.native-assets"
fi
# Keep immutable renderer hashes used by already-open browser tabs, just like Vite assets.
if [ ! -f "$RELEASE/.native-component-assets" ]; then
  (cd "$RELEASE" && find component-library/components -type f -regextype posix-extended \
    -regex '.*\.[a-f0-9]{16}\.json(\.gz|\.br)?' -print) > "$RELEASE/.native-component-assets"
fi
count=0
for prior in "$@"; do
  [ "$prior" != "$RELEASE" ] || continue
  [ -d "$prior/assets" ] || continue
  count=$((count + 1))
  [ "$count" -le 3 ] || break
  # Bootstrap manifests for releases created before this retention mechanism.
  if [ ! -f "$prior/.native-assets" ]; then
    (cd "$prior" && find assets -type f -print) > "$prior/.native-assets"
  fi
  while IFS= read -r asset; do
    case "$asset" in assets/*) ;; *) continue ;; esac
    case "$asset" in *..*) continue ;; esac
    [ -f "$prior/$asset" ] || continue
    [ ! -e "$RELEASE/$asset" ] || continue
    mkdir -p "$(dirname "$RELEASE/$asset")"
    cp "$prior/$asset" "$RELEASE/$asset"
    chmod a+r "$RELEASE/$asset"
  done < "$prior/.native-assets"
done

# Retain previous immutable component JSON (and precompressed sidecars).
count=0
for prior in "$@"; do
  [ "$prior" != "$RELEASE" ] || continue
  [ -d "$prior/component-library/components" ] || continue
  count=$((count + 1))
  [ "$count" -le 3 ] || break
  if [ ! -f "$prior/.native-component-assets" ]; then
    (cd "$prior" && find component-library/components -type f -regextype posix-extended \
      -regex '.*\.[a-f0-9]{16}\.json(\.gz|\.br)?' -print) > "$prior/.native-component-assets"
  fi
  while IFS= read -r asset; do
    case "$asset" in component-library/components/*) ;; *) continue ;; esac
    case "$asset" in *..*) continue ;; esac
    [[ "$asset" =~ \.[a-f0-9]{16}\.json(\.gz|\.br)?$ ]] || continue
    [ -f "$prior/$asset" ] || continue
    [ ! -e "$RELEASE/$asset" ] || continue
    cp "$prior/$asset" "$RELEASE/$asset"
    chmod a+r "$RELEASE/$asset"
  done < "$prior/.native-component-assets"
done

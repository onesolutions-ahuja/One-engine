#!/usr/bin/env bash
# Run only under the Oracle deploy lock. Never remove the active API/worker release.
set -Eeuo pipefail
ROOT="${1:?release root required}"
shift
[[ $# -ge 2 && "$ROOT" = /* && "$ROOT" != / && -d "$ROOT" && ! -L "$ROOT" ]] || exit 64
# All protected directories must be direct, literal children of the approved root.
# An unknown current release is a reason to SKIP pruning rather than guess.
for keep in "$@"; do
  [[ "$keep" =~ ^${ROOT}/gh-[a-f0-9]{40}$ ]] || {
    echo "Skip release cleanup: an active release could not be verified" >&2
    exit 0
  }
done
count=0
for candidate in "$ROOT"/gh-*; do
  [[ -d "$candidate" && ! -L "$candidate" ]] || continue
  [[ "${candidate##*/}" =~ ^gh-[a-f0-9]{40}$ ]] || continue
  keep_it=false
  for keep in "$@"; do
    [[ "$candidate" == "$keep" ]] && { keep_it=true; break; }
  done
  [[ "$keep_it" == true ]] && continue
  # Only inactive immutable code snapshots. Never inspect/delete tenants,
  # business databases, persistent SQL volumes, secrets or arbitrary paths.
  rm -rf --one-file-system -- "$candidate"
  count=$((count+1))
done
echo "Pruned inactive immutable API releases: $count"

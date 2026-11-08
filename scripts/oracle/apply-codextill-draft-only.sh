#!/usr/bin/env bash
# One-time CODEXTILL Page Builder draft operation (not an API deployment).
# Uses the same server PageRuntime, tenant checks and draft revision handling.
set -Eeuo pipefail
umask 077
[[ "${EUID}" == 0 && "$#" == 1 ]] || exit 64
[[ "${GITHUB_REPOSITORY:-}" == "onesolutions-ahuja/One-engine" ]] || exit 64
[[ "$(uname -m)" == "aarch64" ]] || exit 64
SOURCE="$1"
[[ "$SOURCE" == /* ]] || exit 64
test -r /etc/metadrive/production.env
test -f "$SOURCE/apps/server/dist-system/app-seeders/codextill-page-layout.js"
test -f "$SOURCE/apps/server/scripts/fix-codextill-free-canvas.mjs"
# Metadata-only change; no systemd daemon-reload, restart, or release switch.
# Read the existing root-owned runtime environment without logging secrets.
set -a
# shellcheck disable=SC1091
source /etc/metadrive/production.env
set +a
[[ -n "${DATABASE_URL:-}" ]] || { echo "Missing production SQL connection"; exit 1; }
cd "$SOURCE"
# The runner checkout is private to the runner user. Run this one-shot scoped
# database metadata operation under the already-authorised sudo shell; the
# PageRuntime checks the single target page and verifies persisted geometry.
# The preloaded Node process drops uid/gid to metadrive before DB access.
node apps/server/scripts/fix-codextill-free-canvas.mjs

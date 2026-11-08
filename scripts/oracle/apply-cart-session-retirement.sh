#!/usr/bin/env bash
# One-time CartSession retirement during the backed-up Oracle release.
set -Eeuo pipefail
[[ "${EUID}" == 0 ]] || { echo 'Root deployment helper required' >&2; exit 1; }
SOURCE="${1:?immutable release root required}"
[[ "$SOURCE" =~ ^/opt/metadrive/releases/gh-[a-f0-9]{40}$ && -d "$SOURCE/apps/server/dist-system" ]] || exit 1
test -r /etc/metadrive/production.env
# Run all migration entrypoints as metadrive from the same release as the API.
# Check read access before touching any tenant records.
for script in migrate-cart-session-to-cart.mjs migrate-cart-formulas.mjs migrate-cart-page-bindings.mjs retire-cart-session.mjs; do
  runuser -u metadrive -- test -r "$SOURCE/scripts/cart/$script" || {
    echo "Migration script unavailable to metadrive: $script" >&2
    exit 1
  }
done
runuser -u metadrive -- test -r "$SOURCE/scripts/codextill/ensure-smart-till-cart-flows.mjs"
(
 set -a
 source /etc/metadrive/production.env
 set +a
 test -n "${DATABASE_URL:-${METADRIVE_DATABASE_URL:-}}"
 cd "$SOURCE"
 runuser -u metadrive -- node scripts/cart/migrate-cart-session-to-cart.mjs --apply
  runuser -u metadrive -- node scripts/cart/migrate-cart-formulas.mjs --apply
 runuser -u metadrive -- node scripts/cart/migrate-cart-page-bindings.mjs --apply --publish
 runuser -u metadrive -- node scripts/cart/retire-cart-session.mjs --apply --defer-order-cart-session-lookup
)
echo 'Cart copy and metadata migration verified; final legacy retirement may be deferred for active Order.CartSession.'

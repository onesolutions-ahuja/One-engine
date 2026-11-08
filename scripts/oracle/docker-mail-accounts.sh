#!/usr/bin/env bash
# Single-domain Docker Mailserver mailbox administration over the existing Oracle SSH session.
# This does not expose Docker control to MetaDrive's public HTTP API.
set -euo pipefail

container="metadrive-docker-mailserver"
domain="unesolutions.co.uk"
usage() {
  printf 'Usage: %s list | add <address> | reset <address> | delete <address>\n' "$0" >&2
  exit 2
}
action="${1:-}"
case "$action" in
  list) [[ "$#" -eq 1 ]] || usage ;;
  add|reset|delete) [[ "$#" -eq 2 ]] || usage ;;
  *) usage ;;
esac
if [[ "$action" != list ]]; then
  address="${2,,}"
  if [[ ! "$address" =~ ^[a-z0-9][a-z0-9._+-]{0,62}[a-z0-9]@unesolutions[.]co[.]uk$ && ! "$address" =~ ^[a-z0-9]@unesolutions[.]co[.]uk$ ]]; then
    echo "Mailbox must be a valid address at ${domain}" >&2
    exit 2
  fi
fi
docker_bin="$(command -v docker)"
if ! sudo "$docker_bin" inspect -f '{{.State.Running}}' "$container" 2>/dev/null | grep -qx true; then
  echo "Docker Mailserver is not running" >&2
  exit 1
fi
case "$action" in
  list) sudo "$docker_bin" exec "$container" setup email list ;;
  add) sudo "$docker_bin" exec -it "$container" setup email add "$address" ;;
  reset) sudo "$docker_bin" exec -it "$container" setup email update "$address" ;;
  delete)
    echo "This permanently removes mailbox access, and Docker Mailserver may offer to delete stored mail."
    read -r -p "Type DELETE ${address} to continue: " confirmation
    [[ "$confirmation" == "DELETE ${address}" ]] || { echo 'Cancelled'; exit 1; }
    sudo "$docker_bin" exec -it "$container" setup email del "$address"
    ;;
esac

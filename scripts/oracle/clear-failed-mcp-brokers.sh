#!/usr/bin/env bash
# Recover only FAILED socket-activated MCP broker unit state from a systemd
# manager overloaded by thousands of retained failed connection instances.
# No service stops, restarts, secret reads, SQL changes or host reboots.
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
[[ "${EUID}" == 0 && "${#}" == 0 ]] || exit 64
[[ "${GITHUB_REPOSITORY:-}" == 'unedev00/uneengine' ]] || exit 64
[[ "$(uname -m)" == aarch64 ]] || exit 64
[[ "$(cat /proc/1/comm)" == systemd ]] || exit 1

# The currently installed socket template must exist before writing a
# narrowly scoped drop-in. Future failed Accept=yes connections can be
# collected without losing their recorded errors in journald.
unit=metadrive-mcp-broker@.service
test -f "/etc/systemd/system/$unit"
dropin="/etc/systemd/system/$unit.d"
install -d -o root -g root -m 0755 "$dropin"
tmp="$(mktemp "$dropin/.10-collect.conf.XXXXXXXX")"
trap 'rm -f -- "$tmp"' EXIT
printf '[Unit]\nCollectMode=inactive-or-failed\n' > "$tmp"
chmod 0644 "$tmp"
mv -f -- "$tmp" "$dropin/10-collect.conf"
trap - EXIT

# Never fetch all >15k failed units in one D-Bus response: that read itself
# timed out on this host. systemctl's unspecialised --all listing can stream
# a short prefix quickly (confirmed by production diagnostics), so close
# the listing pipe after one bounded batch and retry after resetting.
batch=96
max_passes=240
previous_first=''
for (( pass=1; pass<=max_passes; pass++ )); do
  # head closes the pipe promptly; an upstream SIGPIPE is expected here.
  # Do not use --failed: the server-side failed-unit filter wedged at 15k.
  listing="$(timeout 15 systemctl list-units --all --plain --no-legend --no-pager 'metadrive-mcp-broker@*.service' | head -n "$batch" || true)"
  units=()
  while IFS= read -r line; do
    # Match only failed broker instances; never a live instance or other unit.
    if [[ "$line" == *' loaded failed failed '* &&
          "$line" =~ (metadrive-mcp-broker@[A-Za-z0-9_.-]+\.service) ]]; then
      units+=("${BASH_REMATCH[1]}")
    fi
  done <<< "$listing"
  if (( ${#units[@]} == 0 )); then
    # An empty or healthy prefix is not proof of an empty manager. The final
    # guarded daemon-reload still decides release eligibility.
    echo "No failed MCP broker instances in bounded listing prefix."
    break
  fi
  if [[ "${units[0]}" == "$previous_first" ]]; then
    echo 'Failed MCP broker state did not advance after previous batch; refusing repeat.' >&2
    exit 1
  fi
  previous_first="${units[0]}"
  timeout 30 systemctl reset-failed -- "${units[@]}"
  if (( pass % 10 == 1 )); then
    echo "Reset failed MCP broker batch $pass (${#units[@]} instances)."
  fi
  if (( pass == max_passes )); then
    echo 'Bounded failed MCP broker cleanup reached its pass limit.' >&2
    exit 1
  fi
done
# The caller MUST still pass daemon-reload and API/worker health checks.
echo 'Bounded failed MCP broker cleanup finished; daemon-reload still required.'

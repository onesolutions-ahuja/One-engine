#!/usr/bin/env bash
# Bounded, audited recovery for a stuck Oracle systemd D-Bus control plane.
# SIGUSR1 asks systemd to reconnect to D-Bus; it does not reboot or restart services.
# Never try service activation while the control plane is unavailable.
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
[[ "$EUID" == 0 && "$#" == 0 ]] || { echo 'Root-only preflight; no arguments allowed' >&2; exit 64; }
[[ "${GITHUB_REPOSITORY:-}" == 'unedev00/uneengine' ]] || exit 64
[[ "$(uname -m)" == 'aarch64' ]] || exit 64
[[ "$(cat /proc/1/comm)" == 'systemd' ]] || { echo 'PID 1 is not systemd; refusing recovery' >&2; exit 1; }

# Manager check, NOT service check: an inactive service must not trigger a signal.
if timeout 8 systemctl show --property=Version --value >/dev/null 2>&1; then
  echo 'Oracle systemd manager responding; no recovery required.'
  exit 0
fi

echo 'Oracle systemd manager did not respond. Requesting one documented D-Bus reconnection.'
# Official systemd signal semantics: SIGUSR1 reconnects its D-Bus bus.
kill -s USR1 1
for attempt in 1 2 3 4 5 6; do
  sleep 3
  if timeout 6 systemctl show --property=Version --value >/dev/null 2>&1; then
    echo 'Oracle systemd D-Bus control plane recovered.'
    exit 0
  fi
done

# No reboot, daemon reexec, forced service kill, or bypass of deployment checks.
echo 'Oracle systemd D-Bus still unavailable; deployment safely blocked.' >&2
exit 1

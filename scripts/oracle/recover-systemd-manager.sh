#!/usr/bin/env bash
# Bounded, one-time-per-boot recovery of systemd's failed daemon-reload.
# The systemd *system manager* handles SIGTERM as daemon-reexec, not VM reboot.
# Only invoke from the protected Oracle production runner; no SQL or app data writes.
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
[[ "$EUID" == 0 && "$#" == 0 ]] || exit 64
[[ "${GITHUB_REPOSITORY:-}" == 'unedev00/uneengine' ]] || exit 64
[[ "$(uname -m)" == 'aarch64' ]] || exit 64
[[ "$(cat /proc/1/comm)" == 'systemd' ]] || exit 1
version="$(systemctl --version | sed -nE '1s/^systemd ([0-9]+).*/\1/p')"
[[ "$version" =~ ^[0-9]+$ ]] && ((version >= 239)) || exit 1

# Report bounded systemd control-plane evidence without leaking service environment.
# This diagnostic is read-only and never changes or retries the one-boot guard.
diagnose_reload_failure() {
 echo 'Oracle systemd daemon-reload diagnostic (read-only):'
 printf 'PID 1 wait channel: '; cat /proc/1/wchan 2>/dev/null || true
 timeout 8 systemctl show --property=SystemState,Reloading,Version --no-pager 2>&1 || true
 timeout 8 systemctl list-jobs --no-pager 2>&1 || true
 ps -eo pid,ppid,stat,wchan:28,comm | grep -E '(^ *PID|systemd|dbus|systemctl)' | head -n 40 || true
 timeout 8 journalctl -b _PID=1 -n 25 --no-pager -o short-iso 2>&1 || true
}

# A routine success never signals PID 1. Other errors also fail closed.
set +e
timeout 35 systemctl daemon-reload
rc=$?
set -e
if [[ "$rc" == 0 ]]; then
 echo 'Oracle systemd manager reload succeeded; no reexecution required.'
 exit 0
fi
if [[ "$rc" != 124 ]]; then
 echo "Oracle systemd daemon-reload failed unexpectedly (code $rc); recovery blocked." >&2
 exit 1
fi

# Never repeatedly reexecute the manager within one boot. Marker is atomic.
marker=/run/lock/metadrive-systemd-manager-reexec-once
( set -C; printf 'single audited systemd reexecution\n' > "$marker" ) || {
 echo 'Oracle systemd manager reexecution already attempted this boot; refusing repeat.' >&2
 # A single D-Bus reconnect is less disruptive than systemd reexecution.
 # It does not restart API/worker and cannot bypass the one-reexec guard.
 reconnect_marker=/run/lock/metadrive-systemd-manager-bus-reconnect-once
 if ( set -C; printf 'one bounded manager D-Bus reconnect\\n' > "$reconnect_marker" ) 2>/dev/null; then
  echo 'Requesting one systemd D-Bus reconnect (SIGUSR1), no service restarts.'
  kill -s USR1 1
  sleep 3
  if timeout 35 systemctl daemon-reload; then
   echo 'Oracle systemd manager recovered after bounded D-Bus reconnect.'
   exit 0
  fi
  echo 'Oracle manager reload still blocked after D-Bus reconnect.' >&2
 fi
 # Socket-activated MCP broker instances can leave failed transient units in
 # systemd. Reset *only* their failed state; no running unit is stopped or
 # restarted, no services or files are deleted, and no signal is sent to PID 1.
 # This low-risk cleanup may be retried by a later deployment even if the
 # once-per-boot *manager reexecution* and D-Bus reconnect guards are spent.
 # Keep the original GC marker for audit, but do not let it permanently block a
 # harmless reset-failed attempt after the host has had time to drain requests.
 gc_marker=/run/lock/metadrive-systemd-manager-mcp-gc-once
 if ( set -C; printf 'bounded broker failed-state cleanup\\n' > "$gc_marker" ) 2>/dev/null; then
  echo 'First failed MCP broker cleanup this boot.'
 else
  echo 'Retrying non-disruptive failed MCP broker cleanup; manager signal guards remain enforced.'
 fi
 # Only failed MCP socket instances may be cleared, never running services.
 # The helper also stages a systemd CollectMode drop-in to prevent recurrence.
 # It does not reload the manager or restart any service; this gate does both
 # readiness checks below only after the bounded state cleanup succeeds.
 if ! timeout 900 bash "$(dirname "$0")/clear-failed-mcp-brokers.sh"; then
  echo 'Failed broker cleanup did not finish; refusing deployment.' >&2
  diagnose_reload_failure
  exit 1
 fi
 echo 'Attempting bounded systemd reload after failed broker unit cleanup.'
 if timeout 150 systemctl daemon-reload; then
  timeout 8 systemctl is-active --quiet metadrive-api.service
  timeout 8 systemctl is-active --quiet metadrive-worker.service
  echo 'Oracle systemd manager reload recovered after failed broker unit cleanup.'
  exit 0
 fi
 echo 'Oracle daemon-reload remains blocked after broker state cleanup.' >&2
 diagnose_reload_failure
 exit 1
}
echo 'Oracle daemon-reload timed out. Requesting one documented systemd manager reexecution.'
# For PID 1 systemd v239+, SIGTERM serializes state then reexecutes the manager.
# It does not request a host reboot or terminate managed applications.
kill -s TERM 1
for attempt in 1 2 3 4 5 6 7 8; do
 sleep 3
 if timeout 6 systemctl show --property=Version --value >/dev/null 2>&1; then
   if timeout 35 systemctl daemon-reload; then
     echo 'Oracle systemd manager recovered after reexecution.'
     exit 0
   fi
   break
 fi
done
echo 'Oracle systemd manager still unhealthy after single reexecution. Deployment blocked.' >&2
diagnose_reload_failure
exit 1

#!/usr/bin/env python3
"""Read-only OCI calendar SQL inspection using the production API's OS identity.

Only the trusted, protected main-branch GitHub Action invokes this script.
Root access is used solely to inspect the running systemd API process.
The SQL diagnostic itself executes as the API service account so PostgreSQL
peer authentication matches; its connection is explicitly READ ONLY.
No database credentials or tenant data are printed.
"""
import os
import pwd
import re
import shutil
import subprocess
import sys
from pathlib import Path

TARGET_PATTERN = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$", re.I)
ALLOWED_KEYS = ("DATABASE_URL", "METADRIVE_DB_NAME_OVERRIDE", "METADRIVE_DB_CA_CERT",
                "PGSSLMODE", "PGSSLROOTCERT", "PGSSLCERT", "PGSSLKEY",
                "PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGPASSWORD")

def runtime_ids(pid):
    """Return effective uid/gid of the process, never the sudo invoking user."""
    status = Path(f"/proc/{pid}/status").read_text()
    uid = re.search(r"^Uid:\s+\d+\s+(\d+)\s+", status, re.M)
    gid = re.search(r"^Gid:\s+\d+\s+(\d+)\s+", status, re.M)
    if uid is None or gid is None:
        raise SystemExit("Cannot resolve live API process identity")
    owner_uid, owner_gid = int(uid.group(1)), int(gid.group(1))
    if owner_uid == 0 or owner_gid == 0:
        raise SystemExit("Refusing root database connection identity")
    return owner_uid, owner_gid

def main():
    if len(sys.argv) != 2 or not TARGET_PATTERN.fullmatch(sys.argv[1]):
        raise SystemExit("A valid tenant UUID is required")
    if int(os.environ.get("SUDO_UID", "-1")) < 1 or int(os.environ.get("SUDO_GID", "-1")) < 1:
        raise SystemExit("Requires sudo from a non-root Oracle runner")
    root_dir = Path.cwd().resolve()
    script = root_dir / "scripts/oracle/business-calendar-readonly.mjs"
    if not script.is_file() or script.is_symlink():
        raise SystemExit("Diagnostic source is unavailable")
    # Read trusted script bytes before reducing identity: the GitHub runner's
    # checkout may be inaccessible to the systemd service account.
    diagnostic = script.read_text()
    pid_result = subprocess.run(
        ["systemctl", "show", "metadrive-api.service", "--property=MainPID", "--value"],
        check=True, capture_output=True, text=True, timeout=10
    )
    pid = pid_result.stdout.strip()
    if not pid.isdigit() or int(pid) <= 1:
        raise SystemExit("Production API process is not running")
    uid, gid = runtime_ids(pid)
    # Use the installed pg module in the *running release*, not the runner's
    # node_modules, since the latter may not be traversable by the API user.
    service_dir = Path(os.readlink(f"/proc/{pid}/cwd")).resolve()
    if not service_dir.is_relative_to(Path("/opt/metadrive")):
        raise SystemExit("Live API working directory is outside managed releases")
    pg_module = service_dir / "node_modules/pg/lib/index.js"
    if not pg_module.is_file() or pg_module.is_symlink():
        raise SystemExit("Live release has no trusted PostgreSQL module")
    connection_env = {}
    with open(f"/proc/{pid}/environ", "rb") as source:
        for entry in source.read().split(b"\0"):
            if b"=" not in entry:
                continue
            key, value = entry.split(b"=", 1)
            if key.decode(errors="ignore") in ALLOWED_KEYS:
                connection_env[key.decode()] = value.decode(errors="replace")
    if not connection_env.get("DATABASE_URL"):
        raise SystemExit("Live API process has no DATABASE_URL; database not inspected")
    node = shutil.which("node")
    if node is None:
        raise SystemExit("Node runtime unavailable")
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": pwd.getpwuid(uid).pw_dir,
        "NODE_ENV": "production",
        "MD_DIAG_PG_MODULE": str(pg_module),
        **connection_env,
    }
    # Drop supplementary groups and root *before* Node or PostgreSQL work.
    os.setgroups([])
    os.setgid(gid)
    os.setuid(uid)
    if os.geteuid() != uid or os.getegid() != gid:
        raise SystemExit("Failed to match API service identity")
    print("Live OCI SQL calendar diagnostic (read-only)", flush=True)
    print("SQL client OS identity matches running API service: true", flush=True)
    # Node consumes the validated source from stdin so no filesystem changes,
    # extra privileges, or access to the runner's private checkout are needed.
    outcome = subprocess.run(
        [node, "--input-type=module", "-", sys.argv[1]],
        input=diagnostic, text=True, env=env, cwd=service_dir,
        timeout=45, check=False
    )
    if outcome.returncode:
        raise SystemExit("Read-only SQL inspection failed (details above)")
    print("SQL inspection finished without changes", flush=True)

if __name__ == "__main__":
    main()

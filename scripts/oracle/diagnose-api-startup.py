#!/usr/bin/env python3
"""Safe, bounded Oracle API startup diagnostics for a failed protected deployment.

Called locally as root by the deployment script; prints only allowlisted
systemd state and redacted error summaries. Never prints service environment,
credentials, SQL parameter values, HTTP request bodies or customer records.
"""
import hashlib
import re
import subprocess
import sys

UNIT = "metadrive-api.service"
FIELDS = ("ActiveState", "SubState", "Result", "ExecMainCode", "ExecMainStatus", "NRestarts")


def execute(*args):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, check=False, timeout=6)
    return result.stdout[:100_000]


def sanitize(line):
    line = re.sub(r"https?://\S+|postgres(?:ql)?://\S+|\b\S+@\S+\.\S+",
                  "[redacted]", line, flags=re.I)
    line = re.sub(r"\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b[0-9a-f]{24,}\b",
                  "[redacted]", line, flags=re.I)
    line = re.sub(r"'[^']*'|\$\d+\s*=\s*\S+", "[value]", line)
    line = re.sub(r"(?i)(token|password|secret|credential|apikey|authorization)\s*[:=]\s*\S+",
                  r"\1=[redacted]", line)
    return line[:280]


def main():
    print("Oracle API startup diagnostics (sanitized, no customer records):")
    systemd = execute("systemctl", "show", UNIT,
                      "--property=" + ",".join(FIELDS))
    for line in systemd.splitlines():
        key, separator, value = line.partition("=")
        if separator and key in FIELDS:
            print(key + "=" + re.sub(r"[^a-zA-Z0-9._-]", "", value)[:40])
    logs = execute("journalctl", "-u", UNIT, "-n", "130", "--no-pager",
                   "--output=cat")
    errors = [line for line in logs.splitlines()
              if re.search(r"(failed startup|error:|Error:|migration|SQLSTATE|fatal|ECONNREFUSED|uncaught)", line, re.I)]
    # Most recent errors only, never a full private journal in public Actions.
    for line in errors[-8:]:
        summary = sanitize(line.strip())
        digest = hashlib.sha256(line.encode()).hexdigest()[:10]
        print("API error " + digest + ": " + summary)
    if not errors:
        print("No allowlisted API startup error visible in recent journal.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

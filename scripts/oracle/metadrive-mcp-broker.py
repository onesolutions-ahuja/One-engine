#!/usr/bin/env python3
"""Fixed-operation, systemd socket-activated MetaDrive broker.

No shell or caller-selected paths. This process executes as root only for the
lifetime of a single Unix socket connection. The API remains NoNewPrivileges=yes.
"""
import json
import subprocess
import sys
import re
import os

ALLOWED = {"status", "logs", "restart", "activate_release", "deploy_latest", "deploy_status", "mail_diagnostic", "mailbox_list", "mailbox_add", "mailbox_reset", "mailbox_delete", "sender_approve", "mailbox_scan"}
SERVICES = {"api", "worker"}
MAX_INPUT = 4096

def run(argv, timeout=12):
    p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False,
                       env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"})
    if p.returncode:
        raise RuntimeError("Operation failed (exit code %d)" % p.returncode)
    return p.stdout[:200000]

def main():
    line = sys.stdin.buffer.readline(MAX_INPUT + 1)
    if len(line) > MAX_INPUT or not line.endswith(b"\n"):
        raise ValueError("Invalid request length")
    req = json.loads(line)
    if not isinstance(req, dict) or set(req) - {"action", "service", "release", "address", "password", "offset"}:
        raise ValueError("Invalid request")
    action, service, release = req.get("action"), req.get("service", "api"), req.get("release")
    if action not in ALLOWED or service not in SERVICES:
        raise ValueError("Unsupported operation")
    if action == "mailbox_scan":
        if service != "worker" or release is not None or req.get("password") is not None:
            raise ValueError("Invalid mailbox scan")
        address, offset = req.get("address"), req.get("offset", 0)
        if not isinstance(address, str) or len(address) > 254 or not re.fullmatch(r"[a-z0-9][a-z0-9._+-]{0,62}@[a-z0-9][a-z0-9.-]{0,251}", address):
            raise ValueError("Invalid mailbox")
        if type(offset) is not int or not 0 <= offset <= 20000:
            raise ValueError("Invalid scan offset")
        output = run(["/usr/bin/python3", "-I", "/usr/local/libexec/metadrive-maildir-reader.py",
                      address, str(offset)], timeout=48)
    elif action == "sender_approve":
        if service != "api" or release is not None or req.get("password") is not None:
            raise ValueError("Invalid sender approval operation")
        address = req.get("address")
        if not isinstance(address, str) or len(address) > 254 or not re.fullmatch(r"[a-z0-9][a-z0-9._+-]{0,62}@[a-z0-9][a-z0-9.-]{0,251}", address):
            raise ValueError("Invalid sender address")
        compartment = os.environ.get("METADRIVE_OCI_MAIL_COMPARTMENT_OCID", "")
        if not re.fullmatch(r"ocid1.compartment.oc1..[a-z0-9]+|ocid1.tenancy.oc1..[a-z0-9]+", compartment):
            raise RuntimeError("OCI sender compartment not configured")
        # Root-controlled fixed OCI identity; never accept tenant-provided OCI args or credentials.
        result = subprocess.run(["/usr/local/bin/oci", "email", "sender", "create",
            "--auth", "instance_principal", "--region", "uk-london-1",
            "--compartment-id", compartment, "--email-address", address,
            "--wait-for-state", "ACTIVE"], capture_output=True, text=True, timeout=45,
            check=False, env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"})
        if result.returncode != 0:
            # A duplicate (HTTP 409) is idempotent. Other errors always fail closed.
            if "409" not in result.stderr or "Conflict" not in result.stderr:
                raise RuntimeError("OCI approved sender creation failed")
        output = "APPROVED"
    elif action in {"mailbox_list", "mailbox_add", "mailbox_reset", "mailbox_delete"}:
        if service != "api" or release is not None:
            raise ValueError("Invalid mail operation")
        address, password = req.get("address"), req.get("password")
        if action != "mailbox_list":
            if not isinstance(address, str) or len(address) > 254 or not re.fullmatch(r"[a-z0-9][a-z0-9._+-]{0,62}@[a-z0-9][a-z0-9.-]{0,251}", address):
                raise ValueError("Invalid mailbox")
        elif address is not None:
            raise ValueError("Unexpected mailbox")
        if action in {"mailbox_add", "mailbox_reset"}:
            if not isinstance(password, str) or not 12 <= len(password) <= 256 or any(c in password for c in "\r\n\0"):
                raise ValueError("Invalid password")
        elif password is not None:
            raise ValueError("Unexpected password")
        argv = ["/usr/bin/docker", "exec", "-i", "metadrive-docker-mailserver", "setup", "email"]
        if action == "mailbox_list":
            argv += ["list"]
        elif action == "mailbox_add":
            argv += ["add", address]
        elif action == "mailbox_reset":
            argv += ["update", address]
        else:
            argv += ["del", "-y", address]
        # Never pass mailbox passwords as process arguments or environment variables.
        response = subprocess.run(argv,
            input=(password + "\n" + password + "\n") if password is not None else "",
            capture_output=True, text=True, timeout=17, check=False,
            env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"})
        if response.returncode:
            raise RuntimeError("Mail operation failed")
        output = response.stdout[:100000] if action == "mailbox_list" else "OK"
    elif action == "mail_diagnostic":
        if release is not None:
            raise ValueError("Unexpected release")
        # Never reveal container environment, mounts, logs or mailbox content.
        output = ("=== listeners ===\n" +
                  run(["/usr/bin/ss", "-lnt"]) +
                  "\n=== containers ===\n" +
                  run(["/usr/bin/docker", "ps", "--format", "{{.Names}} {{.Status}} {{.Ports}}"]))
    else:
        if (action in {"activate_release", "deploy_latest"}) != (release is not None):
            raise ValueError("Invalid release")
        if release is not None:
            if not isinstance(release, str) or len(release) != 40 or any(c not in "0123456789abcdef" for c in release) or service != "api":
                raise ValueError("Invalid release")
        output = run(["/usr/local/sbin/metadrive-mcp-operations", action, service] + ([release] if release else []))
    sys.stdout.write(json.dumps({"output": output}) + "\n")
    sys.stdout.flush()

if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Fail closed; no sensitive subprocess stderr leaks to caller.
        sys.stdout.write('{"error":"Broker operation failed"}\n')
        sys.stdout.flush()
        sys.exit(1)

#!/usr/bin/env python3
"""Production email cutover readiness check. Read-only, no mailbox data or secrets printed."""
import collections
import json
import re
import shutil
import smtplib
import socket
import ssl
import subprocess

MAIL_HOST = "mail.unesolutions.co.uk"
PORTS = (25, 465, 587, 993)
def show(label, value):
    print("MAIL_PREFLIGHT " + label + " " + json.dumps(value, sort_keys=True), flush=True)

def run(argv, seconds=8):
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=seconds, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None

listener = run(["ss", "-ltnH"], 5) if shutil.which("ss") else None
if listener and listener.returncode == 0:
    bindings = {}
    for line in listener.stdout.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        local = parts[3]
        for port in PORTS:
            if local.endswith(":" + str(port)):
                bindings.setdefault(str(port), []).append(local)
    show("host_listeners", {str(p): bindings.get(str(p), []) for p in PORTS})
else:
    show("host_listeners", "ss unavailable")

# Connect to localhost only. No message submissions, passwords, or authenticated operations.
for port in PORTS:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=4) as sock:
            show("localhost_tcp_" + str(port), "connected")
    except (OSError, TimeoutError) as error:
        show("localhost_tcp_" + str(port), type(error).__name__)
        continue
    if port not in (25, 587):
        continue
    try:
        with smtplib.SMTP(host="127.0.0.1", port=port, timeout=5) as smtp:
            greeting_code = smtp.ehlo(name="preflight.invalid")[0]
            supports_tls = smtp.has_extn("starttls")
            show("smtp_" + str(port), {"ehlo_code": greeting_code, "starttls": supports_tls})
            if supports_tls:
                # Verify TLS handshake only (no credentials). Mail hostname trust verified separately.
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE
                smtp.starttls(context=context)
                show("smtp_starttls_" + str(port), "handshake_ok")
    except (OSError, ssl.SSLError, smtplib.SMTPException, TimeoutError) as error:
        show("smtp_" + str(port) + "_failure", type(error).__name__)

# Report Docker's public port mappings without accessing environment/credentials.
if shutil.which("docker"):
    result = run(["docker", "inspect", "--format", "{{json .NetworkSettings.Ports}}", "stalwart-setup"])
    if result and result.returncode == 0:
        try:
            mappings = json.loads(result.stdout.strip())
            show("docker_published_mail_ports", {
                p: [dict(hostIp=b.get("HostIp"), hostPort=b.get("HostPort"))
                    for b in (items or [])] for p, items in mappings.items()
                if p.split("/")[0].isdigit() and int(p.split("/")[0]) in PORTS
            })
        except (ValueError, AttributeError, TypeError):
            show("docker_published_mail_ports", "invalid")
    else:
        show("docker_published_mail_ports", "unavailable")

    # Summaries only; raw mail logs can contain addresses and sensitive metadata.
    recent = run(["docker", "logs", "--tail", "300", "stalwart-setup"], 9)
    if recent and recent.returncode == 0:
        combined = recent.stdout + recent.stderr
        tags = ("deferred", "undeliverable", "queue", "smtp", "relay", "blocked", "connect",
                "retry", "timeout", "fail", "dsn", "rate-limit")
        counts = {tag: len(re.findall(r"\b" + re.escape(tag) + r"\b", combined, re.I))
                  for tag in tags}
        show("log_keyword_counts_last_300_lines", {k:v for k,v in counts.items() if v})
    else:
        show("log_keyword_counts_last_300_lines", "unavailable")

show("cutover_status", "DO_NOT_CHANGE_MX_YET: requires external SMTP 25, TLS, outbound relay, and mailbox migration verification")

#!/usr/bin/env python3
"""Public, read-only SMTP/IMAPS readiness probe. Does not authenticate or send mail."""
import argparse
import json
import smtplib
import socket
import ssl
import sys


MAIL_HOST = "mail.unesolutions.co.uk"
MAIL_ADDRESS = "132.145.18.46"
TIMEOUT_SECONDS = 8


def report(name, ok, detail):
    print("MAIL_PUBLIC " + json.dumps({
        "check": name,
        "ok": bool(ok),
        "detail": detail,
    }, sort_keys=True), flush=True)


def resolve_addresses(host):
    try:
        return sorted({
            item[4][0]
            for item in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        })
    except (OSError, UnicodeError):
        return []


def probe_smtp(host, address, port, require_auth):
    smtp = smtplib.SMTP(timeout=TIMEOUT_SECONDS)
    try:
        smtp.connect(address, port)
        smtp._host = host
        code, _ = smtp.ehlo()
        if code < 200 or code >= 400:
            raise smtplib.SMTPConnectError(code, b"EHLO rejected")
        if not smtp.has_extn("starttls"):
            raise RuntimeError("STARTTLS is not advertised")
        smtp.starttls(context=ssl.create_default_context())
        code, _ = smtp.ehlo()
        if code < 200 or code >= 400:
            raise smtplib.SMTPConnectError(code, b"EHLO after TLS rejected")
        auth_advertised = smtp.has_extn("auth")
        if require_auth and not auth_advertised:
            raise RuntimeError("SMTP AUTH is not advertised after STARTTLS")
        return {
            "starttls": True,
            "certificate_verified_for": host,
            "auth_advertised": auth_advertised,
        }
    finally:
        smtp.close()


def probe_smtps(host, address):
    context = ssl.create_default_context()
    with socket.create_connection((address, 465), timeout=TIMEOUT_SECONDS) as raw:
        with context.wrap_socket(raw, server_hostname=host) as secure:
            with secure.makefile("rb") as reader:
                greeting = reader.readline(512)
                if not greeting.startswith(b"220"):
                    raise RuntimeError("Implicit-TLS SMTP greeting was not valid")
                secure.sendall(b"EHLO preflight.invalid\r\n")
                response = []
                while True:
                    line = reader.readline(512)
                    if not line:
                        raise RuntimeError("Implicit-TLS SMTP EHLO response was incomplete")
                    response.append(line.decode("ascii", errors="replace").strip())
                    if len(line) < 4 or line[3:4] != b"-":
                        break

    if not response[-1].startswith("250"):
        raise RuntimeError("Implicit-TLS SMTP EHLO was rejected")
    auth_advertised = any(
        line[4:].upper().startswith("AUTH ")
        for line in response
        if len(line) > 4
    )
    if not auth_advertised:
        raise RuntimeError("Implicit-TLS SMTP AUTH is not advertised")
    return {
        "implicit_tls": True,
        "certificate_verified_for": host,
        "auth_advertised": auth_advertised,
    }


def probe_imaps(host, address):
    context = ssl.create_default_context()
    with socket.create_connection((address, 993), timeout=TIMEOUT_SECONDS) as raw:
        with context.wrap_socket(raw, server_hostname=host) as secure:
            greeting = secure.recv(512).decode("ascii", errors="replace")
    if not greeting.upper().startswith("* OK"):
        raise RuntimeError("IMAPS greeting was not valid")
    return {"tls": True, "certificate_verified_for": host, "greeting": True}


def run(host, expected_address):
    addresses = resolve_addresses(host)
    dns_ok = addresses == [expected_address]
    report("dns_mail_a_matches_oracle", dns_ok, {
        "host": host,
        "addresses": addresses,
        "expected_address": expected_address,
    })

    checks_ok = dns_ok
    for port, require_auth in ((25, False), (587, True)):
        try:
            result = probe_smtp(host, expected_address, port, require_auth)
            report("smtp_" + str(port), True, result)
        except (OSError, RuntimeError, ssl.SSLError, smtplib.SMTPException, TimeoutError) as error:
            report("smtp_" + str(port), False, {"error": type(error).__name__})
            checks_ok = False

    try:
        report("smtps_465", True, probe_smtps(host, expected_address))
    except (OSError, RuntimeError, ssl.SSLError, TimeoutError) as error:
        report("smtps_465", False, {"error": type(error).__name__})
        checks_ok = False

    try:
        report("imaps_993", True, probe_imaps(host, expected_address))
    except (OSError, RuntimeError, ssl.SSLError, TimeoutError) as error:
        report("imaps_993", False, {"error": type(error).__name__})
        checks_ok = False
    return 0 if checks_ok else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=MAIL_HOST)
    parser.add_argument("--expected-address", default=MAIL_ADDRESS)
    args = parser.parse_args()
    return run(args.host, args.expected_address)


if __name__ == "__main__":
    sys.exit(main())

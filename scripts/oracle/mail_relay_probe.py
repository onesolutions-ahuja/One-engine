"""Read-only TLS readiness probe for the approved OCI Email Delivery relay."""
import smtplib
import ssl


OCI_SMTP_HOST = "smtp.email.uk-london-1.oci.oraclecloud.com"
OCI_SMTP_PORT = 587
TIMEOUT_SECONDS = 8


def probe_oci_smtp_relay():
    with smtplib.SMTP(OCI_SMTP_HOST, OCI_SMTP_PORT, timeout=TIMEOUT_SECONDS) as smtp:
        code, _ = smtp.ehlo(name="preflight.invalid")
        if code < 200 or code >= 400:
            raise smtplib.SMTPHeloError(code, b"SMTP relay rejected EHLO")
        if not smtp.has_extn("starttls"):
            raise RuntimeError("OCI SMTP relay does not advertise STARTTLS")

        smtp.starttls(context=ssl.create_default_context())
        code, _ = smtp.ehlo(name="preflight.invalid")
        if code < 200 or code >= 400:
            raise smtplib.SMTPHeloError(code, b"SMTP relay rejected EHLO after TLS")
        if not smtp.has_extn("auth"):
            raise RuntimeError("OCI SMTP relay does not advertise AUTH after TLS")

    return {
        "endpoint": OCI_SMTP_HOST,
        "port": OCI_SMTP_PORT,
        "starttls": True,
        "auth_advertised": True,
        "certificate_verified": True,
    }

import importlib.util
import pathlib
import unittest
from unittest import mock


SCRIPT = pathlib.Path(__file__).with_name("mail_relay_probe.py")
SPEC = importlib.util.spec_from_file_location("mail_relay_probe", SCRIPT)
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


class MailRelayProbeTests(unittest.TestCase):
    def setUp(self):
        self.smtp = mock.MagicMock()
        self.smtp.__enter__.return_value = self.smtp
        self.smtp.__exit__.return_value = False
        self.smtp.ehlo.return_value = (250, b"ready")
        self.smtp.has_extn.side_effect = lambda name: name.lower() in ("starttls", "auth")

    def test_verifies_relay_tls_and_auth_capability_without_authenticating(self):
        with mock.patch.object(
            PROBE.smtplib, "SMTP", return_value=self.smtp
        ) as smtp_class:
            with mock.patch.object(PROBE.ssl, "create_default_context") as context:
                result = PROBE.probe_oci_smtp_relay()

        self.assertEqual(result["endpoint"], PROBE.OCI_SMTP_HOST)
        self.assertEqual(result["port"], 587)
        self.assertTrue(result["certificate_verified"])
        context.assert_called_once_with()
        smtp_class.assert_called_once_with(
            PROBE.OCI_SMTP_HOST, 587, timeout=PROBE.TIMEOUT_SECONDS
        )
        self.smtp.starttls.assert_called_once_with(context=context.return_value)
        self.smtp.login.assert_not_called()
        self.smtp.sendmail.assert_not_called()

    def test_rejects_relay_without_starttls(self):
        self.smtp.has_extn.side_effect = lambda name: name.lower() == "auth"
        with mock.patch.object(PROBE.smtplib, "SMTP", return_value=self.smtp):
            with self.assertRaisesRegex(RuntimeError, "STARTTLS"):
                PROBE.probe_oci_smtp_relay()

    def test_rejects_relay_without_auth_capability(self):
        self.smtp.has_extn.side_effect = lambda name: name.lower() == "starttls"
        with mock.patch.object(PROBE.smtplib, "SMTP", return_value=self.smtp):
            with self.assertRaisesRegex(RuntimeError, "AUTH"):
                PROBE.probe_oci_smtp_relay()


if __name__ == "__main__":
    unittest.main()

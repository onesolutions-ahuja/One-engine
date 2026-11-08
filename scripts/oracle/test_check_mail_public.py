import importlib.util
import pathlib
import unittest
from unittest import mock


SCRIPT = pathlib.Path(__file__).with_name("check-mail-public.py")
SPEC = importlib.util.spec_from_file_location("check_mail_public", SCRIPT)
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


class PublicMailProbeTests(unittest.TestCase):
    def test_resolve_addresses_returns_sorted_unique_addresses(self):
        answers = [
            (None, None, None, None, ("132.145.18.46", 0)),
            (None, None, None, None, ("132.145.18.46", 0)),
            (None, None, None, None, ("2001:db8::1", 0, 0, 0)),
        ]
        with mock.patch.object(CHECK.socket, "getaddrinfo", return_value=answers):
            self.assertEqual(
                CHECK.resolve_addresses("mail.unesolutions.co.uk"),
                ["132.145.18.46", "2001:db8::1"],
            )

    def test_smtp_probe_checks_starttls_certificate_and_submission_auth(self):
        smtp = mock.MagicMock()
        smtp.ehlo.return_value = (250, b"ok")
        smtp.has_extn.side_effect = lambda name: name.lower() in ("starttls", "auth")
        with mock.patch.object(CHECK.smtplib, "SMTP", return_value=smtp):
            result = CHECK.probe_smtp("mail.unesolutions.co.uk", "132.145.18.46", 587, True)
        self.assertTrue(result["starttls"])
        self.assertTrue(result["auth_advertised"])
        smtp.connect.assert_called_once_with("132.145.18.46", 587)
        smtp.starttls.assert_called_once()
        smtp.close.assert_called_once()

    def test_smtp_probe_rejects_submission_without_auth(self):
        smtp = mock.MagicMock()
        smtp.ehlo.return_value = (250, b"ok")
        smtp.has_extn.side_effect = lambda name: name.lower() == "starttls"
        with mock.patch.object(CHECK.smtplib, "SMTP", return_value=smtp):
            with self.assertRaisesRegex(RuntimeError, "AUTH"):
                CHECK.probe_smtp("mail.unesolutions.co.uk", "132.145.18.46", 587, True)
        smtp.close.assert_called_once()

    def test_smtps_probe_verifies_certificate_and_submission_auth(self):
        raw = mock.MagicMock()
        secure = mock.MagicMock()
        reader = mock.MagicMock()
        reader.readline.side_effect = [
            b"220 mail.unesolutions.co.uk ESMTP ready\r\n",
            b"250-mail.unesolutions.co.uk\r\n",
            b"250-AUTH PLAIN LOGIN\r\n",
            b"250 SIZE 1024\r\n",
        ]
        raw.__enter__.return_value = raw
        secure.__enter__.return_value = secure
        secure.makefile.return_value.__enter__.return_value = reader
        context = mock.MagicMock()
        context.wrap_socket.return_value = secure
        with mock.patch.object(CHECK.socket, "create_connection", return_value=raw):
            with mock.patch.object(CHECK.ssl, "create_default_context", return_value=context):
                result = CHECK.probe_smtps("mail.unesolutions.co.uk", "132.145.18.46")
        context.wrap_socket.assert_called_once_with(raw, server_hostname="mail.unesolutions.co.uk")
        secure.sendall.assert_called_once_with(b"EHLO preflight.invalid\r\n")
        self.assertTrue(result["implicit_tls"])
        self.assertTrue(result["auth_advertised"])

    def test_smtps_probe_rejects_missing_auth(self):
        raw = mock.MagicMock()
        secure = mock.MagicMock()
        reader = mock.MagicMock()
        reader.readline.side_effect = [
            b"220 mail.unesolutions.co.uk ESMTP ready\r\n",
            b"250-mail.unesolutions.co.uk\r\n",
            b"250 SIZE 1024\r\n",
        ]
        raw.__enter__.return_value = raw
        secure.__enter__.return_value = secure
        secure.makefile.return_value.__enter__.return_value = reader
        context = mock.MagicMock()
        context.wrap_socket.return_value = secure
        with mock.patch.object(CHECK.socket, "create_connection", return_value=raw):
            with mock.patch.object(CHECK.ssl, "create_default_context", return_value=context):
                with self.assertRaisesRegex(RuntimeError, "AUTH"):
                    CHECK.probe_smtps("mail.unesolutions.co.uk", "132.145.18.46")

    def test_imaps_probe_verifies_hostname_and_greeting(self):
        raw = mock.MagicMock()
        secure = mock.MagicMock()
        secure.recv.return_value = b"* OK Stalwart ready\r\n"
        raw.__enter__.return_value = raw
        secure.__enter__.return_value = secure
        context = mock.MagicMock()
        context.wrap_socket.return_value = secure
        with mock.patch.object(CHECK.socket, "create_connection", return_value=raw):
            with mock.patch.object(CHECK.ssl, "create_default_context", return_value=context):
                result = CHECK.probe_imaps("mail.unesolutions.co.uk", "132.145.18.46")
        context.wrap_socket.assert_called_once_with(raw, server_hostname="mail.unesolutions.co.uk")
        self.assertTrue(result["tls"])
        self.assertTrue(result["greeting"])

    def test_run_checks_all_services_and_requires_mail_dns(self):
        with mock.patch.object(CHECK, "resolve_addresses", return_value=["192.0.2.1"]):
            with mock.patch.object(CHECK, "probe_smtp", return_value={"starttls": True}):
                with mock.patch.object(CHECK, "probe_smtps", return_value={"implicit_tls": True}):
                    with mock.patch.object(CHECK, "probe_imaps", return_value={"tls": True}):
                        with mock.patch.object(CHECK, "report") as report:
                            self.assertEqual(CHECK.run("mail.unesolutions.co.uk", "132.145.18.46"), 1)
        self.assertEqual(report.call_count, 5)

    def test_run_rejects_additional_published_addresses(self):
        with mock.patch.object(CHECK, "resolve_addresses", return_value=[
            "132.145.18.46",
            "192.0.2.1",
        ]):
            with mock.patch.object(CHECK, "probe_smtp", return_value={"starttls": True}):
                with mock.patch.object(CHECK, "probe_smtps", return_value={"implicit_tls": True}):
                    with mock.patch.object(CHECK, "probe_imaps", return_value={"tls": True}):
                        with mock.patch.object(CHECK, "report") as report:
                            self.assertEqual(CHECK.run("mail.unesolutions.co.uk", "132.145.18.46"), 1)
        self.assertFalse(report.call_args_list[0].args[1])


if __name__ == "__main__":
    unittest.main()

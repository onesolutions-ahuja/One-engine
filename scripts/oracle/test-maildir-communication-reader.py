#!/usr/bin/env python3
"""No-Docker local regression tests for the restricted Maildir scanner."""
import importlib.util
import json
import tempfile
import unittest
from email.message import EmailMessage
from pathlib import Path

MODULE = Path(__file__).with_name("maildir-communication-reader.py")
spec = importlib.util.spec_from_file_location("mailreader", MODULE)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)

class ScannerTests(unittest.TestCase):
    def test_folder_scan_and_body(self):
        with tempfile.TemporaryDirectory() as root:
            mailbox = Path(root, "unesolutions.co.uk", "support")
            (mailbox / "new").mkdir(parents=True)
            (mailbox / "cur").mkdir()
            message = EmailMessage()
            message["From"] = "Customer <customer@example.net>"
            message["To"] = "support@unesolutions.co.uk"
            message["Subject"] = "Customer enquiry"
            message["Message-ID"] = "<inbound@example.net>"
            message.set_content("Hi MetaDrive, can you help?")
            (mailbox / "new" / "unique-id").write_bytes(message.as_bytes())
            location = reader.mailbox_directory(
                "support@unesolutions.co.uk",
                [{"Type":"bind", "Destination":"/var/mail", "Source":root}])
            self.assertEqual(location, str(mailbox))
            page = reader.read_page(location, 0)
            self.assertEqual(page["total"], 1)
            self.assertEqual(page["nextOffset"], 0)
            item = page["messages"][0]
            self.assertEqual(item["subject"], "Customer enquiry")
            self.assertIn("can you help?", item["body"])
            self.assertEqual(len(item["fingerprint"]), 64)
            # Changing Maildir read flags must not create a second message.
            (mailbox / "new" / "unique-id").rename(mailbox / "cur" / "unique-id:2,S")
            renamed = reader.read_page(location, 0)
            self.assertEqual(renamed["messages"][0]["fingerprint"], item["fingerprint"])

    def test_container_maildir_read_does_not_use_host_mount(self):
        from unittest.mock import patch
        message = EmailMessage()
        message["From"] = "customer@example.net"
        message["To"] = "support@unesolutions.co.uk"
        message["Subject"] = "Container inbound email"
        message["Message-ID"] = "<container@example.net>"
        message.set_content("Recorded without host mount access.")
        directory = "docker:/var/mail/unesolutions.co.uk/support"
        def fake_docker(args, timeout=7):
            if args[0] == "/usr/bin/find":
                return b"1792880000.0\t/var/mail/unesolutions.co.uk/support/new/id123\0"
            if args[0] == "/usr/bin/cat":
                self.assertEqual(args[1],
                    "/var/mail/unesolutions.co.uk/support/new/id123")
                return message.as_bytes()
            raise AssertionError(args)
        with patch.object(reader, "docker_exec", side_effect=fake_docker):
            page = reader.read_page(directory, 0)
        self.assertEqual(page["total"],1)
        self.assertEqual(page["messages"][0]["subject"],
            "Container inbound email")
        self.assertIn("without host mount", page["messages"][0]["body"])

    def test_no_symlink_escape(self):
        with tempfile.TemporaryDirectory() as root:
            volume = Path(root, "mail-volume")
            outside = Path(root, "elsewhere")
            (outside / "new").mkdir(parents=True)
            (outside / "cur").mkdir()
            (volume / "unesolutions.co.uk").mkdir(parents=True)
            (volume / "unesolutions.co.uk" / "support").symlink_to(outside)
            with self.assertRaises(RuntimeError):
                reader.mailbox_directory("support@unesolutions.co.uk",
                    [{"Type":"bind","Destination":"/var/mail","Source":str(volume)}])

if __name__ == "__main__":
    unittest.main()

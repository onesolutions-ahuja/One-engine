"""Regression tests for the narrowly scoped Oracle OAuth migration owner repair."""
import importlib.util
import pathlib
import subprocess
import unittest
from unittest.mock import patch

SCRIPT = pathlib.Path(__file__).with_name("repair-oauth-function-owner.py")
SPEC = importlib.util.spec_from_file_location("repair_oauth_owner", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class OwnerRepairTests(unittest.TestCase):
    def test_parses_runtime_database_identity_without_exposing_password(self):
        data = 'PORT=3001\nDATABASE_URL="postgresql://md_app:p%40ss@127.0.0.1:5432/metadrive_sql_20261022_production"\n'
        self.assertEqual(MODULE.identity(data),
                         ("md_app", "metadrive_sql_20261022_production"))

    def test_rejects_invalid_or_privileged_identity(self):
        inputs = (
            "",
            "DATABASE_URL=postgresql://postgres:pw@localhost/metadrive",
            "DATABASE_URL=postgresql://md_user@localhost/bad-name",
            "DATABASE_URL=postgresql://md_user@localhost/metadrive\nDATABASE_URL=other",
            "DATABASE_URL=postgresql://bad-user@localhost/metadrive",
            "DATABASE_URL=postgresql://md_user@localhost/metadrive;DROP",
        )
        for value in inputs:
            with self.subTest(value=value[:16]):
                with self.assertRaises(ValueError):
                    MODULE.identity(value)

    def test_sql_targets_only_oauth_function_and_non_superuser_role(self):
        sql = MODULE.statement("md_app")
        self.assertIn("public.md_oauth_token_allowed(uuid,uuid,text,text,text)", sql)
        self.assertIn("NOT rolsuper", sql)
        self.assertIn("rolcanlogin", sql)
        self.assertNotIn("ALTER ROLE", sql)
        self.assertNotIn("GRANT SUPERUSER", sql)
        self.assertNotIn("DROP", sql)

    def test_privileged_local_postgres_exec_never_uses_password(self):
        content = "DATABASE_URL=postgresql://md_app:private@localhost:5432/metadrive"
        with patch.object(MODULE.ENV_PATH.__class__, "read_text", return_value=content), \
             patch.object(MODULE.subprocess, "run") as execute:
            MODULE.main()
        args = execute.call_args.args[0]
        self.assertEqual(args[:4], ["runuser", "-u", "postgres", "--"])
        self.assertIn("psql", args)
        self.assertEqual(args[-2:], ["-d", "metadrive"])
        self.assertNotIn("private", " ".join(args))
        self.assertTrue(execute.call_args.kwargs["check"])


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Repair only the existing OAuth function owner for the pending MCP migration.

Runs on the protected Oracle deployment runner as root, then invokes the
local postgres OS identity. No SQL superuser credentials are supplied to the
application. Never prints or exports DATABASE_URL or any secrets.
"""
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

ENV_PATH = Path("/etc/metadrive/production.env")
NAME = re.compile(r"[a-zA-Z_][a-zA-Z0-9_]{0,62}\Z")


def identity(env_text):
    values = [line.strip().split("=", 1)[1].strip()
              for line in env_text.splitlines()
              if line.strip().startswith("DATABASE_URL=")]
    if len(values) != 1:
        raise ValueError("Expected exactly one DATABASE_URL entry")
    value = values[0]
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        value = value[1:-1]
    uri = urlsplit(value)
    role = unquote(uri.username or "")
    database = unquote(uri.path.removeprefix("/"))
    if uri.scheme not in ("postgres", "postgresql") or not NAME.fullmatch(role) or not NAME.fullmatch(database):
        raise ValueError("Invalid PostgreSQL application identity")
    if role == "postgres":
        raise ValueError("Production runtime must not use the postgres superuser")
    return role, database


def statement(role):
    # The role has already passed a strict PostgreSQL-identifier allowlist.
    return f"""
DO $repair$
DECLARE target_role text := '{role}';
DECLARE current_owner text;
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_roles
  WHERE rolname=target_role AND rolcanlogin AND NOT rolsuper
 ) THEN
  RAISE EXCEPTION 'OAuth migration role must be an existing non-superuser login';
 END IF;
 SELECT pg_get_userbyid(p.proowner) INTO current_owner
 FROM pg_proc p WHERE p.oid=to_regprocedure(
  'public.md_oauth_token_allowed(uuid,uuid,text,text,text)');
 IF current_owner IS NOT NULL AND current_owner<>target_role THEN
  EXECUTE format(
   'ALTER FUNCTION public.md_oauth_token_allowed(uuid,uuid,text,text,text) OWNER TO %I',
   target_role);
 END IF;
END
$repair$;
"""


def main():
    role, database = identity(ENV_PATH.read_text(encoding="utf-8"))
    # Owner change only; does not modify OAuth decisions, policies, tokens
    # or tenant data. Avoid logging database credentials or query contents.
    subprocess.run(
        ["runuser", "-u", "postgres", "--", "psql",
         "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", database],
        input=statement(role), text=True, check=True, timeout=25,
    )
    print("Oracle OAuth migration function ownership checked (non-superuser runtime role)")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("Oracle OAuth migration ownership repair failed: " +
              type(exc).__name__, file=sys.stderr)
        raise SystemExit(1)

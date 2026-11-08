#!/usr/bin/env bash
# GitHub Actions self-hosted Oracle runner: provision a DMS master account
# without sending its password to GitHub or exposing it through Docker argv.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Root required' >&2; exit 1; }

container=metadrive-docker-mailserver
env_file=/etc/metadrive/mail-admin-master.env
dropin=/etc/systemd/system/metadrive-api.service.d/96-mail-admin-master.conf
host=mail.unesolutions.co.uk

[[ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null)" == true ]] ||
 { echo 'Docker Mailserver is not running; no changes applied' >&2; exit 1; }
config="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/tmp/docker-mailserver"}}{{.Source}}{{end}}{{end}}' "$container")"
[[ "$config" = /* && -d "$config" && -f "$config/postfix-accounts.cf" ]] ||
 { echo 'Expected persistent DMS config volume not found; no changes applied' >&2; exit 1; }
master_file="$config/dovecot-masters.cf"

# Respect existing operator-managed configuration. Never rotate it silently.
if grep -Eq '^METADRIVE_MAIL_ADMIN_MASTER_(USERNAME|PASSWORD)=' /etc/metadrive/production.env; then
 echo 'Admin master settings already managed in production.env; leaving unchanged'
 exit 0
fi

install -d -o root -g root -m 0700 /etc/metadrive
if [[ -e "$env_file" ]]; then
 [[ -f "$env_file" && ! -L "$env_file" ]] || exit 1
 chmod 0600 "$env_file"
 master_user="$(sed -n 's/^METADRIVE_MAIL_ADMIN_MASTER_USERNAME=//p' "$env_file")"
 secret="$(sed -n 's/^METADRIVE_MAIL_ADMIN_MASTER_PASSWORD=//p' "$env_file")"
 [[ "$master_user" =~ ^mdadmin-[a-f0-9]{12}$ && "$secret" =~ ^[a-f0-9]{64}$ ]] ||
  { echo 'Existing admin master settings invalid; refusing to overwrite' >&2; exit 1; }
else
 master_user="mdadmin-$(openssl rand -hex 6)"
 secret="$(openssl rand -hex 32)"
 if [[ -e "$master_file" ]] && grep -Fq "$master_user|" "$master_file"; then
  echo 'Generated master account username already exists; refusing to overwrite' >&2; exit 1
 fi
 temp_env="$(mktemp /etc/metadrive/.mail-admin-master.env.XXXXXXXX)"
 printf 'METADRIVE_MAIL_ADMIN_MASTER_USERNAME=%s\nMETADRIVE_MAIL_ADMIN_MASTER_PASSWORD=%s\n' \
  "$master_user" "$secret" >"$temp_env"
 chmod 0600 "$temp_env"
 mv -f "$temp_env" "$env_file"
fi

if [[ ! -f "$master_file" ]] || ! grep -Fq "$master_user|" "$master_file"; then
 # Docker Mailserver master accounts use the {SHA512-CRYPT} format.
 password_hash="$(printf '%s\n' "$secret" | openssl passwd -6 -stdin)"
 temp_accounts="$(mktemp "$config/.dovecot-masters.cf.XXXXXXXX")"
 if [[ -f "$master_file" ]]; then cp -p "$master_file" "$temp_accounts"; fi
 printf '%s|{SHA512-CRYPT}%s\n' "$master_user" "$password_hash" >>"$temp_accounts"
 chmod 0644 "$temp_accounts"
 mv -f "$temp_accounts" "$master_file"
fi

# DMS watches this config for changes. Confirm actual IMAP auth before
# giving the MetaDrive API access to the credential.
python3 - "$env_file" "$config/postfix-accounts.cf" "$host" <<'PY'
import imaplib, pathlib, ssl, sys, time
env, accounts, hostname = sys.argv[1:]
values = dict(line.split("=", 1) for line in pathlib.Path(env).read_text().splitlines() if "=" in line)
username = values["METADRIVE_MAIL_ADMIN_MASTER_USERNAME"]
password = values["METADRIVE_MAIL_ADMIN_MASTER_PASSWORD"]
mailbox = next(
    (line.split("|", 1)[0] for line in pathlib.Path(accounts).read_text().splitlines()
     if line and not line.startswith("#") and "|" in line and "@" in line.split("|", 1)[0]), None)
if not mailbox:
    raise SystemExit("No existing mailbox available to verify Dovecot master access")
for attempt in range(12):
    try:
        client = imaplib.IMAP4_SSL(hostname, 993, ssl_context=ssl.create_default_context(), timeout=10)
        try:
            client.login(mailbox + "*" + username, password)
            client.logout()
        finally:
            try: client.shutdown()
            except Exception: pass
        break
    except Exception:
        if attempt == 11:
            raise SystemExit("Dovecot master IMAP login failed; API credential not enabled")
        time.sleep(3)
print("Dedicated Dovecot master IMAP login verified")
PY

install -d -o root -g root -m 0755 /etc/systemd/system/metadrive-api.service.d
temp_dropin="$(mktemp /etc/systemd/system/metadrive-api.service.d/.96-mail-admin-master.XXXXXXXX)"
printf '[Service]\nEnvironmentFile=-%s\n' "$env_file" >"$temp_dropin"
chmod 0644 "$temp_dropin"
mv -f "$temp_dropin" "$dropin"
systemctl daemon-reload
echo 'Dedicated admin IMAP credential is configured for the next API restart'

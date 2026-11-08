#!/usr/bin/env bash
# Install a renewal hook that updates Docker Mailserver's private certificate copies.
# Run once with sudo on the Oracle host, from the checked-out repository.
set -euo pipefail
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cert_dir="${source_dir}/certs"
domain="mail.unesolutions.co.uk"
source_path="/etc/letsencrypt/live/${domain}"
test -f "${source_path}/fullchain.pem"
test -f "${source_path}/privkey.pem"
install -d -m 750 "${cert_dir}"
install -m 644 -T -D "${source_path}/fullchain.pem" "${cert_dir}/fullchain.pem"
install -m 600 -T -D "${source_path}/privkey.pem" "${cert_dir}/privkey.pem"
hook="/etc/letsencrypt/renewal-hooks/deploy/metadrive-docker-mailserver.sh"
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > "${hook}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
case "\${RENEWED_DOMAINS:-}" in *mail.unesolutions.co.uk*) ;; *) exit 0 ;; esac
install -m 644 -T -D "/etc/letsencrypt/live/mail.unesolutions.co.uk/fullchain.pem" "${cert_dir}/fullchain.pem"
install -m 600 -T -D "/etc/letsencrypt/live/mail.unesolutions.co.uk/privkey.pem" "${cert_dir}/privkey.pem"
docker restart metadrive-docker-mailserver >/dev/null
EOF
chmod 700 "${hook}"
printf '%s\n' 'Mail TLS renewal hook installed; existing certificate copies refreshed.'

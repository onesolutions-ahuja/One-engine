#!/usr/bin/env bash
# Enable password-recovery email for every tenant through OCI Email Delivery HTTPS
# submission, authenticated by this instance's principal. No SMTP username or
# password is created or stored. Never prints secrets.
#
# Usage: sudo ./configure-recovery-mail.sh support@unesolutions.co.uk you@example.com
#   arg 1: approved sender (From address)   arg 2: address that receives a test email
set -Eeuo pipefail
[[ $EUID == 0 ]] || { echo 'Run as root (sudo)' >&2; exit 1; }
from=${1:?approved sender email required}
test_to=${2:?test recipient email required}
env_file=/etc/metadrive/production.env
region=${METADRIVE_OCI_REGION:-uk-london-1}
oci=/usr/local/bin/oci
[[ -x $oci ]] || { echo "OCI CLI missing at $oci" >&2; exit 1; }
[[ -r /etc/metadrive/mail-sender.env ]] || { echo '/etc/metadrive/mail-sender.env missing' >&2; exit 1; }
compartment="$(sed -nE 's/^METADRIVE_OCI_MAIL_COMPARTMENT_OCID=(ocid1\.(compartment|tenancy)\.oc1\.\.[a-z0-9]+)$/\1/p' /etc/metadrive/mail-sender.env | head -n1)"
[[ -n $compartment ]] || { echo 'Compartment OCID missing in mail-sender.env' >&2; exit 1; }

echo "1/5 Checking '$from' is an ACTIVE approved sender in OCI Email Delivery..."
state="$($oci email sender list --auth instance_principal --region "$region" --compartment-id "$compartment" \
  --email-address "$from" --query 'data[0]."lifecycle-state"' --raw-output 2>/dev/null || true)"
if [[ $state != ACTIVE ]]; then
  echo "   Not active (state: ${state:-not found}). Creating approved sender..."
  $oci email sender create --auth instance_principal --region "$region" \
    --compartment-id "$compartment" --email-address "$from" >/dev/null \
    || { echo '   Could not create the sender: the instance dynamic group needs "manage email-family" in this compartment.' >&2; exit 1; }
  echo '   Created. Make sure SPF/DKIM for the domain are published (OCI console → Email Delivery → Email Domains).'
fi

echo "2/5 Sending a test email to $test_to via instance principal..."
$oci email-data-plane email-submitted-response submit-email --auth instance_principal --region "$region" \
  --sender "{\"senderAddress\":{\"email\":\"$from\",\"name\":\"UNE Solutions\"},\"compartmentId\":\"$compartment\"}" \
  --recipients "{\"to\":[{\"email\":\"$test_to\"}]}" \
  --subject 'UNE Solutions password recovery mail test' \
  --body-text 'Password recovery email is configured. You can ignore this message.' >/dev/null \
  || { echo '   Test send failed: the instance dynamic group needs "use email-family" in this compartment, and the sender must be approved.' >&2; exit 1; }
echo '   Sent.'

echo "3/5 Writing non-secret settings to $env_file..."
cp -p "$env_file" "$env_file.bak.$(date +%Y%m%d%H%M%S)"
set_var(){ local k=$1 v=$2; if grep -qE "^$k=" "$env_file"; then sed -i "s|^$k=.*|$k=$v|" "$env_file"; else printf '%s=%s\n' "$k" "$v" >>"$env_file"; fi; }
set_var METADRIVE_PLATFORM_MAIL_TRANSPORT oci-https
set_var METADRIVE_OCI_MAIL_COMPARTMENT_OCID "$compartment"
set_var METADRIVE_OCI_REGION "$region"
set_var METADRIVE_PLATFORM_MAIL_FROM_EMAIL "$from"
set_var METADRIVE_PASSWORD_RESET_ORIGIN https://unesolutions.co.uk/login

echo '4/5 Ensuring the OTP secret exists (generated here, never printed)...'
if ! grep -qE '^METADRIVE_PASSWORD_RESET_OTP_SECRET=.{32,}$' "$env_file"; then
  set_var METADRIVE_PASSWORD_RESET_OTP_SECRET "$(openssl rand -hex 32)"
fi
chmod 0640 "$env_file"

echo '5/5 Restarting the API...'
systemctl restart metadrive-api.service
sleep 3
systemctl is-active --quiet metadrive-api.service && echo 'Done: password recovery email is enabled for all tenants.'

#!/usr/bin/env bash
# Never print compartment identifiers, metadata tokens, or mailbox credentials.
set -euo pipefail
if [[ ! -x /usr/local/bin/oci ]]; then
 echo "::warning::OCI approved-sender automation blocked: /usr/local/bin/oci is not installed"
 exit 0
fi
if [[ ! -r /etc/metadrive/mail-sender.env ]]; then
 echo "::warning::OCI approved-sender automation blocked: root-owned mail-sender.env missing"
 exit 0
fi
# Root-owned file consists solely of the compartment ID. Never source arbitrary contents.
compartment="$(sed -nE 's/^METADRIVE_OCI_MAIL_COMPARTMENT_OCID=(ocid1\.(compartment|tenancy)\.oc1\.\.[a-z0-9]+)$/\1/p' /etc/metadrive/mail-sender.env | head -n1)"
if [[ -z "$compartment" ]]; then
 echo "::warning::OCI approved-sender automation blocked: compartment OCID is missing or invalid"
 exit 0
fi
if timeout 30 /usr/local/bin/oci email sender list --auth instance_principal --region uk-london-1 --compartment-id "$compartment" --limit 1 >/dev/null 2>&1; then
 echo "OCI approved-sender instance principal list preflight passed"
else
 echo "::warning::OCI approved-sender automation blocked: identity or compartment policy is not ready"
fi

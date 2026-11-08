# Stalwart Mail integration

This integration targets Stalwart 0.16+ and uses JMAP for management and mailbox data. It does not use the removed legacy REST principal API.

## Server configuration

Configure these on the MetaDrive API process, never in browser build variables:

- `STALWART_BASE_URL=http://127.0.0.1:8080` when the API and Stalwart run on the same VM and Stalwart's HTTP listener is loopback-bound.
- `STALWART_API_KEY=<dedicated restricted server-side key>`
- `STALWART_ALLOWED_DOMAINS=unesolutions.co.uk` (exact comma-separated allowlist).

The management client accepts Stalwart's same-origin `307` from `/.well-known/jmap` to `/jmap/session`; it does not follow redirects for JMAP API calls or to other destinations.

Never use a `VITE_*` variable for the management key. Keep Stalwart port 8080 private. Create a restricted API key with Replace permission mode and only the account/domain get/query/create/update/destroy permissions needed for the management service, plus the following narrowly scoped permissions needed to grant mailbox users their webmail access: `authenticate`, `jmapEmailGet`, `jmapEmailQuery`, `jmapMailboxGet`, `jmapIdentityGet`, `jmapEmailUpdate`, `jmapEmailImport`, `jmapEmailSubmissionCreate`, `jmapBlobUpload`, and `jmapBlobGet`. Mailbox users receive this explicit Replace set rather than Stalwart's broad default User role; keep the API key's allowed permission set limited to those grants.

The service creates a deterministic internal Stalwart Group per MetaDrive tenant and uses standard `memberGroupIds` membership to scope mailboxes. Do not manually delete generated `mdt<tenant-uuid-without-hyphens>` groups. The assignable `MailAdmin` permission set grants `Mailbox:read` and `Mailbox:manage` but is not automatically assigned.

## GitHub Pages frontend and API-host proxy

The frontend is hosted by GitHub Pages and uses `https://api.unesolutions.co.uk/api` as its API base. The `/mail` page is part of the SPA and uses the existing Pages fallback for deep links. It must not require apex DNS changes or an Nginx route on the apex host.

The server now registers `/api/mail-jmap/*` before Express body parsing and before the MetaDrive bearer-token authorization middleware. This lets the public webmail use the mailbox owner's own Basic credentials to access JMAP while the Stalwart management API key remains server-side and is never used by webmail.

Configure these on the MetaDrive API process:

- `STALWART_BASE_URL=http://127.0.0.1:8080` when Stalwart runs on the same VM with a loopback-bound listener.
- `STALWART_API_KEY=<dedicated restricted server-side key>` for mailbox/domain management routes.
- `STALWART_ALLOWED_DOMAINS=unesolutions.co.uk` (exact comma-separated domain allowlist).
- Optional `METADRIVE_MAIL_WEB_ORIGINS=https://unesolutions.co.uk` to configure the exact allowed browser origins for JMAP. The default is the apex origin only.

The JMAP bridge only permits discovery, JMAP API, upload and download paths. For discovery only, it follows Stalwart's same-origin `307` redirect to `/jmap/session`; other redirect targets are rejected. On JMAP POSTs it allowlists the mail-only capabilities and the required user mailbox methods; Stalwart management methods such as `x:Account/set` are blocked at the bridge. It only forwards HTTP Basic authorization, applies request/upload size limits, and refuses non-loopback plaintext Stalwart URLs. It does not accept the MetaDrive management API key from browser requests.

**No extra Nginx location is required** if the existing `api.unesolutions.co.uk` HTTPS Nginx configuration already forwards `/api/*` requests to the MetaDrive Express API. Do not add a competing `/api/mail-jmap/` Nginx proxy that bypasses this middleware. Preserve the existing Nginx server block and TLS settings.

If the API hostname has a restrictive Nginx body-size limit, allow at least 25 MB for `/api/mail-jmap/jmap/upload/` while preserving all other existing API limits. Test with `sudo nginx -t` before any reload. Keep Stalwart's port 8080 private.

## UI features

- `/mail`: mailbox sign-in, folders, inbox search, reading, mark-as-read, reply, forward, compose, attachment sending (20 MB total limit), and saving drafts to the Drafts folder.
- `/mail-admin`: MetaDrive-authenticated tenant mailbox listing, creation, description/quota editing, password reset, and confirmed deletion.

Saved drafts persist in Stalwart's Drafts folder. Editing a previously saved draft and forwarding original binary attachments are not yet supported. Suspension is not implemented because Stalwart's standard Account object does not expose a simple enabled/disabled flag; the UI must not fake suspension by overwriting credentials.

## DNS and mail delivery

No DNS records are changed by this repository. Preserve existing apex GitHub Pages records, current MX, SPF, Brevo sending records, DKIM and DMARC until the live server has been checked and the owner approves an exact DNS diff. Do not create multiple SPF records or invent DKIM keys.

Before changing MX, independently verify Stalwart listener bindings and TLS, OCI network rules, SMTP submission on 587/STARTTLS, inbound delivery, outbound delivery, SPF, DKIM and DMARC. The existing OCI Email Delivery setup does not by itself prove that this Stalwart host can send or receive mail.

## Live rollout checks

After deploying the MetaDrive API and updating the Nginx API-host location:

1. Confirm `STALWART_BASE_URL`, `STALWART_API_KEY`, and `STALWART_ALLOWED_DOMAINS` exist in the server runtime.
2. From a browser on the production origin, verify JMAP discovery at `https://api.unesolutions.co.uk/api/mail-jmap/.well-known/jmap` returns JSON with proxy-rewritten paths and correct CORS headers.
3. Sign in to `https://unesolutions.co.uk/mail` with a real mailbox. Test folders, search, read, send, attachment, draft save and forward.
4. Verify `/mail-admin` denies users without Mailbox RBAC permissions and that two tenants cannot see or mutate each other's mailboxes.
5. Create a disposable test mailbox, confirm it exists in Stalwart, verify persistence across a container restart, then delete only the test mailbox.
6. Check Nginx/Stalwart logs for errors and confirm passwords/API keys are not logged.
7. Verify real inbound/outbound delivery before approving DNS changes.

The GitHub repository connector can validate source and GitHub Actions but cannot access the live Oracle VM, Nginx, Cloudflare zone, OCI network rules, Stalwart API key, or real mail delivery. Those live checks must be completed on the actual host; no production DNS or mail cutover should be claimed until they pass.

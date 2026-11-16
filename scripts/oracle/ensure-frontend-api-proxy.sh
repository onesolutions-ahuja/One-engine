#!/usr/bin/env bash
# Ensure the main-domain frontend forwards /api to the existing local API.
# Idempotent, with Nginx validation and immediate rollback on failed checks.
set -Eeuo pipefail
[[ "${EUID}" == 0 ]] || { echo "Must execute as root" >&2; exit 1; }
site=/etc/nginx/sites-available/metadrive-frontend
test -f "$site"
grep -Eq 'server_name[[:space:]]+unesolutions[.]co[.]uk' "$site"
if grep -Eq 'location[[:space:]]+(\^~[[:space:]]+)?/api/' "$site"; then
  echo "Frontend API proxy already configured"
else
  backup="$(mktemp /etc/nginx/sites-available/.metadrive-frontend.XXXXXXXX)"
  cp -p "$site" "$backup"
  restore() {
    cp -p "$backup" "$site"
    nginx -t >/dev/null 2>&1 && nginx -s reload || true
    rm -f "$backup"
  }
  trap restore ERR
  python3 - "$site" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text()
needle='    location / {'
if s.count(needle)!=1:
    raise SystemExit('Unexpected frontend vhost structure; no changes applied')
location='''    location ^~ /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
    }
'''
p.write_text(s.replace(needle,location+needle,1))
PY
  nginx -t
  nginx -s reload
  trap - ERR
  rm -f "$backup"
fi
# Preserve the existing API route while admitting the platform's validated 5 MiB
# image uploads (base64 JSON can reach ~6.7 MiB). Nginx defaults to 1 MiB;
# setting a bounded 8 MiB limit avoids an HTML 413 response to /api/media-assets.
# Apply idempotently to an existing vhost, with rollback on invalid Nginx config.
if ! grep -Eq 'client_max_body_size[[:space:]]+8[mM]' "$site"; then
  backup="$(mktemp /etc/nginx/sites-available/.metadrive-frontend.XXXXXXXX)"
  cp -p "$site" "$backup"
  restore_upload_limit() {
    cp -p "$backup" "$site"
    nginx -t >/dev/null 2>&1 && nginx -s reload || true
    rm -f "$backup"
  }
  trap restore_upload_limit ERR
  python3 - "$site" <<'PY'
from pathlib import Path
import re
import sys
p=Path(sys.argv[1])
s=p.read_text()
match=re.search(r'location\s+(?:\^~\s+)?/api/\s*\{',s)
if match is None:
    raise SystemExit('API proxy location not found; cannot set safe upload size')
start=match.end()
depth=1
end=start
while end<len(s) and depth:
    if s[end]=='{': depth+=1
    elif s[end]=='}': depth-=1
    end+=1
if depth or 'proxy_pass' not in s[start:end-1]:
    raise SystemExit('API proxy configuration unexpected; abort upload change')
body=s[start:end-1]
if not re.search(r'\bclient_max_body_size\s+',body):
    s=s[:start]+'\n        client_max_body_size 8m;'+s[start:]
p.write_text(s)
PY
  nginx -t
  nginx -s reload
  trap - ERR
  rm -f "$backup"
fi
# Check routing on every run, including already-configured proxies.
code=""
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  code="$(curl --noproxy '*' --silent --max-time 8 --resolve unesolutions.co.uk:443:127.0.0.1 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' https://unesolutions.co.uk/api/auth/federation/complete)" || code="000"
  [[ "$code" == "204" ]] && break
  sleep 1
done
[[ "$code" == "204" ]] || { echo "Unexpected main-domain federation status: $code" >&2; false; }
# Cloudflare in front of the site: restore the visitor's own IP from CF-Connecting-IP,
# only for requests that really come from Cloudflare's published ranges (cloudflare.com/ips).
# Login limits, audit and session checks then keep seeing the real visitor.
real_ip=/etc/nginx/conf.d/metadrive-cloudflare-real-ip.conf
real_ip_new="$(mktemp)"
{
  echo '# Managed by ensure-frontend-api-proxy.sh'
  for range in 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 \
    108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 \
    104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 \
    2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32; do
    echo "set_real_ip_from $range;"
  done
  echo 'real_ip_header CF-Connecting-IP;'
} > "$real_ip_new"
if ! cmp -s "$real_ip_new" "$real_ip"; then
  had_old=0; [[ -f "$real_ip" ]] && { cp -p "$real_ip" "$real_ip_new.old"; had_old=1; }
  install -o root -g root -m 0644 "$real_ip_new" "$real_ip"
  if nginx -t >/dev/null 2>&1; then nginx -s reload; echo "Cloudflare visitor IP restore configured."
  else
    if [[ $had_old == 1 ]]; then cp -p "$real_ip_new.old" "$real_ip"; else rm -f "$real_ip"; fi
    echo "Cloudflare visitor IP config rejected by nginx; left unchanged" >&2
  fi
  rm -f "$real_ip_new.old"
fi
rm -f "$real_ip_new"
echo "Frontend API reverse proxy verified."

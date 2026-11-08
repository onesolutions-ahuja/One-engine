#!/usr/bin/env bash
# Idempotent frontend renderer caching/compression, with complete config rollback.
set -Eeuo pipefail
[[ "${EUID}" == 0 ]] || { echo "Must execute as root" >&2; exit 1; }
site=/etc/nginx/sites-available/metadrive-frontend
test -f "$site"
grep -Eq 'server_name[[:space:]]+unesolutions[.]co[.]uk' "$site"
if grep -q 'oneengine-component-delivery-v1' "$site"; then
  nginx -t
  exit 0
fi
backup="$(mktemp /etc/nginx/sites-available/.component-delivery.XXXXXXXX)"
cp -p "$site" "$backup"
restore() {
  cp -p "$backup" "$site"
  nginx -t >/dev/null 2>&1 && nginx -s reload || true
  rm -f "$backup"
}
trap restore ERR
# Brotli is not part of every Nginx distribution. Enable it only if the module
# is already built-in or loaded. Gzip is always the functional fallback.
supports_brotli=0
if nginx -V 2>&1 | grep -q 'ngx_brotli'; then supports_brotli=1; fi
if nginx -T 2>&1 | grep -Eq 'load_module .*brotli'; then supports_brotli=1; fi
supports_gzip_static=0
if nginx -V 2>&1 | grep -q -- '--with-http_gzip_static_module'; then supports_gzip_static=1; fi
python3 - "$site" "$supports_brotli" "$supports_gzip_static" <<'PY'
from pathlib import Path
import sys
path=Path(sys.argv[1])
enabled_brotli=sys.argv[2]=='1'
enabled_gzip_static=sys.argv[3]=='1'
content=path.read_text()
anchor='    location / {'
if content.count(anchor)!=1: raise SystemExit('Unexpected frontend vhost structure')
gzip_static='        gzip_static on;\n' if enabled_gzip_static else ''
brotli=('    brotli on;\n    brotli_types application/json application/javascript text/javascript text/css;\n'
        if enabled_brotli else '')
brotli_static='        brotli_static on;\n' if enabled_brotli else ''
addition='''    # oneengine-component-delivery-v1
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types application/json application/javascript text/javascript text/css;
'''+brotli+'''    # Renderer assets are immutable; catalog-index remains fresh for republishing.
    location ~ "^/component-library/components/[A-Za-z][A-Za-z0-9_]*\\.[a-f0-9]{16}\\.json$" {
        try_files $uri =404;
'''+gzip_static+brotli_static+'''        add_header Cache-Control "public, max-age=31536000, immutable";
        add_header Vary "Accept-Encoding";
    }
    location = /component-library/catalog-index.json {
        try_files $uri =404;
        add_header Cache-Control "no-cache";
    }
'''
path.write_text(content.replace(anchor,addition+anchor,1))
PY
nginx -t
nginx -s reload
trap - ERR
rm -f "$backup"

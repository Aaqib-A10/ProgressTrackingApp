#!/usr/bin/env bash
# Faster repeat visits: tell browsers (and Cloudflare) to keep PulseTrack's built files.
#
#   sudo bash ~/pulsetrack/scripts/nginx-speed.sh
#
# Files under /assets/ have a fingerprint in their name (index-AbC123.js), so they never
# change: browsers may keep them for a year. index.html must always be fresh, so a new
# release shows up at once. Call backgrounds and the video-effects engine are kept a week.
# Also turns on compression for the API's JSON.
#
# Safe: it backs up the site file, checks the new setup with "nginx -t" and puts the
# backup back if anything is wrong. Running it twice changes nothing.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run it with sudo: sudo bash $0"; exit 1; fi

SITE=$(grep -lE "root[[:space:]]+/var/www/pulsetrack" /etc/nginx/sites-enabled/* 2>/dev/null | head -1 || true)
if [[ -z "$SITE" ]]; then echo "Could not find the PulseTrack site in /etc/nginx/sites-enabled. Nothing changed."; exit 1; fi
SITE=$(readlink -f "$SITE")
if grep -q "pt-speed" "$SITE"; then echo "Already set up in $SITE. Nothing to do."; exit 0; fi

BACKUP="$SITE.before-speed.$(date +%Y%m%d%H%M%S)"
cp "$SITE" "$BACKUP"

python3 - "$SITE" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
block = r'''
  # pt-speed: built files carry a fingerprint, so browsers can keep them for a year
  location ~* ^/assets/.+\.(js|css|woff2?|svg|png|jpe?g|webp|wasm)$ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
  }
  location ~* ^/(mediapipe|call-backgrounds)/ {
    add_header Cache-Control "public, max-age=604800";
    try_files $uri =404;
  }
  # pt-speed: the page itself is always checked, so a new release appears at once
  location = /index.html {
    add_header Cache-Control "no-cache";
  }
  gzip on;
  gzip_types application/json application/javascript text/css image/svg+xml application/wasm;
  gzip_min_length 1024;
'''
# Put the block just before the first "location / {" inside the server that has the PulseTrack root.
m = re.search(r'\n(\s*)location\s+/\s*\{', s)
if not m:
    sys.exit('no "location / {" found')
s = s[:m.start()] + '\n' + block.rstrip() + s[m.start():]
open(p, 'w').write(s)
PY

if nginx -t 2>/tmp/pt-nginx-test.txt; then
  (systemctl reload nginx 2>/dev/null || nginx -s reload)
  echo "Done. Browsers now keep PulseTrack's files (backup of the old setup: $BACKUP)."
else
  cp "$BACKUP" "$SITE"
  echo "nginx did not accept the change, so the old setup was put back. Details:"
  cat /tmp/pt-nginx-test.txt
  exit 1
fi

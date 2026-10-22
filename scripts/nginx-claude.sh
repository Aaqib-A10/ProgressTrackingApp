#!/usr/bin/env bash
# Let Claude connect to Metriq (the "Connect Claude" link in Settings).
#
#   sudo bash ~/pulsetrack/scripts/nginx-claude.sh
#
# When you press Connect in Claude, it first asks the site whether it needs a sign-in, at
# /.well-known/oauth-... addresses. The website used to answer those with the app's home page,
# so Claude thought Metriq had a sign-in and failed ("Couldn't register with Metriq's sign-in
# service"). Metriq needs no sign-in there (the private key is in the link), so this makes those
# addresses answer "not found".
#
# Safe: it backs up the site file, checks the new setup with "nginx -t" and puts the backup
# back if anything is wrong. Running it twice changes nothing.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run it with sudo: sudo bash $0"; exit 1; fi

SITE=$(grep -lE "root[[:space:]]+/var/www/pulsetrack" /etc/nginx/sites-enabled/* 2>/dev/null | head -1 || true)
if [[ -z "$SITE" ]]; then echo "Could not find the PulseTrack site in /etc/nginx/sites-enabled. Nothing changed."; exit 1; fi
SITE=$(readlink -f "$SITE")
if grep -q "pt-claude" "$SITE"; then echo "Already set up in $SITE. Nothing to do."; exit 0; fi

BACKUP="$SITE.before-claude.$(date +%Y%m%d%H%M%S)"
cp "$SITE" "$BACKUP"

python3 - "$SITE" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
block = r'''
  # pt-claude: Claude asks these to see if Metriq needs a sign-in. It does not, so say "not found"
  # (instead of the app's home page).
  location ^~ /.well-known/oauth- {
    default_type application/json;
    return 404 '{"error":"not_found"}';
  }
  location = /.well-known/openid-configuration {
    default_type application/json;
    return 404 '{"error":"not_found"}';
  }
'''
m = re.search(r'\n(\s*)location\s+/\s*\{', s)
if not m:
    sys.exit('no "location / {" found')
s = s[:m.start()] + '\n' + block.rstrip() + s[m.start():]
open(p, 'w').write(s)
PY

if nginx -t 2>/tmp/pt-nginx-test.txt; then
  (systemctl reload nginx 2>/dev/null || nginx -s reload)
  echo "Done. Claude can now connect to Metriq (backup of the old setup: $BACKUP)."
else
  cp "$BACKUP" "$SITE"
  echo "nginx did not accept the change, so the old setup was put back. Details:"
  cat /tmp/pt-nginx-test.txt
  exit 1
fi

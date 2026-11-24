#!/usr/bin/env bash
# Let Claude, ChatGPT and other apps SIGN IN to Metriq (the connector at https://<site>/api/mcp).
#
#   sudo bash ~/pulsetrack/scripts/nginx-oauth.sh
#
# An app finds out how to sign in by asking the site for /.well-known/oauth-protected-resource,
# /.well-known/oauth-authorization-server and /.well-known/openid-configuration. nginx-claude.sh made those answer
# "not found" (when connectors used a key in the link). Metriq now answers them itself (server/src/routes/mcpAuth.ts),
# so this passes those addresses on to the app, like /api/. Nothing else changes (Let's Encrypt's
# /.well-known/acme-challenge stays as it is).
#
# Safe: it backs up the site file, checks the new setup with "nginx -t" and puts the backup back if anything is
# wrong. Running it twice changes nothing.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run it with sudo: sudo bash $0"; exit 1; fi

SITE=$(grep -lE "root[[:space:]]+/var/www/pulsetrack" /etc/nginx/sites-enabled/* 2>/dev/null | head -1 || true)
if [[ -z "$SITE" ]]; then echo "Could not find the PulseTrack site in /etc/nginx/sites-enabled. Nothing changed."; exit 1; fi
SITE=$(readlink -f "$SITE")
if grep -q "pt-oauth" "$SITE"; then echo "Already set up in $SITE. Nothing to do."; exit 0; fi

BACKUP="$SITE.before-oauth.$(date +%Y%m%d%H%M%S)"
cp "$SITE" "$BACKUP"

python3 - "$SITE" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()

# The app's own address, as /api/ already uses it (scheme, host and port only).
m = re.search(r'location\s+/api/\s*\{[^}]*?proxy_pass\s+(https?://[^/;\s]+)', s)
target = m.group(1) if m else 'http://127.0.0.1:4000'

# Take out the old "not found" answers (nginx-claude.sh), where they are.
s = re.sub(r'\n[ \t]*# pt-claude:.*?location = /\.well-known/openid-configuration \{.*?\n[ \t]*\}', '', s, flags=re.S)

headers = '''    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;'''
block = f'''
  # pt-oauth: how apps (Claude, ChatGPT...) find out how to sign in to Metriq. Answered by the app.
  location ^~ /.well-known/oauth- {{
    proxy_pass {target};
{headers}
  }}
  location ^~ /.well-known/openid-configuration {{
    proxy_pass {target};
{headers}
  }}
'''
m = re.search(r'\n(\s*)location\s+/\s*\{', s)
if not m:
    sys.exit('no "location / {" found')
s = s[:m.start()] + '\n' + block.rstrip() + s[m.start():]
open(p, 'w').write(s)
print(f'proxied to {target}')
PY

if nginx -t 2>/tmp/pt-nginx-test.txt; then
  (systemctl reload nginx 2>/dev/null || nginx -s reload)
  echo "Done. Apps can now sign in to Metriq (backup of the old setup: $BACKUP)."
else
  cp "$BACKUP" "$SITE"
  echo "nginx did not accept the change, so the old setup was put back. Details:"
  cat /tmp/pt-nginx-test.txt
  exit 1
fi

#!/usr/bin/env bash
# Turn on the outside uptime check (System Health). Run on the app server:
#     bash ~/pulsetrack/scripts/set-uptime-token.sh
#
# Makes a long random token, saves it in server/.env as UPTIME_TOKEN, restarts PulseTrack
# and prints the token once. Paste that token into /etc/metriq-uptime.env on the office
# server (see scripts/uptime-check.sh). Running it again makes a new token (the old one stops).
set -euo pipefail

APP=/home/erp/pulsetrack
ENV_FILE="$APP/server/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "server/.env is missing. Stop and ask Claude."
  exit 1
fi

TOKEN=$(openssl rand -hex 24)
cp "$ENV_FILE" "$ENV_FILE.before-uptime"
chmod 600 "$ENV_FILE.before-uptime"
grep -vE '^UPTIME_TOKEN=' "$ENV_FILE.before-uptime" > "$ENV_FILE"
echo "UPTIME_TOKEN=\"$TOKEN\"" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "== Restarting PulseTrack"
pm2 restart pulsetrack-api --update-env >/dev/null
sleep 5
pm2 logs pulsetrack-api --lines 30 --nostream | grep -E "listening|rror" | tail -3 || true

echo
echo "Saved. Put this line in /etc/metriq-uptime.env on the office server (it is shown only now):"
echo
echo "UPTIME_TOKEN=$TOKEN"
echo

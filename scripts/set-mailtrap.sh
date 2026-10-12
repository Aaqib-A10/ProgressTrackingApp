#!/usr/bin/env bash
# Switch PulseTrack's emails to Mailtrap.
# Run on the server:   bash ~/pulsetrack/scripts/set-mailtrap.sh <MAILTRAP_API_TOKEN> <your-email-for-a-test>
#
# 1. Sends one test email through Mailtrap with that token (from the MAIL_FROM address).
# 2. Only if it goes out: saves the token in server/.env, restarts PulseTrack and backs up the settings.
#    If Mailtrap says no, nothing is changed and the reason is shown.
set -euo pipefail

APP=/home/erp/pulsetrack
ENV_FILE="$APP/server/.env"
TOKEN="${1:-}"
TEST_TO="${2:-}"

if [ -z "$TOKEN" ] || [ -z "$TEST_TO" ]; then
  echo "Use it like this:  bash ~/pulsetrack/scripts/set-mailtrap.sh <MAILTRAP_API_TOKEN> <your-email>"
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "server/.env is missing. Stop and ask Claude."
  exit 1
fi

# The "from" address (must be on the domain verified in Mailtrap).
FROM_RAW=$(grep -E '^MAIL_FROM=' "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
[ -z "$FROM_RAW" ] && FROM_RAW='PulseTrack <noreply@pulsetrack.online>'
if [[ "$FROM_RAW" =~ ^(.*)\<([^>]+)\>$ ]]; then
  FROM_NAME=$(echo "${BASH_REMATCH[1]}" | sed -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//')
  FROM_EMAIL="${BASH_REMATCH[2]}"
else
  FROM_NAME="PulseTrack"
  FROM_EMAIL="$FROM_RAW"
fi
echo "== Sending a test email from $FROM_NAME <$FROM_EMAIL> to $TEST_TO"

BODY=$(printf '{"from":{"email":"%s","name":"%s"},"to":[{"email":"%s"}],"subject":"PulseTrack email test (Mailtrap)","text":"If you can read this, PulseTrack emails now go through Mailtrap.","html":"<p>If you can read this, <b>PulseTrack emails now go through Mailtrap</b>.</p>","category":"Setup test"}' "$FROM_EMAIL" "$FROM_NAME" "$TEST_TO")
RESP=$(curl -sS -w '\n%{http_code}' -X POST https://send.api.mailtrap.io/api/send \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$BODY" || true)
CODE=$(echo "$RESP" | tail -1)
TEXT=$(echo "$RESP" | sed '$d')

if [ "$CODE" != "200" ]; then
  echo "   Mailtrap said NO (code $CODE): $TEXT"
  case "$CODE" in
    401) echo "   -> The token is wrong or was copied with a missing piece. Copy it again from Mailtrap." ;;
    403) echo "   -> The domain of $FROM_EMAIL is not verified in Mailtrap yet (or the token belongs to another domain). Finish the DNS step and press 'Verify' in Mailtrap, then run this again." ;;
    *)   echo "   -> Send this message to Claude." ;;
  esac
  echo "   Nothing was changed."
  exit 1
fi
echo "   Mailtrap accepted it: $TEXT"

echo "== Saving the Mailtrap token in server/.env (and removing the old Resend key)"
cp "$ENV_FILE" "$ENV_FILE.before-mailtrap"
chmod 600 "$ENV_FILE.before-mailtrap"
# Resend is no longer used: its key goes, the Mailtrap token comes in.
grep -vE '^(MAILTRAP_API_TOKEN|RESEND_API_KEY)=' "$ENV_FILE.before-mailtrap" > "$ENV_FILE"
echo "MAILTRAP_API_TOKEN=\"$TOKEN\"" >> "$ENV_FILE"
grep -qE '^MAIL_FROM=' "$ENV_FILE" || echo "MAIL_FROM=\"$FROM_NAME <$FROM_EMAIL>\"" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "== Restarting PulseTrack"
pm2 restart pulsetrack-api --update-env >/dev/null
sleep 5
pm2 logs pulsetrack-api --lines 30 --nostream | grep -E "listening|rror" | tail -4 || true
echo "== Backing up the settings"
bash "$APP/scripts/backup-db.sh" >/dev/null && echo "   backup ok"
echo "DONE. Check $TEST_TO for the test email (also look in Spam the first time)."

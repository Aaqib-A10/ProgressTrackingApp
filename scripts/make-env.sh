#!/usr/bin/env bash
# Rebuild server/.env (the settings file) when it has been lost.
# Run on the server:   bash ~/pulsetrack/scripts/make-env.sh
#
# - Gives the database login a NEW password (and puts it in .env).
# - Makes a NEW login secret (everyone signs in again once).
# - Asks for the keys that come from outside websites (Groq, Resend, Cloudflare TURN).
#   Typing is hidden; press Enter to skip one.
# - Restarts PulseTrack with the new settings.
set -euo pipefail

APP=/home/erp/pulsetrack
ENV_FILE="$APP/server/.env"
DB=pulsetrack

cd "$APP"
if [ -f "$ENV_FILE" ]; then
  echo "server/.env already exists. Not changing it."
  exit 1
fi
if [ ! -f server/dist/index.js ]; then
  echo "Build PulseTrack first (server/dist is missing)."
  exit 1
fi

echo "== Database login (you may be asked for the erp password for sudo)"
ROLE=$(sudo -u postgres psql -Atc "select pg_get_userbyid(datdba) from pg_database where datname='$DB'")
if [ -z "$ROLE" ]; then
  echo "Could not find the '$DB' database. Stop and ask Claude."
  exit 1
fi
if [ "$ROLE" = "postgres" ] || grep -qs "//$ROLE:" /home/erp/99tech-erp/.env /home/erp/99tech-erp/.env.local /home/erp/99tech-erp/.env.production; then
  echo "The database login '$ROLE' is shared with something else. Not changing it. Stop and ask Claude."
  exit 1
fi
DB_PASS=$(openssl rand -hex 24)
sudo -u postgres psql -qc "ALTER ROLE \"$ROLE\" WITH LOGIN PASSWORD '$DB_PASS'"
echo "   new password set for '$ROLE'"

echo "== Keys from outside websites (typing is hidden, Enter = skip)"
read -rsp "Groq API key (console.groq.com, starts with gsk_): " GROQ; echo
read -rsp "Resend API key (resend.com, starts with re_): " RESEND; echo
read -rsp "Cloudflare TURN Token ID: " CF_ID; echo
read -rsp "Cloudflare TURN API Token: " CF_TOKEN; echo

umask 077
{
  echo "DATABASE_URL=\"postgresql://$ROLE:$DB_PASS@localhost:5432/$DB?schema=public\""
  echo "JWT_SECRET=\"$(openssl rand -base64 48 | tr -d '\n')\""
  echo 'JWT_EXPIRES_IN="7d"'
  echo 'PORT=4000'
  echo 'NODE_ENV="production"'
  echo 'APP_TIMEZONE="Asia/Karachi"'
  echo 'CLIENT_ORIGIN="https://pulsetrack.online"'
  echo 'APP_URL="https://pulsetrack.online"'
  echo 'MAIL_FROM="PulseTrack <noreply@pulsetrack.online>"'
  echo 'MAIL_REPLY_TO="noreply@pulsetrack.online"'
  [ -n "$RESEND" ] && echo "RESEND_API_KEY=\"$RESEND\""
  [ -n "$GROQ" ] && echo "GROQ_API_KEY=\"$GROQ\""
  [ -n "$CF_ID" ] && echo "CF_TURN_KEY_ID=$CF_ID"
  [ -n "$CF_TOKEN" ] && echo "CF_TURN_API_TOKEN=$CF_TOKEN"
  true
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"
mkdir -p server/uploads
chmod +x "$APP"/scripts/*.sh
echo "   server/.env written"

echo "== Restarting PulseTrack"
pm2 restart pulsetrack-api --update-env
sleep 5
pm2 logs pulsetrack-api --lines 40 --nostream | grep -E "listening|\[calls\]|rror" | tail -6
echo "== Saving a first backup copy of the settings"
bash "$APP/scripts/backup-db.sh" && echo "   backup ok"
echo "DONE. Everyone will need to sign in again once."

#!/usr/bin/env bash
# PulseTrack one-command deploy.
# Commits + pushes local changes to GitHub, then updates the live VPS
# (pull -> migrate -> build -> restart). Just run:  deploy
set -uo pipefail

# --- config ------------------------------------------------------------
SERVER="erp@50.190.164.37"
KEY="$HOME/.ssh/99tech_deploy"
APP_DIR="/home/erp/pulsetrack"        # git repo + server on the VPS
WEB_ROOT="/var/www/pulsetrack"        # Nginx-served client build (www-data)
PM2_APP="pulsetrack-api"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
blue()  { printf "\033[34m%s\033[0m\n" "$*"; }

# --- 1. push local -----------------------------------------------------
blue "==> [1/2] Saving & pushing your code to GitHub..."
cd "$REPO_DIR" || { red "Can't find repo at $REPO_DIR"; exit 1; }
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -m "Deploy $(date '+%Y-%m-%d %H:%M')" || true
fi
if ! git push origin HEAD; then
  red "git push failed — fix the message above, then run 'deploy' again."
  exit 1
fi
green "    Pushed."

# --- 2. deploy on the server ------------------------------------------
blue "==> [2/2] Deploying on the live server ($SERVER)..."
ssh -i "$KEY" "$SERVER" APP_DIR="$APP_DIR" WEB_ROOT="$WEB_ROOT" PM2_APP="$PM2_APP" 'bash -s' <<'REMOTE'
set -e
cd "$APP_DIR"
echo "-- git pull";               git pull
echo "-- npm install";            npm install --no-audit --no-fund
echo "-- prisma migrate deploy";  ( cd server && npx prisma migrate deploy )
echo "-- prisma generate";        ( cd server && npx prisma generate )
echo "-- build server";           npm run build -w server
echo "-- seed marketing example";  ( cd server && npx tsx src/scripts/seedMarketingExample.ts ) || echo "   (seed skipped/failed — non-fatal)"
echo "-- restart API";            pm2 restart "$PM2_APP"
echo "   >> server is now LIVE"
echo "-- build client";           npm run build -w client
echo "-- publish client build";
if rsync -a --delete client/dist/ "$WEB_ROOT"/ 2>/dev/null; then
  echo "   client published to $WEB_ROOT"
elif sudo -n rsync -a --delete client/dist/ "$WEB_ROOT"/ 2>/dev/null; then
  echo "   client published to $WEB_ROOT (via sudo)"
else
  echo "   !! could not write $WEB_ROOT — run once:  sudo chown -R erp:erp $WEB_ROOT"
  echo "   (API is updated; the new pages appear once the client is published)"
fi
echo "===== DEPLOY DONE ====="
REMOTE

status=$?
echo ""
if [ $status -eq 0 ]; then
  green "Deploy finished -> https://pulsetrack.online"
else
  red "Deploy hit an error above (exit $status). Copy the output to Claude."
fi
exit $status

#!/usr/bin/env bash
# Put the latest code from GitHub live. Run on the server:
#     bash ~/pulsetrack/scripts/server-deploy.sh
# Safe to run any time: it stops at the first problem and only ever publishes the
# website into /var/www/pulsetrack.
set -euo pipefail

APP=/home/erp/pulsetrack
WEB=/var/www/pulsetrack

cd "$APP"
if [ ! -f server/package.json ] || [ ! -f client/package.json ]; then
  echo "This is not the PulseTrack folder. Stopping."
  exit 1
fi
if [ ! -f server/.env ]; then
  echo "server/.env is missing. Run: bash ~/pulsetrack/scripts/make-env.sh"
  exit 1
fi

unset NODE_ENV
echo "== Getting the latest code";   git checkout -- package-lock.json 2>/dev/null || true; git pull --ff-only
echo "== Installing";                npm install --include=dev --no-audit --no-fund
echo "== Database update";           ( cd server && npx prisma migrate deploy && npx prisma generate )
echo "== Building the server";       npm run build -w server
echo "== Building the website";      npm run build -w client
if [ ! -f client/dist/index.html ]; then
  echo "The website build is missing. Stopping (nothing was published)."
  exit 1
fi
echo "== Publishing the website to $WEB"
rsync -a --delete "$APP/client/dist/" "$WEB/"
echo "== Restarting PulseTrack"
pm2 restart pulsetrack-api --update-env
sleep 5
pm2 logs pulsetrack-api --lines 40 --nostream | grep -E "listening|\[calls\]|rror" | tail -6
echo "DEPLOY DONE"

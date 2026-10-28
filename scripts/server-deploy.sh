#!/usr/bin/env bash
# Put the latest code from GitHub live. Run on the server:
#     bash ~/pulsetrack/scripts/server-deploy.sh
# Safe to run any time: it stops at the first problem and only ever publishes the
# website into /var/www/pulsetrack.
#
# Before changing anything it:
#   - checks the server is on the main branch (phase 1 work on erp never goes live by mistake)
#   - takes a backup of the database (and stops if the backup fails)
#   - remembers the version that was live, so scripts/rollback.sh can go back to it
# If GitHub has nothing new it says so and stops (usually a missed "git commit" or "git push").
# To build and restart the same version again anyway:  bash ~/pulsetrack/scripts/server-deploy.sh --again
set -euo pipefail

APP=/home/erp/pulsetrack
WEB=/var/www/pulsetrack
BK=/home/erp/backups/pulsetrack
AGAIN="${1:-}"

cd "$APP"
if [ ! -f server/package.json ] || [ ! -f client/package.json ]; then
  echo "This is not the PulseTrack folder. Stopping."
  exit 1
fi
if [ ! -f server/.env ]; then
  echo "server/.env is missing. Run: bash ~/pulsetrack/scripts/make-env.sh"
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "The server is on the '$BRANCH' branch. Only main goes live. Stopping (nothing was changed)."
  echo "To go back to main:  cd ~/pulsetrack && git checkout main"
  exit 1
fi

unset NODE_ENV
BEFORE=$(git rev-parse HEAD)
echo "== Getting the latest code";   git checkout -- package-lock.json 2>/dev/null || true; git pull --ff-only
AFTER=$(git rev-parse HEAD)
if [ "$BEFORE" = "$AFTER" ] && [ "$AGAIN" != "--again" ]; then
  echo "GitHub has nothing new: the live version is already the latest ($(git log -1 --format='%h %s'))."
  echo "If you just made a change: on your PC run git add -A, git commit -m \"...\" and git push, then run this again."
  exit 0
fi
echo "   now: $(git log -1 --format='%h %s')"

echo "== Backing up the database first"
mkdir -p "$BK/predeploy"
STAMP=$(date +%Y%m%d_%H%M%S)
( set -a; . "$APP/server/.env"; set +a
  pg_dump "${DATABASE_URL%%\?*}" --no-owner --no-privileges -Fc -f "$BK/predeploy/pulsetrack_$STAMP.dump" ) || {
  echo "The database backup failed. Stopping before any change (the code was pulled but nothing was built or restarted)."
  git reset --hard "$BEFORE" >/dev/null
  exit 1
}
# Keep the 10 newest pre-deploy backups (the nightly backups are separate).
ls -1t "$BK/predeploy"/pulsetrack_*.dump 2>/dev/null | tail -n +11 | xargs -r rm -f
echo "   saved $BK/predeploy/pulsetrack_$STAMP.dump"
if [ "$BEFORE" != "$AFTER" ]; then
  echo "$BEFORE" > "$BK/previous-version"
  echo "$BK/predeploy/pulsetrack_$STAMP.dump" > "$BK/previous-version-backup"
fi

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
pm2 logs pulsetrack-api --lines 40 --nostream | grep -E "listening|\[calls\]|rror" | tail -6 || true
echo "DEPLOY DONE"
echo "If something looks wrong: bash ~/pulsetrack/scripts/rollback.sh"

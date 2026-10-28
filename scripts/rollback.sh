#!/usr/bin/env bash
# Go back to the version that was live before the last deploy. Run on the server:
#     bash ~/pulsetrack/scripts/rollback.sh
# It puts the previous code back, builds it and restarts. The database is NOT touched: the
# backup taken just before that deploy is kept, and the command to restore it is printed at the
# end, for the rare case where the database itself must go back (that loses everything saved
# since the deploy, so it is never done by itself).
set -euo pipefail

APP=/home/erp/pulsetrack
WEB=/var/www/pulsetrack
BK=/home/erp/backups/pulsetrack

cd "$APP"
if [ ! -f "$BK/previous-version" ]; then
  echo "No earlier version is recorded yet (it is saved by each deploy). Nothing was changed."
  exit 1
fi
PREV=$(cat "$BK/previous-version")
NOW=$(git rev-parse HEAD)
if [ "$PREV" = "$NOW" ]; then
  echo "The live version is already the previous one ($(git log -1 --format='%h %s')). Nothing to do."
  exit 0
fi
echo "Live now:   $(git log -1 --format='%h %s' "$NOW")"
echo "Going back: $(git log -1 --format='%h %s' "$PREV")"
read -r -p "Type yes to go back: " OK
[ "$OK" = "yes" ] || { echo "Stopped. Nothing was changed."; exit 1; }

unset NODE_ENV
git checkout -- package-lock.json 2>/dev/null || true
git reset --hard "$PREV"
echo "== Installing";            npm install --include=dev --no-audit --no-fund
echo "== Building the server";   ( cd server && npx prisma generate ) && npm run build -w server
echo "== Building the website";  npm run build -w client
[ -f client/dist/index.html ] || { echo "The website build is missing. Stopping (nothing was published)."; exit 1; }
rsync -a --delete "$APP/client/dist/" "$WEB/"
pm2 restart pulsetrack-api --update-env
sleep 5
pm2 logs pulsetrack-api --lines 40 --nostream | grep -E "listening|rror" | tail -4 || true
echo "ROLLBACK DONE: the previous version is live. The next normal deploy brings the newest code back."
if [ -f "$BK/previous-version-backup" ]; then
  echo
  echo "Database: not changed. Only if the database itself must go back (this loses everything saved since that deploy):"
  echo "  set -a; . $APP/server/.env; set +a; pg_restore --clean --if-exists --no-owner -d \"\${DATABASE_URL%%\\?*}\" $(cat "$BK/previous-version-backup")"
fi

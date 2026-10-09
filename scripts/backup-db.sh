#!/usr/bin/env bash
# Nightly backup, run by cron at 03:00 (crontab: 0 3 * * * /home/erp/pulsetrack/scripts/backup-db.sh).
# Saves, OUTSIDE the app folder (in ~/backups/pulsetrack):
#   - the database (one file per night, kept 14 days)
#   - every uploaded file (chat files, pictures, recordings, attachments), copied into
#     uploads-mirror/ and never deleted from there
#   - the settings file (.env), readable only by erp
set -euo pipefail
APP=/home/erp/pulsetrack
OUT=/home/erp/backups/pulsetrack
mkdir -p "$OUT"
STAMP=$(date +%Y%m%d_%H%M%S)

set -a; . "$APP/server/.env"; set +a
pg_dump "${DATABASE_URL%%\?*}" --no-owner --no-privileges -Fc -f "$OUT/pulsetrack_$STAMP.dump"
find "$OUT" -maxdepth 1 -name 'pulsetrack_*.dump' -mtime +14 -delete

if [ -d "$APP/server/uploads" ]; then
  mkdir -p "$OUT/uploads-mirror"
  cp -a -u "$APP/server/uploads/." "$OUT/uploads-mirror/"
fi
install -m 600 "$APP/server/.env" "$OUT/env.backup"

echo "$(date '+%F %T') backup ok: database, uploads, settings"

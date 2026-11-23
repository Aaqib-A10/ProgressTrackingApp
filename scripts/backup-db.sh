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

# A copy OFF this server, so a lost or broken server does not take the backups with it.
# Only when BACKUP_REMOTE is set in server/.env, to an rclone destination such as "offsite:metriq-backups"
# (set up once with `rclone config`; an encrypted "crypt" remote is best). Database files older than
# BACKUP_REMOTE_KEEP_DAYS (default 30) are removed there; uploaded files are only ever added.
# The settings file (.env) is NOT sent: it holds keys. Keep a copy of it yourself, somewhere safe.
OFFSITE="not set up (BACKUP_REMOTE is empty)"
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if command -v rclone >/dev/null 2>&1; then
    rclone copy "$OUT/pulsetrack_$STAMP.dump" "$BACKUP_REMOTE/db" --quiet
    rclone delete "$BACKUP_REMOTE/db" --min-age "${BACKUP_REMOTE_KEEP_DAYS:-30}d" --quiet || true
    if [ -d "$OUT/uploads-mirror" ]; then rclone copy "$OUT/uploads-mirror" "$BACKUP_REMOTE/uploads" --quiet; fi
    OFFSITE="copied"
  else
    OFFSITE="FAILED (rclone is not installed)"
  fi
fi

echo "$(date '+%F %T') backup ok: database, uploads, settings; off-server copy: $OFFSITE"
case "$OFFSITE" in FAILED*) exit 1 ;; esac

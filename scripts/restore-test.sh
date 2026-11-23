#!/usr/bin/env bash
# Proves a backup can be brought back. A backup nobody has ever restored is only a hope.
#
#   bash ~/pulsetrack/scripts/restore-test.sh                  # the newest backup on this server
#   bash ~/pulsetrack/scripts/restore-test.sh /path/to/a.dump  # a file you name (e.g. one fetched from off-server)
#
# It restores the file into a NEW, EMPTY scratch database, counts what came back, and removes the scratch
# database again. The live database is only read to compare counts: it is never written to.
# Run it once a month (cron: 0 4 1 * * /home/erp/pulsetrack/scripts/restore-test.sh >> ~/backups/restore-test.log 2>&1).
set -euo pipefail
APP=/home/erp/pulsetrack
OUT=/home/erp/backups/pulsetrack

set -a; . "$APP/server/.env"; set +a
LIVE="${DATABASE_URL%%\?*}"
FILE="${1:-$(ls -1t "$OUT"/pulsetrack_*.dump 2>/dev/null | head -n 1)}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then echo "$(date '+%F %T') restore test FAILED: no backup file found"; exit 1; fi

# The same server and sign-in as the live database, a scratch database name of its own.
SCRATCH_NAME="restore_test_$(date +%s)"
ADMIN="${LIVE%/*}/postgres"
SCRATCH="${LIVE%/*}/$SCRATCH_NAME"
cleanup() { psql "$ADMIN" -q -c "DROP DATABASE IF EXISTS \"$SCRATCH_NAME\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql "$ADMIN" -q -c "CREATE DATABASE \"$SCRATCH_NAME\""
pg_restore --no-owner --no-privileges -d "$SCRATCH" "$FILE"

count() { psql "$1" -At -c "$2"; }
TABLES=$(count "$SCRATCH" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
USERS=$(count "$SCRATCH" 'SELECT count(*) FROM "User"')
COMPANIES=$(count "$SCRATCH" 'SELECT count(*) FROM "Company"')
NEWEST=$(count "$SCRATCH" 'SELECT coalesce(max("createdAt")::text, $$none$$) FROM "LoginEvent"')
LIVE_USERS=$(count "$LIVE" 'SELECT count(*) FROM "User"')

if [ "$TABLES" -lt 50 ] || [ "$USERS" -lt 1 ] || [ "$COMPANIES" -lt 1 ]; then
  echo "$(date '+%F %T') restore test FAILED: $FILE came back with $TABLES tables, $USERS people, $COMPANIES companies"
  exit 1
fi
echo "$(date '+%F %T') restore test ok: $(basename "$FILE") came back with $TABLES tables, $COMPANIES companies, $USERS people (live now: $LIVE_USERS), newest sign-in in it: $NEWEST"

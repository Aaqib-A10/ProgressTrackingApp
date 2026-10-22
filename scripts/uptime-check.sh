#!/usr/bin/env bash
# Metriq outside uptime check (System Health). Runs every minute on the OFFICE server (R740xd),
# so you hear about it even when the whole app server is down.
#
# What it does each minute:
#   * Opens https://pulsetrack.online/api/health. Two misses in a row = the site is down.
#   * Down: emails ALERT_EMAIL straight away (through Mailtrap), and again every 30 minutes.
#   * Back up: emails "back up", and reports the outage to Metriq, which puts it on the
#     System Health page and sends the developers a bell and phone alert.
#   * Up: tells Metriq "still here", so System Health can see the checker itself is working.
#
# Set up once:
#   1. On the app server:   bash ~/pulsetrack/scripts/set-uptime-token.sh      (prints a token)
#   2. Copy this file to the office server, then there:
#        sudo cp uptime-check.sh /usr/local/bin/metriq-uptime && sudo chmod 755 /usr/local/bin/metriq-uptime
#   3. sudo nano /etc/metriq-uptime.env   and put in:
#        SITE_URL=https://pulsetrack.online
#        UPTIME_TOKEN=<the token from step 1>
#        ALERT_EMAIL=<where the down / back up emails go>
#        MAILTRAP_API_TOKEN=<the same Mailtrap token the app uses>
#        MAIL_FROM=noreply@pulsetrack.online
#      then:  sudo chmod 600 /etc/metriq-uptime.env
#   4. Test it:   sudo /usr/local/bin/metriq-uptime --test
#   5. Every minute:   sudo crontab -e   and add the line
#        * * * * * /usr/local/bin/metriq-uptime >/dev/null 2>&1
set -uo pipefail

CONF=/etc/metriq-uptime.env
STATE_DIR=/var/tmp/metriq-uptime
TEST=0
[ "${1:-}" = "--test" ] && TEST=1

if [ ! -f "$CONF" ]; then echo "Missing $CONF (see the steps at the top of this file)."; exit 1; fi
# shellcheck disable=SC1090
set -a; . "$CONF"; set +a
SITE_URL="${SITE_URL:-https://pulsetrack.online}"
SITE_URL="${SITE_URL%/}"
if [ -z "${UPTIME_TOKEN:-}" ]; then echo "UPTIME_TOKEN is missing in $CONF."; exit 1; fi

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/lock"
flock -n 9 || exit 0   # the last run is still going

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
now_s() { date -u +%s; }
log() { echo "$(now_iso) $*" >> "$STATE_DIR/log"; [ "$TEST" = 1 ] && echo "$*"; tail -n 500 "$STATE_DIR/log" > "$STATE_DIR/log.tmp" 2>/dev/null && mv "$STATE_DIR/log.tmp" "$STATE_DIR/log"; }
clean() { printf '%s' "$1" | tr -d '"\\' | tr '\n\r\t' '   ' | cut -c1-200; }

send_mail() { # subject, text
  [ -z "${MAILTRAP_API_TOKEN:-}" ] || [ -z "${ALERT_EMAIL:-}" ] && { log "no email set up: $1"; return 0; }
  local from="${MAIL_FROM:-noreply@pulsetrack.online}" subject text
  subject=$(clean "$1"); text=$(clean "$2")
  local code
  code=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -X POST https://send.api.mailtrap.io/api/send \
    -H "Authorization: Bearer $MAILTRAP_API_TOKEN" -H "Content-Type: application/json" \
    -d "{\"from\":{\"email\":\"$from\",\"name\":\"Metriq uptime\"},\"to\":[{\"email\":\"$ALERT_EMAIL\"}],\"subject\":\"$subject\",\"text\":\"$text\",\"category\":\"Uptime\"}" || echo 000)
  log "email '$subject' -> $code"
}

tell_metriq() { # json body
  curl -sS -m 15 -o /dev/null -w '%{http_code}' -X POST "$SITE_URL/api/system-health/uptime" \
    -H "Content-Type: application/json" -H "x-uptime-token: $UPTIME_TOKEN" -H "User-Agent: MetriqUptime/1.0" -d "$1" || echo 000
}

# --- Look at the site ---------------------------------------------------------------------
BODY="$STATE_DIR/body"
HEADERS="$STATE_DIR/headers"
CODE=$(curl -sS -m 15 -D "$HEADERS" -o "$BODY" -w '%{http_code}' -H "User-Agent: MetriqUptime/1.0" "$SITE_URL/api/health" 2>"$STATE_DIR/err" || true)
[ -z "$CODE" ] && CODE=000
OK=0
grep -q '"status":"ok"' "$BODY" 2>/dev/null && grep -q '"db":"up"' "$BODY" 2>/dev/null && [ "$CODE" = 200 ] && OK=1
DETAIL="HTTP $CODE"
[ "$CODE" = 000 ] && DETAIL="No answer: $(clean "$(cat "$STATE_DIR/err" 2>/dev/null)")"
[ "$CODE" = 200 ] && [ "$OK" = 0 ] && DETAIL="Answered but the database is down"
if [ "$OK" = 0 ] && grep -qi '^cf-mitigated' "$HEADERS" 2>/dev/null; then
  # Cloudflare's bot check stopped us: that says nothing about the site.
  log "Cloudflare stopped the check (bot protection). Add a Cloudflare rule that skips bot checks for /api/health and /api/system-health/uptime."
  exit 0
fi

STATUS=$(cat "$STATE_DIR/status" 2>/dev/null || echo up)
FAILS=$(cat "$STATE_DIR/fails" 2>/dev/null || echo 0)

if [ "$TEST" = 1 ]; then
  echo "Site: $SITE_URL  ->  $([ "$OK" = 1 ] && echo 'UP' || echo "DOWN ($DETAIL)")"
  echo "Telling Metriq 'still here': $(tell_metriq '{"event":"ping"}') (200 means the token is right; 401 means it is wrong)"
  send_mail "Metriq uptime check: test" "The uptime check on $(hostname) is set up and can send you email. Site is $([ "$OK" = 1 ] && echo up || echo "down: $DETAIL")."
  exit 0
fi

if [ "$OK" = 1 ]; then
  if [ "$STATUS" = down ]; then
    DOWN_AT=$(cat "$STATE_DIR/down_at" 2>/dev/null || now_iso)
    WHY=$(cat "$STATE_DIR/why" 2>/dev/null || echo "")
    echo "{\"event\":\"outage\",\"downAt\":\"$DOWN_AT\",\"upAt\":\"$(now_iso)\",\"detail\":\"$(clean "$WHY")\"}" > "$STATE_DIR/pending_outage"
    send_mail "Metriq is back up" "$SITE_URL answers again (it went down at $DOWN_AT UTC: $WHY)."
    log "back up (was down since $DOWN_AT)"
  fi
  echo up > "$STATE_DIR/status"; echo 0 > "$STATE_DIR/fails"
  # Report the outage to Metriq (kept until Metriq has it).
  if [ -f "$STATE_DIR/pending_outage" ]; then
    C=$(tell_metriq "$(cat "$STATE_DIR/pending_outage")")
    case "$C" in 201|400) rm -f "$STATE_DIR/pending_outage" ;; esac
    log "outage reported to Metriq -> $C"
  else
    tell_metriq '{"event":"ping"}' >/dev/null
  fi
  exit 0
fi

FAILS=$((FAILS + 1)); echo "$FAILS" > "$STATE_DIR/fails"
[ "$FAILS" = 1 ] && { now_iso > "$STATE_DIR/first_fail"; echo "$DETAIL" > "$STATE_DIR/why"; }
log "check failed ($FAILS in a row): $DETAIL"
if [ "$STATUS" = up ] && [ "$FAILS" -ge 2 ]; then
  echo down > "$STATE_DIR/status"
  cp "$STATE_DIR/first_fail" "$STATE_DIR/down_at" 2>/dev/null || now_iso > "$STATE_DIR/down_at"
  send_mail "Metriq is DOWN" "$SITE_URL is not answering since $(cat "$STATE_DIR/down_at") UTC. Reason: $DETAIL. Check: ssh erp@<server>, then pm2 status and pm2 logs pulsetrack-api."
elif [ "$STATUS" = down ] && [ $((FAILS % 30)) = 0 ]; then
  send_mail "Metriq still down ($FAILS min)" "$SITE_URL has not answered since $(cat "$STATE_DIR/down_at") UTC. Last reason: $DETAIL."
fi
exit 0

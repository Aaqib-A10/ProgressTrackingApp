# PulseTrack — Production Deployment (VPS)

How to run PulseTrack on your own Linux server (Ubuntu/Debian) with **Nginx + HTTPS
+ PM2**. This setup is the right fit because the app needs an **always-on Node
process** (the attendance-reminder cron) and correct **client-IP reading** (the
office-network check).

> Architecture: browser → **Nginx** (TLS, serves the React build, proxies `/api`)
> → **Node/Express** (PM2) → **PostgreSQL**.

---

## 0. Before you start
- A server with a public IP and a domain pointed at it (an A record, e.g.
  `app.yourdomain.com`).
- Your office **public/WAN IP(s)** for the attendance restriction (add them in-app
  later under Admin → Office Networks).
- SSH access with sudo.

## 1. Install prerequisites
```bash
# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# PostgreSQL, Nginx, PM2, certbot
sudo apt-get install -y postgresql nginx
sudo npm install -g pm2

# certbot for free TLS
sudo apt-get install -y certbot python3-certbot-nginx
```

## 2. Create the database
```bash
sudo -u postgres psql <<'SQL'
CREATE USER pulsetrack WITH PASSWORD 'CHANGE_ME';
CREATE DATABASE pulsetrack OWNER pulsetrack;
SQL
```

## 3. Get the code + configure
```bash
sudo mkdir -p /var/www && cd /var/www
sudo git clone https://github.com/Aaqib-A10/ProgressTrackingApp.git pulsetrack
sudo chown -R $USER:$USER pulsetrack && cd pulsetrack
```
Create `server/.env` (it's gitignored — never commit it) with:
```env
DATABASE_URL="postgresql://pulsetrack:CHANGE_ME@localhost:5432/pulsetrack?schema=public"
JWT_SECRET="CHANGE_ME"          # openssl rand -base64 48
JWT_EXPIRES_IN="7d"
PORT=4000
NODE_ENV="production"
APP_TIMEZONE="Asia/Karachi"     # company default timezone
CLIENT_ORIGIN="https://app.yourdomain.com"
APP_URL="https://app.yourdomain.com"

# Reverse proxy hop count so req.ip = the REAL client IP (office-network check).
# Nginx only -> 1 ; Nginx + CDN/Traefik -> 2 ; direct/no proxy -> leave unset.
# NEVER set this to "true" (that lets clients spoof their IP and bypass the check).
TRUST_PROXY=1

# Email (Resend) — required for attendance reminders + invites. Empty = skipped.
RESEND_API_KEY=""
MAIL_FROM="PulseTrack <noreply@yourdomain.com>"
MAIL_REPLY_TO="noreply@yourdomain.com"
```

The client needs the API base at build time (same origin → `/api`):
```bash
echo 'VITE_API_URL=/api' > client/.env
```

## 4. Install, build, migrate, seed
```bash
npm install                       # both workspaces
npx prisma generate -w server
npx prisma migrate deploy -w server   # apply all migrations (no data loss)
npm run seed -w server                # departments, tags, admin account
npm run build                         # builds server (dist) + client (dist)
```
The seed prints the admin login (`admin@pulsetrack.app` / `Password123!`) — change
it immediately after first login.

## 5. Run the API under PM2
```bash
pm2 start server/dist/index.js --name pulsetrack-api --update-env
pm2 save
pm2 startup            # run the command it prints, to survive reboots
```
Check the cron started: `pm2 logs pulsetrack-api` should show
`[reminders] attendance reminder scheduler started`.

## 6. Nginx: serve the client + proxy the API
Create `/etc/nginx/sites-available/pulsetrack`:
```nginx
server {
  server_name app.yourdomain.com;

  # React build (static)
  root /var/www/pulsetrack/client/dist;
  index index.html;

  # API → Node. proxy_add_x_forwarded_for appends the real client IP so
  # TRUST_PROXY=1 in Node resolves req.ip correctly (office-network check).
  location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # SPA routing — everything else serves index.html
  location / {
    try_files $uri $uri/ /index.html;
  }

  # Uploaded attachments (if used) are served by the API
  location /uploads/ {
    proxy_pass http://127.0.0.1:4000;
  }
}
```
Enable + TLS:
```bash
sudo ln -s /etc/nginx/sites-available/pulsetrack /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d app.yourdomain.com     # issues + wires HTTPS, auto-renews
```

## 7. Turn on the office-IP restriction
Log in as the admin → **Admin → Office Networks** → add your office WAN IP(s)
(e.g. `119.156.230.29`, `110.93.226.217`). The banner will switch to
**Enforcement ON**. From then on, only those IPs can check in/out (Super Admin and
localhost always pass).

> If office staff get blocked after enabling: (a) your WAN IP likely rotated —
> add the new one; (b) you're on IPv6 — tell me and I'll add IPv6 CIDR support;
> (c) `TRUST_PROXY` is wrong for your proxy chain.

## 8. Firewall (recommended)
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```
Do **not** expose port 4000 publicly — only Nginx (80/443) should be open; Node
listens on 127.0.0.1.

---

## Updating later
```bash
cd /var/www/pulsetrack
git pull
npm install
npx prisma migrate deploy -w server
npm run build
pm2 restart pulsetrack-api
```

## Backups
```bash
pg_dump -U pulsetrack -h localhost pulsetrack \
  --no-owner --no-privileges --clean --if-exists -f pulsetrack_backup.sql
```
Schedule it with cron and copy off-box.

## Notes
- **Reminders** only email once `RESEND_API_KEY` is set; the cron runs regardless
  and dedupes per person/day.
- **Timezone**: set `APP_TIMEZONE` to your company default; per-employee shift
  timezones override it.
- Keep the server clock synced (`timedatectl set-ntp true`) — shift windows and
  reminders depend on it.

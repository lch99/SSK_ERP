# SSK ERP

**Try it with no server or database:** `npm install && npm run dev`, then open http://localhost:5175. It runs as a demo and saves to your browser.

Commission and CMS system. The first part is the **Setup page**, which admins complete before the first deal is entered: company profile, branches, deal types, tier ladder, upline levels and split, total payout per tier (company-wide with branch overrides), and case/voucher numbering. [ERP_FEATURES.md](ERP_FEATURES.md) lists every screen of the current ERP and where it is in this one; [LAUNCH.md](LAUNCH.md) is how its data moves across, for rehearsals and on launch day.

## Requirements
- Node.js 22.12 or newer
- MySQL 8

## First run on a laptop
```sh
# 1. Create the database
mysql -u root -e "CREATE DATABASE ssk_erp CHARACTER SET utf8mb4"

# 2. Backend
cd backend
cp .env.example .env        # fill in DB_PASSWORD and JWT_SECRET
npm install
npm run migrate
npm run dev                 # http://localhost:3002

# 3. Frontend (second terminal, project root), talking to the backend
npm install
VITE_USE_SERVER=true npm run dev    # http://localhost:5175
```

The backend runs on MySQL only. Set `AUTH_DISABLED=true` in `backend/.env` to skip sign-in on a laptop.

- `cd backend && npm run demo-data`: fill Setup with sample data
- `cd backend && npm run reset-db`: wipe back to blank
- `npm test`: payout rule tests
- `cd backend && npm test`: backend tests on MySQL (they empty and refill the test databases `ssk_erp_test` and `ssk_legacy_test`, never `ssk_erp`)
- `npm run e2e`: browser tests (Playwright; once: `npx playwright install chromium`): every page on a desktop and a 360 px phone, and the sign-in screens. Against a running server, signed in for real: `E2E_URL=https://<staging> E2E_USER=… E2E_PASSWORD=… npm run e2e` (on a new server, add `E2E_SETUP_KEY` and the first account is made with it). Use a test account, never a real person's.

## Staging server

One Node process serves both the API and the pages; put HTTPS in front of it (Caddy, nginx or the host's load balancer).

```sh
# On the server: Node 22.12+, MySQL 8, and mysqldump for the backups
mysql -u root -e "CREATE DATABASE ssk_erp CHARACTER SET utf8mb4"

# The pages, built to use the server
npm ci
VITE_USE_SERVER=true npm run build          # → dist/

# The API
cd backend
npm ci --omit=dev
cp .env.example .env                        # see below
npm run migrate
NODE_ENV=production node src/index.js       # under pm2 or systemd, so it restarts
```

`backend/.env` for staging (the rest of `.env.example` can stay as it is):

| Setting | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | the staging database (its own user, not root) |
| `JWT_SECRET`, `ADMIN_TOKEN` | two different long random strings: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `WEB_DIR` | `../dist` (this server serves the pages) |
| `CORS_ORIGIN`, `ERP_URL` | the staging address, e.g. `https://erp-staging.example.com` and the same with a `/` at the end |
| `UPLOAD_DIR` or `STORAGE=s3` + `S3_*` | where uploads go (a folder outside the code, or a bucket of its own) |
| `ALERT_WEBHOOK` | optional: server errors go to this chat |

Then open the site: the first screen creates the superadmin and asks for the setup key (`ADMIN_TOKEN`). Check `https://<staging>/api/health` returns `{"ok":true}`.

**With a copy of the real data on staging**, keep it from reaching real people and from changing as time passes:

- Leave `MAIL_URL` and `FIREBASE_SERVICE_ACCOUNT` unset (no e-mails or phone pushes), and set `PUSH_SECONDS=0`.
- Set `TIME_RULES_MINUTES=0` until you have checked the import, so idle accounts are not locked by the clock.
- Import from a restored copy of the current ERP's database (`LEGACY_DB_*`; never the live server):
  `npm run legacy:inspect`, then `npm run legacy:import -- --out import-report.md`, `npm run legacy:verify`,
  `npm run legacy:panel` (`PANEL_DB_URL`) and `npm run legacy:copy-files`.
- Daily backups: `npm run backup` from cron (`BACKUP_DIR`).

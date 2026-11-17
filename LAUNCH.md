# Moving from the current ERP to the new one

The old database is never used as it is: each time, a copy of it is read and **reshaped into the new
database** (`npm run legacy:import`, rules in `backend/src/legacy/mapping.js`). The same steps run for every
rehearsal and once more on launch day, from a copy taken after the old ERP stops taking changes, so
everything people entered up to that moment is in the new ERP.

Measured on the 4 Nov 2026 copy (7 GB dump, 123,529 listings, 25,132 E-Forms, 2,589 staff):
loading the copy took **about 1 minute** (without the two search logs), the import **about 5½ minutes**
(two of them making everyone's password hash), and its check found **all 139 counts and money totals matching**.

## What carries over

- Every record, with its old id and code: staff, listings with follow-ups, photos and sharing, buildings,
  areas, customers, owner requests, E-Forms with documents and landlord checks, payments, closes and payout
  lines, salary requests, request forms, archives, favourites, saved listings, the last 90 days of
  notifications, the old data log, and first-system (V1) records for history.
- Every old row, imported or not, is kept as it was in `legacy_rows`; nothing is lost.
- **Passwords**: everyone signs in with the username and password they use today. The old ERP keeps them
  in plain text; the import stores only a one-way hash of each (the text is never copied), and signing in
  makes it full strength. Each re-import brings a password changed in the old ERP; one set in the new ERP
  (a link, the office, a change) is kept. People who left get no account.
- **Setup** (company, tiers, uplines, approvals, numbering) is typed into the new ERP once and **stays**
  through every re-import. So do **sign-in accounts**: each is linked back to its person after a re-import.

Left out on purpose (the import report lists them): the two website search logs, old sign-in sessions,
failed sign-ins, notifications older than 90 days, and a bought-in contact list (`db_name_1`, PDPA).

## The one rule

**Nothing is made in the production database before the last import except Setup and sign-in accounts.**
A re-import replaces every record, so the import refuses to run over records made in the new ERP
(listings, E-Forms, viewings…). On staging, re-importing a newer copy after clients have tested needs
`--force`, which removes what they made there; their uploads are released and cleaned up the next day.
Clients test on staging, never on the production database.

## Rehearsal (repeat on staging whenever there is a newer copy)

1. A copy of the old database, without the two search logs (5 GB of logs the import never reads):

   ```sh
   mysqldump --single-transaction --no-tablespaces subsalek_ebdb \
     --ignore-table=subsalek_ebdb.db_property_search_data_capture \
     --ignore-table=subsalek_ebdb.db_property_search_log > copy.sql
   ```
   (From phpMyAdmin: Export → Custom, and untick the data of those two tables.)
2. Load it into its own database next to the new one, never the live server:
   `mysql -e "DROP DATABASE IF EXISTS sinland_copy; CREATE DATABASE sinland_copy CHARACTER SET utf8mb4"` and
   `mysql sinland_copy < copy.sql`.
3. With `LEGACY_DB_*` in `backend/.env` pointing at `sinland_copy`:
   ```sh
   cd backend
   npm run legacy:inspect -- --out inspect.md        # what the copy holds (no personal details)
   npm run legacy:import -- --replace --out import.md # the first time without --replace
   ```
   It must end with **"All … checks match"**. Read `import.md`'s "Codes the mapping did not know": a new value
   there (as `eform_rental` was) is added to `CODES` in `mapping.js` and imported again.
4. `npm run legacy:panel` (with `PANEL_DB_URL`) for the /panel's bios, awards and switches.
5. `npm run legacy:copy-files` copies photos and documents off the old file server. It can stop and start,
   and only copies what is new, so start it during rehearsals and let it catch up.
6. `E2E_URL=https://<staging> E2E_USER=… E2E_PASSWORD=… npm run e2e`: every page, signed in, on the real data.

## Launch day

1. **Freeze the old ERP**: announce a time; from then it takes no changes (maintenance page or read-only).
2. Take the final copy (rehearsal step 1) and load it (step 2).
3. Import into the production database: `npm run legacy:import -- --replace --out import.md`. Check **all
   checks match**. Then `legacy:panel`, and `legacy:copy-files` once more for the last new files.
4. Turn on what was off for staging: `TIME_RULES_MINUTES` (blank = every 15 minutes), `MAIL_URL`,
   `FIREBASE_SERVICE_ACCOUNT`.
5. Point the addresses at the new server: `erp.subsaleking.com` (the ERP), `api.subsaleking.com` (the phone
   app's `/v1`), and the website's reads (`/api/public`).
6. Smoke test: `npm run e2e` against production with a test account.
7. People sign in as before. Keep the old ERP read-only for a few weeks, and keep the final copy somewhere safe.

The downtime is the freeze to the switch: about **30 minutes** at today's size.

## The old database holds everyone's password in plain text

Keep every copy of it (dumps, `sinland_copy`) off shared drives, chat and e-mail, and delete them once the move
is done (keep one final copy somewhere safe). Old passwords are often short; people can choose a stronger
one in My profile, and anyone the office worries about gets a one-time link instead.

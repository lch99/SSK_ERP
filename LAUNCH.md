# Moving from the current ERP to the new one

The old database is never used as it is: each time, a copy of it is read and **reshaped into the new
database** (`npm run legacy:import`, rules in `backend/src/legacy/mapping.js`). The same steps run for every
rehearsal and once more on launch day, from a copy taken after the old ERP stops taking changes, so
everything people entered up to that moment is in the new ERP.

Measured on the 4 Nov 2026 copy (7 GB dump, 123,529 listings, 25,132 E-Forms, 2,589 staff):
loading the copy took **about 1 minute** (without the two search logs), the import **about 5½ minutes**
(two of them making everyone's password hash), and its check found **all 141 counts and money totals matching**,
including the 16,039 listings the website shows.

## What carries over

- Every record, with its old id and code: staff, listings with follow-ups, photos and sharing, buildings,
  areas, customers, owner requests, E-Forms with documents and landlord checks, payments, closes and payout
  lines, salary requests, request forms, archives, favourites, saved listings, the last 90 days of
  notifications, the old data log, and first-system (V1) records for history.
- Every old row, imported or not, is kept as it was in `legacy_rows`; nothing is lost.
- Listings saved through the old ERP's draft form (`property_draft` 2: most listings, nine in ten new ones)
  arrive **published**, as the website shows them; only the 53 real drafts (code 1) stay drafts. The check
  compares the website's listings old and new, so a mistake here shows as a mismatch.
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
5. Point the addresses at the new server: `erp.subsaleking.com` (the ERP) and `api.subsaleking.com` (the phone
   app's `/v1`). Switch the website to its new version that reads `/api/public` (see **The website** below):
   it reads the old database directly, so pointing an address is not enough.
6. Smoke test: `npm run e2e` against production with a test account.
7. People sign in as before. Keep the old ERP read-only for a few weeks, and keep the final copy somewhere safe.

The downtime is the freeze to the switch: about **30 minutes** at today's size.

## The website (www.subsaleking.com)

The website is a separate app (ASP.NET Blazor, "SubSaleKing.Web") that reads the **old database on its own
server**. It calls no API, so changing an address does not move it: whoever maintains it must change it to read
the new system's `/api/public` (described at the top of `backend/src/public/index.js`), try it against staging,
and switch on launch day. Until then it keeps showing the old database, frozen at the launch copy.

| On the site | In the new system |
|---|---|
| Results pages, the home sections and the 15 states; search box and its suggestions | `GET /listings` (type, category, states, areas, titles, price, bedrooms, bathrooms, car parks, furnishing, renovation, tracking, sort, page), `GET /keywords` |
| Filters panel pickers, with counts | `GET /categories`, `/areas`, `/titles` |
| Super Hot, Rent King; the Handpicked Area banners | `catalog=super-hot`, `rent-king`; `catalog=best-lifestyle-kepong` (the only banner with a rule on the site today) |
| Cards: photo count, NEW, Fast View / Easy View / Exclusive, the green Trip Incentive ticket | each listing's `photoCount`, `createdOn`, `labels`, `tripIncentive` |
| A listing's page: photos, summary, About Property, map, mortgage, You may also like | `GET /listings/:id` (`photos`, `description`, `title.address` for the map), `areaIds` + `exclude` |
| Old links `/listings/<name>-for-sale-<number>` and `?areas=<number>` | Listing, area and building numbers are the old ones, so old links keep working |
| Vendor Request Form | `POST /owner-requests` → ERP Listings › Owner requests |
| Co-Agent Request Form | `POST /agent-requests` → ERP Agents › Co-Agent requests (those the site already received stay in its own database) |
| Staff sign-in, My Saved Listings | `POST /api/auth/login`, `GET /saved`, `POST /saved/:listingId` |
| /panel (bio, socials, awards, registration, feature switches) | The ERP's agent page; `legacy:panel` brings the panel's values across |

To settle with the website's maintainer before launch:
- **Super Hot and Rent King**: the site shows 178 and 11; the new system's rules (the phone app's) give 477
  and 19 on the same data, and only part overlaps. The site's lists look hand-picked ("Featured", "Best
  pick") or follow a rule kept in its own database. Decide which rule the website uses.
- **Four of the five banners** (Wangsa Maju, Kepong hot demand, Bukit Jalil, Kota Damansara) show every
  listing on the site today; the phone app has rules for two of them.
- **Agent contact**: each listing from `/api/public` carries its person in charge's name, phone and e-mail.
  The site shows no agent today; drop it if it should stay that way.

## The old database holds everyone's password in plain text

Keep every copy of it (dumps, `sinland_copy`) off shared drives, chat and e-mail, and delete them once the move
is done (keep one final copy somewhere safe). Old passwords are often short; people can choose a stronger
one in My profile, and anyone the office worries about gets a one-time link instead.

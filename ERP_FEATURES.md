# Current ERP: feature list

Every screen of the current ERP at **erp.subsaleking.com** (the PHP system, "Sinland E.R.P"), checked against
this new ERP. Use it to make sure nothing is left behind before the switch.

**How it was gathered (2026-11-16).** Signed in with an admin account and opened one page of each kind from the
menu, read-only. Pages that change something when opened were not opened. For example, *Add Property List*
creates a listing record as soon as it loads. Status variants of the same list (Draft / Clear / Return…) share
one layout, so one of each was read. Not seen:

- **/panel ("ERP [NEXT]")**: the newer admin at www.subsaleking.com/panel. It only draws in a real browser.
  What it keeps is known from its database (see [/panel](#panel-erp-next)).
- **Appointment**, **Tax Invoice & Official Receipts** and **Invoices**: they answer "Function not found": the current
  ERP has retired them.
- Detail pages (one E-Form, one transaction, one salary request): not opened. The lists were read.

**Legend:** ✅ in the new ERP · ⚠️ partly: see the note · ❌ missing

---

## Gaps found, and what was done (2026-11-16)

| # | Gap | Now |
|---|-----|-----|
| 1 | **Add a listing dropped two fields:** the form asked for *Vendor/Landlord Race* and *Car Parks*, and the save never kept them. | ✅ Fixed: both are saved, and Edit changes them. |
| 2 | **Listing fields the current ERP has that the new one didn't:** land area, utilities/store rooms, renovation cost, bank value, and the short, renovation and furnishing descriptions. | ✅ Added to Add, Edit, the listing page and the import. *Bank Value* is the box the old form posts as `property_price_psqf`; price per sq ft is now worked out (ad price ÷ built-up, sale listings). |
| 3 | **Imported but never shown:** placement, specs, renovation, nett/nego, race. | ✅ Shown on the listing page and editable. A value outside the choices (e.g. the phone app's free-text renovation) is kept and shown as it is. |
| 4 | **Old viewings not imported.** | Left as history on purpose: the current ERP's Appointment page is gone ("Function not found"), so there is nothing live to carry over. Every old row is still kept in `legacy_rows`. |
| 5 | **Landlord check history.** | ✅ "Unable to verify" can be tried again (*Try again*), and each earlier try is kept (*History*). The import brings every earlier check of a case, not only the latest. |
| 6 | **/panel not walked through.** | Open: it needs a browser. What it stores is imported (see [/panel](#panel-erp-next)). |

Also found and fixed on the way:

- **Videos picked on Add a listing were never uploaded** when running on the server: only how many was saved. They are now uploaded and kept like the Album's.
- The "(Demo: photos are kept in this browser…)" notes showed on the server too; now only in the demo.

The old form's separate width × length boxes for the built-up and land area are not kept as two numbers: built-up is one number (the import multiplies them), and land is one text box (e.g. "22 x 75").

Everything else in the menu has a matching page in the new ERP (the `was` names in [modules.js](src/erp/modules.js)
are the current ERP's menu names, so quick search finds them).

---

## Top bar and dashboard

| Current ERP | Details | New ERP |
|---|---|---|
| Dashboard | Total submission (this year, this month, last month), total close case (V1 + V2), case counts: submitted, full close, partial close, abort | ✅ Home › Dashboard |
| Make Close Case Rerun (pop-up on every page) | Re-runs a close case's payout | ✅ E-Form page and Approve payouts |
| Request Invoice (pop-up on every page) | Type 01 / Yes | ✅ E-Forms (Request Invoice) |
| View Org. Chart | Tree from the top; each person shows IC name, position and closing amount | ✅ Agents › Org chart |
| Settings (own profile) | IC name, phone, e-mail, house address, bank and account number, profile photo, change password, "Your Org Chart" | ✅ Home › My profile |
| System Settings | Company name, registration number, SST number, address; property types | ✅ System › Settings, Setup |
| ERP [NEXT] link | Opens /panel | See [/panel](#panel-erp-next) |
| Logout | Through the website's sign-out | ✅ |

## Property

### Listing lists

All listing lists share one layout:

- **Filters:** staff profile, branch manager, sale/rental, market value complete/incomplete, area, title, category,
  settings (Key On Agent Hand, Exclusive, Vacant, Need Follow-Up, Process Deal, Process L&L, Owner Occupied, Tenanted,
  On Hold, Friendly Tenant), follow-up, status, case code, created date from–to.
- **Category tabs with counts:** All, Residential landed, Residential non-landed, Commercial, Industrial, Land, No category.
- **Columns:** created date, updated date, area, title, category, more, ad price, best price, market value,
  unit number / size, owner contact, settings, follow-up, status, actions.
- **Per row:** Edit; *Update Listing Tracking* (status, plus the sold/rent price); *Marketing Tools* (publish to the
  portals iProperty, PropertyGuru and Mudah: left out of the new ERP until there is a portal integration, your
  call on 2026-10-28; the portals a listing was on are imported).
- 20 rows a page with *Go to* page.

| Current ERP | New ERP |
|---|---|
| Added Today | ✅ Listings › All listings (view) |
| Latest Price Updated | ✅ |
| Creator Listing (my listings as creator) | ✅ |
| Sold Out / Rent Out / Outdated | ✅ |
| Last Upload Photo / Last Follow-Up | ✅ |
| By role: Branch Manager, Area Manager, Project Handler, Product Handler (filter main / co-product handler) | ✅ Listings › By role |
| Outdated Listing by role (same four) | ✅ Listings › Outdated listings |
| Vendor Listing (listings made from owner requests) | ✅ Listings › From owner requests |

### Listing form (Add / Edit)

| Field or action | New ERP |
|---|---|
| For sale / For rent, state, area (or add a new area), title (or add a new title), category and sub-type | ✅ |
| Address, unit number and jalan | ✅ |
| Bedrooms, bathrooms | ✅ |
| Car park | ✅ |
| Utilities / store rooms | ✅ |
| Built-up and land area, as sq ft or width × length | ✅ one built-up number and a land text (see above) |
| Tenure (freehold / leasehold) | ✅ |
| Vendor/landlord race: Chinese, Indian, Malay, Malay Reserved | ✅ |
| Listing placement: intermediate / corner lot | ✅ |
| Specs (basic / renovated / partly renovated), renovation (fully / partly), renovation cost | ✅ |
| Furnishing (non / partial / fully) and furnishing description | ✅ |
| Best price, bank value, nett / nego, commission % | ✅ (price per sq ft is worked out) |
| Short description, full description, personal-use remarks | ✅ |
| Settings ticks (the ten flags above) | ✅ |
| Owner name, owner contact | ✅ |
| Change listing owner (agent) | ✅ |
| Photos: upload, select all, download selected, delete selected, cover | ✅ Album |
| Share listing settings (main / co-product handlers) | ✅ |
| Draft (one half-filled listing per agent, "continue it now?") | ✅ Save as draft |
| Duplicate check (same unit, owner phone, title and type) | ✅ |

### Other Property screens

| Current ERP | Details | New ERP |
|---|---|---|
| Vendor Requests | Ticket, date, from, property info, status (Pending Follow-Up, Ongoing Follow-Up, Listing Created, Cancelled, Invalid); search by ticket, phone, dates; *create listing from ticket* | ✅ Listings › Owner requests |
| Appointment | Retired in the current ERP ("Function not found") | ✅ Listings › Viewings (new); old records kept as history |
| Check Enquiry | Inbox, starred, trash | ✅ Listings › Enquiries |
| Title Management | Create title (area picked or typed, or taken from the address), category and sub-type, state, search address; edit; enable/disable; delete with a replacement title; active listings count; manager and handler per title; title requests | ✅ Listings › Buildings & estates |
| Area Management | Add area (state, name); edit; approve/disable; manager per area; area requests; load all areas | ✅ Listings › Areas |

## Customer database

| Current ERP | New ERP |
|---|---|
| List: date, name, phone, type (rent/sale), area, from where, action (Admin Follow-Up, Manager Follow-Up, Offering, Fact Finding), min/max budget, status (Active, Closing, By Others), remarks edited in the row | ✅ Listings › Customers |
| Filters: staff, type, action, status, keywords, page size 100–1000 | ✅ |
| Add / edit a name, follow-up history | ✅ |

## E-Forms (Ver 2)

| Current ERP | Details | New ERP |
|---|---|---|
| Personal Sales | Columns: code, listing, listing creator, branch manager, area manager, sale staff, product handler, address, sell/rent price, total, net total, closing total, transaction amount, status. Filters: staff, sales/rental, status (Draft, Submitted, Abort/Cancel, Closed Full, Closed Partial), case, address, price, dates | ✅ Commission › All E-Forms |
| Branch Sales | Same, by branch manager | ✅ By branch |
| Team Sales | Same, by team lead | ✅ By team |
| Add Sales Record / Add Rental Record | (Not opened: opening one creates a record) | ✅ Submit an E-Form |
| Downline's E-Forms | One list per downline | ✅ Old records (V1) / team views |
| Confirm form & listing pay details (pop-up) | | ✅ E-Form page |

## Commission and reports

| Current ERP | Details | New ERP |
|---|---|---|
| Commission (2020 page) | Form, property, date, nett comm, sale person, sale comm, sale upline, HQ, in-charge person (AM/PM/PH), Saleking, area manager, Saleking upline, system tally | ✅ Reports › 2020 commission page |
| Total Report | Staff E-Form totals between two dates | ✅ Agent totals |
| Staff Summary | Per staff | ✅ Staff pay summary |
| Sales Over Agents | Staff, cases (own / co-bro), amount of sales, total claim | ✅ Top sellers |
| E-Forms Update Tracker | Change log (before / after) | ✅ E-Form change log |
| E-Forms Summary Report | | ✅ E-Forms by person |
| E-Forms Case Summary | Enter a code, see the case's payout | ✅ Payout calculator |
| Archived Case Landlord | Weekly archive (ARC-…) with how many are unverified; per case: form, address, price, product handler, landlord, verification (Pending, Verified, Unable to verify), date, remarks, history | ✅ Landlord checks (Try again, History) |

## Transactions (Ver 2)

| Current ERP | Details | New ERP |
|---|---|---|
| Add Transaction | (Not opened) | ✅ Accounts › Record a payment |
| All Transactions and the Draft / Clear / Return / Pending / Invalid lists | Columns: ID, staff, date, from, amount, method, cash method, purpose, bank-in date, remark, status, file, cheque, recipient reference, form type, bill year, request, case, SST. Status changed in the row; edit; download | ✅ Accounts › All payments in |
| SST Account Transactions | ID, date, form, amount | ✅ SST account |

## Closed case (Ver 2)

| Current ERP | Details | New ERP |
|---|---|---|
| Close Case List / New / Pending Queries / Ready | Columns: date, time, case, staff, role, %, form, cash to date, cash, sell/rent, claim, payout, net comm, type (partial / full / balance close), status, salary status. Filters: staff, branch manager, status, salary status, type, claim category (sales / product), dates. Delete a line | ✅ Commission › To approve |
| Create Archive (N cases) | Groups the ready cases into a weekly archive ARC-nnnnn-date | ✅ |
| Archived Case | Pick an archive | ✅ Archived |
| Salary Not-Requested / Requested | | ✅ |

## Request forms (Ver 2), money out

Each list has the stages **New → Pending Queries → Payment Ready → Payment Clear**. Each row has payment date,
receipt upload, reasons and *Export CSV*. The current ERP shows them under four menu groups (New, Pending
Queries, Payment Ready, Payment Clear), one entry per kind.

| Kind | Columns | New ERP |
|---|---|---|
| All requests | Type, date, form, staff, file, status, payment date, receipt, amount, cheque no., bank, bank account; *Download Letter*, *Download Receipt* | ✅ Accounts › Payments out |
| Balance to Vendor | Vendor, bank, account, balance, transaction | ✅ |
| Transfer Deposit to Other | Letter, transfer to, IC, bank, account, amount | ✅ |
| Abort Case | Letter, return to, purchaser IC, bank, account, return amount | ✅ |
| Cheque to Co-Bro | Letter, co-bro fees, agency name, agency reg. no., to agent, address | ✅ |
| Introducer Fees | Fees, introducer name, IC, phone, bank account | ✅ |
| Tenancy Agreement Fees | Tenant name, IC, bank account, fees | ✅ |

## H.R. portal

| Current ERP | Details | New ERP |
|---|---|---|
| Add New Agent/Staff | (Not opened) | ✅ Agents › Add an agent, System › Add office staff |
| All / Active / Inactive / Pending Agent/Staff | Staff ID, user name, IC name, IC no., name-card name, phone, e-mail, position request, closing amount, upline, manage; link to the person's E-Forms | ✅ Agents › All agents (position requests, closing amount) |

## Invoice & receipt

| Current ERP | New ERP |
|---|---|
| Tax Invoice & Official Receipts | Retired in the current ERP ("Function not found"). ✅ Accounts › Tax invoices & receipts |
| Invoices | Retired in the current ERP ("Function not found"). ✅ Accounts › Invoices |

## Salary and incentives (Ver 2)

| Current ERP | Details | New ERP |
|---|---|---|
| Request Salary / Request Incentives / Request Creator Fees | (Not opened) | ✅ Commission › Pay agents |
| All List / New Request / Payment Ready / Payment Clear / Document Not Valid | Date, staff, bank account, status, reason, salary ID; status changed in the row | ✅ Pay requests |

## Video gallery

| Current ERP | Details | New ERP |
|---|---|---|
| Meetings | Add: date, title, description, video; Save & Publish | ✅ Agents › Meeting recordings |
| Trainings | Same, grouped by date (26 videos: log in, submit a case, add a transaction, close a case, request salary, the request forms, add a listing…) | ✅ Training videos |

## Old system (V1), read-only history

| Current ERP | Details | New ERP |
|---|---|---|
| E-Forms (Sort): All, Sales, Rental × Draft / Submitted / Abort / Closed Full / Closed Partial | Code, sale staff, product handler, address, price, totals, status | ✅ Commission › Old records (V1) |
| E-Forms (Old) | Same | ✅ |
| Transactions (Sort), SST Account List | | ✅ |
| Closed Case (V1), including archives ARC-00001…00135 and select-all archiving | | ✅ |
| Request Form (V1), six kinds × four stages | | ✅ |
| Salary (V1): salary ID, date, staff, status, cheque no., cheque date, reason, submit amount, salary amount | | ✅ |
| Overide Module: summaries 2016–2019 | | ✅ |

## /panel (ERP [NEXT])

The newer admin at www.subsaleking.com/panel, with its own database. Not walked through (needs a browser).
From its tables, it keeps per person:

| What | New ERP |
|---|---|
| Bio, social links (Facebook, Instagram, TikTok, Twitter, Xiaohongshu, Lemon8, LinkedIn) | ✅ imported (`npm run legacy:panel`) |
| Awards (name, organisation, date, description) | ✅ |
| Registration: REN / REA / PEA and number | ✅ |
| Feature switches: agent features, profile page, profile document, add listings, landlord verification, vendor requests, trip incentive | ✅ |
| Profile photos | ⚠️ still on the panel's storage until copied |

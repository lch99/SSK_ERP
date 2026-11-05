// Proof that nothing went missing in the import: the old database and the new
// one are added up separately, each with its own SQL (never through the import's
// code), and compared.
//   1. Every row of every old table is in legacy_rows (only the tables mapping.js
//      NOT_COPIED / HELD_BACK names are left out, and a RECENT table's older rows;
//      the report says so).
//   2. Records and money match: people, listings by status, E-Forms by status with
//      their prices and net commission, payments in by status, closes and payout
//      lines with their totals, request forms by type with their amounts…
// The Markdown report shows counts and totals only, never anyone's details.
//
//   npm run legacy:verify -- --out check.md      (again, any time after an import)
const M = require('./mapping');
const { tableNames } = require('./inspect');
const { localToday } = require('../db/days');

const fmt = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const near = (a, b, rows) => Math.abs(Number(a) - Number(b)) <= 0.01 + 0.005 * rows;

// SQL that means "not deleted in the old ERP" (`*_stat = '3'`).
const alive = col => [`coalesce(??, '') <> '3'`, [col]];
// A deleted_at of '0000-00-00…' is no date, as the import reads it.
const notDeletedAt = q => q.whereNull('deleted_at').orWhere('deleted_at', 'like', '0000%');
const v2Forms = legacy => legacy('db_eforms').select('form_id').whereRaw(...alive('form_stat')).where('property_id', '>', 0);

async function verify({ legacy, db, report = null }) {
  const present = await tableNames(legacy);
  const has = t => present.includes(t);
  const checks = [];
  const add = (group, label, before, after, rows = 0, money = false) =>
    checks.push({ group, label, before: Number(before) || 0, after: Number(after) || 0, ok: money ? near(before || 0, after || 0, rows) : Number(before || 0) === Number(after || 0), money });
  const one = async q => Object.values((await q.first()) || {}).map(v => Number(v) || 0);
  // Grouped totals: { key → [count, sum…] }.
  const grouped = async (q, key) => Object.fromEntries((await q).map(r => [String(r[key] ?? ''), Object.entries(r).filter(([k]) => k !== key).map(([, v]) => Number(v) || 0)]));
  const compareGroups = (group, what, before, after, toNew, sums = []) => {
    const keys = new Set([...Object.keys(before).map(k => toNew(k)), ...Object.keys(after)]);
    const sumUp = (src, k) => Object.entries(src).filter(([x]) => toNew(x) === k).reduce((a, [, v]) => a.map((n, i) => n + (v[i] || 0)), [0, ...sums.map(() => 0)]);
    for (const k of [...keys].sort()) {
      const b = sumUp(before, k), a = after[k] || [0, ...sums.map(() => 0)];
      add(group, `${what} · ${k} · count`, b[0], a[0]);
      sums.forEach((s, i) => add(group, `${what} · ${k} · ${s}`, b[i + 1], a[i + 1], Math.max(b[0], a[0]), true));
    }
  };

  // 1. Every old row kept.
  const keptRows = Object.fromEntries((await db('legacy_rows').select('source_table').count({ n: '*' }).groupBy('source_table')).map(r => [r.source_table, Number(r.n)]));
  const recent = {};
  for (const t of present) {
    if (M.NOT_COPIED[t] || (M.HELD_BACK[t] && !(report?.include || []).includes(t) && !keptRows[t])) continue;
    const q = legacy(t).count({ n: '*' });
    if (M.RECENT[t]) {
      recent[t] = await M.recentFrom(legacy, t);
      q.where(M.RECENT[t].column, '>=', recent[t] || '9999-12-31');
    }
    const [n] = await one(q);
    add('Every old row kept', recent[t] ? `${t} (from ${recent[t]})` : t, n, keptRows[t] || 0);
  }
  // The latest notifications, for a person and a listing that came across.
  if (recent.db_user_notification) {
    const [n] = await one(legacy('db_user_notification as n').count({ n: '*' }).where('n.created_at', '>=', recent.db_user_notification)
      .whereIn('n.user_id', legacy('new_staff').select('user_id'))
      .whereIn('n.reference_id', legacy('db_property').select('property_id').whereRaw(...alive('property_stat'))));
    const [m] = await one(db('notices').whereIn('id', db('legacy_rows').where('source_table', 'db_user_notification').whereNotNull('target_id').select(db.raw('cast(target_id as unsigned)'))).count({ n: '*' }));
    add('Notifications', `the last ${M.RECENT.db_user_notification.days} days (from ${recent.db_user_notification}) → notices`, n, m);
  }
  // Starred listings and buildings, of people and records that came across.
  for (const [t, col, of, key, stat, kind] of [['db_user_favourite_property', 'property_id', 'db_property', 'property_id', 'property_stat', 'listings'],
    ['db_user_favourite_property_title', 'property_title_id', 'db_property_title', 'title_id', 'title_stat', 'titles']]) {
    if (!has(t) || !has(of)) continue;
    const [n] = await one(legacy(t).count({ n: '*' }).whereIn('user_id', legacy('new_staff').select('user_id'))
      .whereIn(col, legacy(of).select(key).whereRaw(...alive(stat))));
    const [m] = await one(db('favourites').sum({ n: db.raw('json_length(??)', [kind]) }));
    add('Favourites', `starred ${kind}`, n, m);
  }

  // 2. Records and money.
  if (has('new_staff')) {
    const [n] = await one(legacy('new_staff').count({ n: '*' }));
    // Not the "Unknown" stand-ins (MySQL writes JSON with spaces, so not a text match).
    const [m] = await one(db('staff').whereRaw("json_extract(more, '$.placeholder') is null").count({ n: '*' }));
    add('People', 'staff (every account, those who left included)', n, m);
  }
  if (has('db_property')) {
    compareGroups('Listings', 'listings',
      await grouped(legacy('db_property').whereRaw(...alive('property_stat')).select({ k: legacy.raw('coalesce(property_tracking, 0)') }).count({ n: '*' }).groupByRaw('coalesce(property_tracking, 0)'), 'k'),
      await grouped(db('listings').select({ k: 'status' }).count({ n: '*' }).groupBy('status'), 'k'),
      k => M.CODES.listingStatus[k] || `old code ${k}`);
  }
  if (has('db_eforms')) {
    compareGroups('E-Forms', 'E-Forms',
      await grouped(legacy('db_eforms').whereRaw(...alive('form_stat')).where('property_id', '>', 0).select({ k: 'form_status' })
        .count({ n: '*' }).sum({ price: 'rent_price' }).sum({ net: 'net_total' }).groupBy('form_status'), 'k'),
      await grouped(db('deals').select({ k: 'status' }).count({ n: '*' }).sum({ price: 'price' }).sum({ net: 'net' }).groupBy('status'), 'k'),
      k => M.CODES.dealStatus[k] || `old code ${k}`, ['price', 'net commission']);
    const [v1] = await one(legacy('db_eforms').whereRaw(...alive('form_stat')).where(q => q.where('property_id', 0).orWhereNull('property_id')).count({ n: '*' }));
    const [v1New] = await one(db('v1_eforms').count({ n: '*' }));
    add('E-Forms', 'first-system (V1) E-Forms', v1, v1New);
  }
  if (has('db_trans') && has('db_eforms')) {
    compareGroups('Payments in', 'payments in',
      await grouped(legacy('db_trans').whereRaw(...alive('tran_stat')).where(notDeletedAt).where('version_id', '>', 0)
        .whereRaw('coalesce(case_id, 0) = 0 and coalesce(request_id, 0) = 0 and tran_amount >= 0').whereIn('form_id', v2Forms(legacy))
        // An amount the new column can't hold (RM 1.49 trillion, typed by mistake) is left blank and listed in the report.
        .select({ k: 'tran_status' }).count({ n: '*' }).sum({ amount: legacy.raw('case when abs(tran_amount) < 1000000000000 then tran_amount else 0 end') }).groupBy('tran_status'), 'k'),
      await grouped(db('money_in').select({ k: 'status' }).count({ n: '*' }).sum({ amount: 'amount' }).groupBy('status'), 'k'),
      k => M.CODES.moneyInStatus[k] || `old code ${k}`, ['amount']);
  }
  if (has('db_case_list') && has('db_eforms')) {
    const lines = () => legacy('db_case_list').where(q => q.whereRaw(...alive('case_stat')).orWhere('arc_id', '>', 0)).where('property_id', '>', 0).whereIn('form_id', v2Forms(legacy));
    // A close is its lines (case_link), with the claim of its first one still there (its first line may be deleted).
    const firsts = lines().select('comm_claim', legacy.raw('row_number() over (partition by coalesce(nullif(case_link, 0), case_id) order by case_id) as nth'));
    const [closes, claim] = await one(legacy.from(firsts.as('f')).where('nth', 1).count({ n: '*' }).sum({ c: 'comm_claim' }));
    const [closesNew, claimNew] = await one(db('closes').count({ n: '*' }).sum({ c: 'claim' }));
    add('Closes and payouts', 'closes · count', closes, closesNew);
    add('Closes and payouts', 'closes · commission claimed', claim, claimNew, closes, true);
    // A line whose salary request is Payment Clear is paid, whatever its own status says.
    const cleared = legacy('db_salary').select('salary_id').whereRaw(...alive('salary_stat')).where('version_id', '>', 0).where('salary_status', 3).whereRaw('year(salary_date) > 0');
    const status = legacy.raw('case when staff_salary_id in (?) then 3 else case_status end', [cleared]);
    compareGroups('Closes and payouts', 'payout lines',
      await grouped(lines().select({ k: status }).count({ n: '*' }).sum({ amount: 'total_payout' }).groupBy('k'), 'k'),
      await grouped(db('payout_lines').select({ k: db.raw("case when status in ('approved', 'paid') then 'ready' else status end") })
        .count({ n: '*' }).sum({ amount: 'amount' }).groupByRaw("case when status in ('approved', 'paid') then 'ready' else status end"), 'k'),
      k => ({ new: 'new', queried: 'queried', approved: 'ready' })[M.CODES.payoutStatus[k]] || `old code ${k}`, ['amount']);
  }
  if (has('db_salary')) {
    compareGroups('Closes and payouts', 'salary / incentive requests',
      await grouped(legacy('db_salary').whereRaw(...alive('salary_stat')).where('version_id', '>', 0).select({ k: 'salary_status' }).count({ n: '*' }).groupBy('salary_status'), 'k'),
      await grouped(db('pay_requests').select({ k: 'status' }).count({ n: '*' }).groupBy('status'), 'k'),
      k => M.CODES.salaryStatus[k] || `old code ${k}`);
  }
  if (has('db_eforms_request') && has('db_eforms')) {
    const type = `case ${Object.entries(M.CODES.requestType).map(([k, v]) => `when request_type like '${k}%' then '${v}'`).join(' ')} else 'other' end`;
    const amount = `case when request_type like 'balancetovendor%' then balance_to_vendor when request_type like 'transferdeposittoother%' then transfer_amount
      when request_type like 'abortcase%' then return_amount when request_type like 'chequetocobroagent%' then cobro_fees
      when request_type like 'requestintrofees%' then (case when coalesce(net_intro_fees, 0) <> 0 then net_intro_fees else intro_fees end)
      when request_type like 'tenancyagreementfees%' then tenancy_fees else 0 end`;
    compareGroups('Request forms', 'request forms',
      await grouped(legacy('db_eforms_request').whereRaw(...alive('request_stat')).where('version_id', '>', 0).whereIn('form_id', v2Forms(legacy))
        .select({ k: legacy.raw(type) }).count({ n: '*' }).sum({ amount: legacy.raw(amount) }).groupByRaw(type), 'k'),
      await grouped(db('money_out').select({ k: 'type' }).count({ n: '*' }).sum({ amount: 'amount' }).groupBy('type'), 'k'),
      k => k, ['amount']);
  }
  const simple = [
    ['Listings', 'listing follow-ups', 'db_property_followup', 'follow_stat', 'listing_follow_ups', q => q.whereIn('property_id', legacy('db_property').select('property_id').whereRaw(...alive('property_stat')))],
    ['Listings', 'website enquiries', 'db_property_enquiry', 'en_stat', 'enquiries', q => q.whereIn('property_id', legacy('db_property').select('property_id').whereRaw(...alive('property_stat')))],
    ['Listings', 'buildings (titles)', 'db_property_title', 'title_stat', 'titles'],
    ['Listings', 'areas', 'db_property_area', 'area_stat', 'areas'],
    ['Listings', 'owner requests', 'db_vendor_request', null, 'vendor_requests'],
    ['Customers', 'customers', 'db_name', 'name_stat', 'customers'],
    ['Customers', 'customer follow-ups', 'db_name_followup', 'follow_stat', 'customer_follow_ups', q => q.whereIn('name_id', legacy('db_name').select('name_id').whereRaw(...alive('name_stat')))],
    ['Closes and payouts', 'archives', 'db_case_archieve_ver2', 'arc_stat', 'archives'],
    ['Other', 'training and meeting videos', 'db_posts', null, 'videos', q => q.where(notDeletedAt)],
  ];
  // Marketing access: one per pair of people (the old table lists some pairs twice).
  if (has('db_marketing_user') && has('new_staff')) {
    const pairs = legacy('db_marketing_user').whereRaw(...alive('user_stat')).whereIn('staff_id', legacy('new_staff').select('user_id'))
      .whereIn('user_id', legacy('new_staff').select('user_id')).distinct('staff_id', 'user_id');
    const [n] = await one(legacy.from(pairs.as('p')).count({ n: '*' }));
    const [m] = await one(db('staff_marketing').count({ n: '*' }));
    add('People', 'marketing access (pairs of people)', n, m);
  }
  for (const [group, label, t, stat, target, more = q => q] of simple) {
    if (!has(t)) continue;
    const q = legacy(t);
    if (stat) q.whereRaw(...alive(stat));
    const [n] = await one(more(q).count({ n: '*' }));
    const [m] = await one(db(target).count({ n: '*' }));
    add(group, label, n, m);
  }

  const problems = checks.filter(c => !c.ok).length;
  const markdown = await writeReport({ db, report, checks, present });
  const summary = problems
    ? `${problems} of ${checks.length} checks differ between the old and the new database: see the report.`
    : `All ${checks.length} checks match: every old row is kept (but what is left out on purpose), and the records and money add up.`;
  return { ok: !problems, problems, checks, summary, markdown };
}

async function writeReport({ db, report, checks, present }) {
  const out = [`# Import from the current ERP (${localToday()})`, ''];
  const problems = checks.filter(c => !c.ok);
  out.push(problems.length ? `**${problems.length} of ${checks.length} checks differ.** Each one is listed first; the rows behind it are in "Kept in history only" below (or in \`legacy_rows\`).`
    : `**All ${checks.length} checks match.** Every old row is kept (but what is left out on purpose, listed at the end), and the records and money add up.`, '');
  if (report) out.push(`${present.length} old tables read in ${fmt(report.seconds)} s. Counts and totals only: no names, IC numbers, phones or addresses.`, '');

  const table = list => ['| Check | Old ERP | New ERP | |', '|---|--:|--:|---|',
    ...list.map(c => `| ${c.label} | ${fmt(c.before)} | ${fmt(c.after)} | ${c.ok ? 'matches' : `**differs by ${fmt(c.after - c.before)}**`} |`)];
  if (problems.length) out.push('## Differences', '', ...table(problems), '');
  for (const group of [...new Set(checks.map(c => c.group))]) out.push(`## ${group}`, '', ...table(checks.filter(c => c.group === group)), '');

  if (report) {
    out.push('## What became of each old table', '', '| Old table | Rows | Became | Kept in history only |', '|---|--:|---|--:|');
    for (const [t, s] of Object.entries(report.tables)) {
      const into = Object.entries(s.imported).map(([k, n]) => `${fmt(n)} ${k}`).join(', ') || '–';
      out.push(`| \`${t}\` | ${fmt(s.rows)} | ${into} | ${fmt(Object.values(s.kept).reduce((a, b) => a + b, 0))} |`);
    }
    const kept = Object.entries(report.tables).flatMap(([t, s]) => Object.entries(s.kept).map(([why, n]) => `| \`${t}\` | ${why} | ${fmt(n)} |`));
    out.push('', '## Kept in history only, and why', '');
    if (kept.length) out.push('These rows are in `legacy_rows` exactly as they were; nothing in them is lost.', '', '| Old table | Why | Rows |', '|---|---|--:|', ...kept);
    else out.push('None: every old row became a record.');

    const notes = Object.entries(report.tables).flatMap(([t, s]) => Object.entries(s.notes).map(([n, c]) => `| \`${t}\` | ${n} | ${fmt(c)} |`));
    if (notes.length) out.push('', '## Imported with a change', '', '| Old table | What | Rows |', '|---|---|--:|', ...notes);
    const codes = Object.entries(report.unknownCodes);
    if (codes.length) {
      out.push('', '## Codes the mapping did not know', '', 'Read as the default shown in the notes above. Add them to `CODES` in src/legacy/mapping.js and import again.', '',
        '| Column | Value × rows |', '|---|---|', ...codes.map(([col, vals]) => `| \`${col}\` | ${Object.entries(vals).map(([v, n]) => `\`${v}\` ×${fmt(n)}`).join(' · ')} |`));
    }
    const cut = Object.entries(report.truncated);
    if (cut.length) out.push('', '## Text cut to fit its column', '', 'The full text is in `legacy_rows`.', '', '| Column | Rows |', '|---|--:|', ...cut.map(([c, n]) => `| \`${c}\` | ${fmt(n)} |`));
    const big = Object.entries(report.outOfRange || {});
    if (big.length) out.push('', '## Numbers the column cannot hold, left blank', '', 'Typing mistakes in the old ERP (a negative area, 40,000 rooms); the old value is in `legacy_rows`.', '', '| Column | Rows |', '|---|--:|', ...big.map(([c, n]) => `| \`${c}\` | ${fmt(n)} |`));
    if (report.placeholders) out.push('', `**${fmt(report.placeholders)} "Unknown" staff records** stand in for people the old records name but the staff list no longer has, so their E-Forms and payouts keep their money.`);

    const branches = await db('branches').whereIn('id', report.branchesMade).select('id', 'name', 'code');
    if (branches.length) {
      out.push('', '## Branches made from the old "B.M" accounts', '', 'Rename them, or move people, in Setup → Company and branches.', '', '| Branch | Code | People | Listings | E-Forms |', '|---|---|--:|--:|--:|');
      for (const b of branches) {
        const n = async t => fmt((await db(t).where('branch_id', b.id).count({ n: '*' }).first()).n);
        out.push(`| ${b.name} | ${b.code} | ${await n('staff')} | ${await n('listings')} | ${await n('deals')} |`);
      }
    }
    out.push('', '## Left out on purpose', '');
    for (const [t, why] of Object.entries(report.notCopied)) if (present.includes(t)) out.push(`- \`${t}\`: ${why}.`);
    for (const [t, { from, left }] of Object.entries(report.recent || {})) out.push(`- \`${t}\`: ${M.RECENT[t].why} (${fmt(left)} rows before ${from}).`);
    for (const [t, why] of Object.entries(report.heldBack)) out.push(`- \`${t}\`: ${why} (\`--include ${t}\` keeps it).`);
    for (const [t, cols] of Object.entries(report.secretColumns)) if (present.includes(t)) out.push(`- \`${t}\` columns ${cols.map(c => `\`${c}\``).join(', ')}: passwords and sign-in tokens.`);
    if (report.unknownTables.length) out.push('', `**Tables the import does not know** (kept in history; decide where they go): ${report.unknownTables.map(t => `\`${t}\``).join(', ')}.`);
    if (report.missingTables.length) out.push('', `Tables the import reads that are not in this copy: ${report.missingTables.map(t => `\`${t}\``).join(', ')}.`);
    out.push('', '## Not in this database: copy before the old system is switched off', '',
      '- **Files**: listing photos, E-Form documents, payment slips and HR uploads are on the old file server and S3; the records keep their old paths (`legacy_rows`, E-Form files).',
      '- **The new panel\'s PostgreSQL** (www.subsaleking.com/panel): awards, bios, social links, profile photos and feature switches it keeps only there.',
      '- **Sign-in**: passwords are not copied. Accounts are made separately (or people keep signing in at www.subsaleking.com).');
  }
  return `${out.join('\n')}\n`;
}

module.exports = { verify };

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
  const fs = require('fs');
  const { legacyDb } = require('./connection');
  const db = require('../db/connection');
  const args = process.argv.slice(2);
  const file = args[args.indexOf('--out') + 1];
  const legacy = legacyDb();
  verify({ legacy, db })
    .then(r => { if (args.includes('--out')) fs.writeFileSync(file, r.markdown); else process.stdout.write(r.markdown); console.error(r.summary); if (!r.ok) process.exitCode = 1; })
    .catch(err => { console.error(err.message); process.exitCode = 1; })
    .finally(() => Promise.all([legacy.destroy(), db.destroy()]));
}

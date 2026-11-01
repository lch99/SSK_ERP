// What is in the copy of the current ERP's database, as Markdown: every table
// with its row count, and every column with its type, how often it is empty,
// how many different values it has, and (only where safe) what they are:
// status codes and option values with their counts, date and number ranges,
// and whether an `…_id` column points at rows that exist. Names, IC numbers,
// phones, e-mails, addresses, bank details, remarks and files are never shown.
//
//   npm run legacy:inspect                    → the whole database, to the screen
//   npm run legacy:inspect -- --out report.md --table eform --table staff
//
// The top of the report checks the tables and columns the import reads.

// Columns whose values are about a person, secrets, or free text: counted, never shown.
const PERSONAL = /name|(^|_)ic($|_)|nric|ic_no|passport|phone|tel|mobile|(^|_)hp($|_)|handphone|fax|email|e_mail|address|addr|bank|(^|_)acc(_|$|no|num)|account|password|pass(wd)?|pwd|token|secret|(^|_)key($|_)|api_?key|smtp|otp|(^|_)pin($|_)|salt|hash|session|remark|note|desc|message|comment|reason|file|photo|image|img|cover|url|link|ref(erence)?|cheque|birthday|dob|ip($|_)|facebook|instagram|whatsapp|wechat|contact|unit|lot/i;
const MAX_CODES = 15;   // a column with this many different values or fewer is a list of codes
const MAX_CODE_LENGTH = 30;

const NUMERIC = /int|decimal|numeric|float|double|real|bit|bool/i;
const DATELIKE = /date|time|year/i;

// The tables and columns the import reads (src/legacy/mapping.js, from the
// real schema). One missing in the copy is listed at the top of the report.
const { EXPECTED, KEYS } = require('./mapping');

const fmt = n => Number(n).toLocaleString('en-US');
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');
const cell = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

async function tableNames(db) {
  if (db.client.config.client === 'better-sqlite3') {
    return (await db.raw("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")).map(r => r.name);
  }
  const [rows] = await db.raw('show full tables where Table_type = ?', ['BASE TABLE']);
  return rows.map(r => Object.values(r)[0]).sort();
}

// Is it safe to show this column's values? Codes only: few values, short, not about a person.
const showable = (col, info, distinct, longest) =>
  !PERSONAL.test(col) && distinct <= MAX_CODES && (NUMERIC.test(info.type) || longest <= MAX_CODE_LENGTH);

async function describeColumn(db, table, col, info, rows, idTables, columns) {
  const q = () => db(table);
  const stats = await q().select(
    db.raw('count(distinct ??) as d', [col]),
    db.raw('sum(case when ?? is null then 1 else 0 end) as nulls', [col]),
  ).first();
  const distinct = Number(stats.d), empty = Number(stats.nulls);
  let what = '';
  if (PERSONAL.test(col) && distinct > 0) what = '_personal or free text: not shown_';
  else if (DATELIKE.test(info.type) && !NUMERIC.test(info.type)) {
    const r = await q().min({ lo: col }).max({ hi: col }).first();
    what = r.lo == null ? '' : `${String(r.lo).slice(0, 10)} → ${String(r.hi).slice(0, 10)}`;
  }
  if (!what && distinct > 0) {
    const longest = NUMERIC.test(info.type) ? 0 : Number((await q().max({ m: db.raw('length(??)', [col]) }).first()).m) || 0;
    if (showable(col, info, distinct, longest)) {
      const vals = await q().select({ v: col }).count({ n: '*' }).groupBy(col).orderBy('n', 'desc');
      what = vals.map(v => `\`${v.v === null ? 'null' : String(v.v) === '' ? "''" : v.v}\` ×${fmt(v.n)}`).join(' · ');
    } else if (PERSONAL.test(col)) {
      what = '_personal or free text: not shown_';
    } else if (NUMERIC.test(info.type)) {
      const r = await q().min({ lo: col }).max({ hi: col }).first();
      // Eight or more digits may be an IC, phone or account number: the range is not shown.
      what = [r.lo, r.hi].some(v => String(v).replace(/\D/g, '').length >= 8 && !/[.]/.test(String(v))) ? '_long numbers: range not shown_' : `${r.lo} → ${r.hi}`;
    } else {
      what = `text up to ${fmt(longest)} characters`;
    }
  }
  // staff_id → staff? form_id → eform? Count the values with no row to point at.
  const m = col.match(/^(.*)_id$/);
  if (m && distinct > 0) {
    const target = idTables.find(t => t === m[1]) || idTables.find(t => t.endsWith(m[1]) || m[1].endsWith(t));
    if (target && target !== table) {
      const key = (KEYS[target] || [Object.keys(columns[target])[0]])[0];
      const missing = await q().whereNotNull(col).whereNot(col, 0).whereNotIn(col, s => s.select(key).from(target)).countDistinct({ n: col }).first();
      what += `${what ? ' · ' : ''}→ \`${target}.${key}\`${Number(missing.n) ? `, ${fmt(missing.n)} value(s) not found` : ''}`;
    }
  }
  return `| \`${cell(col)}\` | ${cell(info.type)}${info.maxLength ? `(${info.maxLength})` : ''} | ${pct(empty, rows)} | ${fmt(distinct)} | ${cell(what)} |`;
}

async function inspect(db, { tables: only = [], when = new Date().toISOString().slice(0, 10) } = {}) {
  const all = await tableNames(db);
  const counts = {};
  for (const t of all) counts[t] = Number((await db(t).count({ n: '*' }).first()).n);
  const columns = {};
  for (const t of all) columns[t] = await db(t).columnInfo();

  const out = [`# The current ERP's database (copy inspected ${when})`, '',
    `${all.length} tables, ${fmt(Object.values(counts).reduce((a, b) => a + b, 0))} rows. Values are shown only for code columns; personal details and free text are counted, never shown.`, '',
    '## What the import expects', '', '| Expected | Found | Missing columns |', '|---|---|---|'];
  for (const [want, cols] of Object.entries(EXPECTED)) {
    const found = all.find(t => t === want);
    const missing = found ? cols.filter(c => !(c in columns[found])) : cols;
    out.push(`| \`${want}\` | ${found ? `${fmt(counts[found])} rows` : '**not found**'} | ${missing.map(c => `\`${c}\``).join(', ') || '–'} |`);
  }
  out.push('', '## Tables', '', '| Table | Rows | Columns |', '|---|---|---|', ...all.map(t => `| \`${t}\` | ${fmt(counts[t])} | ${Object.keys(columns[t]).length} |`));

  for (const t of only.length ? all.filter(x => only.includes(x)) : all) {
    out.push('', `## \`${t}\` (${fmt(counts[t])} rows)`, '', '| Column | Type | Empty | Different values | What is in it |', '|---|---|---|---|---|');
    for (const [col, info] of Object.entries(columns[t])) out.push(await describeColumn(db, t, col, info, counts[t], all, columns));
  }
  return `${out.join('\n')}\n`;
}

module.exports = { inspect, tableNames, PERSONAL, EXPECTED, showable };

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
  const fs = require('fs');
  const { legacyDb } = require('./connection');
  const args = process.argv.slice(2);
  const opt = name => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
  const db = legacyDb();
  inspect(db, { tables: opt('--table') })
    .then(md => {
      const [file] = opt('--out');
      if (file) { fs.writeFileSync(file, md); console.log(`Written to ${file}`); } else process.stdout.write(md);
    })
    .catch(err => { console.error(err.message); process.exitCode = 1; })
    .finally(() => db.destroy());
}

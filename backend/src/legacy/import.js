// Copies the current ERP's database (a restored copy, LEGACY_DB_* in backend/.env)
// into the new tables, then checks nothing went missing (verify.js).
//
//   npm run legacy:import -- --out import-report.md          into an empty database
//   npm run legacy:import -- --replace --out report.md       again, over an earlier import (a newer copy)
//   npm run legacy:import -- --force                         also over records made in the new system (trial runs only)
//   npm run legacy:import -- --include db_name_1             also keep a table held back by default (mapping.js HELD_BACK)
//
// Old ids stay the ids (staff, listings, E-Forms, payments, payout lines…) and
// old codes stay the codes, so links, printed documents and the .NET panel's
// staff ids still match. Every old row, imported or not, is kept as it was in
// `legacy_rows` with the record it became or why it did not become one;
// passwords and sign-in tokens are the only things never copied. Running it
// again with a newer copy replaces the earlier import, so the last copy taken
// before the old ERP goes read-only is the one the new ERP starts from.
const M = require('./mapping');
const { UPLOADS } = require('../../../shared/files.js');
const { tableNames, columnsOf } = require('./inspect');
const { loadState } = require('../db/setupStore');
const { parseJson } = require('../db/records');
const { verify } = require('./verify');
const { localToday } = require('../db/days');

const PAGE = 1000;
const BATCH = 200;
const NUMERIC = /int|decimal|numeric|float|double|real/i;

// Records the import writes, children before parents (the order they are emptied in).
const RECORD_TABLES = ['legacy_activity', 'notices', 'favourites', 'saved_listings', 'staff_marketing', 'listing_follow_ups', 'customer_follow_ups', 'payout_lines', 'closes', 'pay_requests', 'archives', 'money_out',
  'money_in', 'customers', 'enquiries', 'vendor_requests', 'deals', 'listings', 'titles', 'areas', 'property_types', 'videos', 'v1_eforms', 'v1_overrides', 'staff'];
// Business records checked for "made in the new system" before an import replaces them.
const GUARDED = ['staff', 'listings', 'deals', 'money_in', 'payout_lines', 'customers', 'money_out', 'pay_requests'];
const HQ_NAME = 'Head office';

// ── Reading the copy ─────────────────────────────────────────────────────────
// Each table's primary key as the copy declares it (else mapping.js KEYS). A table
// with neither is read in a fixed order and its rows kept as "#1", "#2"…
const primaryKeys = {};
async function readPrimaryKeys(legacy, present) {
  for (const t of present) {
    const [rows] = await legacy.raw(`select column_name as c from information_schema.key_column_usage
      where table_schema = database() and table_name = ? and constraint_name = 'PRIMARY' order by ordinal_position`, [t]);
    const keys = rows.map(r => r.c ?? r.COLUMN_NAME);
    primaryKeys[t] = keys.length ? keys : M.KEYS[t] || null;
  }
}
const keysOf = table => primaryKeys[table] || M.KEYS[table] || null;
const historyId = (keys, row, n) => (keys ? keys.map(k => row[k]).join(':') : `#${n}`).slice(0, 64);

// Rows in key order, a page at a time (by key value where the key is one number).
// Each row comes with its place in the table (for tables with no key). `only`
// narrows the rows read (a RECENT table's latest).
async function* pages(legacy, table, cols, only = () => {}) {
  const keys = keysOf(table);
  if (keys?.length === 1 && NUMERIC.test(cols[keys[0]]?.type || '')) {
    let last = null;
    for (;;) {
      const q = legacy(table).where(only).orderBy(keys[0]).limit(PAGE);
      if (last != null) q.where(keys[0], '>', last);
      const rows = await q;
      if (rows.length) yield rows;
      if (rows.length < PAGE) return;
      last = rows[rows.length - 1][keys[0]];
    }
  }
  for (let off = 0; ; off += PAGE) {
    const rows = await legacy(table).where(only).orderBy(keys || Object.keys(cols)).limit(PAGE).offset(off);
    rows.forEach((r, i) => place.set(r, off + i + 1));
    if (rows.length) yield rows;
    if (rows.length < PAGE) return;
  }
}
const place = new WeakMap();

// The old row as it is kept in history.
function raw(table, row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (M.SECRET_COLUMNS[table]?.includes(k)) continue;
    out[k] = Buffer.isBuffer(v) ? `base64:${v.toString('base64')}` : v instanceof Date ? v.toISOString() : v;
  }
  return JSON.stringify(out);
}

// ── Writing the new tables ───────────────────────────────────────────────────
// The numbers a column holds ('int unsigned', 'smallint', 'decimal(14,2)'…), as [lowest, highest]; null: any.
const INT_MAX = { tinyint: 127, smallint: 32767, mediumint: 8388607, int: 2147483647 };
function rangeOf(columnType) {
  const [, type, p, s] = String(columnType).match(/^(\w+)(?:\((\d+)(?:,(\d+))?\))?/) || [];
  const unsigned = /unsigned/.test(columnType);
  const max = INT_MAX[type] != null ? (unsigned ? INT_MAX[type] * 2 + 1 : INT_MAX[type]) : type === 'decimal' ? 10 ** (Number(p) - Number(s || 0)) - 10 ** -Number(s || 0) : null;
  if (max == null) return null;
  return [unsigned ? 0 : type === 'decimal' ? -max : -max - 1, max];
}

function writer(db, report) {
  const info = {};
  const columns = async t => {
    if (!info[t]) {
      const [rows] = await db.raw('select column_name as c, column_type as type, character_maximum_length as l, is_nullable as n from information_schema.columns where table_schema = database() and table_name = ?', [t]);
      info[t] = Object.fromEntries(rows.map(r => [r.c, { type: r.type, maxLength: r.l, nullable: r.n === 'YES', range: rangeOf(r.type) }]));
    }
    return info[t];
  };
  const bump = (what, col) => { report[what][col] = (report[what][col] || 0) + 1; };
  // Text longer than its column is cut to fit, and a number the column can't hold (the
  // old ERP has −400 m² and 40,000 rooms) is left blank (0 where it can't be blank);
  // the whole value stays in history, and each is counted in the report.
  async function fit(t, row) {
    const cols = await columns(t);
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'boolean') row[k] = v ? 1 : 0;  // MySQL keeps booleans as 1/0
      const c = cols[k];
      if (!c) continue;
      if (typeof v === 'string' && c.maxLength && v.length > Number(c.maxLength) && !/json|text/i.test(c.type)) {
        row[k] = v.slice(0, Number(c.maxLength));
        bump('truncated', `${t}.${k}`);
      } else if (typeof v === 'number' && c.range && (v < c.range[0] || v > c.range[1])) {
        row[k] = c.nullable ? null : 0;
        bump('outOfRange', `${t}.${k}`);
      }
    }
    return row;
  }
  return {
    async insert(t, rows) {
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = [];
        for (const r of rows.slice(i, i + BATCH)) batch.push(await fit(t, { ...r }));
        await db(t).insert(batch);
      }
    },
    async updateEach(t, rows) {  // [{ id, ...fields }]
      await db.transaction(async trx => {
        for (const { id, ...set } of rows) await trx(t).where('id', id).update(await fit(t, set));
      });
    },
  };
}

// ── Before anything is written ───────────────────────────────────────────────
async function checkCopy(legacy) {
  const present = await tableNames(legacy);
  const cols = {};
  // In the order each table has them (a table with no key is read in that order).
  for (const t of present) cols[t] = await columnsOf(legacy, t);
  const missing = [];
  for (const [t, reads] of Object.entries(M.EXPECTED)) {
    if (cols[t]) for (const c of reads) if (!(c in cols[t])) missing.push(`${t}.${c}`);
  }
  if (missing.length) {
    throw new Error(`The copy is missing columns the import reads (nothing was written):\n  ${missing.join('\n  ')}\nCheck the copy is complete, or fix the names in src/legacy/mapping.js.`);
  }
  return { present, cols };
}

async function prepareTarget(db, { replace, force }) {
  const count = async t => Number((await db(t).count({ n: '*' }).first()).n);
  let total = 0;
  for (const t of GUARDED) total += await count(t);
  if (total && !replace && !force) {
    throw new Error(`The new database already has ${total.toLocaleString('en-US')} records. Use --replace to import a newer copy over an earlier import.`);
  }
  if (total && !force) {
    const made = [];
    for (const t of GUARDED) {
      const imported = new Set((await db('legacy_rows').where('target_table', t).select('target_id')).map(r => String(r.target_id)));
      const rows = await db(t).select(t === 'staff' ? ['id', 'more'] : ['id']);
      const n = rows.filter(r => !imported.has(String(r.id)) && !(t === 'staff' && parseJson(r.more)?.placeholder)).length;
      if (n) made.push(`${n.toLocaleString('en-US')} ${t}`);
    }
    if (made.length) {
      throw new Error(`The new database has records that did not come from the old ERP (${made.join(', ')}): made in the new system, by Setup's agent list, or by demo data. Replacing the import would delete them, so nothing was changed. Start from an empty database (npm run reset-db), or pass --force for a trial run.`);
    }
  }
  // Sign-in accounts point at staff records, which are made again with the same ids: the links are
  // put back once the people are in (relinkAccounts), so nobody loses their account at switch-over.
  const links = await db('users').whereNotNull('staff_id').select('id', 'staff_id');
  await db.transaction(async trx => {
    await trx('users').update({ staff_id: null });
    await trx('legacy_rows').del();
    await trx('audit_log').where('entity', 'deal').del();
    for (const t of RECORD_TABLES) await trx(t).del();
    await trx('counters').del();
  });
  return links;
}

// Each account goes back to its person, if they came across again (else it stays without one, as an office account
// would, and the report counts it).
async function relinkAccounts(db, links) {
  if (!links?.length) return 0;
  const there = new Set((await db('staff').whereIn('id', links.map(l => l.staff_id)).pluck('id')).map(Number));
  let lost = 0;
  for (const l of links) {
    if (there.has(Number(l.staff_id))) await db('users').where('id', l.id).update({ staff_id: l.staff_id });
    else lost++;
  }
  return lost;
}

// ── Branches: the old ERP's "B.M (…)" accounts (account type sale-staff) ─────
async function makeBranches(db, people, report) {
  const existing = await db('branches').select('id', 'name', 'code', 'sort_order');
  const byName = new Map(existing.map(b => [b.name.trim().toLowerCase(), b.id]));
  const codes = new Set(existing.map(b => b.code));
  let order = existing.reduce((m, b) => Math.max(m, b.sort_order), 0);
  async function branch(name) {
    const key = name.trim().toLowerCase();
    if (byName.has(key)) return byName.get(key);
    const base = (name.match(/\(([^)]+)\)/)?.[1] || name).replace(/[^a-z]/gi, '').toUpperCase().slice(0, 3) || 'BR';
    let code = base;
    for (let n = 2; codes.has(code); n++) code = `${base.slice(0, 4 - String(n).length)}${n}`;
    codes.add(code);
    const [bid] = await db('branches').insert({ name: name.slice(0, 100), code, sort_order: ++order });
    byName.set(key, bid);
    report.branchesMade.push(bid);
    return bid;
  }
  const bm = new Map();
  for (const p of people.values()) {
    if (M.text(p.type).toLowerCase() !== 'sale-staff') continue;
    const name = M.text(p.name_card_name) || M.text(p.ic_name) || M.text(p.user_name) || `Branch ${p.user_id}`;
    bm.set(M.int(p.user_id), await branch(name));
  }
  const hq = await branch(HQ_NAME);
  // A person's branch: the first B.M account up their upline chain (their own, for one).
  const memo = new Map();
  const branchOfStaff = sid => {
    if (sid == null) return null;
    if (memo.has(sid)) return memo.get(sid);
    let cur = sid, found = null;
    for (let hops = 0; cur && hops < 60 && found == null; hops++) {
      if (bm.has(cur)) found = bm.get(cur);
      else cur = M.id(people.get(cur)?.staff_id);
    }
    memo.set(sid, found);
    return found;
  };
  return { bm, hq, branchOfStaff };
}

// ── The import ───────────────────────────────────────────────────────────────
async function importLegacy({ legacy, db, replace = false, force = false, include = [], log = () => {} }) {
  const started = Date.now();
  const { present, cols } = await checkCopy(legacy);
  if (!(await db.schema.hasTable('legacy_rows'))) throw new Error('The new database is not ready: run npm run migrate first.');
  await readPrimaryKeys(legacy, present);
  const links = await prepareTarget(db, { replace, force });

  const report = { tables: {}, unknownCodes: {}, truncated: {}, outOfRange: {}, branchesMade: [], placeholders: 0, missingTables: [], unknownTables: [], recent: {}, include };
  const stat = t => (report.tables[t] ||= { rows: 0, imported: {}, kept: {}, notes: {} });
  const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
  const w = writer(db, report);

  // Lookups and the staff tree, read whole.
  const lookup = {};
  for (const [t, l] of Object.entries(M.LOOKUPS)) {
    lookup[t] = new Map(present.includes(t) ? (await legacy(t).select(l.key, l.name)).map(r => [M.int(r[l.key]), M.text(r[l.name])]) : []);
  }
  const areas = new Map(present.includes('db_property_area') ? (await legacy('db_property_area').select('area_id', 'area_name', 'state_id')).map(r => [M.int(r.area_id), r]) : []);
  const titles = new Map(present.includes('db_property_title') ? (await legacy('db_property_title').select('title_id', 'title_name')).map(r => [M.int(r.title_id), M.text(r.title_name)]) : []);
  const people = new Map(present.includes('new_staff')
    ? (await legacy('new_staff').select('user_id', 'staff_id', 'type', 'name_card_name', 'ic_name', 'user_name')).map(p => [M.int(p.user_id), p]) : []);
  const { bm, hq, branchOfStaff } = await makeBranches(db, people, report);
  const roles = (await loadState(db)).roles || [];

  const ids = { staff: new Set() };
  const seen = {};
  const ctx = {
    today: localToday(),
    notes: [],
    placeholders: [],
    listingTitles: new Map(), vendorListing: new Map(), deals: new Map(), salaries: new Map(), closes: new Map(), caseDeal: new Map(), v1Price: new Map(),
    counts: {},
    has: (t, v) => v != null && !!ids[t]?.has(v),
    note: m => ctx.notes.push(m),
    count: (ns, k) => bump((ctx.counts[ns] ||= {}), k),
    firstTime: (ns, k) => { const s = (seen[ns] ||= new Set()); if (s.has(k)) return false; s.add(k); return true; },
    // A code (or user name) once only: a missing or repeated one becomes `fallback`
    // (made from the old id), or blank when there is no fallback.
    unique: (ns, v, fallback) => {
      if (v != null && ctx.firstTime(ns, String(v).toLowerCase())) return v;
      if (v != null) ctx.note(`${ns} repeats an earlier row's: ${fallback ? 'one was made from its id' : 'left blank'}`);
      else if (fallback) ctx.note(`no ${ns} in the old ERP: one was made from its id`);
      if (!fallback) return null;
      let code = fallback;
      for (let n = 2; !ctx.firstTime(ns, code.toLowerCase()); n++) code = `${fallback}-${n}`;
      return code;
    },
    unknownCode: (label, value, fallback) => { bump((report.unknownCodes[label] ||= {}), String(value ?? 'null')); ctx.note(`unknown ${label}: read as ${fallback}`); return fallback; },
    code: (map, value, label, fallback) => M.CODES[map][String(value ?? '').trim()] ?? ctx.unknownCode(label, value, fallback),
    person(v, { required = false } = {}) {
      const n = M.id(v);
      if (n && ids.staff?.has(n)) return n;
      if (!required) { if (n) ctx.note('a person on it is not in the staff list: left blank'); return null; }
      // A record that must name someone keeps its money: an "Unknown" staff record stands in for the missing person.
      const pid = n || ctx.nobody();
      if (!ids.staff.has(pid)) { ids.staff.add(pid); ctx.placeholders.push({ id: pid, old: n }); }
      ctx.note(n ? 'its person is not in the staff list: an "Unknown" staff record stands in' : 'nobody named on it: an "Unknown" staff record stands in');
      return pid;
    },
    nobody: () => (ctx.nobodyId ||= Math.max(0, ...people.keys()) + 1),
    branchOfStaff: sid => branchOfStaff(sid),
    branchOfBm: sid => (sid != null && bm.has(sid) ? bm.get(sid) : null),
    hq: () => hq,
    positionFor: rank => roles.find(r => [r.name, r.code].some(x => x && String(x).toLowerCase() === String(rank || '').toLowerCase()))?.code || null,
    bankName: v => lookup.db_bank.get(M.int(v)) || '',
    stateName: v => lookup.db_property_state.get(M.int(v)) || '',
    subName: v => lookup.db_property_cate_sub.get(M.int(v)) || '',
    cateName: v => lookup.db_property_cate.get(M.int(v)) || '',
    areaName: v => M.text(areas.get(M.int(v))?.area_name),
    areaState: v => lookup.db_property_state.get(M.int(areas.get(M.int(v))?.state_id)) || '',
    titleName: v => titles.get(M.int(v)) || '',
  };

  async function savePlaceholders() {
    if (!ctx.placeholders.length) return;
    const rows = ctx.placeholders.map(p => ({
      id: p.id, code: `STAFF-${M.pad(p.id, 5)}`, name: p.old ? `Unknown (old staff ${p.old})` : 'Unknown (left blank in the old ERP)',
      short_name: p.old ? `Unknown ${p.old}` : 'Unknown', branch_id: hq, type: 'staff', status: 'inactive', more: JSON.stringify({ placeholder: true }),
    }));
    report.placeholders += rows.length;
    ctx.placeholders = [];
    await w.insert('staff', rows);
  }
  async function saveCloses() {
    const fresh = [...ctx.closes.values()].filter(c => !c.saved);
    for (const c of fresh) c.saved = true;
    await w.insert('closes', fresh.map(({ saved, sides, ...c }) => ({ ...c, sides: '[]' })));  // eslint-disable-line no-unused-vars
  }
  // Every old row of a table into history, with what became of it.
  async function keep(table, rows, fate = () => ({})) {
    const keys = keysOf(table);
    await w.insert('legacy_rows', rows.map(r => {
      const f = fate(r);
      return { source_table: table, source_id: historyId(keys, r, place.get(r)), target_table: f.target ?? null, target_id: f.id == null ? null : String(f.id), note: f.note ? String(f.note).slice(0, 200) : null, data: raw(table, r) };
    }));
  }

  // 1. The tables that become records, in the order their links need.
  for (const [table, m] of Object.entries(M.TABLES)) {
    if (!present.includes(table)) { report.missingTables.push(table); continue; }
    log(`${table} → ${m.into}`);
    const st = stat(table);
    for await (const rows of pages(legacy, table, cols[table])) {
      const out = {}, fates = new Map();
      for (const r of rows) {
        ctx.notes = [];
        let res;
        try { res = m.transform(r, ctx); } catch (err) { res = M.skip(`could not be read (${err.message})`); }
        st.rows++;
        if (res?.skip) {
          bump(st.kept, res.skip);
          fates.set(r, { note: res.skip });
        } else {
          const { into, row } = res.otherTable ? { into: res.otherTable, row: res.row } : { into: m.into, row: res };
          (out[into] ||= []).push(row);
          bump(st.imported, into);
          if (into === 'payout_lines') ctx.caseDeal.set(row.id, { dealId: row.deal_id, archiveId: row.archive_id });
          if (into === 'v1_eforms') ctx.v1Price.set(row.id, row.price || 0);
          fates.set(r, { target: into, id: into === 'staff_marketing' ? `${row.staff_id}:${row.member_id}` : row.id, note: [...new Set(ctx.notes)].join(' · ') });
        }
        for (const n of new Set(ctx.notes)) bump(st.notes, n);
      }
      await savePlaceholders();
      if (table === 'db_case_list') await saveCloses();
      for (const [t, list] of Object.entries(out)) {
        await w.insert(t, list);
        const set = (ids[t] ||= new Set());
        for (const r of list) set.add(r.id);
      }
      await keep(table, rows, r => fates.get(r));
    }
    if (table === 'new_staff') {
      // Uplines once everyone is in (an upline may come after the person in id order).
      const ups = [...people.values()].map(p => ({ id: M.int(p.user_id), upline_id: M.id(p.staff_id) }))
        .filter(p => p.upline_id && p.upline_id !== p.id && ids.staff?.has(p.id) && ids.staff.has(p.upline_id));
      await w.updateEach('staff', ups);
    }
  }

  // 2. Rows that fill in records already made, a page at a time. fate(row) says
  // what the row became ({ target, id, note }) or why it is history only ({ note }).
  async function fillIn(t, fate, afterPage = async () => {}) {
    if (!present.includes(t)) { report.missingTables.push(t); return; }
    log(`${t} → filled in`);
    const st = stat(t);
    for await (const rows of pages(legacy, t, cols[t])) {
      st.rows += rows.length;
      const fates = new Map(rows.map(r => [r, fate(r)]));
      for (const f of fates.values()) {
        if (f.target) bump(st.imported, f.target); else bump(st.kept, f.note);
        if (f.target && f.note) bump(st.notes, f.note);
      }
      await afterPage();
      await keep(t, rows, r => fates.get(r));
    }
  }

  // Main and co-product handler slots → listing.share ({ pmId, coPh: [{ staffId, until, locked, from }] }).
  const share = new Map();
  await fillIn('db_property_share_product_handler', r => {
    const lid = M.id(r.property_id), sid = M.id(r.staff_id), status = M.int(r.status_id);
    if (!ids.listings?.has(lid)) return { note: 'its listing is not imported' };
    if (![1, 2].includes(status)) return { note: 'an ended slot (replaced, expired or lost to a lock)' };
    if (!ids.staff.has(sid)) return { note: 'a person on it is not in the staff list' };
    const s = share.get(lid) || { pmId: null, coPh: [] };
    if (M.text(r.type) === 'main_ph') s.pmId = sid;
    else s.coPh.push({ staffId: sid, until: M.day(r.valid_until), locked: status === 2, from: M.day(r.created_at) });
    share.set(lid, s);
    return { target: 'listings', id: lid };
  });
  await w.updateEach('listings', [...share].map(([id, s]) => ({ id, share: JSON.stringify(s) })));

  // Listing photos → the listing's album (photo_set): each photo's address on the old file server, which the
  // old phone app shows as it always did, until the files are copied over with small previews. A listing keeps
  // up to UPLOADS.photo.maxFiles of them (its cover, then the newest), as the new album holds; the rest stay in
  // history (and on the old server).
  const MAX_PHOTOS = UPLOADS.photo.maxFiles;
  const fileName = u => { const last = u.split('/').pop() || ''; try { return decodeURIComponent(last); } catch { return last; } };
  const shownPhoto = r => !M.deleted(r.image_stat) && M.int(r.image_display) !== 0 && ids.listings?.has(M.id(r.property_id)) && M.oldFileUrl(r.image_url);
  const keptPhotos = new Set();
  if (present.includes('db_property_images')) {
    const byListing = new Map();
    for await (const rows of pages(legacy, 'db_property_images', cols.db_property_images)) {
      for (const r of rows) if (shownPhoto(r)) {
        const lid = M.id(r.property_id);
        if (!byListing.has(lid)) byListing.set(lid, []);
        byListing.get(lid).push({ id: M.int(r.image_id), cover: M.flag(r.image_cover), on: M.day(r.image_date) || '' });
      }
    }
    for (const list of byListing.values()) {
      list.sort((a, b) => (b.cover - a.cover) || b.on.localeCompare(a.on) || b.id - a.id);
      for (const p of list.slice(0, MAX_PHOTOS)) keptPhotos.add(p.id);
    }
  }
  const albums = new Map();
  await fillIn('db_property_images', r => {
    if (M.deleted(r.image_stat)) return { note: 'deleted in the old ERP' };
    if (M.int(r.image_display) === 0) return { note: 'hidden in the old ERP' };
    const lid = M.id(r.property_id);
    if (!ids.listings?.has(lid)) return { note: 'its listing is not imported' };
    const url = M.oldFileUrl(r.image_url);
    if (!url) return { note: 'no file address' };
    if (!keptPhotos.has(M.int(r.image_id))) return { note: `more than ${MAX_PHOTOS} photos on one listing (it keeps its cover and the newest)` };
    if (!albums.has(lid)) albums.set(lid, []);
    albums.get(lid).push({ id: M.int(r.image_id), name: fileName(url) || `Photo ${r.image_id}`, published: true,
      cover: M.flag(r.image_cover), url, on: M.day(r.image_date) || null });
    return { target: 'listings', id: lid };
  });
  await w.updateEach('listings', [...albums].map(([id, list]) => {
    list.sort((a, b) => a.id - b.id);
    // One cover: the first marked, else the first.
    const cover = list.find(p => p.cover) || list[0];
    const set = list.map(p => ({ ...p, cover: p === cover }));
    const newest = list.map(p => p.on).filter(Boolean).sort().at(-1) || null;
    return { id, photo_set: JSON.stringify(set), photo_count: set.length, photos_on: newest };
  }));

  // Other buyers / owners (tenants / landlords) saved as E-Form extras.
  const others = new Map();
  const party = x => {
    if (!x || typeof x !== 'object') return { name: M.text(x) };
    const pick = re => M.text(Object.entries(x).find(([k, v]) => re.test(k) && M.text(v))?.[1]);
    return { name: pick(/name/i), ic: pick(/nric|(^|_)ic|passport/i), phone: pick(/tel|phone/i) };
  };
  await fillIn('db_eforms_meta', r => {
    const did = M.id(r.form_id), key = M.text(r.meta_key).toLowerCase();
    if (!ctx.deals.has(did)) return { note: 'its E-Form is not imported' };
    const side = /landlord|owner|vendor/.test(key) ? 'other_owners' : /tenant|purchaser|buyer/.test(key) ? 'other_buyers' : null;
    if (!side) return { note: 'an E-Form extra the new E-Form has no field for' };
    let value;
    try { value = JSON.parse(r.meta_value); } catch { value = r.meta_value; }
    const e = others.get(did) || {};
    e[side] = [...(e[side] || []), ...(Array.isArray(value) ? value : [value]).map(party).filter(p => p.name)];
    others.set(did, e);
    return { target: 'deals', id: did };
  });
  await w.updateEach('deals', [...others].map(([id, e]) => ({ id, ...Object.fromEntries(Object.entries(e).map(([k, v]) => [k, JSON.stringify(v)])) })));

  // Landlord verification of archived cases → the E-Form's check (Reports). Archived and
  // never checked: Pending Verification (−1), as the old report shows it.
  const checked = new Map();
  await fillIn('db_landlord_verification', r => {
    const c = ctx.caseDeal.get(M.id(r.case_id));
    if (!c) return { note: 'its case line is not imported' };
    const key = `${M.day(r.verification_date) || M.day(r.created_at) || ''}#${M.pad(r.id, 12)}`;
    if (!checked.has(c.dealId) || key > checked.get(c.dealId).key) checked.set(c.dealId, { key, r, archiveId: c.archiveId });
    return { target: 'deals', id: c.dealId };
  });
  {
    const archived = new Map();
    for (const c of ctx.caseDeal.values()) if (c.archiveId && !archived.has(c.dealId)) archived.set(c.dealId, c.archiveId);
    const updates = [...archived].filter(([d]) => !checked.has(d)).map(([id, arc]) => ({ id, lv_status: -1, lv_archive_id: arc }));
    for (const [id, { r, archiveId }] of checked) {
      updates.push({ id, lv_status: M.int(r.verification_status) ?? -1, lv_on: M.day(r.verification_date), lv_remarks: M.text(r.remarks) || null, lv_archive_id: archiveId });
    }
    await w.updateEach('deals', updates);
  }

  // The E-Form update tracker → the audit log (the E-Form page's history).
  let audit = [];
  const at = v => (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(String(v || '')) && M.day(v) ? String(v).replace('T', ' ').slice(0, 19) : null);
  await fillIn('db_eforms_update_tracker', r => {
    const did = M.id(r.form_id);
    if (!ctx.deals.has(did)) return { note: 'its E-Form is not imported' };
    audit.push({
      user_id: null, username: M.text(people.get(M.id(r.user_id))?.user_name).slice(0, 32) || null, action: 'update', entity: 'deal', entity_id: String(did),
      detail: JSON.stringify({ field: M.text(r.type), ref: M.text(r.ref) || undefined, before: r.data_before ?? null, after: r.data_after ?? null }),
      created_at: at(r.created_at) || `${ctx.deals.get(did).date} 00:00:00`,
    });
    return { target: 'audit_log', note: at(r.created_at) ? null : 'no time: dated with the E-Form' };
  }, async () => { await w.insert('audit_log', audit); audit = []; });

  // First-system override lines → yearly totals per person (Old records).
  const overrides = new Map();
  await fillIn('db_overiding_record', r => {
    const sid = M.id(r.staff_id), year = M.int(r.year) || M.int(M.day(r.over_date)?.slice(0, 4));
    if (M.deleted(r.over_stat)) return { note: 'deleted in the old ERP' };
    if (!year) return { note: 'no year' };
    const k = `${sid || 0}|${year}`;
    const tot = overrides.get(k) || { id: overrides.size + 1, year, staff_id: ids.staff.has(sid) ? sid : null, forms: new Set(), override: 0 };
    if (M.id(r.form_id)) tot.forms.add(M.id(r.form_id));
    tot.override = M.r2(tot.override + (M.money(r.over_amount) || 0));
    overrides.set(k, tot);
    return { target: 'v1_overrides', id: tot.id, note: sid && !tot.staff_id ? 'a person on it is not in the staff list: left blank' : null };
  });
  await w.insert('v1_overrides', [...overrides.values()].map(x => ({
    id: x.id, year: x.year, staff_id: x.staff_id, cases: x.forms.size, override: x.override,
    sales: M.r2([...x.forms].reduce((s, f) => s + (ctx.v1Price.get(f) || 0), 0)),
  })));

  // Starred listings and buildings → each person's favourites (who hears of new listings and price changes there).
  const favs = new Map();
  const starred = (kind, of) => r => {
    const sid = M.id(r.user_id), target = M.id(of(r));
    if (!ids.staff.has(sid)) return { note: 'its person is not in the staff list' };
    if (!ids[kind]?.has(target)) return { note: kind === 'listings' ? 'its listing is not imported' : 'its building is not imported' };
    const f = favs.get(sid) || { listings: [], titles: [] };
    if (!f[kind].includes(target)) f[kind].push(target);
    favs.set(sid, f);
    return { target: 'favourites', id: sid };
  };
  await fillIn('db_user_favourite_property', starred('listings', r => r.property_id));
  await fillIn('db_user_favourite_property_title', starred('titles', r => r.property_title_id));
  await w.insert('favourites', [...favs].map(([viewer_id, f]) => ({ viewer_id, listings: JSON.stringify(f.listings), titles: JSON.stringify(f.titles) })));

  // The website's "My Saved Listings" → saved_listings (the listings an agent keeps for their profile document).
  const saved = new Map();
  await fillIn('db_user_saved_property', r => {
    const sid = M.id(r.user_id), lid = M.id(r.property_id);
    if (!ids.staff.has(sid)) return { note: 'its person is not in the staff list' };
    if (!ids.listings?.has(lid)) return { note: 'its listing is not imported' };
    saved.set(`${sid}:${lid}`, { staff_id: sid, listing_id: lid, saved_at: String(r.created_at || '').replace('T', ' ').slice(0, 19) || null });
    return { target: 'saved_listings', id: `${sid}:${lid}` };
  });
  await w.insert('saved_listings', [...saved.values()].map(r => (r.saved_at && /^\d{4}-\d{2}-\d{2}/.test(r.saved_at) ? r : { staff_id: r.staff_id, listing_id: r.listing_id })));

  // 3. The latest notifications become notices (new ids: the old ones ran to 763,000);
  // older ones are left out (RECENT).
  if (present.includes('db_user_notification')) {
    const t = 'db_user_notification', from = await M.recentFrom(legacy, t);
    log(`${t} → notices, from ${from}`);
    const st = stat(t);
    let next = Number((await db('notices').max({ m: 'id' }).first())?.m || 0) + 1;
    if (from) {
      for await (const rows of pages(legacy, t, cols[t], q => q.where(M.RECENT[t].column, '>=', from))) {
        const out = [], fates = new Map();
        for (const r of rows) {
          ctx.notes = [];
          st.rows++;
          const res = M.notification(r, ctx);
          if (res.skip) {
            bump(st.kept, res.skip);
            fates.set(r, { note: res.skip });
          } else {
            out.push({ id: next++, ...res });
            bump(st.imported, 'notices');
            fates.set(r, { target: 'notices', id: next - 1, note: ctx.notes.join(' · ') });
          }
          for (const n of new Set(ctx.notes)) bump(st.notes, n);
        }
        await w.insert('notices', out);
        await keep(t, rows, r => fates.get(r));
      }
    }
    const [{ n }] = await legacy(t).count({ n: '*' });
    report.recent[t] = { from, left: Number(n) - st.rows };
  }

  // 4. The data log, into a table of its own (kept for good; not in legacy_rows).
  for (const [t, { into }] of Object.entries(M.LOGS)) {
    if (!present.includes(t)) continue;
    log(`${t} → ${into}`);
    const st = stat(t);
    for await (const rows of pages(legacy, t, cols[t])) {
      st.rows += rows.length;
      bump(st.imported, into, rows.length);
      await w.insert(into, rows.map(M.activity));
    }
  }

  // 5. Everything else: kept in history as it was.
  const done = new Set([...Object.keys(M.TABLES), ...Object.keys(M.AFTER), ...Object.keys(M.RECENT), ...Object.keys(M.LOGS)]);
  for (const t of present) {
    if (done.has(t) || M.NOT_COPIED[t]) continue;
    if (M.HELD_BACK[t] && !include.includes(t)) continue;
    const why = M.LOOKUPS[t] ? 'lookup: its names are copied onto the records'
      : M.HISTORY_ONLY[t] || (M.HELD_BACK[t] ? 'held back by default; kept on request (--include)' : null);
    if (!why) report.unknownTables.push(t);
    const note = why || 'not known to the import: decide where it goes (src/legacy/mapping.js)';
    log(`${t} → history`);
    const st = stat(t);
    for await (const rows of pages(legacy, t, cols[t])) {
      st.rows += rows.length;
      bump(st.kept, note, rows.length);
      await keep(t, rows, () => ({ note }));
    }
  }

  // 6. Totals and links worked out from what was imported.
  {
    // Each deal's closes in order: part 1, 2… (a full close after a partial one is a Balance Close), and their sides.
    const byDeal = new Map();
    for (const c of ctx.closes.values()) (byDeal.get(c.deal_id) || byDeal.set(c.deal_id, []).get(c.deal_id)).push(c);
    const closeUpdates = [], dealClosed = [];
    for (const [dealId, list] of byDeal) {
      list.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      list.forEach((c, i) => closeUpdates.push({ id: c.id, part_no: i + 1, sides: JSON.stringify(c.sides) }));
      if (ctx.deals.get(dealId)?.status === 'closed') dealClosed.push({ id: dealId, closed_on: list.at(-1).date });
    }
    await w.updateEach('closes', closeUpdates);
    await w.updateEach('deals', dealClosed);

    const archiveCount = new Map();
    for (const c of ctx.caseDeal.values()) if (c.archiveId) archiveCount.set(c.archiveId, (archiveCount.get(c.archiveId) || 0) + 1);
    await w.updateEach('archives', [...archiveCount].map(([id, count]) => ({ id, count })));

    // A listing's open E-Form (the latest draft, submitted or partly closed one).
    const open = new Map();
    for (const [dealId, d] of ctx.deals) if (d.listingId && ['draft', 'submitted', 'partial'].includes(d.status) && dealId > (open.get(d.listingId) || 0)) open.set(d.listingId, dealId);
    await w.updateEach('listings', [...open].map(([id, deal_id]) => ({ id, deal_id })));
    await w.updateEach('listings', Object.entries(ctx.counts.enquiries || {}).map(([id, n]) => ({ id: Number(id), enquiry_count: n })));
  }

  // New codes continue after the highest number the old ERP ever gave, deleted rows
  // included (its next AUTO_INCREMENT less one), so no code is ever handed out twice.
  const top = async (t, col = 'id') => Number((await db(t).max({ m: col }).first())?.m) || 0;
  const oldTop = async t => {
    if (!present.includes(t)) return 0;
    const [key] = keysOf(t) || [];
    const max = key ? Number((await legacy(t).max({ m: key }).first())?.m) || 0 : 0;
    const next = await legacy.transaction(async trx => {
      await trx.raw('set session information_schema_stats_expiry = 0');  // not the cached figure
      const [rows] = await trx.raw('select auto_increment as n from information_schema.tables where table_schema = database() and table_name = ?', [t]);
      return Number(rows[0]?.n ?? rows[0]?.AUTO_INCREMENT) || 0;
    });
    return Math.max(max, next - 1);
  };
  const counters = {
    staff: Math.max(await top('staff'), await oldTop('new_staff')), listing: Math.max(await top('listings'), await oldTop('db_property')),
    transaction: Math.max(await top('money_in'), await oldTop('db_trans')), case: Math.max(await top('payout_lines'), await oldTop('db_case_list')),
    salary: Math.max(await top('pay_requests'), await oldTop('db_salary')), archive: Math.max(await top('archives'), await oldTop('db_case_archieve_ver2')),
    request: Math.max(await top('money_out'), await oldTop('db_eforms_request')),
  };
  await db('counters').insert(Object.entries(counters).map(([key, value]) => ({ key, value })));

  // The fallback branch goes again if nothing ended up in it.
  const inHq = (await Promise.all(['staff', 'listings', 'deals', 'customers'].map(async t => Number((await db(t).where('branch_id', hq).count({ n: '*' }).first()).n)))).reduce((a, b) => a + b, 0);
  if (!inHq && report.branchesMade.includes(hq)) {
    await db('branches').where('id', hq).del();
    report.branchesMade = report.branchesMade.filter(b => b !== hq);
  }

  report.accountsUnlinked = await relinkAccounts(db, links);
  report.seconds = Math.round((Date.now() - started) / 1000);
  report.notCopied = M.NOT_COPIED;
  report.heldBack = Object.fromEntries(Object.entries(M.HELD_BACK).filter(([t]) => present.includes(t) && !include.includes(t)));
  report.secretColumns = M.SECRET_COLUMNS;
  report.present = present;
  return report;
}

module.exports = { importLegacy, RECORD_TABLES };

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
  const fs = require('fs');
  const { legacyDb } = require('./connection');
  const db = require('../db/connection');
  const args = process.argv.slice(2);
  const opt = name => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
  const legacy = legacyDb();
  (async () => {
    const report = await importLegacy({
      legacy, db, replace: args.includes('--replace'), force: args.includes('--force'), include: opt('--include'),
      log: line => console.log(`  ${line}`),
    });
    const result = await verify({ legacy, db, report });
    await db('settings').insert({ key: 'legacy_import', value: JSON.stringify({ at: new Date().toISOString(), ok: result.ok, problems: result.problems }), updated_at: db.fn.now() })
      .onConflict('key').merge();
    const [file] = opt('--out');
    if (file) fs.writeFileSync(file, result.markdown);
    console.log(`\n${result.summary}${file ? `\nReport: ${file}` : ''}`);
    if (!result.ok) process.exitCode = 1;
  })()
    .catch(err => { console.error(err.message); process.exitCode = 1; })
    .finally(() => Promise.all([legacy.destroy(), db.destroy()]));
}

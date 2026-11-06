// The whole ERP in the shape the demo store keeps it (src/demo/erpApi.js), read
// from the tables, and what one action changes in it written back.
//
// Stage one of moving the ERP onto the server: the pages still get the records
// at once (limited to each person: db/erpGuard.js), and the actions are
// shared/erpActions.js, run on what was read here. Before real data the pages
// move to the paged lists (routes/erp.js) and each action to loading only the
// records it touches (CLAUDE.md "Server rule"); saveChanges() stays as it is.
const { MODELS, toRecords, childRows, parseJson } = require('./records');
const { loadSetup } = require('./setupStore');
const { localToday } = require('./days');
const { erpBlockers } = require('../../../shared/erpRules.js');

// Parents before children, so every row a record points at is already there.
const KINDS = ['propertyTypes', 'staff', 'titles', 'areas', 'projects', 'listings', 'enquiries', 'vendorRequests', 'deals', 'customers',
  'moneyIn', 'archives', 'closes', 'requests', 'payouts', 'moneyOut', 'videos', 'viewings', 'notices', 'downtime'];
const RUNS_KEY = 'erp:runs';
// The order the demo store keeps them in (a few pages show them as they come); the rest by id.
const newest = col => [{ column: col, order: 'desc' }, 'id'];
const ORDER_BY = {
  enquiries: newest('date'), vendorRequests: newest('date'),
  // Newest first; of two at the same minute, the later one first (as a new notice goes on top).
  notices: [{ column: 'at', order: 'desc' }, { column: 'id', order: 'desc' }],
  customers: ['date', 'id'], moneyIn: ['date', 'id'], closes: ['date', 'id'], requests: ['date', 'id'], moneyOut: ['date', 'id'], viewings: ['code'],
};

// only: the kinds to read (the start-up read: a few small ones); the others come back empty.
async function loadState(q, { only = null } = {}) {
  const setup = await loadSetup(q);
  const blockers = erpBlockers(setup);
  if (blockers.length) return { setup, data: null, blockers };
  const data = { asOf: localToday() };
  const wanted = key => !only || only.includes(key);
  for (const key of KINDS) {
    const m = MODELS[key];
    data[key] = wanted(key) ? await toRecords(q, m, await q(m.table).orderBy(ORDER_BY[key] || 'id')) : [];
  }
  data.v1 = !wanted('v1') ? { eforms: [], overrides: [] } : {
    eforms: await toRecords(q, MODELS.v1Eforms, await q('v1_eforms').orderBy(newest('date'))),
    overrides: await toRecords(q, MODELS.v1Overrides, await q('v1_overrides').orderBy(['year', 'id'])),
  };
  // The E-Form update tracker, newest first (the demo unshifts new entries).
  data.audit = !wanted('audit') ? [] : (await q('audit_log').where('entity', 'deal').orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }]))
    .map(r => ({ at: String(r.created_at).replace('T', ' ').slice(0, 16), by: r.username, dealId: Number(r.entity_id), ...parseJson(r.detail) }));
  data.favourites = Object.fromEntries((await q('favourites')).map(f => [f.viewer_id, { listings: parseJson(f.listings) || [], titles: parseJson(f.titles) || [] }]));
  const runs = await q('settings').where('key', RUNS_KEY).first();
  data.runs = runs ? parseJson(runs.value) : {};
  return { setup, data, blockers };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (m, r) => Object.fromEntries(Object.entries(r).filter(([k]) => !m.children[k]));

// Notifications are never deleted here: a browser keeps only the latest, the table keeps them
// until they expire (db/notices.js, once a day).
const KEPT = new Set(['notices']);

// Writes what changed between `before` and `after` (both in the demo's shape):
// new records, then changed ones, then removed ones (children first). `by`: the
// signed-in person's username, written on new E-Form history entries.
async function saveChanges(trx, before, after, { by } = {}) {
  const plan = KINDS.map(key => {
    const m = MODELS[key];
    const was = new Map((before[key] || []).map(r => [r.id, r]));
    const now = new Map((after[key] || []).map(r => [r.id, r]));
    return {
      key, m,
      added: [...now.values()].filter(r => !was.has(r.id)),
      changed: [...now.values()].filter(r => was.has(r.id) && !same(r, was.get(r.id))).map(r => [was.get(r.id), r]),
      removed: KEPT.has(key) ? [] : [...was.keys()].filter(id => !now.has(id)),
    };
  });
  for (const { key, m, added } of plan) {
    if (!added.length) continue;
    // A new person's upline may be another new person: link them once both are in.
    await trx(m.table).insert(added.map(r => m.toRow(key === 'staff' ? { ...r, uplineId: null } : r, { full: true })));
    if (key === 'staff') for (const s of added.filter(x => x.uplineId != null)) await trx('staff').where('id', s.id).update({ upline_id: s.uplineId });
    for (const k of added.flatMap(r => childRows(m, r))) await trx(k.table).insert(k.row);
  }
  for (const { m, changed } of plan) {
    for (const [was, r] of changed) {
      if (!same(own(m, was), own(m, r))) await trx(m.table).where('id', r.id).update(m.toRow(r, { full: true }));
      for (const [key, c] of Object.entries(m.children)) {
        if (same(was[key] || [], r[key] || [])) continue;
        await trx(c.table).where(c.fk, r.id).del();
        for (const k of childRows({ children: { [key]: c }, name: m.name }, r)) await trx(k.table).insert(k.row);
      }
    }
  }
  for (const { m, removed } of [...plan].reverse()) {
    if (!removed.length) continue;
    for (const c of Object.values(m.children)) await trx(c.table).whereIn(c.fk, removed).del();
    await trx(m.table).whereIn('id', removed).del();
  }

  // New E-Form history entries are at the front; they name whoever is signed in.
  const fresh = (after.audit || []).slice(0, Math.max(0, (after.audit || []).length - (before.audit || []).length));
  if (by) for (const a of fresh) a.by = by;
  if (fresh.length) {
    await trx('audit_log').insert([...fresh].reverse().map(a => ({
      created_at: a.at, username: a.by, action: 'update', entity: 'deal', entity_id: String(a.dealId),
      detail: JSON.stringify({ field: a.field, before: a.before, after: a.after }),
    })));
  }
  const favs = after.favourites || {};
  for (const [viewer, f] of Object.entries(favs)) {
    if (same(f, before.favourites?.[viewer])) continue;
    const row = { listings: JSON.stringify(f.listings || []), titles: JSON.stringify(f.titles || []) };
    if (before.favourites?.[viewer]) await trx('favourites').where('viewer_id', Number(viewer)).update(row);
    else await trx('favourites').insert({ viewer_id: Number(viewer), ...row });
  }
  if (!same(after.runs || {}, before.runs || {})) {
    await trx('settings').insert({ key: RUNS_KEY, value: JSON.stringify(after.runs || {}), updated_at: trx.fn.now() }).onConflict('key').merge();
  }
}

module.exports = { loadState, saveChanges, KINDS };

// The browser demo's sample, in the database: the sample Setup
// (shared/setupState.js sampleState) and the ERP records the demo makes from it
// (src/demo/erpSample.js), with the same ids, so server mode shows what the
// demo shows. Replaces every ERP record: demos and tests only.
const db = require('./connection');
const S = require('../../../shared/setupState.js');
const { makeErpSample } = require('../../../src/demo/erpSample.js');
const { seedProjects } = require('../../../src/demo/projectsApi.js');
const { MODELS, childRows } = require('./records');
const { replaceState } = require('./setupStore');
const { localToday } = require('./days');

// Parents before children, so every row a record points at is already there.
const ORDER = ['propertyTypes', 'staff', 'titles', 'areas', 'projects', 'listings', 'enquiries', 'vendorRequests', 'deals', 'customers',
  'moneyIn', 'archives', 'closes', 'requests', 'payouts', 'moneyOut', 'videos', 'v1Eforms', 'v1Overrides', 'viewings', 'notices', 'downtime'];
const CHILD_TABLES = ['listing_follow_ups', 'customer_follow_ups', 'staff_marketing'];

async function insertAll(trx, table, rows) {
  for (let i = 0; i < rows.length; i += 200) await trx(table).insert(rows.slice(i, i + 200));
}

async function seedDemo({ asOf = localToday() } = {}) {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to load demo data with NODE_ENV=production.');
  await db.transaction(async trx => {
    await trx('users').update({ staff_id: null });
    for (const t of CHILD_TABLES) await trx(t).del();
    await trx('audit_log').where('entity', 'deal').del();
    for (const key of [...ORDER].reverse()) await trx(MODELS[key].table).del();
    await trx('favourites').del();
    await trx('settings').where('key', 'erp:runs').del();
    await trx('counters').del();
  });

  const setup = await replaceState(S.sampleState());
  const data = makeErpSample(setup, asOf);
  data.v1Eforms = data.v1.eforms;
  data.v1Overrides = data.v1.overrides;
  // The demo keeps projects in a store of their own, made the same way from the project E-Forms.
  data.projects = seedProjects(data.deals, setup, asOf);

  await db.transaction(async trx => {
    for (const key of ORDER) {
      const m = MODELS[key];
      const records = data[key] || [];
      // Uplines point at other staff rows: insert without them, then fill them in.
      const rows = records.map(r => m.toRow(key === 'staff' ? { ...r, uplineId: null } : r, { strict: true, full: true }));
      await insertAll(trx, m.table, rows);
      if (key === 'staff') for (const s of records.filter(x => x.uplineId != null)) await trx('staff').where('id', s.id).update({ upline_id: s.uplineId });
      const kids = records.flatMap(r => childRows(m, r, { strict: true }));
      for (const t of new Set(kids.map(k => k.table))) await insertAll(trx, t, kids.filter(k => k.table === t).map(k => k.row));
    }
    // The E-Form update tracker lives in the audit log, oldest first (it reads back newest first).
    await insertAll(trx, 'audit_log', [...data.audit].reverse().map(a => ({
      created_at: a.at, username: a.by, action: 'update', entity: 'deal', entity_id: String(a.dealId),
      detail: JSON.stringify({ field: a.field, before: a.before, after: a.after }),
    })));
    await insertAll(trx, 'favourites', Object.entries(data.favourites || {}).map(([viewer, f]) => ({
      viewer_id: Number(viewer), listings: JSON.stringify(f.listings || []), titles: JSON.stringify(f.titles || []),
    })));
  });
  return { setup, data };
}

module.exports = { seedDemo, ORDER };

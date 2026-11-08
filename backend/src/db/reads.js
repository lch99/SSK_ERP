// Reading the ERP's records as a viewer may see them: one record, and a list's
// rows after its own step (the Whole agency hides owners) and its reader (another
// area's view with private parts taken out). routes/erp.js and the old phone
// app's addresses (appV1/) read through these.
const db = require('./connection');
const AC = require('../../../shared/access.js');
const { trimmed } = require('../../../shared/lists.js');
const { scopeFor } = require('./lists');
const { extrasFor } = require('./list');
const { toRecords } = require('./records');

// One record in the viewer's reach, with its list's extras; null when there is none.
async function oneRecord(spec, viewer, id) {
  const b = db(spec.table).where(`${spec.table}.id`, id);
  scopeFor(spec, viewer)(b);
  const row = await b.select(`${spec.table}.*`).first();
  if (!row) return null;
  const [rec] = await toRecords(db, spec.model, [row]);
  if (spec.extras) rec.$ = (await extrasFor(db, spec.extras, [rec])).get(rec.id);
  return rec;
}

// A list's own area may read it, and so may its `readers` (shared/lists.js), each
// record with what that reader may not see taken out. A list that names its `fields` sends only those.
const asReader = (spec, v) => {
  const strip = spec.area == null || AC.allows(v.policy, v.role, spec.area, 'view') ? r => r
    : Object.entries(spec.readers).find(([area]) => AC.allows(v.policy, v.role, area, 'view'))?.[1] || (r => r);
  return r => trimmed(spec, strip(r));
};

// A list's rows as the viewer may see them: its `rows` step, then its reader.
const shown = async (spec, v, rows) => (spec.rows ? await spec.rows(db, rows, v) : rows).map(asReader(spec, v));

// The query, with the viewer's own key in the filters that take it (their favourites, their unread).
const paramsOf = (spec, v, query) => {
  const p = { ...query };
  for (const k of spec.viewerFilters) if (p[k] !== undefined && p[k] !== '') p[k] = String(v.staffId ?? 0);
  return p;
};

module.exports = { oneRecord, asReader, shown, paramsOf };

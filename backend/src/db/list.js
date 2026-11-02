// One page of a list, worked out by the database: search, filters, sort and
// page, plus the total, the counts the page shows as filter chips and each
// row's extras from other records ({ rows, total, counts, page, size }). Never
// the whole table. The lists are described once in shared/lists.js; lists.js
// turns each description into the spec this runs:
//
// spec: {
//   table, model,                      — the table and its records.js model
//   search: [column | { via, table, cols }],   — every word typed must match one of them (or of the record it points at)
//   filters: { key: { apply(query, value, prepared), prepare?(q, value) } },
//   sorts: { key: column }, sort: '-date',        — '-' = newest / biggest first
//   counts: { key: { col } | { set } | { only, sum, distinct? } | { only, custom } },   (see shared/lists.js)
//   extras: [{ key, … }],              — worked out for the page's rows only
// }
const { toRecords } = require('./records');
const { DEFAULT_SIZE, MAX_SIZE, countsWanted } = require('../../../shared/lists.js');
const { localToday } = require('./days');

// '!' escapes % and _ in what was typed: a backslash means different things in MySQL and SQLite.
const escapeLike = s => s.replace(/[!%_]/g, c => `!${c}`);

// Raw query results: MySQL gives [rows, fields], SQLite the rows.
const rawRows = r => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r);
const r2 = n => Math.round(n * 100) / 100;
const get = (r, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), r);

// Everyone at or under `staffId` in the upline chart (themselves included).
async function teamIds(q, staffId) {
  if (staffId == null) return [];
  const rows = await q.raw(
    'with recursive team(id) as (select id from staff where id = ? union select s.id from staff s join team t on s.upline_id = t.id) select id from team',
    [staffId]);
  return rawRows(rows).map(r => r.id);
}

function parseSort(param, spec) {
  const wanted = String(param || spec.sort || '').split(',').filter(Boolean);
  const out = [];
  for (const w of wanted) {
    const desc = w.startsWith('-');
    const col = spec.sorts?.[desc ? w.slice(1) : w];
    if (col) out.push({ column: col, order: desc ? 'desc' : 'asc' });
  }
  if (!out.length && spec.sort) return parseSort(spec.sort, { ...spec, sort: null });
  // Same order every time, so pages never repeat or skip a row.
  out.push({ column: `${spec.table}.id`, order: out[0]?.order || 'desc' });
  return out;
}

// The page's rows' extras: Map(id → { key: value }). A `from` starting with '$.'
// reads an extra worked out before it (defs keep their order).
async function extrasFor(q, defs, records) {
  const out = new Map(records.map(r => [r.id, {}]));
  const ids = records.map(r => r.id);
  for (const e of defs) {
    if (e.from) {
      const at = r => get({ ...r, $: out.get(r.id) }, e.from);
      const want = [...new Set(records.map(at).filter(x => x != null))];
      let found;
      if (e.picks) {
        const linked = want.length ? await q(e.table).whereIn('id', want).select('id', ...e.picks.map(p => p.col)) : [];
        found = new Map(linked.map(x => [x.id, Object.fromEntries(e.picks.map(p => [p.path, p.kind.read(x[p.col]) ?? null]))]));
      } else found = new Map(want.length ? (await q(e.table).whereIn('id', want).select('id', { v: e.fieldCol })).map(x => [x.id, x.v]) : []);
      for (const r of records) out.get(r.id)[e.key] = found.get(at(r)) ?? null;
      continue;
    }
    // null in a value list: empty. Booleans as the tables keep them (0 / 1).
    const values = vals => vals.filter(x => x !== null).map(x => (typeof x === 'boolean' ? Number(x) : x));
    const linked = b => {
      b.whereIn(e.byCol, ids);
      for (const [col, vals] of e.where) {
        b.where(x => { if (values(vals).length) x.orWhereIn(col, values(vals)); if (vals.includes(null)) x.orWhereNull(col); });
      }
      for (const [col, vals] of e.not) {
        b.where(x => {
          if (vals.includes(null)) x.whereNotNull(col).whereNotIn(col, values(vals));
          else x.whereNull(col).orWhereNotIn(col, values(vals));
        });
      }
      return b;
    };
    if (e.sumCol || e.count) {
      const by = linked(q(e.table)).select({ k: e.byCol }).groupBy(e.byCol);
      if (e.count) by.count({ s: '*' }); else by.sum({ s: e.sumCol });
      const sums = new Map(ids.length ? (await by).map(x => [Number(x.k), Number(x.s)]) : []);
      for (const r of records) out.get(r.id)[e.key] = e.count ? sums.get(r.id) || 0 : r2(sums.get(r.id) || 0);
    } else {
      const rows = ids.length ? await toRecords(q, e.model, await linked(q(e.table)).orderBy('id')) : [];
      for (const r of records) {
        out.get(r.id)[e.key] = rows.filter(x => get(x, e.by) === r.id).map(x => Object.fromEntries(e.pick.map(f => [f, get(x, f) ?? null])));
      }
    }
  }
  return out;
}

// The search, filters and reach of one request, as a where clause: where(query,
// filters to leave out, filters to set instead) (the counts use the last two).
async function whereOf(q, spec, params, scope) {
  const words = String(params.q || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  const active = Object.entries(spec.filters || {}).filter(([k]) => params[k] !== undefined && params[k] !== '');
  // Teams, Setup and the like are worked out once, before the query.
  const prepared = {};
  const prepare = async (k, v) => (spec.filters[k].prepare ? spec.filters[k].prepare(q, v) : null);
  for (const [k] of active) prepared[k] = await prepare(k, params[k]);
  const like = (x, c, w) => x.orWhereRaw("?? like ? escape '!'", [c, w]);

  const where = (b, except = [], set = null) => {
    scope(b);
    for (const w of words) {
      const pattern = `%${escapeLike(w)}%`;
      b.where(x => {
        for (const c of spec.search || []) {
          if (typeof c === 'string') like(x, c, pattern);
          else x.orWhereIn(c.via, sub => sub.select(`${c.table}.id`).from(c.table).where(y => { for (const col of c.cols) like(y, col, pattern); }));
        }
      });
    }
    for (const [k, f] of active) if (!except.includes(k) && !(set && k in set)) f.apply(b, params[k], prepared[k]);
    for (const [k, [v, p]] of Object.entries(set || {})) spec.filters[k].apply(b, v, p);
    return b;
  };
  const prepareSet = async set => Object.fromEntries(await Promise.all(Object.entries(set).map(async ([k, v]) => [k, [v, await prepare(k, v)]])));
  return { where, active, prepareSet };
}

// ctx: { today } (what dated counts are worked out from; today by default).
async function listPage(q, spec, params = {}, scope = () => {}, given = {}) {
  const ctx = { today: localToday(), ...given };
  const { where, active, prepareSet } = await whereOf(q, spec, params, scope);

  const size = Math.min(MAX_SIZE, Math.max(1, Number.parseInt(params.size, 10) || DEFAULT_SIZE));
  const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
  const { n } = await where(q(spec.table)).count({ n: '*' }).first();
  const rows = await where(q(spec.table)).select(`${spec.table}.*`).orderBy(parseSort(params.sort, spec)).limit(size).offset((page - 1) * size);

  // counts=0: a later page (the first one had the counts).
  const counts = {};
  for (const [key, c] of countsWanted(spec, params)) {
    if (c.col) {
      const got = await where(q(spec.table), [key]).select({ v: c.col }).count({ n: '*' }).groupBy(c.col);
      counts[key] = Object.fromEntries(got.map(r => [r.v ?? '', Number(r.n)]));
    } else if (c.only) {
      const b = q(spec.table);
      scope(b);
      // Its own filters, and of the page's only those it keeps (the chosen branch).
      const kept = Object.fromEntries(active.filter(([k]) => c.keep.includes(k)).map(([k]) => [k, params[k]]));
      for (const [k, [v, p]] of Object.entries(await prepareSet({ ...kept, ...c.only(ctx) }))) spec.filters[k].apply(b, v, p);
      if (c.custom) { counts[key] = await c.custom(q, b, ctx); continue; }
      if (c.distinct) b.countDistinct({ d: c.distinct });
      const r = await b.count({ n: '*' }).sum({ s: c.sum }).first();
      counts[key] = { n: Number(r.n), sum: r2(Number(r.s) || 0), ...(c.distinct && { distinct: Number(r.d) }) };
    } else {
      const set = await prepareSet(typeof c.set === 'function' ? c.set(ctx) : c.set);
      counts[key] = Number((await where(q(spec.table), c.ignores || [], set).count({ n: '*' }).first()).n);
    }
  }

  const records = await toRecords(q, spec.model, rows);
  if (spec.extras) {
    const ex = await extrasFor(q, spec.extras, records);
    for (const r of records) r.$ = ex.get(r.id);
  }
  return { rows: records, total: Number(n), counts, page, size };
}

// Every matching record, sorted, with its extras (an Excel download), read in
// chunks. Refused above `max` rows: the person narrows the filters instead.
const CHUNK = 1000;
async function listAll(q, spec, params = {}, scope = () => {}, { max = 50000 } = {}) {
  const { where } = await whereOf(q, spec, params, scope);
  const { n } = await where(q(spec.table)).count({ n: '*' }).first();
  if (Number(n) > max) {
    throw Object.assign(new Error(`That is ${Number(n).toLocaleString('en-MY')} rows. Narrow the search or filters to ${max.toLocaleString('en-MY')} or fewer and download again.`), { status: 400 });
  }
  const order = parseSort(params.sort, spec);
  const out = [];
  for (let at = 0; at < Number(n); at += CHUNK) {
    const records = await toRecords(q, spec.model, await where(q(spec.table)).select(`${spec.table}.*`).orderBy(order).limit(CHUNK).offset(at));
    if (spec.extras) {
      const ex = await extrasFor(q, spec.extras, records);
      for (const r of records) r.$ = ex.get(r.id);
    }
    out.push(...records);
  }
  return { rows: out, total: Number(n) };
}

module.exports = { listPage, listAll, extrasFor, rawRows, escapeLike, teamIds };

// One page of a list, worked out by the database: search, filters, sort and
// page, plus the total, the counts the page shows as filter chips and each
// row's extras from other records ({ rows, total, counts, page, size }). Never
// the whole table. The lists are described once in shared/lists.js; lists.js
// turns each description into the spec this runs:
//
// spec: {
//   table, model,                      — the table and its records.js model
//   search: [columns],                 — every word typed must match one of them
//   filters: { key: { apply(query, value, prepared), prepare?(q, value) } },
//   sorts: { key: column }, sort: '-date',        — '-' = newest / biggest first
//   counts: { key: { col } | { set } | { only, sum } },   (see shared/lists.js)
//   extras: [{ key, … }],              — worked out for the page's rows only
// }
const { toRecords } = require('./records');
const { DEFAULT_SIZE, MAX_SIZE } = require('../../../shared/lists.js');
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

// The page's rows' extras: Map(id → { key: value }).
async function extrasFor(q, defs, records) {
  const out = new Map(records.map(r => [r.id, {}]));
  const ids = records.map(r => r.id);
  for (const e of defs) {
    if (e.from) {
      const want = [...new Set(records.map(r => get(r, e.from)).filter(x => x != null))];
      const found = new Map(want.length ? (await q(e.table).whereIn('id', want).select('id', { v: e.fieldCol })).map(x => [x.id, x.v]) : []);
      for (const r of records) out.get(r.id)[e.key] = found.get(get(r, e.from)) ?? null;
      continue;
    }
    const linked = b => {
      b.whereIn(e.byCol, ids);
      for (const [col, vals] of e.where) b.whereIn(col, vals);
      for (const [col, vals] of e.not) b.whereNotIn(col, vals);
      return b;
    };
    if (e.sumCol) {
      const sums = new Map(ids.length ? (await linked(q(e.table)).select({ k: e.byCol }).sum({ s: e.sumCol }).groupBy(e.byCol)).map(x => [Number(x.k), Number(x.s)]) : []);
      for (const r of records) out.get(r.id)[e.key] = r2(sums.get(r.id) || 0);
    } else {
      const rows = ids.length ? await toRecords(q, e.model, await linked(q(e.table)).orderBy('id')) : [];
      for (const r of records) {
        out.get(r.id)[e.key] = rows.filter(x => get(x, e.by) === r.id).map(x => Object.fromEntries(e.pick.map(f => [f, get(x, f) ?? null])));
      }
    }
  }
  return out;
}

// ctx: { today } (what dated counts are worked out from; today by default).
async function listPage(q, spec, params = {}, scope = () => {}, given = {}) {
  const ctx = { today: localToday(), ...given };
  const words = String(params.q || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  const active = Object.entries(spec.filters || {}).filter(([k]) => params[k] !== undefined && params[k] !== '');
  // Teams, Setup and the like are worked out once, before the query.
  const prepared = {};
  const prepare = async (k, v) => (spec.filters[k].prepare ? spec.filters[k].prepare(q, v) : null);
  for (const [k] of active) prepared[k] = await prepare(k, params[k]);

  const where = (b, except = [], set = null) => {
    scope(b);
    for (const w of words) {
      const like = `%${escapeLike(w)}%`;
      b.where(x => { for (const c of spec.search || []) x.orWhereRaw("?? like ? escape '!'", [c, like]); });
    }
    for (const [k, f] of active) if (!except.includes(k) && !(set && k in set)) f.apply(b, params[k], prepared[k]);
    for (const [k, [v, p]] of Object.entries(set || {})) spec.filters[k].apply(b, v, p);
    return b;
  };
  const prepareSet = async set => Object.fromEntries(await Promise.all(Object.entries(set).map(async ([k, v]) => [k, [v, await prepare(k, v)]])));

  const size = Math.min(MAX_SIZE, Math.max(1, Number.parseInt(params.size, 10) || DEFAULT_SIZE));
  const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
  const { n } = await where(q(spec.table)).count({ n: '*' }).first();
  const rows = await where(q(spec.table)).select(`${spec.table}.*`).orderBy(parseSort(params.sort, spec)).limit(size).offset((page - 1) * size);

  const counts = {};
  for (const [key, c] of Object.entries(spec.counts || {})) {
    if (c.col) {
      const got = await where(q(spec.table), [key]).select({ v: c.col }).count({ n: '*' }).groupBy(c.col);
      counts[key] = Object.fromEntries(got.map(r => [r.v ?? '', Number(r.n)]));
    } else if (c.only) {
      const b = q(spec.table);
      scope(b);
      for (const [k, [v, p]] of Object.entries(await prepareSet(c.only(ctx)))) spec.filters[k].apply(b, v, p);
      const r = await b.count({ n: '*' }).sum({ s: c.sum }).first();
      counts[key] = { n: Number(r.n), sum: r2(Number(r.s) || 0) };
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

module.exports = { listPage, rawRows, escapeLike, teamIds };

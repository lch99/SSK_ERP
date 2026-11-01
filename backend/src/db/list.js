// One page of a list, worked out by the database: search, filters, sort and
// page, plus the total and the counts the page shows as filter chips
// ({ rows, total, counts, page, size }). Never the whole table.
//
// spec: {
//   table, model,                 — the table and its records.js model
//   search: [columns],            — every word typed must match one of them
//   filters: { key: fn(query, value, params) },
//   sorts: { key: column }, sort: '-date',   — '-' = newest / biggest first
//   counts: { key: 'column' | { where: fn(query), ignores: [filter keys] } },
// }
// A count by column ({ status: { draft: 3, … } }) leaves out the filter of the
// same name, so each chip says how many picking it would give.
const { toRecords } = require('./records');

const DEFAULT_SIZE = 50;
const MAX_SIZE = 200;

// '!' escapes % and _ in what was typed: a backslash means different things in MySQL and SQLite.
const escapeLike = s => s.replace(/[!%_]/g, c => `!${c}`);

// Raw query results: MySQL gives [rows, fields], SQLite the rows.
const rawRows = r => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r);

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

async function listPage(q, spec, params = {}, scope = () => {}) {
  const words = String(params.q || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  const active = Object.entries(spec.filters || {}).filter(([k]) => params[k] !== undefined && params[k] !== '');
  const where = (b, except = []) => {
    scope(b);
    for (const w of words) {
      const like = `%${escapeLike(w)}%`;
      b.where(x => { for (const c of spec.search || []) x.orWhereRaw("?? like ? escape '!'", [c, like]); });
    }
    for (const [k, f] of active) if (!except.includes(k)) f(b, params[k], params);
    return b;
  };

  const size = Math.min(MAX_SIZE, Math.max(1, Number.parseInt(params.size, 10) || DEFAULT_SIZE));
  const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
  const { n } = await where(q(spec.table)).count({ n: '*' }).first();
  const rows = await where(q(spec.table)).select(`${spec.table}.*`).orderBy(parseSort(params.sort, spec)).limit(size).offset((page - 1) * size);

  const counts = {};
  for (const [key, c] of Object.entries(spec.counts || {})) {
    if (typeof c === 'string') {
      const got = await where(q(spec.table), [key]).select({ v: c }).count({ n: '*' }).groupBy(c);
      counts[key] = Object.fromEntries(got.map(r => [r.v ?? '', Number(r.n)]));
    } else {
      const b = where(q(spec.table), c.ignores || []);
      c.where(b);
      counts[key] = Number((await b.count({ n: '*' }).first()).n);
    }
  }
  return { rows: await toRecords(q, spec.model, rows), total: Number(n), counts, page, size };
}

// ── Filter helpers ───────────────────────────────────────────────────────────
const list = v => String(v).split(',').map(s => s.trim()).filter(Boolean);
const val = s => (s === 'none' ? null : /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s);
// One value, or several separated by commas; 'none' matches an empty column.
const eq = col => (b, v) => {
  const vals = list(v).map(val);
  const set = vals.filter(x => x !== null);
  b.where(x => {
    if (set.length) x.whereIn(col, set);
    if (set.length < vals.length) x.orWhereNull(col);
  });
};
const from = col => (b, v) => b.where(col, '>=', v);
const to = col => (b, v) => b.where(col, '<=', v);
const yes = col => (b, v) => b.where(col, v === 'true' || v === '1' ? 1 : 0);

module.exports = { listPage, rawRows, escapeLike, eq, from, to, yes, DEFAULT_SIZE, MAX_SIZE };

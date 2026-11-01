// /api/erp — the ERP's records, read a page at a time (the server rule in
// CLAUDE.md: never whole tables). Each list and record is limited to what the
// viewer's role may see (shared/access.js) and comes back in the demo's shapes.
//   GET /meta                     the Setup view the pages pay by, and who is asking
//   GET /org/children?of=&branchId=&page=   one level of the org chart, with team sizes
//   GET /org/trail/:id            the uplines above someone, top first
//   GET /deals/:id/history        the E-Form update tracker for one E-Form
//   GET /:list?q=&sort=&page=&size=&<filters>   { rows, total, counts, page, size }
//   GET /:list/:id                one record
// Stage one (db/erpState.js), until the pages move to the lists above:
//   GET /state                    every record, as the demo store gives them (after the time rules)
//   POST /actions/:name {args}    one of the demo's actions (shared/access.js ACTIONS), saved; then /state
const express = require('express');
const db = require('../db/connection');
const AC = require('../../../shared/access.js');
const erp = require('../../../src/demo/erpApi.js');
const { requireAuth } = require('../middleware/auth');
const { viewerOf, needs, teamIds } = require('../middleware/access');
const { LISTS, scopeFor } = require('../db/lists');
const { listPage, rawRows } = require('../db/list');
const { MODELS, toRecords, KINDS, parseJson } = require('../db/records');
const { loadSetup } = require('../db/setupStore');
const { loadState, saveChanges } = require('../db/erpState');

const router = express.Router();
router.use(requireAuth);

const wrap = fn => (req, res, next) => fn(req, res).catch(next);
const notFound = res => res.status(404).json({ error: 'Not found, or not yours to see.' });
const idOf = v => (/^\d+$/.test(String(v)) ? Number(v) : null);
const placeholders = ids => ids.map(() => '?').join(', ');

// ── Stage one: every record, and the demo's own actions ─────────────────────
// One change at a time, so two saves never hand out the same new id or code.
let queue = Promise.resolve();
const oneAtATime = fn => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };
// Reads every record in one transaction, lets `change` alter them (false: nothing
// to save) and saves the difference.
const changeState = change => oneAtATime(() => db.transaction(async trx => {
  const state = await loadState(trx);
  const before = structuredClone(state.data);
  if ((await change(state)) !== false && state.data) await saveChanges(trx, before, state.data);
  return state;
}));

router.get('/state', wrap(async (req, res) => {
  res.json(await changeState(state => (state.data ? erp.clockOn(state) : false)));
}));

// Actions that name who is doing them: someone signed in as a staff record always acts as themselves.
const ACTOR_ARG = { claimPay: 0, stackPay: 0, readNotices: 1, toggleFavourite: 2, confirmViewing: 1, cancelViewing: 2, addViewingRemark: 2, revealOwner: 1 };

router.post('/actions/:name', wrap(async (req, res) => {
  const { name } = req.params;
  if (!Object.hasOwn(AC.ACTIONS, name) || typeof erp[name] !== 'function') return notFound(res);
  const v = await viewerOf(req);
  const why = AC.refusal(v.policy, v.role, name);
  if (why) return res.status(403).json({ error: why, errors: [why] });
  const args = Array.isArray(req.body?.args) ? [...req.body.args] : [];
  if (Object.hasOwn(ACTOR_ARG, name) && v.staffId != null) args[ACTOR_ARG[name]] = v.staffId;
  let refused = null;
  await changeState(async state => {
    try {
      await erp.runOn(state, () => erp[name](...args));
    } catch (err) {
      if (err.status !== 400) throw err;
      refused = err;
      return false;
    }
  });
  if (refused) return res.status(400).json({ error: refused.message, errors: refused.errors || [refused.message] });
  // Read back from the tables, so the page shows what was saved.
  res.json(await loadState(db));
}));

router.get('/meta', wrap(async (req, res) => {
  const v = await viewerOf(req);
  res.json({ setup: await loadSetup(), viewer: { role: v.role, scope: v.scope, staffId: v.staffId, branchId: v.branchId } });
}));

// ── Org chart ───────────────────────────────────────────────────────────────
// Senior upline levels first (Setup lists levels junior first), then by name.
const byRank = (b, roles) => {
  const senior = [...roles].reverse().map(r => r.code);
  if (senior.length) b.orderByRaw(`case ${senior.map(() => 'when position = ? then ?').join(' ')} else ? end`, [...senior.flatMap((c, i) => [c, i]), senior.length]);
  return b.orderBy([{ column: 'name' }, { column: 'id' }]);
};

// Everyone under each of `ids` (not counting them), in one query.
async function teamSizes(ids) {
  if (!ids.length) return new Map();
  const rows = rawRows(await db.raw(
    `with recursive sub(root, id) as (select id, id from staff where id in (${placeholders(ids)}) union select sub.root, s.id from staff s join sub on s.upline_id = sub.id)
     select root, count(*) - 1 as team from sub group by root`, ids));
  return new Map(rows.map(r => [Number(r.root), Number(r.team)]));
}

router.get('/org/children', needs('staff'), wrap(async (req, res) => {
  const v = await viewerOf(req);
  const spec = LISTS.staff;
  const scope = scopeFor(spec, v);
  const of = idOf(req.query.of);
  const size = Math.min(100, Math.max(1, Number.parseInt(req.query.size, 10) || 20));
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const level = () => {
    const b = db('staff').whereIn('type', ['staff', 'sale-staff']);
    scope(b);
    if (of != null) b.where('upline_id', of);
    // The top: no upline, or one the viewer can't see (an agent's own place in the chart).
    else b.where(x => x.whereNull('upline_id').orWhereNotIn('upline_id', sub => { sub.select('id').from('staff'); scope(sub); }));
    if (req.query.branchId) b.where('branch_id', idOf(req.query.branchId));
    return b;
  };
  const { n } = await level().count({ n: '*' }).first();
  const { roles = [] } = await loadSetup();
  const rows = await byRank(level().select('staff.*'), roles).limit(size).offset((page - 1) * size);
  const ids = rows.map(r => r.id);
  const team = await teamSizes(ids);
  const direct = new Map(ids.length ? (await db('staff').whereIn('upline_id', ids).select('upline_id').count({ n: '*' }).groupBy('upline_id'))
    .map(r => [r.upline_id, Number(r.n)]) : []);
  const people = (await toRecords(db, MODELS.staff, rows)).map(p => ({ ...p, team: team.get(p.id) || 0, direct: direct.get(p.id) || 0 }));
  res.json({ rows: people, total: Number(n), page, size });
}));

router.get('/org/trail/:id', needs('staff'), wrap(async (req, res) => {
  const v = await viewerOf(req);
  const id = idOf(req.params.id);
  const ups = rawRows(await db.raw(
    `with recursive up(id, depth) as (select upline_id, 1 from staff where id = ? union select s.upline_id, up.depth + 1 from staff s join up on s.id = up.id where up.depth < 50)
     select id, depth from up where id is not null`, [id]));
  const depth = new Map(ups.map(r => [Number(r.id), Number(r.depth)]));
  const b = db('staff').whereIn('id', [...depth.keys()]);
  scopeFor(LISTS.staff, v)(b);
  const rows = (await b).sort((x, y) => depth.get(y.id) - depth.get(x.id));
  res.json({ rows: await toRecords(db, MODELS.staff, rows) });
}));

// ── One record, a list, an E-Form's history ─────────────────────────────────
async function oneRecord(spec, viewer, id) {
  const b = db(spec.table).where(`${spec.table}.id`, id);
  scopeFor(spec, viewer)(b);
  const row = await b.select(`${spec.table}.*`).first();
  return row ? (await toRecords(db, spec.model, [row]))[0] : null;
}

router.get('/deals/:id/history', needs('deals'), wrap(async (req, res) => {
  const v = await viewerOf(req);
  const id = idOf(req.params.id);
  if (id == null || !(await oneRecord(LISTS.deals, v, id))) return notFound(res);
  const rows = await db('audit_log').where({ entity: 'deal', entity_id: String(id) }).orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }]).limit(500);
  res.json({ rows: rows.map(r => ({ at: KINDS.at.read(r.created_at), by: r.username, dealId: id, ...parseJson(r.detail) })) });
}));

const listOf = (req, res) => {
  const spec = Object.hasOwn(LISTS, req.params.list) ? LISTS[req.params.list] : null;
  if (!spec) notFound(res);
  return spec;
};

router.get('/:list', wrap(async (req, res, next) => {
  const spec = listOf(req, res);
  if (!spec) return;
  needs(spec.area)(req, res, async () => {
    try {
      const v = await viewerOf(req);
      const params = { ...req.query };
      if (req.params.list === 'staff' && idOf(params.teamOf) != null) params.teamIds = await teamIds(db, idOf(params.teamOf));
      res.json(await listPage(db, spec, params, scopeFor(spec, v)));
    } catch (err) { next(err); }
  });
}));

router.get('/:list/:id', wrap(async (req, res, next) => {
  const spec = listOf(req, res);
  if (!spec) return;
  needs(spec.area)(req, res, async () => {
    try {
      const id = idOf(req.params.id);
      const rec = id == null ? null : await oneRecord(spec, await viewerOf(req), id);
      return rec ? res.json(rec) : notFound(res);
    } catch (err) { next(err); }
  });
}));

module.exports = router;

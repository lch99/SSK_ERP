// /api/erp — the ERP's records, read a page at a time (the server rule in
// CLAUDE.md: never whole tables). Each list and record is limited to what the
// viewer's role may see (shared/access.js) and comes back in the demo's shapes.
//   GET /meta                     the Setup view the pages pay by, and who is asking
//   GET /org/children?of=&branchId=&page=   one level of the org chart, with team sizes
//   GET /org/trail/:id            the uplines above someone, top first
//   GET /deals/history?q=&page=&size=   every E-Form's history in reach, newest first (Reports → E-Form change log)
//   GET /deals/:id/history        the E-Form update tracker for one E-Form
//   GET /deals/:id/credit         its agent's and listing holder's tier credit (the payout preview)
//   GET /:list?q=&sort=&page=&size=&<filters>   { rows, total, counts, page, size }
//   GET /:list/download?q=&sort=&<filters>      every matching row as an Excel file (lists with a `download`)
//   GET /:list/:id                one record, with the list's extras
// Stage one (db/erpState.js, db/erpGuard.js), until the pages move to the lists above:
//   GET /state                    the records this person may see, as the demo store gives them (after the time rules)
//   GET /start                    the same, but only the start-up kinds (staff directory, buildings, areas…; G.startUp)
//   POST /actions/:name {args}    one action (shared/erpActions.js; its rule in shared/access.js ACTIONS),
//                                 checked against the person's reach and saved; replies like /state, and for a
//                                 project action with `result` (what was saved)
const express = require('express');
const db = require('../db/connection');
const AC = require('../../../shared/access.js');
const A = require('../../../shared/erpActions.js');
const J = require('../../../shared/projects.js');
const R = require('../../../shared/erpRules.js');
const { requireAuth } = require('../middleware/auth');
const { viewerOf, needs } = require('../middleware/access');
const { LISTS, scopeFor } = require('../db/lists');
const { listPage, listAll, extrasFor, rawRows } = require('../db/list');
const { MODELS, toRecords, KINDS, parseJson } = require('../db/records');
const { loadSetup } = require('../db/setupStore');
const { loadState, saveChanges } = require('../db/erpState');
const { pruneNotices } = require('../db/notices');
const G = require('../db/erpGuard');
const { audit } = require('../db/audit');
const { isInUse } = require('../db/errors');
const { localToday } = require('../db/days');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const { downloadRows, trimmed } = require('../../../shared/lists.js');
const { xlsxParts, zip, XLSX_TYPE } = require('../../../shared/xlsx.js');

const deflateRaw = promisify(zlib.deflateRaw);

const router = express.Router();
router.use(requireAuth);

const wrap = fn => (req, res, next) => fn(req, res).catch(next);
const notFound = res => res.status(404).json({ error: 'Not found, or not yours to see.' });
const idOf = v => (/^\d+$/.test(String(v)) ? Number(v) : null);
const placeholders = ids => ids.map(() => '?').join(', ');

// ── Stage one: the records at once, and the shared actions ──────────────────
// One change at a time, so two saves never hand out the same new id or code.
let queue = Promise.resolve();
const oneAtATime = fn => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };
// Reads every record in one transaction, runs the time rules (as the demo does
// before every action), lets `change(state, before, trx)` alter the records and
// saves the difference. A refusal thrown by `change` saves nothing.
const changeState = (change, { by } = {}) => oneAtATime(() => db.transaction(async trx => {
  const state = await loadState(trx);
  if (!state.data) throw Object.assign(new Error(state.blockers[0]), { status: 400, errors: [state.blockers[0]] });
  const before = structuredClone(state.data);
  A.runClock(state.data, state.setup);
  await change(state, before, trx);
  await saveChanges(trx, before, state.data, { by });
  return state;
}));

// Everything this person may see (after the time rules); `start`: only the start-up read's kinds.
const readState = start => wrap(async (req, res) => {
  const v = await viewerOf(req);
  await pruneNotices(db, localToday());
  let state = await loadState(db);
  // Something the time rules change (a viewing expired…) is saved once, here.
  if (state.data && A.runClock(state.data, state.setup)) state = await changeState(() => {});
  const data = state.data && G.forViewer(state.data, v);
  res.json({ ...state, data: start && data ? G.startUp(data) : data });
});
router.get('/state', readState(false));
router.get('/start', readState(true));

// Projects: the demo keeps them in a store of their own (src/demo/projectsApi.js);
// here they are records like the rest, and the same changes run on them.
function onProjects(state, change) {
  const all = state.data.projects;
  const s = { projects: all, nextId: Math.max(0, ...all.flatMap(p => [p.id, ...(p.incentives || []).map(i => i.id)])) + 1 };
  const result = change(s);
  state.data.projects = s.projects;
  return result;
}
const PROJECT_ACTIONS = {
  saveProject: (state, project) => onProjects(state, s => J.saveProjectIn(s, project, state.setup.tiers)),
  saveIncentive: (state, projectId, incentive) => onProjects(state, s => J.saveIncentiveIn(s, projectId, incentive)),
  deleteIncentive: (state, projectId, incentiveId) => onProjects(state, s => J.deleteIncentiveIn(s, projectId, incentiveId)),
};
const refused = (res, status, err) => res.status(status).json({ error: err.message, errors: err.errors || [err.message] });

router.post('/actions/:name', wrap(async (req, res) => {
  const { name } = req.params;
  const forProjects = Object.hasOwn(PROJECT_ACTIONS, name);
  if (!Object.hasOwn(AC.ACTIONS, name) || (!forProjects && typeof A[name] !== 'function')) return notFound(res);
  const v = await viewerOf(req);
  const why = AC.refusal(v.policy, v.role, name);
  if (why) return res.status(403).json({ error: why, errors: [why] });
  // Whoever the page says is acting, it is the signed-in person.
  const args = G.actorArgs(name, Array.isArray(req.body?.args) ? req.body.args : [], v);
  let result, state, added = {};
  try {
    state = await changeState(async (s, before, trx) => {
      G.checkBefore(name, args, s.data, v);
      if (forProjects) result = PROJECT_ACTIONS[name](s, ...args);
      else {
        const why = A[name](...args)(s.data, s.setup, localToday());
        if (why) throw Object.assign(new Error(why), { status: 400, errors: [why] });
      }
      G.checkAfter(before, s.data, v);
      added = G.addedIds(before, s.data);
      await audit(req, { action: name, entity: 'erp', detail: { changed: G.changedIds(before, s.data) } }, trx);
    }, { by: req.user.username });
  } catch (err) {
    if (err.status === 400 || err.status === 403) return refused(res, err.status, err);
    if (isInUse(err)) return refused(res, 400, new Error('Other records still use this, so it cannot be removed. Set it Inactive instead.'));
    throw err;
  }
  // small: the page keeps only the start-up read (it reads lists a page at a time); added: the ids made.
  const data = G.forViewer(state.data, v);
  res.json({ ...state, data: req.body?.small === true ? G.startUp(data) : data, added, ...(forProjects ? { result } : {}) });
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
  if (!row) return null;
  const [rec] = await toRecords(db, spec.model, [row]);
  if (spec.extras) rec.$ = (await extrasFor(db, spec.extras, [rec])).get(rec.id);
  return rec;
}

// Every E-Form's history in the person's reach, newest first, a page at a time (Reports → E-Form change log).
// q: part of the E-Form's code or of who made the change. audit_log keeps the E-Form's id as text (compared as a number:
// its collation is not the deals table's).
router.get('/deals/history', needs('deals'), wrap(async (req, res) => {
  const v = await viewerOf(req);
  const size = Math.min(200, Math.max(1, Number.parseInt(req.query.size, 10) || 25));
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const q = String(req.query.q || '').trim();
  const ids = sub => { sub.select('deals.id').from('deals'); scopeFor(LISTS.deals, v)(sub); };
  const dealId = db.raw('cast(audit_log.entity_id as unsigned)');
  const found = () => {
    const b = db('audit_log').where('audit_log.entity', 'deal').whereIn(dealId, ids);
    if (q) b.where(x => x.where('audit_log.username', 'like', `%${q}%`).orWhereIn(dealId, sub => { ids(sub); sub.where('deals.code', 'like', `%${q}%`); }));
    return b;
  };
  const { n } = await found().count({ n: '*' }).first();
  const rows = await found().orderBy([{ column: 'audit_log.created_at', order: 'desc' }, { column: 'audit_log.id', order: 'desc' }]).limit(size).offset((page - 1) * size)
    .select('audit_log.id', 'audit_log.username', 'audit_log.entity_id', 'audit_log.detail', 'audit_log.created_at');
  const codes = new Map((await db('deals').whereIn('id', [...new Set(rows.map(r => Number(r.entity_id)))]).select('id', 'code')).map(d => [d.id, d.code]));
  res.json({ total: Number(n), page, size, rows: rows.map(r => ({ id: r.id, at: KINDS.at.read(r.created_at), by: r.username, dealId: Number(r.entity_id), code: codes.get(Number(r.entity_id)) || null, ...parseJson(r.detail) })) });
}));

router.get('/deals/:id/history', needs('deals'), wrap(async (req, res) => {
  const v = await viewerOf(req);
  const id = idOf(req.params.id);
  if (id == null || !(await oneRecord(LISTS.deals, v, id))) return notFound(res);
  const rows = await db('audit_log').where({ entity: 'deal', entity_id: String(id) }).orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }]).limit(500);
  res.json({ rows: rows.map(r => ({ at: KINDS.at.read(r.created_at), by: r.username, dealId: id, ...parseJson(r.detail) })) });
}));

// The tier credit of an E-Form's agent and listing holder (the payout preview
// before the case closes): { [staffId]: { lifetime, yearly } }, from the closes
// on their E-Forms (a close side is always the E-Form's agent or holder).
router.get('/deals/:id/credit', needs('deals'), wrap(async (req, res) => {
  const v = await viewerOf(req);
  const id = idOf(req.params.id);
  const deal = id == null ? null : await oneRecord(LISTS.deals, v, id);
  if (!deal) return notFound(res);
  const ids = [...new Set([deal.agentId, deal.holderId].filter(x => x != null))];
  const staff = await toRecords(db, MODELS.staff, await db('staff').whereIn('id', ids));
  const closes = await toRecords(db, MODELS.closes, await db('closes')
    .whereIn('deal_id', sub => sub.select('id').from('deals').whereIn('agent_id', ids).orWhereIn('holder_id', ids)));
  const year = localToday().slice(0, 4);
  res.json(Object.fromEntries(staff.map(s => [s.id, R.tierCredit(s, closes, year)])));
}));

const listOf = (req, res) => {
  const spec = Object.hasOwn(LISTS, req.params.list) ? LISTS[req.params.list] : null;
  if (!spec) notFound(res);
  return spec;
};
// A list's own area may read it, and so may its `readers` (shared/lists.js),
// each record with what that reader may not see taken out.
const areasOf = spec => [spec.area, ...Object.keys(spec.readers)];
// Who may read a list: its areas, or everyone (area: null, each person's own).
const gateOf = spec => (spec.area == null ? (req, res, next) => next() : needs(areasOf(spec)));
// A list that names its `fields` sends only those.
const asReader = (spec, v) => {
  const strip = spec.area == null || AC.allows(v.policy, v.role, spec.area, 'view') ? r => r
    : Object.entries(spec.readers).find(([area]) => AC.allows(v.policy, v.role, area, 'view'))?.[1] || (r => r);
  return r => trimmed(spec, strip(r));
};

// A list's own rows as the viewer may see them: its `rows` step (the Whole agency hides owners), then its reader.
const shown = async (spec, v, rows) => (spec.rows ? await spec.rows(db, rows, v) : rows).map(asReader(spec, v));
// The query, with the viewer's own key in the filters that take it (their favourites, their unread).
const paramsOf = (spec, v, query) => {
  const p = { ...query };
  for (const k of spec.viewerFilters) if (p[k] !== undefined && p[k] !== '') p[k] = String(v.staffId ?? 0);
  return p;
};

router.get('/:list', wrap(async (req, res, next) => {
  const spec = listOf(req, res);
  if (!spec) return;
  gateOf(spec)(req, res, async () => {
    try {
      const v = await viewerOf(req);
      const page = await listPage(db, spec, paramsOf(spec, v, req.query), scopeFor(spec, v));
      res.json({ ...page, rows: await shown(spec, v, page.rows) });
    } catch (err) { next(err); }
  });
}));

router.get('/:list/download', wrap(async (req, res, next) => {
  const spec = listOf(req, res);
  if (!spec) return;
  if (!spec.download) return notFound(res);
  gateOf(spec)(req, res, async () => {
    try {
      const v = await viewerOf(req);
      // One transaction: the rows are read in chunks from one snapshot, so a save meanwhile can't shift them.
      const { rows } = await db.transaction(trx => listAll(trx, spec, paramsOf(spec, v, req.query), scopeFor(spec, v)));
      const d = spec.download;
      // Compressed off the main thread (zlib's pool), so a big file doesn't hold up everyone else.
      const parts = xlsxParts([{ name: d.sheet, rows: downloadRows(spec, await shown(spec, v, rows), { setup: await loadSetup(db) }), widths: d.widths }]);
      const file = zip(await Promise.all(parts.map(async f => ({ ...f, body: await deflateRaw(f.data), crc: zlib.crc32(f.data) }))));
      res.set({ 'Content-Type': XLSX_TYPE, 'Content-Disposition': `attachment; filename="${d.file}-${localToday()}.xlsx"` });
      res.send(Buffer.from(file));
    } catch (err) {
      if (err.status === 400) return refused(res, 400, err);
      next(err);
    }
  });
}));

router.get('/:list/:id', wrap(async (req, res, next) => {
  const spec = listOf(req, res);
  if (!spec) return;
  gateOf(spec)(req, res, async () => {
    try {
      const id = idOf(req.params.id);
      const v = await viewerOf(req);
      const rec = id == null ? null : await oneRecord(spec, v, id);
      return rec ? res.json((await shown(spec, v, [rec]))[0]) : notFound(res);
    } catch (err) { next(err); }
  });
}));

module.exports = router;

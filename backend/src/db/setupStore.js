// Setup on the server. The steps are the browser demo's (shared/setupState.js):
// read the state, apply the steps with the same rules, save what changed, all
// in one transaction, so the server accepts exactly what the page accepts.
//   settings 'setup' — the document: company, bank accounts, deal types, tier
//                      plans with totals, uplines and split, rules by date,
//                      approvals, numbering, which steps are confirmed
//   branches         — one row per branch (records point at them)
//   staff            — imported agents become agent rows (type Agent)
const db = require('./connection');
const S = require('../../../shared/setupState.js');
const P = require('../../../shared/payout.js');
const A = require('../../../shared/agents.js');
const { ValidationError, isInUse } = require('./errors');
const { take, highestCode, forUpdate } = require('./counters');
const { parseJson } = require('./records');

const DOC_KEY = 'setup';
// Staff account types that are agents (src/erp/model.js AGENT_TYPES); office staff are left alone.
const AGENT_TYPES = ['staff', 'sale-staff'];
const STAFF_PREFIX = 'STAFF-';

const toBranch = b => ({ id: b.id, name: b.name, code: b.code, address: b.address || '', phone: b.phone || '', manager: b.manager || '' });
const branchRow = (b, i) => ({ name: b.name, code: b.code, address: b.address || '', phone: b.phone || '', manager: b.manager || '', sort_order: i });

// A staff row as Setup's agent list has it (shared/agents.js checkAgents).
const toAgent = s => ({
  id: s.id, name: s.name, branchId: s.branch_id, position: s.position ?? null, uplineId: s.upline_id ?? null, tierId: s.tier_floor_id ?? null,
  lifetime: Number(s.opening_lifetime), phone: s.phone || '', email: s.email || '', ic: s.ic_no || '', renNo: s.ren_no || '',
  joined: s.joined_on ? String(s.joined_on).slice(0, 10) : '', bank: s.bank || '', accountNo: s.account_no || '',
});
const AGENT_COLS = ['name', 'branch_id', 'position', 'upline_id', 'tier_floor_id', 'opening_lifetime', 'phone', 'email', 'ic_no', 'ren_no', 'joined_on', 'bank', 'account_no'];
const agentRow = (a, tiers) => ({
  name: a.name, branch_id: a.branchId, position: a.position || null, upline_id: a.uplineId ?? null, tier_floor_id: a.tierId ?? null,
  opening_lifetime: A.openingLifetime(a, tiers), phone: a.phone || '', email: a.email || '', ic_no: a.ic || '', ren_no: a.renNo || '',
  joined_on: a.joined || null, bank: a.bank || '', account_no: a.accountNo || '',
});

async function loadState(q = db, { lock = false } = {}) {
  const docQuery = q('settings').where('key', DOC_KEY);
  const row = await (lock ? forUpdate(q, docQuery) : docQuery).first();
  const doc = row ? parseJson(row.value) : S.emptyState();
  const branches = (await q('branches').orderBy([{ column: 'sort_order' }, { column: 'id' }])).map(toBranch);
  const agents = (await q('staff').whereIn('type', AGENT_TYPES).orderBy('id')).map(toAgent);
  // Setup hands out ids from one counter; keep it above every id already used.
  const top = async table => Number((await q(table).max({ m: 'id' }).first())?.m) || 0;
  const nextId = Math.max(Number(doc.nextId) || 1, (await top('branches')) + 1, (await top('staff')) + 1);
  return { ...doc, branches, agents, nextId };
}

// What the Setup page reads (the state plus the go-live checklist).
const loadSetup = async (q = db) => S.view(await loadState(q));

// Parents before their downline, so each upline row exists when it is pointed at.
function uplineOrder(agents) {
  const byId = new Map(agents.map(a => [a.id, a]));
  const done = new Set(), out = [];
  const visit = (a, depth = 0) => {
    if (done.has(a.id)) return;
    done.add(a.id);
    const up = byId.get(a.uplineId);
    if (up && depth < 100) visit(up, depth + 1);
    out.push(a);
  };
  agents.forEach(a => visit(a));
  return out;
}

const changed = (a, b, cols) => cols.some(c => String(a[c] ?? '') !== String(b[c] ?? ''));

async function saveState(trx, before, after) {
  const { branches, agents, ...doc } = after;
  await trx('settings').insert({ key: DOC_KEY, value: JSON.stringify(doc), updated_at: trx.fn.now() }).onConflict('key').merge();

  // Branches: add and update first (agents may move into a new one), remove last.
  const oldBranches = new Map(before.branches.map(b => [b.id, b]));
  for (const [i, b] of branches.entries()) {
    const row = branchRow(b, i);
    if (!oldBranches.has(b.id)) await trx('branches').insert({ id: b.id, ...row });
    else if (changed(branchRow(oldBranches.get(b.id), i), row, Object.keys(row))) await trx('branches').where('id', b.id).update(row);
  }

  // Agents: new ones get the next staff codes; changed ones are updated; the rest are left alone.
  const view = S.view(after);
  const tiersOf = branchId => P.tiersFor(view, branchId);
  const oldAgents = new Map(before.agents.map(a => [a.id, a]));
  const added = uplineOrder(agents.filter(a => !oldAgents.has(a.id)));
  if (added.length) {
    let code = await take(trx, 'staff', { n: added.length, atLeast: await highestCode(trx, 'staff', 'code', STAFF_PREFIX) });
    const rows = added.map(a => ({ id: a.id, code: `${STAFF_PREFIX}${String(code++).padStart(5, '0')}`, ...agentRow(a, tiersOf(a.branchId)),
      short_name: a.name, type: 'staff', status: 'active', access: JSON.stringify({ agent: true, addListing: true }) }));
    for (let i = 0; i < rows.length; i += 500) await trx('staff').insert(rows.slice(i, i + 500));
  }
  for (const a of agents) {
    const old = oldAgents.get(a.id);
    if (!old) continue;
    const row = agentRow(a, tiersOf(a.branchId));
    // A blank lifetime on an agent already saved keeps what they have.
    if (a.lifetime === '' || a.lifetime == null) delete row.opening_lifetime;
    if (changed(agentRow(old, tiersOf(old.branchId)), row, Object.keys(row))) {
      await trx('staff').where('id', a.id).update({ ...row, updated_at: trx.fn.now() });
    }
  }
  const keep = new Set(agents.map(a => a.id));
  const removed = before.agents.filter(a => !keep.has(a.id)).map(a => a.id);
  try {
    for (let i = 0; i < removed.length; i += 500) await trx('staff').whereIn('id', removed.slice(i, i + 500)).whereIn('type', AGENT_TYPES).del();
  } catch (err) {
    if (!isInUse(err)) throw err;
    throw new ValidationError(["Some of these agents already have E-Forms, listings, customers or payouts, so they can't be taken off the list. Add the new rows instead, or set people Inactive in Agents."]);
  }

  const kept = new Set(branches.map(b => b.id));
  for (const b of before.branches.filter(x => !kept.has(x.id))) {
    try {
      await trx('branches').where('id', b.id).del();
    } catch (err) {
      if (!isInUse(err)) throw err;
      throw new ValidationError([`${b.name} still has people, sign-in accounts or records. Move them to another branch before removing it.`]);
    }
  }
}

// steps: [[step, body], …] — one wizard page, saved all or nothing. Returns the
// fresh view. `onSaved(trx, step, body)` logs each step in the same transaction.
async function saveSteps(steps, { onSaved } = {}) {
  return db.transaction(async trx => {
    const before = await loadState(trx, { lock: true });
    let after;
    try {
      after = S.applySteps(before, structuredClone(steps));
    } catch (err) {
      if (err instanceof S.SetupError) throw new ValidationError(err.errors);
      throw err;
    }
    await saveState(trx, before, after);
    if (onSaved) for (const [step, body] of steps) await onSaved(trx, step, body);
    return S.view(await loadState(trx));
  });
}

// The whole Setup replaced by `state` (the demo-data script uses it with the sample).
async function replaceState(state) {
  return db.transaction(async trx => {
    const before = await loadState(trx, { lock: true });
    await saveState(trx, before, { ...state, nextId: Math.max(state.nextId, before.nextId) });
    return S.view(await loadState(trx));
  });
}

module.exports = { ValidationError, loadState, loadSetup, saveSteps, replaceState, AGENT_TYPES };

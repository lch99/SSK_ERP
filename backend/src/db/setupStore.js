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

// One new branch, put on tier plan `planId` (the Standard plan when null), with
// the same rules as Setup's own steps. `then(trx, branchId)` runs in the same
// transaction (the Users page adds the branch's manager there), so either both
// are saved or neither. Returns the new branch.
async function addBranch(branch, { planId = null, then } = {}) {
  return db.transaction(async trx => {
    const before = await loadState(trx, { lock: true });
    let after, id;
    try {
      after = S.applySteps(before, [['branches', { branches: [...before.branches, { ...branch, id: null }] }]]);
      id = after.branches[after.branches.length - 1].id;
      if (planId != null) {
        const i = after.plans.findIndex(p => p.id === Number(planId));
        if (i < 0) throw new S.SetupError(['That payout plan no longer exists.']);
        if (i > 0) {
          const plans = after.plans.map((p, j) => (j === i ? { ...p, branchIds: [...p.branchIds, id] } : p));
          after = S.applySteps(after, [['plans', { plans, sideSharePct: after.sideSharePct }]]);
        }
      }
      // Setup's checklist stays as the Superadmin left it: adding a branch here confirms none of its steps.
      after = { ...after, confirmed: before.confirmed };
    } catch (err) {
      if (err instanceof S.SetupError) throw new ValidationError(err.errors);
      throw err;
    }
    await saveState(trx, before, after);
    if (then) await then(trx, id);
    return (await loadState(trx)).branches.find(b => b.id === id);
  });
}

// Setup as one branch sees it (a Branch Partner's My branch page): only that branch and its agents.
// The rest (plans, upline levels) is the company's, read only, so the agent template and its checks work.
// Nothing about other branches goes out: their plans, tiers, numbering and BM accounts, nor the
// company's bank accounts and past rules.
const branchView = (state, branchId) => {
  const plans = state.plans || [];
  const i = plans.length ? P.planIndexFor(plans, branchId) : -1;
  const ownPlans = i > 0 ? [plans[0], { ...plans[i], branchIds: [branchId] }] : plans.slice(0, 1);
  const bm = state.standard?.branchManagers?.[branchId] ?? state.standard?.branchManagers?.[String(branchId)];
  const numbering = state.numbering && { ...state.numbering, branches: state.numbering.branches?.[branchId] ? { [branchId]: state.numbering.branches[branchId] } : {} };
  const narrow = { ...state, branches: state.branches.filter(b => b.id === branchId), plans: ownPlans, bankAccounts: [], ruleHistory: [],
    ...(numbering ? { numbering } : {}),
    ...(state.standard ? { standard: { ...state.standard, branchManagers: bm == null ? {} : { [branchId]: bm } } } : {}) };
  return { ...S.view(narrow), agents: state.agents.filter(a => a.branchId === branchId) };
};
const loadBranchSetup = async (branchId, q = db) => branchView(await loadState(q), Number(branchId));

// A partner edits their own branch's details. Name and code stay the Superadmin's (the code is in
// every case and voucher number). Returns the branch's fresh view.
async function updateBranchDetails(branchId, body, { then } = {}) {
  return db.transaction(async trx => {
    const before = await loadState(trx, { lock: true });
    const id = Number(branchId);
    if (!before.branches.some(b => b.id === id)) throw new ValidationError(['That branch no longer exists.']);
    const pick = k => String(body?.[k] ?? '').trim();
    // Only this branch's own fields change, and only they are checked: another branch's data never
    // blocks the partner (nor shows in an error), and Setup's checklist is left alone.
    const fields = { address: pick('address'), phone: pick('phone'), manager: pick('manager') };
    const tooLong = Object.entries({ address: 300, phone: 30, manager: 100 }).filter(([k, n]) => fields[k].length > n).map(([k, n]) => `${k[0].toUpperCase()}${k.slice(1)}: at most ${n} characters.`);
    if (tooLong.length) throw new ValidationError(tooLong);
    const after = { ...before, branches: before.branches.map(b => (b.id === id ? { ...b, ...fields } : b)) };
    await saveState(trx, before, after);
    if (then) await then(trx);
    return branchView(await loadState(trx), id);
  });
}

// A partner's agent list from Excel, added to their branch only: the rows are checked against a Setup
// holding just that branch (so every row lands in it), and uplines are matched among its own agents.
// Agents already saved stay as they are (no "replace" here: that could remove other people's work).
async function importBranchAgents(branchId, rows, { then } = {}) {
  return db.transaction(async trx => {
    const before = await loadState(trx, { lock: true });
    const id = Number(branchId);
    if (!before.branches.some(b => b.id === id)) throw new ValidationError(['That branch no longer exists.']);
    const own = { ...before, branches: before.branches.filter(b => b.id === id), agents: before.agents.filter(a => a.branchId === id) };
    let added;
    try {
      const others = before.agents.filter(a => a.branchId !== id);
      const out = S.applySteps(own, [['agents', { mode: 'add', rows, others }]]);
      added = { list: out.agents.slice(own.agents.length), nextId: out.nextId };
    } catch (err) {
      if (err instanceof S.SetupError) throw new ValidationError(err.errors);
      throw err;
    }
    await saveState(trx, before, { ...before, agents: [...before.agents, ...added.list], nextId: added.nextId });
    if (then) await then(trx, added.list.length);
    return branchView(await loadState(trx), id);
  });
}

// A partner names who receives their own branch's BM profit (the existing payout standard pays it to
// one agent account per branch: shared/standard.js branchManagerFor). Only an agent of that branch;
// null: nobody (the company keeps it). Other branches' choices are left as they are.
async function setBranchManager(branchId, staffId, { then } = {}) {
  return db.transaction(async trx => {
    const before = await loadState(trx, { lock: true });
    const id = Number(branchId);
    if (!before.branches.some(b => b.id === id)) throw new ValidationError(['That branch no longer exists.']);
    if (before.standard?.kind !== 'existing') throw new ValidationError(["The company's payout standard has no BM profit, so there is no account to name."]);
    const who = staffId == null || staffId === '' ? null : Number(staffId);
    if (who != null && !before.agents.some(a => a.id === who && a.branchId === id)) {
      throw new ValidationError(['Pick an agent of your own branch.']);
    }
    const managers = { ...(before.standard.branchManagers || {}) };
    delete managers[String(id)];
    if (who != null) managers[id] = who;
    const after = { ...before, standard: { ...before.standard, branchManagers: managers } };
    await saveState(trx, before, after);
    if (then) await then(trx, who);
    return branchView(await loadState(trx), id);
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

module.exports = { ValidationError, loadState, loadSetup, saveSteps, addBranch, loadBranchSetup, updateBranchDetails, importBranchAgents, setBranchManager,
  replaceState, AGENT_TYPES };

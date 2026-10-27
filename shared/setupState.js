// The Setup steps as pure functions on one plain state object: clean the input,
// validate it with the rules in payout.js, return the next state. The browser
// demo (src/demo/localApi.js) runs on this with no server.
import * as P from './payout.js';
import * as A from './agents.js';

export const DEFAULTS = {
  company: { name: '', regNo: '', licenceNo: '', reaName: '', reaNo: '', sstNo: '', address: '', phone: '', email: '' },
  dealTypes: {
    sale:    { enabled: true,  defaultRate: '' },
    rental:  { enabled: false, defaultRate: '' },
    project: { enabled: false, defaultRate: '' },
    sstPct: 8, sstMode: 'on_top',
    whtPct: 2, coaSharePct: 50, referralPct: 10,
  },
  // Left blank on purpose: the boss picks each one.
  approvals: { dealApprover: '', bossAbove: '', refundApprover: '', payWhen: '', payRun: '', payDay: '' },
  numbering: { letters: { sale: 'S', rental: 'R', project: 'P' }, caseDigits: 4, voucherPrefix: 'PV', voucherDigits: 4, branches: {} },
};

export function emptyState() {
  return {
    company: { ...DEFAULTS.company },
    dealTypes: structuredClone(DEFAULTS.dealTypes),
    numbering: structuredClone(DEFAULTS.numbering),
    approvals: { ...DEFAULTS.approvals },
    confirmed: {},
    bankAccounts: [], branches: [], plans: [], roles: [], splits: {}, agents: [],
    nextId: 1,
  };
}

export class SetupError extends Error {
  constructor(errors) { super(errors[0]); this.errors = errors; }
}
const check = errors => { if (errors.length) throw new SetupError(errors); };
const str = v => String(v ?? '').trim();
const numOrBlank = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? '' : Number(v));

const plainTier = ({ totals, ...t }) => t;

// What the Setup page reads: the state plus the go-live checklist. Tier plans
// are also given the older way (company tiers, branchTiers and totals rows),
// which is what the ERP pages and payout.js read: tiersFor(), resolveTotal().
// Tier ids are unique across plans, so every total is a company-scope row.
export function view(saved) {
  const state = migrate(saved);
  const plans = state.plans;
  const out = {
    // Older saved data may miss newer fields: fill them from the defaults.
    company: { ...DEFAULTS.company, ...state.company },
    dealTypes: { ...DEFAULTS.dealTypes, ...state.dealTypes },
    approvals: { ...DEFAULTS.approvals, ...state.approvals },
    bankAccounts: state.bankAccounts || [],
    numbering: state.numbering,
    branches: state.branches.map(b => ({ address: '', phone: '', manager: '', ...b })),
    plans,
    tiers: (plans[0]?.tiers || []).map(plainTier),
    branchTiers: Object.fromEntries(state.branches.map(b => [b.id, P.planIndexFor(plans, b.id)]).filter(([, i]) => i > 0)
      .map(([id, i]) => [id, plans[i].tiers.map(plainTier)])),
    totals: plans.flatMap(p => p.tiers.flatMap(t => P.DEAL_TYPES.filter(dt => t.totals?.[dt] !== '' && t.totals?.[dt] != null)
      .map(dt => ({ branchId: P.COMPANY_SCOPE, dealType: dt, tierId: t.id, totalPct: Number(t.totals[dt]) })))),
    roles: state.roles,
    splits: P.normalizeSplits(state.splits, state.roles),
    agents: state.agents || [],
  };
  // Data saved before steps were tracked has no `confirmed`: treat it as all checked.
  return { ...out, checklist: P.setupChecklist(state.confirmed ? { ...out, confirmed: state.confirmed } : out) };
}

// Data saved before tier plans: company tiers, branchTiers, and totals rows per
// branch. Each branch list becomes a plan of its own, and so does a branch that
// only changed some totals on the company tiers (as a copy, with its totals).
export function migrate(saved) {
  const state = renameOldSample(saved);
  if (Array.isArray(state.plans)) return state;
  const { tiers = [], branchTiers = {}, totals = [], ...rest } = state;
  let nextId = state.nextId;
  const totalsOf = (branchId, tierId) => Object.fromEntries(P.DEAL_TYPES.flatMap(dt => {
    const row = totals.find(x => x.branchId === branchId && x.dealType === dt && x.tierId === tierId);
    return row ? [[dt, row.totalPct]] : [];
  }));
  const standard = { id: nextId++, name: P.STANDARD_PLAN, branchIds: [], tiers: tiers.map(t => ({ ...t, totals: totalsOf(P.COMPANY_SCOPE, t.id) })) };
  const plans = [standard];
  for (const b of state.branches || []) {
    if (branchTiers[b.id]) {
      plans.push({ id: nextId++, name: b.name, branchIds: [b.id], tiers: branchTiers[b.id].map(t => ({ ...t, totals: totalsOf(b.id, t.id) })) });
    } else if (totals.some(x => x.branchId === b.id)) {
      plans.push({ id: nextId++, name: b.name, branchIds: [b.id],
        tiers: standard.tiers.map(t => ({ ...t, id: nextId++, totals: { ...t.totals, ...totalsOf(b.id, t.id) } })) });
    }
  }
  const c = state.confirmed;
  const confirmed = c && { ...c, tiers: !!(c.tiers && c.payouts) };
  if (confirmed) delete confirmed.payouts;
  return { ...rest, plans: tiers.length || plans.length > 1 ? plans : [], nextId, confirmed };
}

// Give new rows ids; return the list and the next free id.
function withIds(items, nextId, known) {
  let id = nextId;
  const list = items.map(i => (i.id != null && known.has(Number(i.id)) ? { ...i, id: Number(i.id) } : { ...i, id: id++ }));
  return { list, nextId: id };
}

const STEPS = {
  // body: company fields + bankAccounts: [{ id?, bank, accountName, accountNo, purpose }]
  company(state, body) {
    const company = Object.fromEntries(Object.keys(DEFAULTS.company).map(k => [k, str(body?.[k])]));
    const accounts = (Array.isArray(body?.bankAccounts) ? body.bankAccounts : []).map(a => ({
      id: a.id ?? null, bank: str(a.bank), accountName: str(a.accountName), accountNo: str(a.accountNo), purpose: a.purpose || '',
    }));
    check([...P.validateCompany(company), ...P.validateBankAccounts(accounts)]);
    const { list, nextId } = withIds(accounts, state.nextId, new Set((state.bankAccounts || []).map(a => a.id)));
    return { ...state, company, bankAccounts: list, nextId };
  },

  branches(state, body) {
    const branches = (Array.isArray(body?.branches) ? body.branches : [])
      .map(b => ({ id: b.id ?? null, name: str(b.name), code: str(b.code).toUpperCase(),
        address: str(b.address), phone: str(b.phone), manager: str(b.manager) }));
    check(P.validateBranches(branches));
    const { list, nextId } = withIds(branches, state.nextId, new Set(state.branches.map(b => b.id)));
    const ids = new Set(list.map(b => b.id));
    return { ...state, branches: list, nextId,
      plans: state.plans.map(p => ({ ...p, branchIds: p.branchIds.filter(id => ids.has(id)) })),
      numbering: { ...state.numbering, branches: P.cleanBranchNumbering(state.numbering.branches, list) } };
  },

  'deal-types'(state, body) {
    const dealTypes = {
      sstPct: numOrBlank(body?.sstPct), sstMode: body?.sstMode || 'on_top',
      whtPct: numOrBlank(body?.whtPct), coaSharePct: numOrBlank(body?.coaSharePct), referralPct: numOrBlank(body?.referralPct),
    };
    for (const dt of P.DEAL_TYPES) {
      dealTypes[dt] = { enabled: !!body?.[dt]?.enabled, defaultRate: numOrBlank(body?.[dt]?.defaultRate) };
    }
    check(P.validateDealTypes(dealTypes));
    return { ...state, dealTypes };
  },

  // body: { plans: [{ id?, name, branchIds, tiers: [{ id?, name, title, basis,
  // threshold, agentRate, totals: { [dealType]: pct } }] }] }. Saves every tier
  // plan at once. The first plan is the standard one; branchIds says which
  // branches use each of the others. Tiers are put in ladder order.
  plans(state, body) {
    const branchIds = new Set(state.branches.map(b => b.id));
    const plans = (Array.isArray(body?.plans) ? body.plans : []).map((p, i) => ({
      id: p.id ?? null, name: str(p.name) || (i === 0 ? P.STANDARD_PLAN : ''),
      branchIds: i === 0 ? [] : [...new Set((p.branchIds || []).map(Number))].filter(id => branchIds.has(id)),
      tiers: P.sortTiers((Array.isArray(p.tiers) ? p.tiers : []).map(t => ({
        id: t.id ?? null, name: str(t.name), title: str(t.title), basis: t.basis,
        threshold: numOrBlank(t.threshold), agentRate: numOrBlank(t.agentRate),
        totals: Object.fromEntries(P.DEAL_TYPES.map(dt => [dt, numOrBlank(t.totals?.[dt])]).filter(([, v]) => v !== '')),
      }))),
    }));
    check(P.validatePlans(plans, state.dealTypes, state.branches));
    // Keep known ids (each used once); new plans and tiers get fresh ones.
    let nextId = state.nextId;
    const used = new Set();
    const keep = (id, known) => {
      const n = Number(id);
      if (id != null && known.has(n) && !used.has(n)) { used.add(n); return n; }
      return nextId++;
    };
    const knownPlans = new Set(state.plans.map(p => p.id));
    const knownTiers = new Set(state.plans.flatMap(p => p.tiers.map(t => t.id)));
    const list = plans.map(p => ({ ...p, id: keep(p.id, knownPlans), tiers: p.tiers.map(t => ({ ...t, id: keep(t.id, knownTiers) })) }));
    return { ...state, plans: list, nextId };
  },

  uplines(state, body) {
    const roles = (Array.isArray(body?.roles) ? body.roles : []).map(r => ({ code: str(r.code).toUpperCase(), name: str(r.name) }));
    check(P.validateRoles(roles));
    const splits = roles.length < 2 ? P.normalizeSplits({}, roles)
      : Object.fromEntries(roles.map(r => [r.code, numOrBlank(body?.splits?.[r.code])]));
    check(P.validateSplits(splits, roles));
    return { ...state, roles, splits };
  },

  // body: { mode: 'replace' | 'add', rows } with rows from A.readAgentTable():
  // the spreadsheet's cells, checked again here. { mode: 'replace', rows: [] }
  // empties the list.
  agents(state, body) {
    const existing = body?.mode === 'add' ? state.agents || [] : [];
    const rows = (Array.isArray(body?.rows) ? body.rows : []).map((r, i) => ({ line: Number(r.line) || i + 2, cells: r.cells || {} }));
    if (rows.length > 5000) throw new SetupError(['Up to 5,000 agents at a time.']);
    const { agents, errors } = A.checkAgents(rows, state, existing);
    check(errors.slice(0, 50).map(A.errorText).concat(errors.length > 50 ? [`…and ${errors.length - 50} more rows to fix.`] : []));
    let nextId = state.nextId;
    const idOf = new Map(agents.map(a => [a.ref, nextId++]));
    const added = agents.map(({ ref, line, upline, ...a }) => ({ ...a, id: idOf.get(ref), uplineId: upline == null ? null : idOf.get(upline) ?? upline }));
    return { ...state, agents: [...existing, ...added], nextId };
  },

  approvals(state, body) {
    const approvals = {
      dealApprover: body?.dealApprover || '', bossAbove: numOrBlank(body?.bossAbove),
      refundApprover: body?.refundApprover || '', payWhen: body?.payWhen || '',
      payRun: body?.payRun || '', payDay: ['weekly', 'monthly'].includes(body?.payRun) ? numOrBlank(body?.payDay) : '',
    };
    if (approvals.dealApprover !== 'manager') approvals.bossAbove = '';
    check(P.validateApprovals(approvals));
    return { ...state, approvals };
  },

  numbering(state, body) {
    const numbering = {
      letters: Object.fromEntries(P.DEAL_TYPES.map(dt => [dt, str(body?.letters?.[dt]).toUpperCase()])),
      caseDigits: Number(body?.caseDigits),
      voucherPrefix: str(body?.voucherPrefix).toUpperCase(),
      voucherDigits: Number(body?.voucherDigits),
      branches: P.cleanBranchNumbering(body?.branches, state.branches),
    };
    check(P.validateNumbering(numbering, state.dealTypes, state.branches));
    return { ...state, numbering };
  },
};

// Which part of the checklist each step confirms.
const STEP_KEYS = { 'deal-types': 'dealTypes', plans: 'tiers' };

export function applyStep(saved, step, body) {
  const fn = STEPS[step];
  if (!fn) throw new SetupError([`Unknown setup step "${step}".`]);
  const state = migrate(saved);
  const next = tidyAgents(fn(state, body));
  return { ...next, confirmed: { ...state.confirmed, [STEP_KEYS[step] || step]: true } };
}

// Keep imported agents in line with the rest of Setup: a removed branch takes
// its agents with it; a position, tier or upline that no longer exists is
// cleared (a negotiator, placed by lifetime commission, with no upline).
function tidyAgents(state) {
  if (!state.agents?.length) return state;
  const branchIds = new Set(state.branches.map(b => b.id));
  const kept = state.agents.filter(a => branchIds.has(a.branchId));
  const ids = new Set(kept.map(a => a.id));
  const codes = new Set(state.roles.map(r => r.code));
  return { ...state, agents: kept.map(a => {
    const tiers = state.plans[P.planIndexFor(state.plans, a.branchId)]?.tiers || [];
    return { ...a, uplineId: ids.has(a.uplineId) ? a.uplineId : null, position: codes.has(a.position) ? a.position : null,
      tierId: tiers.some(t => t.id === a.tierId) ? a.tierId : null };
  }) };
}

// Several steps saved together (one wizard page), all or nothing.
export const applySteps = (state, steps) => steps.reduce((s, [step, body]) => applyStep(s, step, body), state);

const SAMPLE_COMPANY = 'SSK Ventures Sdn Bhd';
const SAMPLE_EMAIL = 'admin@ssk-ventures.example';

// The sample company used to be "Sample Realty Sdn Bhd". Browsers that loaded
// it then get the client's real name without reloading the sample.
function renameOldSample(state) {
  const OLD = 'Sample Realty Sdn Bhd';
  if (state.company?.name !== OLD) return state;
  return { ...state,
    company: { ...state.company, name: SAMPLE_COMPANY, email: state.company.email === 'admin@sample-realty.example' ? SAMPLE_EMAIL : state.company.email },
    bankAccounts: (state.bankAccounts || []).map(a => ({ ...a, accountName: String(a.accountName || '').replace(OLD, SAMPLE_COMPANY) })) };
}

// Example data for demos. Apart from the company name, the details, people, thresholds and rates are made up.
export function sampleState() {
  let s = emptyState();
  s = applyStep(s, 'company', { name: SAMPLE_COMPANY, regNo: '202401000001 (1234567-X)',
    licenceNo: 'E (1) 0000', reaName: 'Tan Ah Kow', reaNo: 'E 0000', sstNo: 'W10-1234-56789012',
    address: '12, Jalan Contoh 1/2, Taman Contoh, 58100 Kuala Lumpur', phone: '03-1234 5678', email: SAMPLE_EMAIL,
    bankAccounts: [
      { bank: 'Maybank', accountName: SAMPLE_COMPANY, accountNo: '5140 0000 0001', purpose: 'operating' },
      { bank: 'Public Bank', accountName: `${SAMPLE_COMPANY} - Clients Account`, accountNo: '3100 0000 02', purpose: 'client' },
    ] });
  s = applyStep(s, 'branches', { branches: [
    { name: 'Taman Desa', code: 'TD', address: 'Jalan Desa, Taman Desa, 58100 Kuala Lumpur', phone: '03-0000 1111', manager: 'Lim Mei Ling' },
    { name: 'Cheras', code: 'CH', address: 'Jalan Cheras, 56100 Kuala Lumpur', phone: '03-0000 2222', manager: 'Raj Kumar' },
    { name: 'Puchong', code: 'PC', address: 'Bandar Puteri, 47100 Puchong', phone: '03-0000 3333', manager: 'Nur Aisyah' },
  ] });
  s = applyStep(s, 'deal-types', { sale: { enabled: true, defaultRate: 3 }, rental: { enabled: true, defaultRate: 100 }, project: { enabled: true, defaultRate: 2 },
    sstPct: 8, sstMode: 'on_top', whtPct: 2, coaSharePct: 50, referralPct: 10 });
  // Every deal type pays the same total: agent rate + some points, capped at 95%.
  const ladder = (rows, points) => rows.map(([name, title, basis, threshold, agentRate]) => {
    const total = Math.min(95, agentRate + points);
    return { name, title, basis, threshold, agentRate, totals: Object.fromEntries(P.DEAL_TYPES.map(dt => [dt, total])) };
  });
  const pc = s.branches.find(b => b.code === 'PC');
  // Taman Desa and Cheras pay on the standard plan; Puchong runs its own, simpler one.
  s = applyStep(s, 'plans', { plans: [
    { name: 'Standard', tiers: ladder([
      ['T1', 'Associate', 'lifetime', 0, 60], ['T2', 'Negotiator', 'lifetime', 30000, 65], ['T3', 'Senior Negotiator', 'lifetime', 60000, 70],
      ['T4', 'Executive', 'lifetime', 90000, 75], ['T5', 'Senior Executive', 'lifetime', 120000, 80],
      ['T6', 'Achiever', 'yearly', 100000, 83], ['T7', 'Star', 'yearly', 120000, 85], ['T8', 'Elite', 'yearly', 150000, 88], ['T9', 'Platinum', 'yearly', 200000, 90],
    ], 25) },
    { name: 'Puchong', branchIds: [pc.id], tiers: ladder([
      ['P1', 'Junior', 'lifetime', 0, 55], ['P2', 'Senior', 'lifetime', 50000, 65], ['P3', 'Leader', 'lifetime', 100000, 75],
      ['P4', 'Star', 'yearly', 150000, 85],
    ], 20) },
  ] });
  s = applyStep(s, 'uplines', {
    roles: [{ code: 'AGA', name: 'Agent Leader' }, { code: 'TSM', name: 'Team Sales Manager' }, { code: 'GSM', name: 'Group Sales Manager' }],
    splits: { AGA: 20, TSM: 20, GSM: 60 },
  });
  // No agents imported: the demo ERP makes up its own people for the sample.
  s = applyStep(s, 'agents', { mode: 'replace', rows: [] });
  s = applyStep(s, 'approvals', { dealApprover: 'manager', bossAbove: 20000, refundApprover: 'boss', payWhen: 'full', payRun: 'weekly', payDay: 5 });
  // Taman Desa keeps its own prefixes and carries on from its existing numbers.
  const td = s.branches.find(b => b.code === 'TD');
  return applyStep(s, 'numbering', { letters: { sale: 'S', rental: 'R', project: 'P' }, caseDigits: 4, voucherPrefix: 'PV', voucherDigits: 4,
    branches: { [td.id]: { prefixes: { sale: 'TDS', rental: 'TDR', voucher: 'VTD' }, starts: { sale: 1251, rental: 342, voucher: 87 } } } });
}

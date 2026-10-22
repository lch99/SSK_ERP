// Reads and writes for the Setup page. Every write validates with the same
// rules the page uses (shared/payout.js) and returns the full, fresh state.
const db = require('./connection');
const P = require('../../../shared/payout.js');

const DEFAULTS = {
  company: { name: '', regNo: '', sstNo: '', address: '', phone: '', email: '' },
  dealTypes: {
    sale:    { enabled: true,  defaultRate: '' },
    rental:  { enabled: false, defaultRate: '' },
    project: { enabled: false, defaultRate: '' },
    sstPct: 8,
  },
  numbering: {
    letters: { sale: 'S', rental: 'R', project: 'P' },
    caseDigits: 4,
    voucherPrefix: 'PV',
    voucherDigits: 4,
  },
  uplines: { roles: [], splits: {} },
};

class ValidationError extends Error {
  constructor(errors) { super(errors[0]); this.errors = errors; }
}

const str = v => String(v ?? '').trim();
const parseJson = v => (typeof v === 'string' ? JSON.parse(v) : v);

async function readSettings(q = db) {
  const rows = await q('settings').select('key', 'value');
  const out = {};
  for (const r of rows) out[r.key] = parseJson(r.value);
  return out;
}

async function writeSetting(key, value, q = db) {
  await q('settings')
    .insert({ key, value: JSON.stringify(value), updated_at: q.fn.now() })
    .onConflict('key').merge();
}

async function loadSetup(q = db) {
  const s = await readSettings(q);
  const branches = (await q('branches').orderBy([{ column: 'sort_order' }, { column: 'id' }]))
    .map(b => ({ id: b.id, name: b.name, code: b.code }));
  const tiers = (await q('tiers').orderBy([{ column: 'sort_order' }, { column: 'id' }]))
    .map(t => ({ id: t.id, name: t.name, title: t.title || '', basis: t.basis, threshold: Number(t.threshold), agentRate: Number(t.agent_rate) }));
  const totals = (await q('payout_totals'))
    .map(r => ({ branchId: r.branch_id, dealType: r.deal_type, tierId: r.tier_id, totalPct: Number(r.total_pct) }));
  const uplines = s.uplines || DEFAULTS.uplines;
  const state = {
    company:   { ...DEFAULTS.company, ...s.company },
    dealTypes: { ...DEFAULTS.dealTypes, ...s.dealTypes },
    numbering: { ...DEFAULTS.numbering, ...s.numbering, letters: { ...DEFAULTS.numbering.letters, ...s.numbering?.letters },
      branches: P.cleanBranchNumbering(s.numbering?.branches, branches) },
    branches,
    tiers,
    roles: uplines.roles,
    splits: P.normalizeSplits(uplines.splits, uplines.roles),
    totals,
  };
  return { ...state, checklist: P.setupChecklist(state) };
}

// ── Simple settings ──────────────────────────────────────────────────────────

async function saveCompany(body) {
  const company = Object.fromEntries(Object.keys(DEFAULTS.company).map(k => [k, str(body?.[k])]));
  const errors = P.validateCompany(company);
  if (errors.length) throw new ValidationError(errors);
  await writeSetting('company', company);
  return loadSetup();
}

async function saveDealTypes(body) {
  const dealTypes = { sstPct: Number(body?.sstPct) };
  for (const dt of P.DEAL_TYPES) {
    const d = body?.[dt] || {};
    dealTypes[dt] = { enabled: !!d.enabled, defaultRate: d.defaultRate === '' || d.defaultRate == null ? '' : Number(d.defaultRate) };
  }
  if (!Number.isFinite(dealTypes.sstPct)) dealTypes.sstPct = '';
  const errors = P.validateDealTypes(dealTypes);
  if (errors.length) throw new ValidationError(errors);
  await writeSetting('dealTypes', dealTypes);
  return loadSetup();
}

async function saveNumbering(body) {
  const numbering = {
    letters: Object.fromEntries(P.DEAL_TYPES.map(dt => [dt, str(body?.letters?.[dt]).toUpperCase()])),
    caseDigits: Number(body?.caseDigits),
    voucherPrefix: str(body?.voucherPrefix).toUpperCase(),
    voucherDigits: Number(body?.voucherDigits),
  };
  const { dealTypes, branches } = await loadSetup();
  numbering.branches = P.cleanBranchNumbering(body?.branches, branches);
  const errors = P.validateNumbering(numbering, dealTypes, branches);
  if (errors.length) throw new ValidationError(errors);
  await writeSetting('numbering', numbering);
  return loadSetup();
}

// ── Lists (replace-all: keep ids that come back, add new, delete missing) ────

async function syncList(trx, table, items, toRow) {
  const existing = new Set(await trx(table).pluck('id'));
  const keep = new Set(items.filter(i => i.id != null && existing.has(Number(i.id))).map(i => Number(i.id)));
  const removed = [...existing].filter(id => !keep.has(id));
  if (removed.length) await trx(table).whereIn('id', removed).del();
  for (const [i, item] of items.entries()) {
    const row = { ...toRow(item), sort_order: i };
    if (keep.has(Number(item.id))) await trx(table).where('id', Number(item.id)).update(row);
    else await trx(table).insert(row);
  }
  return removed;
}

async function saveBranches(body) {
  const branches = (Array.isArray(body?.branches) ? body.branches : [])
    .map(b => ({ id: b.id ?? null, name: str(b.name), code: str(b.code).toUpperCase() }));
  const errors = P.validateBranches(branches);
  if (errors.length) throw new ValidationError(errors);
  await db.transaction(async trx => {
    const keepIds = branches.filter(b => b.id != null).map(b => Number(b.id));
    const withUsers = await trx('branches as b').join('users as u', 'u.branch_id', 'b.id')
      .whereNotIn('b.id', keepIds.length ? keepIds : [0]).distinct('b.name').pluck('b.name');
    if (withUsers.length) {
      throw new ValidationError(withUsers.map(n => `${n} still has user accounts. Move them to another branch (Users page) before removing it.`));
    }
    const removed = await syncList(trx, 'branches', branches, b => ({ name: b.name, code: b.code }));
    if (removed.length) await trx('payout_totals').whereIn('branch_id', removed).del();
  });
  return loadSetup();
}

async function saveTiers(body) {
  const tiers = (Array.isArray(body?.tiers) ? body.tiers : []).map(t => ({
    id: t.id ?? null, name: str(t.name), title: str(t.title), basis: t.basis,
    threshold: t.threshold === '' ? '' : Number(t.threshold),
    agentRate: t.agentRate === '' ? '' : Number(t.agentRate),
  }));
  const errors = P.validateTiers(tiers);
  if (errors.length) throw new ValidationError(errors);
  await db.transaction(async trx => {
    await syncList(trx, 'tiers', tiers, t => ({ name: t.name, title: t.title, basis: t.basis, threshold: t.threshold, agent_rate: t.agentRate }));
    // A lower total than the new agent rate would pay uplines a negative share.
    const rows = await trx('payout_totals as p').join('tiers as t', 't.id', 'p.tier_id')
      .whereRaw('p.total_pct < t.agent_rate').select('t.name', 'p.deal_type', 'p.total_pct', 't.agent_rate');
    if (rows.length) {
      throw new ValidationError(rows.map(r =>
        `${r.name} (${P.DEAL_TYPE_LABELS[r.deal_type]}): a total payout of ${Number(r.total_pct)}% is below the new agent rate ${Number(r.agent_rate)}%. Raise that total first.`));
    }
  });
  return loadSetup();
}

async function saveUplines(body) {
  const roles = (Array.isArray(body?.roles) ? body.roles : [])
    .map(r => ({ code: str(r.code).toUpperCase(), name: str(r.name) }));
  const errors = P.validateRoles(roles);
  if (errors.length) throw new ValidationError(errors);
  const splits = {};
  for (const combo of P.roleCombos(roles)) {
    const key = P.comboKey(combo);
    splits[key] = Object.fromEntries(combo.map(c => {
      const v = body?.splits?.[key]?.[c];
      return [c, v === '' || v == null ? '' : Number(v)];
    }));
  }
  const splitErrors = P.validateSplits(splits, roles);
  if (splitErrors.length) throw new ValidationError(splitErrors);
  await writeSetting('uplines', { roles, splits });
  return loadSetup();
}

// body: { branchId, dealType, totals: { [tierId]: pct | "" } }. A blank value
// removes the row: a branch falls back to the company default.
async function savePayouts(body) {
  const branchId = Number(body?.branchId);
  const dealType = body?.dealType;
  if (!P.DEAL_TYPES.includes(dealType)) throw new ValidationError(['Unknown deal type.']);
  if (!Number.isInteger(branchId) || branchId < 0) throw new ValidationError(['Unknown branch.']);
  if (branchId !== P.COMPANY_SCOPE && !(await db('branches').where('id', branchId).first())) {
    throw new ValidationError(['That branch no longer exists.']);
  }
  const tiers = await db('tiers').select('id', 'name', 'agent_rate');
  const errors = [], upserts = [], clears = [];
  for (const t of tiers) {
    if (!body?.totals || !(String(t.id) in body.totals)) continue;
    const v = body.totals[t.id];
    if (v === '' || v == null) { clears.push(t.id); continue; }
    const err = P.validateTotal(v, Number(t.agent_rate));
    if (err) errors.push(`${t.name}: total payout ${err}.`);
    else upserts.push({ branch_id: branchId, deal_type: dealType, tier_id: t.id, total_pct: Number(v) });
  }
  if (errors.length) throw new ValidationError(errors);
  await db.transaction(async trx => {
    if (clears.length) {
      await trx('payout_totals').where({ branch_id: branchId, deal_type: dealType }).whereIn('tier_id', clears).del();
    }
    if (upserts.length) await trx('payout_totals').insert(upserts).onConflict(['branch_id', 'deal_type', 'tier_id']).merge(['total_pct']);
  });
  return loadSetup();
}

module.exports = {
  ValidationError, loadSetup,
  saveCompany, saveDealTypes, saveNumbering, saveBranches, saveTiers, saveUplines, savePayouts,
};

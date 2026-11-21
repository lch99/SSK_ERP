// The payout standard Setup picks for E-Forms from a date:
//   'cms'      tiers, upline levels and total payouts (payout.js): the new way.
//   'existing' the current ERP's rules (its version 23H2.3, in use since August 2025),
//              so the ERP pays exactly as today until the company moves to the CMS.
//
// The existing standard, one side of a case at a time (the closing agent's side and
// the listing holder's), worked out from the 3,374 cases the current ERP paid under it:
//   • `cap` (90%) of the side is paid out; the company keeps the rest.
//   • The earner gets their position's rate (Trainee 60, Agent 70, … Team Leader 85).
//   • Above that rate the side is paid in bands, each to the nearest upline whose
//     position holds it: to 80 (Pre-Team Leader and up), 80–85 (Team Leader and up),
//     85–88 (Pre-Unit Manager and up; a Unit Manager keeps it on their own deals),
//     88–90 (Area Manager and up, themselves included).
//   • A band nobody up the chain holds goes to the Branch Manager (BM profit).
//   • The listing side, when someone else created the listing: the holder keeps up to
//     `holderKeeps` (60) plus whatever of their rate is above the creator's part (a Team
//     Leader keeps 65); the creator's part (`pct`, 20) goes to the creator by position
//     (5, 15 or 20) and the rest of it to the creator's own uplines.
// Rates are percentages of the side (60 = 60%), as in payout.js.

const r2 = n => Math.round(n * 100) / 100;
const isNum = v => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v));

export const STANDARDS = { cms: 'Tiers and uplines (new CMS)', existing: 'Existing standard (current ERP)' };

// Line roles the existing standard writes, the same codes as the lines imported from the current ERP.
export const EXISTING_ROLES = {
  PTL: 'Pre-Team Leader', TL: 'Team Leader', UM: 'Unit Manager', AM: 'Area Manager',
  BM: 'Branch Manager', CREATOR: 'Listing creator', CREATOR_T: "Listing creator's team",
};

// The current ERP's values. `rank` orders the ladder (blank: off it, never holds a band).
export const EXISTING_DEFAULT = Object.freeze({
  cap: 90,
  positions: [
    { code: 'TR', name: 'Trainee', rate: 60, rank: 1 },
    { code: 'AG', name: 'Agent', rate: 70, rank: 2 },
    { code: 'SN', name: 'Senior Negotiator', rate: 80, rank: 3 },
    { code: 'PTL', name: 'Pre-Team Leader', rate: 80, rank: 4 },
    { code: 'TL', name: 'Team Leader', rate: 85, rank: 5 },
    { code: 'PUM', name: 'Pre-Unit Manager', rate: 85, rank: 6 },
    { code: 'UM', name: 'Unit Manager', rate: 85, rank: 7 },
    { code: 'PAM', name: 'Pre-Area Manager', rate: 85, rank: 8 },
    { code: 'AM', name: 'Area Manager', rate: 85, rank: 9 },
    { code: 'DM', name: 'District Manager', rate: 85, rank: 10 },
    { code: 'BM', name: 'Branch Manager', rate: 80, rank: '' },
    { code: 'HQ', name: 'Agency HQ', rate: 85, rank: '' },
  ],
  // Each band: paid from the previous one up to `upTo`, to the nearest upline at `from` or above;
  // `selfFrom`: the earner keeps it when their own position is at it or above.
  bands: [
    { code: 'PTL', upTo: 80, from: 'PTL', selfFrom: '' },
    { code: 'TL', upTo: 85, from: 'TL', selfFrom: '' },
    { code: 'UM', upTo: 88, from: 'PUM', selfFrom: 'UM' },
    { code: 'AM', upTo: 90, from: 'AM', selfFrom: 'AM' },
  ],
  creator: {
    pct: 20, holderKeeps: 60,
    // The creator's own part by position; the steps above it go to their uplines at those positions.
    steps: [{ from: 'TR', upTo: 5 }, { from: 'PTL', upTo: 15 }, { from: 'TL', upTo: 20 }],
  },
  // { [branchId]: staffId }: the Branch Manager account each branch's BM profit is paid to.
  branchManagers: {},
});

export const existingDefault = () => structuredClone({ ...EXISTING_DEFAULT });

// The standard as Setup keeps it; older saved Setups have none and are on the CMS.
export function standardOf(s) {
  const st = s?.standard;
  if (!st || st.kind !== 'existing') return { kind: 'cms' };
  const d = EXISTING_DEFAULT;
  return { kind: 'existing', cap: st.cap ?? d.cap, positions: st.positions || d.positions, bands: st.bands || d.bands,
    creator: { ...d.creator, ...st.creator }, branchManagers: st.branchManagers || {}, branchRules: st.branchRules || {} };
}

// ── A branch's own rates ─────────────────────────────────────────────────────
// A branch may pay on its own numbers (its Branch Partner sets them on My branch), else on the
// company's. `branchRules`: { [branchId]: { cap, rates: { [position]: % }, bands: { [band]: up to % },
// creator: { pct, holderKeeps, steps: { [position]: up to % } } } }, each value optional. The
// positions, bands and their order stay the company's, so a chain across branches still lines up.
export function branchRulesOf(standard, branchId) {
  const r = standard?.branchRules;
  return branchId == null || !r ? null : r[branchId] ?? r[String(branchId)] ?? null;
}

// The existing standard a branch pays on: the company's, with the branch's own numbers over it.
export function standardFor(setup, branchId) {
  const st = standardOf(setup);
  const own = st.kind === 'existing' ? branchRulesOf(st, branchId) : null;
  if (!own) return st;
  const pick = (map, key, fallback) => (map && map[key] !== undefined && map[key] !== null ? map[key] : fallback);
  return { ...st, cap: pick(own, 'cap', st.cap),
    positions: st.positions.map(p => ({ ...p, rate: pick(own.rates, p.code, p.rate) })),
    bands: st.bands.map(b => ({ ...b, upTo: pick(own.bands, b.code, b.upTo) })),
    creator: { ...st.creator, pct: pick(own.creator, 'pct', st.creator.pct), holderKeeps: pick(own.creator, 'holderKeeps', st.creator.holderKeeps),
      steps: st.creator.steps.map(s => ({ ...s, upTo: pick(own.creator?.steps, s.from, s.upTo) })) } };
}

// What a branch keeps as its own, from the standard it edited (standardFor's shape).
export function ownRulesOf(st) {
  return { cap: st.cap, rates: Object.fromEntries(st.positions.map(p => [p.code, p.rate])),
    bands: Object.fromEntries(st.bands.map(b => [b.code, b.upTo])),
    creator: { pct: st.creator.pct, holderKeeps: st.creator.holderKeeps, steps: Object.fromEntries(st.creator.steps.map(s => [s.from, s.upTo])) } };
}

// One line for a branch's own numbers: paid-out share and each position's rate.
export const describeOwnRules = st => `${st.cap}% paid out · ${st.positions.map(p => `${p.code} ${p.rate}%`).join(' · ')}`;

// The numbers that decide what a side pays (to tell a real change from none).
export const moneyKeyOf = st => JSON.stringify(st.kind !== 'existing' ? null
  : [Number(st.cap), st.positions.map(p => Number(p.rate)), st.bands.map(b => Number(b.upTo)),
    Number(st.creator.pct), Number(st.creator.holderKeeps), st.creator.steps.map(s => Number(s.upTo))]);

export function validateStandard(st) {
  if (st?.kind === 'cms') return [];
  if (st?.kind !== 'existing') return ['Pick the payout standard.'];
  const errors = [];
  const cap = Number(st.cap);
  if (!isNum(st.cap) || cap <= 0 || cap > 100) errors.push('The paid-out share must be more than 0% and at most 100%.');
  const codes = new Set();
  if (!st.positions?.length) errors.push('Add at least one position.');
  for (const [i, p] of (st.positions || []).entries()) {
    const label = p.name || p.code || `Position ${i + 1}`;
    if (!/^[A-Z0-9]{1,10}$/.test(p.code || '')) errors.push(`${label}: the code is letters and numbers, up to 10.`);
    else if (codes.has(p.code)) errors.push(`Two positions use the code ${p.code}.`);
    codes.add(p.code);
    if (!String(p.name || '').trim()) errors.push(`Position ${p.code || i + 1} needs a name.`);
    if (!isNum(p.rate) || Number(p.rate) <= 0 || Number(p.rate) > cap) errors.push(`${label}: the rate must be more than 0% and at most ${isNum(st.cap) ? cap : 100}%.`);
    if (p.rank !== '' && p.rank != null && (!Number.isInteger(Number(p.rank)) || Number(p.rank) < 1)) errors.push(`${label}: the ladder place is a whole number from 1, or blank.`);
  }
  const ranked = c => (st.positions || []).some(p => p.code === c && p.rank !== '' && p.rank != null);
  let last = 0;
  for (const [i, b] of (st.bands || []).entries()) {
    const label = `Band ${i + 1}${b.code ? ` (${b.code})` : ''}`;
    if (!/^[A-Z0-9_]{1,10}$/.test(b.code || '')) errors.push(`${label}: the code is letters and numbers, up to 10.`);
    if (!isNum(b.upTo) || Number(b.upTo) <= last || Number(b.upTo) > cap) errors.push(`${label}: each band must end higher than the one before, at most ${isNum(st.cap) ? cap : 100}%.`);
    else last = Number(b.upTo);
    if (!ranked(b.from)) errors.push(`${label}: pick the position (on the ladder) that holds it.`);
    if (b.selfFrom && !ranked(b.selfFrom)) errors.push(`${label}: the earner's own position must be on the ladder.`);
  }
  const c = st.creator || {};
  if (!isNum(c.pct) || Number(c.pct) < 0 || !isNum(c.holderKeeps) || Number(c.holderKeeps) < 0 || Number(c.holderKeeps) + Number(c.pct) > cap) {
    errors.push(`The listing creator's part and what the holder keeps must add up to at most ${isNum(st.cap) ? cap : 100}%.`);
  }
  let step = 0;
  for (const [i, s] of (c.steps || []).entries()) {
    if (!ranked(s.from)) errors.push(`Creator step ${i + 1}: pick a position on the ladder.`);
    if (!isNum(s.upTo) || Number(s.upTo) <= step || Number(s.upTo) > Number(c.pct)) errors.push(`Creator step ${i + 1}: each step must be higher than the one before, at most the creator's part.`);
    else step = Number(s.upTo);
  }
  return errors;
}

// ── One side of a case ────────────────────────────────────────────────────────
// staffById: { [id]: { id, role (position code), uplineId, status } }. creatorId: the
// listing's creator on the listing side (null on the closing agent's side). bmId: the
// Branch Manager account for this side. Returns the lines (earner first, role null),
// what the company keeps, and the earner's rate.
export function existingSide({ standard, amount, earnerId, creatorId = null, staffById, bmId = null }) {
  const st = standard;
  const cap = Number(st.cap);
  const pos = code => st.positions.find(p => p.code === code);
  const rankOf = code => { const p = pos(code); return p && p.rank !== '' && p.rank != null ? Number(p.rank) : null; };
  const positionOf = id => staffById[id]?.role;
  const holds = (id, from) => { const r = rankOf(positionOf(id)), need = rankOf(from); return r != null && need != null && r >= need; };
  const active = id => staffById[id] && staffById[id].status !== 'inactive';
  // Up the chain from (not including) `id`; people who have left are passed over.
  const nearestUp = (id, from) => {
    const seen = new Set([id]);
    for (let p = staffById[staffById[id]?.uplineId]; p && !seen.has(p.id); p = staffById[p.uplineId]) {
      seen.add(p.id);
      if (active(p.id) && holds(p.id, from)) return p.id;
    }
    return null;
  };
  const rate = Number(pos(positionOf(earnerId))?.rate ?? st.positions[0]?.rate ?? 0);
  const lines = [];
  const add = (staffId, role, pct) => { if (pct > 0) lines.push({ staffId, role, pct: r2(pct) }); };
  const toBm = pct => add(bmId, 'BM', pct);

  let at;
  if (creatorId != null && creatorId !== earnerId && st.creator && Number(st.creator.pct) > 0) {
    const c = st.creator, keeps = Number(c.holderKeeps), part = Number(c.pct);
    add(earnerId, null, Math.min(rate, keeps) + Math.max(0, rate - keeps - part));
    let given = 0;
    if (active(creatorId)) {
      const own = [...(c.steps || [])].reverse().find(s => holds(creatorId, s.from)) || (c.steps || [])[0];
      if (own) { add(creatorId, 'CREATOR', Number(own.upTo)); given = Number(own.upTo); }
    }
    for (const s of c.steps || []) {
      if (Number(s.upTo) <= given) continue;
      const who = nearestUp(creatorId, s.from);
      if (who != null) { add(who, 'CREATOR_T', Number(s.upTo) - given); given = Number(s.upTo); }
    }
    if (given < part) toBm(part - given);
    at = Math.max(rate, keeps + part);
  } else {
    add(earnerId, null, rate);
    at = rate;
  }
  for (const b of st.bands) {
    const upTo = Number(b.upTo);
    if (upTo <= at) continue;
    const who = b.selfFrom && holds(earnerId, b.selfFrom) ? earnerId : nearestUp(earnerId, b.from);
    if (who != null) { add(who, b.code, upTo - at); at = upTo; }
  }
  if (at < cap) toBm(cap - at);

  // One line per person and role; BM profit with no Branch Manager account stays with the company.
  const merged = [];
  for (const l of lines) {
    if (l.role === 'BM' && l.staffId == null) continue;
    const same = merged.find(m => m.staffId === l.staffId && m.role === l.role);
    if (same) same.pct = r2(same.pct + l.pct); else merged.push({ ...l });
  }
  const a = Number(amount) || 0;
  let paid = 0;
  const priced = merged.map(l => { const amt = r2(a * l.pct / 100); paid = r2(paid + amt); return { ...l, amount: amt }; });
  const paidPct = r2(merged.reduce((s, l) => s + l.pct, 0));
  return { lines: priced, company: r2(a - paid), companyPct: r2(100 - paidPct), agentRate: priced[0]?.pct ?? 0 };
}

// The two sides under the existing standard: with a listing, always the closing agent's
// and the holder's (also when they are the same person, so a creator's part still applies
// to the listing half); without one, the closing agent's alone.
export function existingSides({ agentId, holderId, listingId }, salesPct = 50) {
  if (listingId === '' || listingId == null || holderId == null || holderId === '') return [{ side: 'sales', staffId: agentId, pct: 100 }];
  const pct = isNum(salesPct) ? Number(salesPct) : 50;
  return [{ side: 'sales', staffId: agentId, pct }, { side: 'listing', staffId: holderId, pct: r2(100 - pct) }];
}

// The Branch Manager account for a side: the closing agent's own branch on their side,
// the case's branch on the listing side (as the current ERP pays BM profit).
export function branchManagerFor(standard, side, { deal, earner }) {
  const of = branchId => { const id = standard.branchManagers?.[branchId] ?? standard.branchManagers?.[String(branchId)]; return id == null || id === '' ? null : Number(id); };
  // The closing agent's branch first on their side; a branch with no Branch Manager account (Head office) falls back to the case's.
  return (side === 'sales' ? of(earner?.branchId) : null) ?? of(deal.branchId);
}

export function describeStandard(st) {
  if (st.kind !== 'existing') return STANDARDS.cms;
  return `${STANDARDS.existing}: ${st.positions.length} positions, ${st.bands.length} upline bands, ${st.cap}% paid out`;
}

// The positions people hold: the existing standard's (junior first), or the CMS's upline levels.
export function positionsOf(setup) {
  const st = standardOf(setup);
  return st.kind === 'existing' ? st.positions.map(p => ({ code: p.code, name: p.name })) : setup?.roles || [];
}

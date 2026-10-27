// Tier, upline-split and total-payout rules — the one copy of this maths.
// Imported by the Setup page (src/) and the API (backend/), so what the page
// previews is exactly what the server validates and stores.
//
// All rates here are PERCENTAGES of the commission (60 = 60%), 2 dp at most.
//
// How a deal pays out:
//   • The negotiator earns their tier's agent rate.
//   • If they have uplines, the deal pays out the tier's TOTAL payout (set per
//     deal type, company-wide, optionally overridden per branch). The upline
//     pool is `total − agent rate`, shared by whichever uplines the chain has,
//     using the split set for that combination of uplines.
//   • Whatever isn't paid out stays with the company.

export const DEAL_TYPES = ["sale", "rental", "project"];
export const DEAL_TYPE_LABELS = { sale: "Sub-Sales", rental: "Rental", project: "Project" };
export const COMPANY_SCOPE = 0;            // payout_totals.branch_id for the company default

const r2 = n => Math.round(n * 100) / 100;
const isNum = v => v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v));
const twoDp = n => Math.abs(Math.round(n * 100) - n * 100) <= 1e-6;

// ── Tiers ────────────────────────────────────────────────────────────────────
// tiers: [{ id, name, title, basis: "lifetime" | "yearly", threshold, agentRate }]
// in ladder order. `name` is the short code (T1); `title` is the optional name
// the company calls that level (e.g. "Senior Negotiator"). Lifetime tiers come first and climb on lifetime commission;
// yearly tiers unlock once the top lifetime tier is reached and climb on this
// year's commission.

export function validateTiers(tiers) {
  const errors = [];
  if (!tiers?.length) return ["Add at least one tier."];
  const names = new Set();
  let seenYearly = false;
  let prev = { lifetime: null, yearly: null };
  tiers.forEach((t, i) => {
    const label = t.name?.trim() || `Tier ${i + 1}`;
    if (!t.name?.trim()) errors.push(`Tier ${i + 1} needs a code (e.g. T${i + 1}).`);
    else if (t.name.trim().length > 20) errors.push(`${label}: code can be at most 20 characters.`);
    else if (names.has(t.name.trim().toLowerCase())) errors.push(`Two tiers are called "${t.name.trim()}".`);
    names.add(t.name?.trim().toLowerCase());
    if (String(t.title ?? "").trim().length > 60) errors.push(`${label}: name can be at most 60 characters.`);

    if (t.basis !== "lifetime" && t.basis !== "yearly") errors.push(`${label}: pick Lifetime or Yearly.`);
    if (t.basis === "yearly") seenYearly = true;
    else if (seenYearly) errors.push(`${label}: lifetime tiers must all come before the yearly tiers.`);

    if (!isNum(t.threshold) || Number(t.threshold) < 0) errors.push(`${label}: threshold must be RM 0 or more.`);
    else {
      const th = Number(t.threshold);
      if (i === 0 && th !== 0) errors.push(`${label}: the first tier's threshold must be RM 0 — every agent starts there.`);
      if (t.basis === "yearly" && th <= 0) errors.push(`${label}: a yearly threshold must be more than RM 0.`);
      const p = prev[t.basis];
      if (p !== null && th <= p) errors.push(`${label}: threshold must be higher than the tier before it.`);
      if (t.basis in prev) prev[t.basis] = th;
    }

    if (!isNum(t.agentRate) || Number(t.agentRate) <= 0 || Number(t.agentRate) >= 100) {
      errors.push(`${label}: agent rate must be between 0% and 100%.`);
    } else if (!twoDp(Number(t.agentRate))) errors.push(`${label}: agent rate can have at most 2 decimal places.`);
  });
  if (tiers[0]?.basis === "yearly") errors.push("The first tier must be a Lifetime tier.");
  return errors;
}

// Index (into `tiers`) of the tier an agent's totals reach. `floorIndex` is a
// manual tier floor (e.g. a tier kept from a previous year).
// "T1 · Senior Negotiator", or just "T1" when the tier has no name.
export const tierLabel = t => (String(t?.title ?? "").trim() ? `${t.name} · ${String(t.title).trim()}` : t?.name ?? "");

export function computeTierIndex(lifetime, yearly, tiers, floorIndex = 0) {
  let idx = 0;
  const lifetimeIdx = tiers.map((t, i) => [t, i]).filter(([t]) => t.basis === "lifetime");
  for (const [t, i] of lifetimeIdx) if (Number(lifetime) >= Number(t.threshold)) idx = i;
  const topLifetime = lifetimeIdx.length ? lifetimeIdx[lifetimeIdx.length - 1][1] : -1;
  if (idx === topLifetime) {
    tiers.forEach((t, i) => {
      if (t.basis === "yearly" && Number(yearly) >= Number(t.threshold)) idx = i;
    });
  }
  return Math.max(idx, Math.min(Number(floorIndex) || 0, tiers.length - 1));
}

// ── Upline roles and how they split the pool ─────────────────────────────────
// roles: [{ code, name }] ordered most junior → most senior (e.g. AGA, TSM, GSM).
// splits: { [code]: pct } — each level's fixed share of the upline pool, adding
// up to 100. A level missing from a deal doesn't pass its share to the others:
// it stays with the company (the client's rule, 2026-10-27).

// Juniors take 20% each, the most senior upline takes the rest
// (2 uplines → 20 / 80, 3 → 20 / 20 / 60). Equal shares if 20% each won't fit.
export function defaultSplit(codes) {
  const n = codes.length;
  const junior = n * 20 < 100 ? 20 : Math.floor(10000 / n) / 100;
  const out = {};
  codes.forEach((c, i) => { out[c] = i === n - 1 ? r2(100 - junior * (n - 1)) : junior; });
  return out;
}

// Keep the split while it still names exactly these levels; otherwise default
// it. A lone level always holds the whole pool. Splits saved before 2026-10-27
// had one per mix of uplines, keyed "AGA+TSM+GSM": the whole chain's is kept.
export function normalizeSplits(splits, roles) {
  const codes = roles.map(r => r.code);
  if (codes.length < 2) return defaultSplit(codes);
  const old = splits?.[codes.join("+")];
  const have = old && typeof old === "object" ? old : splits || {};
  const same = Object.keys(have).length === codes.length && codes.every(c => isNum(have[c]));
  return same ? Object.fromEntries(codes.map(c => [c, Number(have[c])])) : defaultSplit(codes);
}

export function validateRoles(roles) {
  const errors = [];
  const codes = new Set();
  (roles || []).forEach((r, i) => {
    const code = String(r.code || "").trim();
    if (!code) errors.push(`Upline ${i + 1} needs a short code (e.g. TSM).`);
    else if (!/^[A-Za-z0-9]{1,10}$/.test(code)) errors.push(`"${code}": codes are letters/numbers only, up to 10.`);
    else if (codes.has(code.toUpperCase())) errors.push(`Two uplines use the code "${code}".`);
    codes.add(code.toUpperCase());
    if (!String(r.name || "").trim()) errors.push(`Upline ${code || i + 1} needs a name.`);
  });
  if ((roles || []).length > 4) errors.push("Up to 4 upline levels are supported.");
  return errors;
}

export function validateSplits(splits, roles) {
  const codes = (roles || []).map(r => r.code);
  if (codes.length < 2) return [];
  let sum = 0;
  for (const c of codes) {
    const v = splits?.[c];
    if (!isNum(v) || Number(v) < 0 || Number(v) > 100) return [`${c}: its share must be 0–100% of the upline pool.`];
    if (!twoDp(Number(v))) return [`${c}: at most 2 decimal places.`];
    sum += Number(v);
  }
  return Math.round(sum * 100) !== 10000 ? [`The upline shares add up to ${r2(sum)}%, must be 100%.`] : [];
}

// ── Total payout per tier ────────────────────────────────────────────────────
// totals: [{ branchId, dealType, tierId, totalPct }] — branchId COMPANY_SCOPE
// is the company default; a branch row overrides it for that deal type + tier.

export function validateTotal(totalPct, agentRate) {
  if (!isNum(totalPct)) return "must be a number";
  const n = Number(totalPct);
  if (n < Number(agentRate)) return `must be at least the agent rate (${Number(agentRate)}%)`;
  if (n > 100) return "cannot be more than 100%";
  if (!twoDp(n)) return "at most 2 decimal places";
  return null;
}

export function resolveTotal(totals, { branchId, dealType, tierId }) {
  const find = scope => totals.find(t =>
    Number(t.branchId) === Number(scope) && t.dealType === dealType && Number(t.tierId) === Number(tierId));
  const own = branchId != null && Number(branchId) !== COMPANY_SCOPE ? find(branchId) : null;
  if (own) return { pct: Number(own.totalPct), source: "branch" };
  const company = find(COMPANY_SCOPE);
  return company ? { pct: Number(company.totalPct), source: "company" } : null;
}

// ── Branch tier lists ────────────────────────────────────────────────────────
// branchTiers: { [branchId]: tiers[] }. A branch listed there has its own tier
// list (own names, thresholds, rates). Every other branch uses the company tiers.
// The Setup page fills both from its tier plans (below); the backend still
// stores branch lists with their totals as payout_totals rows of that branchId.

export const hasOwnTiers = (s, branchId) =>
  branchId != null && Number(branchId) !== COMPANY_SCOPE && Array.isArray(s?.branchTiers?.[branchId]);

export const tiersFor = (s, branchId) => (hasOwnTiers(s, branchId) ? s.branchTiers[branchId] : s?.tiers || []);

// ── Tier plans ───────────────────────────────────────────────────────────────
// plans: [{ id, name, branchIds, tiers }]. Each tier carries its own total
// payout per deal type: tier.totals = { sale: 85, rental: 85, … }.
// The first plan is the standard one: every branch not picked for another plan
// uses it, so its branchIds stay empty. A branch is on exactly one plan.

export const STANDARD_PLAN = "Standard";

// Index of the plan a branch pays on (0 = the standard plan).
export function planIndexFor(plans, branchId) {
  const i = (plans || []).findIndex((p, j) => j > 0 && (p.branchIds || []).map(Number).includes(Number(branchId)));
  return i > 0 ? i : 0;
}

export const branchesOnPlan = (plans, branches, index) => (branches || []).filter(b => planIndexFor(plans, b.id) === index);

export const planLabel = (p, i) => String(p?.name ?? "").trim() || (i === 0 ? STANDARD_PLAN : `Plan ${i + 1}`);

// Ladder order: lifetime tiers first, each part by threshold. Blank thresholds
// keep their place at the end, so a half-typed row doesn't jump around.
export function sortTiers(tiers) {
  const key = t => (isNum(t.threshold) ? Number(t.threshold) : Infinity);
  return (tiers || []).map((t, i) => [t, i])
    .sort(([a, i], [b, j]) => (a.basis === "yearly") - (b.basis === "yearly") || key(a) - key(b) || i - j)
    .map(([t]) => t);
}

export function validatePlans(plans, dealTypes, branches = []) {
  if (!plans?.length || !plans[0].tiers?.length) return ["Add at least one tier."];
  const errors = [];
  const enabled = DEAL_TYPES.filter(dt => dealTypes?.[dt]?.enabled);
  const many = plans.length > 1;
  const names = new Set();
  const onPlan = new Map();          // branchId → plan name
  plans.forEach((p, i) => {
    const name = planLabel(p, i);
    const pre = many ? `${name}: ` : "";
    if (i > 0 && !String(p.name ?? "").trim()) errors.push(`Plan ${i + 1} needs a name.`);
    else if (names.has(name.toLowerCase())) errors.push(`Two tier plans are called "${name}".`);
    names.add(name.toLowerCase());
    if (i > 0) {
      if (!p.branchIds?.length) errors.push(`${pre}pick the branches that use it, or remove the plan.`);
      for (const id of p.branchIds || []) {
        const b = branches.find(x => Number(x.id) === Number(id));
        if (onPlan.has(Number(id))) errors.push(`${b?.name || "A branch"} is on two plans (${onPlan.get(Number(id))} and ${name}).`);
        onPlan.set(Number(id), name);
      }
    }
    if (!p.tiers?.length) { errors.push(`${pre}add at least one tier.`); return; }
    errors.push(...validateTiers(p.tiers).map(e => pre + e));
    // Every tier needs a total for each deal type in use; one line per deal type.
    for (const dt of DEAL_TYPES) {
      const missing = [];
      for (const [j, t] of p.tiers.entries()) {
        const v = t.totals?.[dt];
        const tier = String(t.name ?? "").trim() || `Tier ${j + 1}`;
        if (v === "" || v == null) { if (enabled.includes(dt)) missing.push(tier); continue; }
        const err = validateTotal(v, t.agentRate);
        if (err) errors.push(`${pre}${tier}: total payout${enabled.length > 1 ? ` (${DEAL_TYPE_LABELS[dt]})` : ""} ${err}.`);
      }
      if (missing.length) errors.push(`${pre}set the total payout${enabled.length > 1 ? ` for ${DEAL_TYPE_LABELS[dt]}` : ""} of ${missing.join(", ")}.`);
    }
  });
  return errors;
}

// The plans as the checklist sees them. Callers without plans (the backend)
// pass company tiers + branchTiers + totals instead.
function plansOf(s) {
  if (Array.isArray(s?.plans)) return s.plans;
  if (!s?.tiers?.length) return [];
  const withTotals = (tiers, branchId) => tiers.map(t => ({ ...t, totals: Object.fromEntries(DEAL_TYPES.flatMap(dt => {
    const r = resolveTotal(s.totals || [], { branchId, dealType: dt, tierId: t.id });
    return r ? [[dt, r.pct]] : [];
  })) }));
  return [
    { name: "Company", branchIds: [], tiers: withTotals(s.tiers, COMPANY_SCOPE) },
    ...(s.branches || []).filter(b => hasOwnTiers(s, b.id)).map(b => ({ name: b.name, branchIds: [b.id], tiers: withTotals(s.branchTiers[b.id], b.id) })),
  ];
}

// Percent shares of one deal's commission. `uplines` are the codes the
// negotiator's chain actually has. Each level gets its own share of the pool,
// whoever else is on the deal; a missing level's share goes to the company.
// Shares are rounded to 2 dp and the most senior level takes the remainder, so
// the whole chain adds up to the total exactly.
export function distribute({ agentRate, totalPct, uplines = [], splits, roles }) {
  const agent = Number(agentRate);
  const order = roles.map(r => r.code);
  if (!order.some(c => uplines.includes(c)) || totalPct == null) {
    return { agent, uplines: {}, company: r2(100 - agent) };
  }
  const pool = r2(Number(totalPct) - agent);
  const split = order.every(c => isNum(splits?.[c])) ? splits : normalizeSplits(splits, roles);
  const shares = {};
  let given = 0, paid = 0;
  order.forEach((c, i) => {
    const share = i === order.length - 1 ? r2(pool - given) : r2(pool * Number(split[c]) / 100);
    given = r2(given + share);
    if (uplines.includes(c)) { shares[c] = share; paid = r2(paid + share); }
  });
  return { agent, uplines: shares, company: r2(100 - agent - paid) };
}

// ── One deal's money ─────────────────────────────────────────────────────────
// `fee` is the agency's professional fee agreed on the deal. With SST "on top"
// the client pays fee + SST; "included" means the fee already holds the SST.
// A co-broke agency keeps (100 − coaSharePct)% of the fee; an outside referrer
// gets referralPct% of what is left. `net` is shared by the people on the deal.
export function dealMoney({ fee, sstPct = 0, sstMode = "on_top", coBroke = false, coaSharePct = 100, referral = false, referralPct = 0 }) {
  const f = Number(fee) || 0, rate = Number(sstPct) || 0;
  const exSst = sstMode === "included" ? r2(f * 100 / (100 + rate)) : r2(f);
  const sst = sstMode === "included" ? r2(f - exSst) : r2(f * rate / 100);
  const coBrokeFee = coBroke ? r2(exSst * (100 - Number(coaSharePct)) / 100) : 0;
  const ours = r2(exSst - coBrokeFee);
  const referralFee = referral ? r2(ours * Number(referralPct) / 100) : 0;
  return { fee: exSst, sst, billed: r2(exSst + sst), coBroke: coBrokeFee, ours, referral: referralFee, net: r2(ours - referralFee) };
}

// ── The two sides of a deal ──────────────────────────────────────────────────
// The negotiator who closed the deal (sales side) and the agent holding the
// listing (listing side) share its commission, each paid on their own tier and
// uplines. When one person holds both, or there is no listing holder (e.g. a
// project deal), the sales side takes it all.
// TODO: SIDE_SHARE copies the legacy ERP (50/50); move it into Setup once confirmed.
export const SIDE_SHARE = 50;
export const SIDE_LABELS = { sales: "Sales side", listing: "Listing side" };

export function dealSides(agentId, holderId) {
  if (holderId == null || holderId === agentId) return [{ side: "sales", staffId: agentId, pct: 100 }];
  return [{ side: "sales", staffId: agentId, pct: SIDE_SHARE }, { side: "listing", staffId: holderId, pct: 100 - SIDE_SHARE }];
}

// Who holds each upline role above a staff member: the nearest person up the
// chain with that role. staffById: { [id]: { id, uplineId, role, status } }.
// When that nearest person has left (Inactive), the role is empty on this deal:
// nobody further up takes it, so its share stays with the company.
export function uplineHolders(staffById, staffId, roles) {
  const codes = new Set(roles.map(r => r.code));
  const out = {};
  const seen = new Set([staffId]);
  let p = staffById[staffById[staffId]?.uplineId];
  while (p && !seen.has(p.id)) {
    seen.add(p.id);
    if (codes.has(p.role) && !(p.role in out)) out[p.role] = p.status === "inactive" ? null : p.id;
    p = staffById[p.uplineId];
  }
  return Object.fromEntries(Object.entries(out).filter(([, id]) => id != null));
}

// One side's payout lines in RM: the earner at their agent rate, then each
// upline holder (holders: { [roleCode]: staffId }). The company keeps the rest,
// including any rounding, so lines + company always equal `amount`.
export function payoutLines({ amount, earnerId, agentRate, totalPct, holders = {}, splits, roles }) {
  const out = distribute({ agentRate, totalPct, uplines: Object.keys(holders), splits, roles });
  const a = Number(amount) || 0;
  const lines = [{ staffId: earnerId, role: null, pct: out.agent }];
  for (const r of roles) if (out.uplines[r.code] != null) lines.push({ staffId: holders[r.code], role: r.code, pct: out.uplines[r.code] });
  let paid = 0;
  const priced = lines.map(l => {
    const amt = r2(a * l.pct / 100);
    paid = r2(paid + amt);
    return { ...l, amount: amt };
  });
  return { lines: priced, company: r2(a - paid), companyPct: out.company };
}

// A payslip's totals: withholding tax comes off the gross (none when exempt).
export function payslipTotals(amounts, whtPct, exempt = false) {
  const gross = r2(amounts.reduce((s, a) => s + Number(a || 0), 0));
  const wht = exempt ? 0 : r2(gross * (Number(whtPct) || 0) / 100);
  return { gross, wht, net: r2(gross - wht) };
}

// ── Numbering ────────────────────────────────────────────────────────────────
// numbering: {
//   letters: { sale, rental, project }, caseDigits, voucherPrefix, voucherDigits,
//   branches: { [branchId]: { prefixes: { sale?, rental?, project?, voucher? },
//                             starts:   { sale?, rental?, project?, voucher? } } }
// }
// A number is prefix + running number. By default the prefix is the deal-type
// letter (or voucher prefix) + the branch code: S + TD → STD0001. A branch can
// set its own prefix and first number for any of them; blank = the default.
// Each prefix keeps its own running number.

export const NUMBER_KINDS = [...DEAL_TYPES, "voucher"];
export const NUMBER_KIND_LABELS = { ...DEAL_TYPE_LABELS, voucher: "Payment voucher" };
const PREFIX_RE = /^[A-Z0-9]{1,8}$/;

const digitsFor = (numbering, kind) =>
  Number(kind === "voucher" ? numbering?.voucherDigits : numbering?.caseDigits) || 4;

export function defaultPrefix(numbering, kind, branchCode) {
  const lead = kind === "voucher" ? numbering?.voucherPrefix ?? "" : numbering?.letters?.[kind] ?? "";
  return `${lead}${branchCode || "??"}`;
}

export function branchPrefix(numbering, kind, branch) {
  const own = String(numbering?.branches?.[branch?.id]?.prefixes?.[kind] ?? "").trim();
  return own || defaultPrefix(numbering, kind, branch?.code);
}

export function branchStart(numbering, kind, branch) {
  const n = Number(numbering?.branches?.[branch?.id]?.starts?.[kind]);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function formatNumber(numbering, kind, branch, seq = branchStart(numbering, kind, branch)) {
  return `${branchPrefix(numbering, kind, branch)}${String(seq).padStart(digitsFor(numbering, kind), "0")}`;
}

export function previewCaseNo(numbering, dealType, branchCode, seq = 1) {
  return formatNumber(numbering, dealType, { id: null, code: branchCode }, seq);
}

export function previewVoucherNo(numbering, branchCode, seq = 1) {
  return formatNumber(numbering, "voucher", { id: null, code: branchCode }, seq);
}

// Keep only what a branch actually changed; drop branches that no longer exist.
export function cleanBranchNumbering(raw, branches) {
  const out = {};
  for (const b of branches || []) {
    const r = raw?.[b.id];
    if (!r) continue;
    const prefixes = {}, starts = {};
    for (const k of NUMBER_KINDS) {
      const p = String(r.prefixes?.[k] ?? "").trim().toUpperCase();
      if (p) prefixes[k] = p;
      const st = r.starts?.[k];
      if (st !== "" && st != null) starts[k] = Number(st);
    }
    if (Object.keys(prefixes).length || Object.keys(starts).length) out[b.id] = { prefixes, starts };
  }
  return out;
}

export function validateNumbering(numbering, dealTypes, branches = []) {
  const errors = [];
  const used = new Set();
  const enabled = DEAL_TYPES.filter(dt => dealTypes?.[dt]?.enabled);
  for (const dt of enabled) {
    const l = String(numbering?.letters?.[dt] ?? "").trim();
    if (!/^[A-Za-z]{1,3}$/.test(l)) errors.push(`${DEAL_TYPE_LABELS[dt]}: case prefix must be 1–3 letters.`);
    else if (used.has(l.toUpperCase())) errors.push(`Two deal types use the case prefix "${l}" — their numbers would clash.`);
    used.add(l.toUpperCase());
  }
  for (const [k, label] of [["caseDigits", "Case number"], ["voucherDigits", "Voucher number"]]) {
    const d = Number(numbering?.[k]);
    if (!Number.isInteger(d) || d < 2 || d > 8) errors.push(`${label} digits must be 2–8.`);
  }
  if (!/^[A-Za-z]{0,4}$/.test(String(numbering?.voucherPrefix ?? ""))) errors.push("Voucher prefix: up to 4 letters.");

  // Each branch's own prefixes and first numbers.
  const kinds = [...enabled, "voucher"];
  for (const b of branches) {
    const own = numbering?.branches?.[b.id];
    if (!own) continue;
    for (const k of kinds) {
      const p = String(own.prefixes?.[k] ?? "").trim();
      if (p && !PREFIX_RE.test(p.toUpperCase())) errors.push(`${b.name} ${NUMBER_KIND_LABELS[k]}: prefix must be 1–8 letters or numbers.`);
      const st = own.starts?.[k];
      if (st !== "" && st != null) {
        const n = Number(st), max = 10 ** digitsFor(numbering, k) - 1;
        if (!Number.isInteger(n) || n < 1 || n > max) errors.push(`${b.name} ${NUMBER_KIND_LABELS[k]}: first number must be a whole number from 1 to ${max}.`);
      }
    }
  }

  // No two branches / deal types may end up sharing a prefix (vouchers are
  // checked among themselves: they are a separate series).
  for (const group of [enabled, ["voucher"]]) {
    const seen = new Map();
    for (const b of branches) for (const k of group) {
      const p = branchPrefix(numbering, k, b).toUpperCase();
      const who = `${b.name} ${NUMBER_KIND_LABELS[k]}`;
      if (seen.has(p)) errors.push(`${seen.get(p)} and ${who} would both use "${p}" — their numbers would clash.`);
      else seen.set(p, who);
    }
  }
  return errors;
}

export function validateDealTypes(dealTypes) {
  const errors = [];
  const on = DEAL_TYPES.filter(dt => dealTypes?.[dt]?.enabled);
  if (!on.length) errors.push("Turn on at least one deal type.");
  for (const dt of on) {
    const r = dealTypes[dt].defaultRate;
    if (!isNum(r) || Number(r) <= 0 || Number(r) > 100) errors.push(`${DEAL_TYPE_LABELS[dt]}: default commission rate must be more than 0% and at most 100%.`);
  }
  if (!isNum(dealTypes?.sstPct) || Number(dealTypes.sstPct) < 0 || Number(dealTypes.sstPct) > 100) errors.push("SST must be 0–100%.");
  if (dealTypes?.sstMode != null && !SST_MODES.some(m => m.value === dealTypes.sstMode)) errors.push("Pick how SST is charged.");
  for (const [k, label, max] of [["whtPct", "Withholding tax", 10], ["coaSharePct", "Co-agency share", 100], ["referralPct", "Referral fee", 100]]) {
    if (dealTypes?.[k] == null) continue;
    if (!isNum(dealTypes[k]) || Number(dealTypes[k]) < 0 || Number(dealTypes[k]) > max) errors.push(`${label} must be 0–${max}%.`);
  }
  return errors;
}

export const SST_MODES = [
  { value: "on_top", label: "Added on top", desc: "Client pays commission + SST (e.g. RM 10,000 + RM 800)." },
  { value: "included", label: "Already included", desc: "The commission amount already includes SST (RM 10,000 includes RM 740.74)." },
];

export function validateBranches(branches) {
  const errors = [];
  const names = new Set(), codes = new Set();
  if (!branches?.length) errors.push("Add at least one branch.");
  (branches || []).forEach((b, i) => {
    const name = String(b.name || "").trim(), code = String(b.code || "").trim().toUpperCase();
    if (!name) errors.push(`Branch ${i + 1} needs a name.`);
    else if (names.has(name.toLowerCase())) errors.push(`Two branches are called "${name}".`);
    names.add(name.toLowerCase());
    if (!/^[A-Z0-9]{1,4}$/.test(code)) errors.push(`${name || `Branch ${i + 1}`}: code must be 1–4 letters/numbers.`);
    else if (codes.has(code)) errors.push(`Two branches use the code "${code}".`);
    codes.add(code);
  });
  return errors;
}

export function validateCompany(company) {
  const errors = [];
  if (!String(company?.name || "").trim()) errors.push("Company name is required.");
  if (!String(company?.regNo || "").trim()) errors.push("SSM registration number is required (it prints on vouchers).");
  if (company && "licenceNo" in company) {
    if (!String(company.licenceNo || "").trim()) errors.push("Estate agency licence no. (BOVAEPM) is required — it must appear on documents.");
    if (!String(company.reaName || "").trim()) errors.push("Name the Registered Estate Agent (REA) in charge.");
    if (!String(company.reaNo || "").trim()) errors.push("The REA's registration no. is required.");
  }
  return errors;
}

// ── Company bank accounts ────────────────────────────────────────────────────
// [{ id, bank, accountName, accountNo, purpose: "operating" | "client" }]

export const BANK_PURPOSES = [
  { value: "operating", label: "Operating", desc: "Pays agents, uplines and co-agencies." },
  { value: "client", label: "Client account", desc: "Holds buyers' and tenants' deposits." },
];

export function validateBankAccounts(accounts) {
  const errors = [];
  if (!accounts?.length) return ["Add at least one company bank account."];
  const seen = new Set();
  accounts.forEach((a, i) => {
    const who = String(a.bank || "").trim() || `Account ${i + 1}`;
    if (!String(a.bank || "").trim()) errors.push(`Account ${i + 1}: pick the bank.`);
    if (!String(a.accountName || "").trim()) errors.push(`${who}: account name is required.`);
    const no = String(a.accountNo || "").replace(/[\s-]/g, "");
    if (!/^\d{6,20}$/.test(no)) errors.push(`${who}: account no. should be 6–20 digits.`);
    else if (seen.has(no)) errors.push(`Account no. ${a.accountNo} is listed twice.`);
    seen.add(no);
    if (!BANK_PURPOSES.some(p => p.value === a.purpose)) errors.push(`${who}: pick what the account is for.`);
  });
  if (!errors.length && !accounts.some(a => a.purpose === "operating")) errors.push("Mark one account as Operating — agents are paid from it.");
  return errors;
}

// ── Approvals and paying agents ──────────────────────────────────────────────

export const APPROVERS = [
  { value: "manager", label: "Branch manager" },
  { value: "boss", label: "Boss / director" },
  { value: "both", label: "Branch manager, then boss" },
];
export const PAY_WHEN = [
  { value: "full", label: "After the client has paid in full", desc: "Safest: nothing is paid out before the whole commission is in." },
  { value: "received", label: "As money comes in", desc: "Pay each person their share of whatever has been received so far." },
];
export const PAY_RUNS = [
  { value: "weekly", label: "Every week" },
  { value: "twice", label: "Twice a month (1st and 15th)" },
  { value: "monthly", label: "Once a month" },
  { value: "any", label: "Any day, once approved" },
];
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function validateApprovals(a) {
  const errors = [];
  if (!APPROVERS.some(x => x.value === a?.dealApprover)) errors.push("Pick who approves a deal's payout.");
  if (a?.dealApprover === "manager" && a.bossAbove !== "" && a.bossAbove != null && (!isNum(a.bossAbove) || Number(a.bossAbove) < 0)) {
    errors.push("The amount that needs the boss must be RM 0 or more (or leave it blank).");
  }
  if (!["manager", "boss"].includes(a?.refundApprover)) errors.push("Pick who approves refunds.");
  if (!PAY_WHEN.some(x => x.value === a?.payWhen)) errors.push("Pick when agents get paid.");
  if (!PAY_RUNS.some(x => x.value === a?.payRun)) errors.push("Pick how often payments are made.");
  if (a?.payRun === "weekly" && !(Number(a.payDay) >= 1 && Number(a.payDay) <= 7)) errors.push("Pick the weekday payments are made.");
  if (a?.payRun === "monthly" && !(Number.isInteger(Number(a.payDay)) && Number(a.payDay) >= 1 && Number(a.payDay) <= 28)) errors.push("Pick a payment day from 1 to 28.");
  return errors;
}

// 1 → "1st", 2 → "2nd", 11 → "11th", 22 → "22nd"
const ordinal = n => (n % 100 >= 11 && n % 100 <= 13 ? `${n}th` : `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`);

export function describeApprovals(a) {
  if (validateApprovals(a).length) return "";
  const who = APPROVERS.find(x => x.value === a.dealApprover).label;
  const above = a.dealApprover === "manager" && a.bossAbove !== "" && a.bossAbove != null ? `, boss too above RM ${Number(a.bossAbove).toLocaleString("en-MY")}` : "";
  const run = a.payRun === "weekly" ? `every ${WEEKDAYS[a.payDay - 1]}` : a.payRun === "monthly" ? `on the ${ordinal(Number(a.payDay))}` : PAY_RUNS.find(x => x.value === a.payRun).label.toLowerCase();
  return `${who} approves${above} · paid ${run}`;
}

// ── Go-live checklist ────────────────────────────────────────────────────────
// state: everything GET /api/setup returns. One item per Setup step.

// One item per Setup wizard step. A step can cover several saved parts
// (e.g. company + branches); it is ticked once every part has been confirmed.
export function setupChecklist(s) {
  const enabled = DEAL_TYPES.filter(dt => s.dealTypes?.[dt]?.enabled);
  const plans = plansOf(s);
  const saved = plans.length > 0 && plans.every(p => (p.tiers || []).every(t => t.id != null));
  const tierErrors = !plans.length ? ["Add the tiers first."] : !saved ? ["Save the tiers first."] : validatePlans(plans, s.dealTypes, s.branches);

  // s.confirmed (when present) lists the parts someone has saved at least once;
  // a part that is merely valid by default isn't ticked until it is confirmed.
  const item = (key, title, errors, okDetail, parts = [key]) => {
    if (errors.length) return { key, title, done: false, detail: errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} more)` : "") };
    if (s.confirmed && !parts.every(p => s.confirmed[p])) return { key, title, done: false, detail: "Not checked yet" };
    return { key, title, done: true, detail: okDetail };
  };
  const branches = (s.branches || []).length;
  const ownNumbers = (s.branches || []).filter(b => s.numbering?.branches?.[b.id]).length;

  return [
    item("company", "Company and branches",
      [...validateCompany(s.company), ...validateBranches(s.branches), ...(s.bankAccounts ? validateBankAccounts(s.bankAccounts) : [])],
      `${s.company?.name} · ${branches} branch${branches === 1 ? "" : "es"}`, ["company", "branches"]),
    item("dealTypes", "Deals, tax and sharing", validateDealTypes(s.dealTypes), enabled.map(dt => DEAL_TYPE_LABELS[dt]).join(", ")),
    item("tiers", "Tiers and payouts", tierErrors,
      plans.length > 1 ? `${plans.length} tier plans · ${plans.map(planLabel).join(", ")}` : `${plans[0]?.tiers.length} tiers · every branch`),
    item("uplines", "Uplines and split", [...validateRoles(s.roles || []), ...validateSplits(s.splits, s.roles || [])],
      (s.roles || []).length ? (s.roles || []).map(r => r.code).join(" → ") : "No uplines — negotiators keep their tier rate only"),
    ...(Array.isArray(s.agents) ? [item("agents", "Agents", [], (() => {
      const leaders = s.agents.filter(a => a.position).length;
      return s.agents.length ? `${s.agents.length} agent${s.agents.length === 1 ? "" : "s"}${leaders ? ` · ${leaders} leader${leaders === 1 ? "" : "s"}` : ""}` : "None yet, can be added later";
    })())] : []),
    item("approvals", s.approvals ? "Approvals and numbering" : "Case and voucher numbering",
      [...(s.approvals ? validateApprovals(s.approvals) : []), ...validateNumbering(s.numbering, s.dealTypes, s.branches || [])],
      [s.approvals && describeApprovals(s.approvals), ownNumbers ? `${ownNumbers} branch${ownNumbers === 1 ? " has its" : "es have their"} own numbers` : null]
        .filter(Boolean).join(" · ") || "Same numbering for every branch",
      s.approvals ? ["approvals", "numbering"] : ["numbering"]),
  ];
}

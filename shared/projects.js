// Projects (developer new launches): each project's own payout rule and the
// developer's incentive campaigns ("sell 10 units this month → RM 3,000").
// Pure functions, shared by the ERP pages and (later) the API.

const r2 = n => Math.round(n * 100) / 100;
const isNum = v => v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v));
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// ── Payout rule per project ──────────────────────────────────────────────────
//   setup  — same as Setup (the tier's agent rate and total payout)
//   boost  — the negotiator gets `boostPct` points more on this project; the
//            total payout grows by the same, so uplines keep their pool
//   custom — this project's own total payout per company tier (customTotals)

export const PAYOUT_MODES = [
  { value: "setup", label: "Same as Setup", desc: "Pay this project like any other deal." },
  { value: "boost", label: "Extra for the negotiator", desc: "Add a few % on top of each tier's rate, e.g. when the developer pays more." },
  { value: "custom", label: "Own total payout per tier", desc: "Set this project's total payout for every tier." },
];

export function projectPayout(project, tier, normalTotal) {
  const agent = Number(tier.agentRate);
  const total = normalTotal == null ? null : Number(normalTotal);
  const rule = project?.payout || { mode: "setup" };
  if (rule.mode === "boost") {
    const x = Number(rule.boostPct) || 0;
    return { agentRate: Math.min(100, r2(agent + x)), totalPct: total == null ? null : Math.min(100, r2(total + x)) };
  }
  if (rule.mode === "custom") {
    const own = rule.customTotals?.[tier.id];
    return { agentRate: agent, totalPct: isNum(own) ? Number(own) : total };
  }
  return { agentRate: agent, totalPct: total };
}

export function describePayout(project) {
  const rule = project?.payout || { mode: "setup" };
  if (rule.mode === "boost") return `Negotiator +${Number(rule.boostPct) || 0}% on every tier`;
  if (rule.mode === "custom") return `Own total payout per tier`;
  return "Same as Setup";
}

// ── Developer incentives ─────────────────────────────────────────────────────
// incentive: {
//   id, name, from, to,                      // dates, inclusive
//   kind: "target" | "perUnit",
//   counts: "company" | "branch" | "agent",  // whose units are counted together
//   steps: [{ units, amount }],              // target: reach `units` → `amount`
//   perUnit,                                 // perUnit: RM per unit sold
//   paidTo: "agents" | "split" | "company", agentPct  // who receives it
// }

export const INCENTIVE_KINDS = [
  { value: "target", label: "Hit a target", desc: "e.g. sell 10 units this month → RM 3,000." },
  { value: "perUnit", label: "Per unit sold", desc: "e.g. RM 500 for every unit booked in the period." },
];
export const COUNTS = [
  { value: "company", label: "Whole company", desc: "All branches' units count together." },
  { value: "branch", label: "Each branch", desc: "Each branch has its own count and its own reward." },
  { value: "agent", label: "Each agent", desc: "Every agent who reaches it earns it." },
];
export const PAID_TO = [
  { value: "agents", label: "The selling agents", desc: "Shared by units sold." },
  { value: "split", label: "Agents and company", desc: "Agents get a share; the company keeps the rest." },
  { value: "company", label: "Company keeps it", desc: "Counts as company income." },
];

export function incentiveStatus(inc, today) {
  if (today < inc.from) return "upcoming";
  if (today > inc.to) return "ended";
  return "active";
}

// A project's sales: project deals for this project that went through.
export const projectDeals = (deals, project) =>
  deals.filter(d => d.type === "project" && d.property?.title === project.name && d.status !== "draft" && d.status !== "cancelled");

// Progress and reward, per counting group (company / each branch / each agent).
// Returns { status, groups: [{ key, units, amount, reached, next, shares }], total, units }.
// shares: [{ agentId, units, amount }] — what each selling agent receives.
export function incentiveProgress(inc, project, deals, today) {
  const sold = projectDeals(deals, project).filter(d => d.date >= inc.from && d.date <= inc.to);
  const keyOf = d => (inc.counts === "branch" ? d.branchId : inc.counts === "agent" ? d.agentId : "company");
  const byGroup = new Map();
  for (const d of sold) {
    const k = keyOf(d);
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(d);
  }
  if (inc.counts === "company" && !byGroup.size) byGroup.set("company", []);
  const steps = [...(inc.steps || [])].filter(s => isNum(s.units) && isNum(s.amount)).sort((a, b) => a.units - b.units);
  const agentShare = inc.paidTo === "company" ? 0 : inc.paidTo === "split" ? (Number(inc.agentPct) || 0) / 100 : 1;

  const groups = [...byGroup.entries()].map(([key, ds]) => {
    const units = ds.length;
    let amount = 0, reached = null, next = null;
    if (inc.kind === "perUnit") amount = r2(units * (Number(inc.perUnit) || 0));
    else {
      reached = [...steps].reverse().find(s => units >= s.units) || null;
      next = steps.find(s => units < s.units) || null;
      amount = reached ? Number(reached.amount) : 0;
    }
    // The agents' part is shared by units sold in this group.
    const perAgent = new Map();
    for (const d of ds) perAgent.set(d.agentId, (perAgent.get(d.agentId) || 0) + 1);
    const pool = r2(amount * agentShare);
    const shares = [...perAgent.entries()].map(([agentId, u]) => ({ agentId, units: u, amount: units ? r2(pool * u / units) : 0 }));
    return { key, units, amount, reached, next, shares, toAgents: pool, toCompany: r2(amount - pool) };
  }).sort((a, b) => b.units - a.units);

  return {
    status: incentiveStatus(inc, today),
    groups,
    units: sold.length,
    total: r2(groups.reduce((t, g) => t + g.amount, 0)),
  };
}

export function describeIncentive(inc) {
  const who = { company: "whole company", branch: "each branch", agent: "each agent" }[inc.counts] || "";
  if (inc.kind === "perUnit") return `RM ${Number(inc.perUnit || 0).toLocaleString("en-MY")} per unit`;
  const steps = [...(inc.steps || [])].sort((a, b) => a.units - b.units)
    .map(s => `${s.units} unit${Number(s.units) === 1 ? "" : "s"} → RM ${Number(s.amount).toLocaleString("en-MY")}`).join(", ");
  return `${steps}${who ? ` (${who})` : ""}`;
}

// ── Checks ───────────────────────────────────────────────────────────────────

export function validateProject(p) {
  const errors = [];
  if (!String(p?.name || "").trim()) errors.push("Project name is required.");
  if (!String(p?.developer || "").trim()) errors.push("Developer is required.");
  if (!isNum(p?.devCommissionPct) || Number(p.devCommissionPct) <= 0 || Number(p.devCommissionPct) > 20) {
    errors.push("The developer's commission must be more than 0% and at most 20%.");
  }
  if (p?.units !== "" && p?.units != null && (!Number.isInteger(Number(p.units)) || Number(p.units) < 1)) errors.push("Total units must be a whole number.");
  const rule = p?.payout || { mode: "setup" };
  if (!PAYOUT_MODES.some(m => m.value === rule.mode)) errors.push("Pick how this project pays.");
  if (rule.mode === "boost" && (!isNum(rule.boostPct) || Number(rule.boostPct) <= 0 || Number(rule.boostPct) > 20)) {
    errors.push("The extra for the negotiator must be more than 0% and at most 20%.");
  }
  if (rule.mode === "custom") {
    for (const [tierId, v] of Object.entries(rule.customTotals || {})) {
      if (v !== "" && v != null && (!isNum(v) || Number(v) <= 0 || Number(v) > 100)) errors.push(`Tier ${tierId}: total payout must be 0–100%.`);
    }
  }
  return errors;
}

// Custom totals can't be below the tier's agent rate. tiers: [{ id, name, agentRate }]
export function validateProjectTotals(p, tiers) {
  if (p?.payout?.mode !== "custom") return [];
  return tiers.flatMap(t => {
    const v = p.payout.customTotals?.[t.id];
    return isNum(v) && Number(v) < Number(t.agentRate) ? [`${t.name}: total payout ${v}% is below the agent rate ${t.agentRate}%.`] : [];
  });
}

export function validateIncentive(inc) {
  const errors = [];
  if (!String(inc?.name || "").trim()) errors.push("Give the incentive a name, e.g. \"October push\".");
  if (!isDate(inc?.from) || !isDate(inc?.to)) errors.push("Pick the start and end dates.");
  else if (inc.to < inc.from) errors.push("The end date is before the start date.");
  if (!INCENTIVE_KINDS.some(k => k.value === inc?.kind)) errors.push("Pick the kind of incentive.");
  if (!COUNTS.some(c => c.value === inc?.counts)) errors.push("Pick whose units are counted.");
  if (inc?.kind === "target") {
    const steps = (inc.steps || []).filter(s => s.units !== "" || s.amount !== "");
    if (!steps.length) errors.push("Add at least one target.");
    steps.forEach((s, i) => {
      if (!Number.isInteger(Number(s.units)) || Number(s.units) < 1) errors.push(`Target ${i + 1}: units must be a whole number from 1.`);
      if (!isNum(s.amount) || Number(s.amount) <= 0) errors.push(`Target ${i + 1}: reward must be more than RM 0.`);
    });
    const units = steps.map(s => Number(s.units));
    if (new Set(units).size !== units.length) errors.push("Two targets have the same number of units.");
  }
  if (inc?.kind === "perUnit" && (!isNum(inc.perUnit) || Number(inc.perUnit) <= 0)) errors.push("The amount per unit must be more than RM 0.");
  if (!PAID_TO.some(x => x.value === inc?.paidTo)) errors.push("Pick who receives the incentive.");
  if (inc?.paidTo === "split" && (!isNum(inc.agentPct) || Number(inc.agentPct) <= 0 || Number(inc.agentPct) >= 100)) {
    errors.push("The agents' share must be between 0% and 100%.");
  }
  return errors;
}

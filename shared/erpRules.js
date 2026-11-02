// Rules the ERP's actions use (shared/erpActions.js), the page and the demo's
// sample alike: dates, pay days, who approves a payout, what Setup must have,
// the documents an E-Form needs, and one close's payout lines.
import * as P from './payout.js'

const r2 = n => Math.round(n * 100) / 100

// ── Dates are 'YYYY-MM-DD' strings ───────────────────────────────────────────
export const toDate = s => new Date(`${s}T00:00:00Z`)
const isoOf = d => d.toISOString().slice(0, 10)
export const addDays = (s, n) => isoOf(new Date(toDate(s).getTime() + n * 86400000))
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000)
export function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const maxDate = (a, b) => (a > b ? a : b)

// The first pay day after `after`, from Setup → Approvals and paying agents.
// payDay is 1 (Monday) … 7 (Sunday) for weekly runs, a date for monthly ones.
export function nextPayDate(approvals, after) {
  let d = addDays(after, 1)
  for (let i = 0; i < 400; i++, d = addDays(d, 1)) {
    const dt = toDate(d), wd = dt.getUTCDay(), dom = dt.getUTCDate()
    switch (approvals?.payRun) {
      case 'weekly': if (wd === Number(approvals.payDay) % 7) return d; break
      case 'twice': if (dom === 1 || dom === 15) return d; break
      case 'monthly': if (dom === Number(approvals.payDay)) return d; break
      default: if (wd !== 0 && wd !== 6) return d   // any day: the next working day
    }
  }
  return addDays(after, 1)
}

// Who signs off a deal's payout, from Setup → Approvals.
export function payoutApprovers(setup, branchId, paidOut) {
  const manager = setup.branches.find(b => b.id === branchId)?.manager || 'Branch manager'
  const boss = setup.company.reaName || 'Director'
  const a = setup.approvals || {}
  if (a.dealApprover === 'boss') return [boss]
  if (a.dealApprover === 'both') return [manager, boss]
  const limit = a.bossAbove === '' || a.bossAbove == null ? null : Number(a.bossAbove)
  return limit != null && paidOut > limit ? [manager, boss] : [manager]
}

// What the ERP needs from Setup before it can run.
export function erpBlockers(setup) {
  const out = []
  if (!setup?.branches?.length) out.push('Add at least one branch.')
  if (!setup?.tiers?.length) out.push('Set up the tiers.')
  if (!P.DEAL_TYPES.some(dt => setup?.dealTypes?.[dt]?.enabled)) out.push('Turn on at least one deal type.')
  return out
}

// A person's tier credit: their opening balance plus the commission on each
// close side they earned on (lifetime), and this year's part of it (as Setup →
// Tiers counts it). `skip`: a close left out (a re-run works it out again).
export function tierCredit(staff, closes, year, skip = null) {
  let lifetime = Number(staff?.openingLifetime) || 0, yearly = 0
  for (const c of closes) if (c.id !== skip) for (const sd of c.sides || []) if (sd.staffId === staff?.id) {
    lifetime += sd.base
    if (c.date.startsWith(year)) yearly += sd.base
  }
  return { lifetime: r2(lifetime), yearly: r2(yearly) }
}

// The documents an E-Form needs before its case can close (Supporting Document Attachments).
export function docNames(type, coBroke) {
  return type === 'sale'
    ? ['Letter of offer', 'Appointment letter', 'Receipts', 'SPA', 'Buyer IC', 'Vendor IC', ...(coBroke ? ['Co-broke letter'] : [])]
    : type === 'rental'
      ? ['Letter of offer', 'Appointment letter', 'Receipt', 'Tenancy agreement', 'Tenant IC', 'Landlord IC', ...(coBroke ? ['Co-broke letter'] : [])]
      : ['Booking form', 'SPA', 'Buyer IC', 'Developer claim letter']
}
// One close's payout: the commission `net` is split into the deal's sides, and
// each side's earner is paid at the tier their commission has reached so far
// (creditOf(id) → { lifetime, yearly }), with their uplines and the company's
// share. Used for the sample history and for closing a deal in the demo.
// The rules are the ones in force on the E-Form's date (P.rulesAt); `on` is the
// close date, for whether an agent had left by then.
export function payoutForClose(current, staffById, deal, net, creditOf, on = localToday()) {
  const setup = P.rulesAt(current, deal.date)
  const roles = setup.roles || []
  const all = P.dealSides(deal, setup.sideSharePct)
  const sides = [], lines = []
  let given = 0
  all.forEach((side, i) => {
    const base = i === all.length - 1 ? r2(net - given) : r2(net * side.pct / 100)
    given = r2(given + base)
    // A retracted side's portion goes back to the company; the other side is not topped up.
    if (P.sideRetracted(side, staffById, on)) {
      sides.push({ side: side.side, staffId: side.staffId, sharePct: side.pct, base, retracted: true, tierId: null, agentRate: null, totalPct: null, company: base })
      return
    }
    const earner = staffById[side.staffId]
    const tiers = P.tiersFor(setup, earner.branchId)
    const floor = Math.max(0, tiers.findIndex(t => t.id === earner.tierFloorId))
    const credit = creditOf(earner.id)
    const tier = tiers[P.computeTierIndex(credit.lifetime, credit.yearly, tiers, floor)]
    const total = P.resolveTotal(setup.totals, { branchId: earner.branchId, dealType: deal.type, tierId: tier.id })
    const holders = P.uplineHolders(staffById, earner.id, roles)
    const out = P.payoutLines({ amount: base, earnerId: earner.id, agentRate: tier.agentRate, totalPct: total?.pct, holders, splits: setup.splits, roles })
    sides.push({ side: side.side, staffId: earner.id, sharePct: side.pct, base, tierId: tier.id, agentRate: tier.agentRate,
      totalPct: total?.pct ?? null, company: out.company })
    for (const l of out.lines) lines.push({ ...l, side: side.side, base, tierId: l.role ? null : tier.id })
  })
  return { sides, lines }
}

// Lookups and totals over the ERP records, built once per load, plus the
// labels for every status. Pages read from this instead of searching arrays.
import * as P from '../../shared/payout.js'

const r2 = n => Math.round(n * 100) / 100
const sum = (xs, f) => r2((xs || []).reduce((s, x) => s + Number(f(x) || 0), 0))
const byId = arr => Object.fromEntries(arr.map(x => [x.id, x]))
const group = (arr, key) => arr.reduce((m, x) => { (m[x[key]] ||= []).push(x); return m }, {})

// Statuses and options with the current ERP's names (tone: gray | blue | amber | green | red | violet).
export const DEAL_STATUS = {
  draft: { label: 'Draft', tone: 'gray', help: 'Saved by the agent but not submitted yet. Nothing is billed.' },
  submitted: { label: 'Submitted', tone: 'blue', hint: 'Waiting for the client’s money', help: 'Submitted. Waiting for the client’s money to come in and clear.' },
  partial: { label: 'Closed Partial', tone: 'violet', help: 'Part of the money is in and closed (paid out); the rest is still to come.' },
  closed: { label: 'Closed Full', tone: 'green', help: 'All the money is in and closed. The payouts are made.' },
  cancelled: { label: 'Abort/Cancel', tone: 'red', help: 'The deal fell through. Money received is refunded through Payments out.' },
}
export const MONEY_IN_STATUS = {
  draft: { label: 'Draft', tone: 'gray', help: 'Recorded, not checked yet.' },
  pending: { label: 'Pending', tone: 'amber', help: 'Waiting for accounts to check it against the bank statement.' },
  cleared: { label: 'Clear', tone: 'green', help: 'Checked against the bank. Counts as cleared cash for closing the case.' },
  returned: { label: 'Return', tone: 'red', help: 'The bank returned it (e.g. a bounced cheque). It does not count.' },
  invalid: { label: 'Invalid', tone: 'red', help: 'Rejected (e.g. wrong amount or reference). It does not count.' },
}
// Close-case lines: New → Pending Queries → Ready (approved; paid lines stay Ready).
export const PAYOUT_STATUS = {
  new: { label: 'New', tone: 'amber', help: 'Made when the case closed. Waiting for the approver to check it.' },
  queried: { label: 'Pending Queries', tone: 'red', help: 'The approver asked a question. Once it is answered, the line can be set Ready.' },
  approved: { label: 'Ready', tone: 'blue', help: 'Approved. It can now be requested under Salary.' },
  paid: { label: 'Ready', tone: 'green', help: 'Approved and paid.' },
}
export const SALARY_STATUS = {
  none: { label: 'Not Requested', tone: 'gray', help: 'Not in a salary or incentive request yet.' },
  requested: { label: 'Requested', tone: 'blue', help: 'In a salary or incentive request, waiting for the pay day.' },
  paid: { label: 'Paid', tone: 'green', help: 'Paid out.' },
}
export const REQUEST_STATUS = {
  new: { label: 'New Request', tone: 'amber', help: 'Requested. Accounts checks the documents next.' },
  ready: { label: 'Payment Ready', tone: 'blue', help: 'Checked. It is paid on the pay day.' },
  clear: { label: 'Payment Clear', tone: 'green', help: 'Paid. The payout lines in it are marked paid.' },
  invalid: { label: 'Document Not Valid', tone: 'red', help: 'Sent back: a document is missing or wrong (see the reason).' },
}
export const MONEY_OUT_STATUS = {
  new: { label: 'New', tone: 'amber', help: 'Requested. Waiting for approval.' },
  queried: { label: 'Pending Queries', tone: 'red', help: 'The approver asked a question before paying.' },
  ready: { label: 'Payment Ready', tone: 'blue', help: 'Approved. Accounts can pay it.' },
  paid: { label: 'Payment Clear', tone: 'green', help: 'Paid out of the account.' },
}
export const MONEY_OUT_TYPES = {
  balance: 'Balance to Vendor',
  transfer: 'Transfer Deposit to Other',
  refund: 'Abort Case',
  cobroke: 'Cheque to Co-Bro',
  referral: 'Introducer Fees',
  ta: 'Tenancy Agreement Fees',
}
export const LISTING_STATUS = {
  active: { label: 'Active', tone: 'green', help: 'On the market and on the website.' },
  sold: { label: 'Sold', tone: 'violet', help: 'Sold through us.' },
  rented: { label: 'Rent Out', tone: 'violet', help: 'Rented out through us.' },
  invalid: { label: 'Not Valid', tone: 'gray', help: 'Not a real listing (a duplicate or wrong details).' },
  sold_other: { label: 'Sold By Other', tone: 'gray', help: 'Sold by another agency or by the owner.' },
  outdated: { label: 'Outdated', tone: 'amber', help: 'Not updated for a long time. Check it is still available.' },
}
export const LISTING_CATEGORY = { 1: 'Residential landed property', 2: 'Residential non landed property', 3: 'Commercial', 4: 'Industrial', 5: 'Land' }
export const listingCategory = l => (/Shop|Office/.test(l.category) ? 3 : /Condo|Serviced|Apartment|Flat/.test(l.category) ? 2 : 1)
export const CUSTOMER_TRACK = {
  0: { label: 'Active', tone: 'green', help: 'Still looking. Keep following up.' },
  1: { label: 'Closing', tone: 'blue', help: 'Signed an offer through us.' },
  2: { label: 'By Other', tone: 'gray', help: 'Bought or rented through someone else.' },
}
export const CUSTOMER_ACTION = { 0: 'Admin Follow-Up', 1: 'Manager Follow-Up', 2: 'Offering', 3: 'Fact Finding' }
export const CUSTOMER_FROM = { iProperty: 'iProperty', 'Mudah.my': 'Mudah.my', Banner: 'Banner', Intro: 'Intro', others: 'Other' }
export const STAFF_STATUS = {
  active: { label: 'Active', tone: 'green', help: 'Can sign in and be paid.' },
  pending: { label: 'Pending', tone: 'amber', help: 'New. HR still has to enable them.' },
  inactive: { label: 'Inactive', tone: 'gray', help: 'Left or disabled. Cannot sign in.' },
}
export const VENDOR_STATUS = {
  0: { label: 'Pending Follow-Up', tone: 'amber', help: 'New from the website. Nobody has called the owner yet.' },
  1: { label: 'Ongoing Follow-Up', tone: 'blue', help: 'Someone is talking to the owner.' },
  2: { label: 'Listing Created', tone: 'green', help: 'The owner agreed and the listing is made.' },
  '-1': { label: 'Cancelled', tone: 'gray', help: 'The owner changed their mind.' },
  '-2': { label: 'Invalid', tone: 'red', help: 'Spam or a wrong number.' },
}
export const LANDLORD_STATUS = {
  '-1': { label: 'Pending Verification', tone: 'amber', help: 'Nobody has confirmed this landlord yet.' },
  0: { label: 'Unable to Verify', tone: 'red', help: 'Tried, but the landlord could not be confirmed.' },
  1: { label: 'Verified', tone: 'green', help: 'The landlord is confirmed.' },
}
export const TITLE_STATUS = {
  0: { label: 'Approved', tone: 'green', help: 'Agents can file listings under it.' },
  1: { label: 'Pending', tone: 'amber', help: 'Requested by an agent. Waiting for an admin.' },
  2: { label: 'Rejected', tone: 'red', help: 'Not added (usually a duplicate or misspelling).' },
  3: { label: 'Disabled', tone: 'gray', help: 'Switched off: agents can no longer file new listings under it.' },
}
export const AREA_STATUS = {
  0: { label: 'Approved', tone: 'green', help: 'Listings and titles can use this area.' },
  1: { label: 'Disabled', tone: 'gray', help: 'Switched off: not offered for new listings.' },
  2: { label: 'Pending', tone: 'amber', help: 'Requested by an agent. Waiting for an admin.' },
}
export const PURPOSES = { deposit: 'Cash Deposit', commission: 'Balance Commission', rental: 'Balance Rent', other: 'Others' }
export const METHODS = { online: 'Online Transfer', cheque: 'Cheque', cash: 'Cash' }
export const CASH_METHODS = { cashtocompany: 'Cash to Company', cashbankin: 'Cash Bank In' }
export const PARTY = {
  sale: { buyer: 'Purchaser', owner: 'Vendor' },
  rental: { buyer: 'Tenant', owner: 'Landlord' },
  project: { buyer: 'Purchaser', owner: 'Developer' },
}
// Account types, named as in the client's new HR form (old names in brackets in the comments: Admin (lv2), Admin (lv1), Sales Agent).
// Account types, with the current ERP's codes. Agents sell and earn commission
// (Agents module); the rest are office staff (System → Users).
export const ACCOUNT_TYPES = { staff: 'Agent', 'sale-staff': 'Sales Agent', 'admin-staff': 'Admin Level 2', 'admin-staff2': 'Admin Level 1', account: 'Accounting', 'sale-marketing': 'Marketing & Sales' }
export const AGENT_TYPES = ['staff', 'sale-staff']
export const isAgent = s => AGENT_TYPES.includes(s?.type || 'staff')
export const closeType = c => (!c.full ? 'Partial Close' : c.partNo > 1 ? 'Balance Close' : 'Full Close')

export function buildModel(data, setup) {
  const staff = byId(data.staff)
  const deals = byId(data.deals)
  const listings = byId(data.listings)
  const branches = byId(setup.branches)
  const closes = byId(data.closes)
  const moneyInByDeal = group(data.moneyIn, 'dealId')
  const moneyOutByDeal = group(data.moneyOut, 'dealId')
  const payoutsByDeal = group(data.payouts, 'dealId')
  const payoutsByStaff = group(data.payouts, 'staffId')
  const closesByDeal = group(data.closes, 'dealId')
  const downline = group(data.staff, 'uplineId')
  const year = data.asOf.slice(0, 4)

  const cleared = id => sum((moneyInByDeal[id] || []).filter(t => t.status === 'cleared'), t => t.amount)
  const received = id => sum((moneyInByDeal[id] || []).filter(t => t.status !== 'invalid' && t.status !== 'returned'), t => t.amount)

  // Tier credit: the commission on each side a person earned on (as in Setup → Tiers).
  const credit = {}
  for (const c of data.closes) for (const s of c.sides) {
    const k = s.staffId
    credit[k] ||= { lifetime: 0, year: 0, deals: new Set() }
    credit[k].lifetime = r2(credit[k].lifetime + s.base)
    if (c.date.startsWith(year)) credit[k].year = r2(credit[k].year + s.base)
    credit[k].deals.add(c.dealId)
  }
  function tierInfo(id) {
    const s = staff[id]
    const tiers = P.tiersFor(setup, s.branchId)
    const lifetime = r2(s.openingLifetime + (credit[id]?.lifetime || 0))
    const yearly = credit[id]?.year || 0
    const floor = Math.max(0, tiers.findIndex(t => t.id === s.tierFloorId))
    const idx = P.computeTierIndex(lifetime, yearly, tiers, floor)
    const tier = tiers[idx], next = tiers[idx + 1] || null
    // Progress toward the next tier, on the basis that tier climbs on.
    const basis = next?.basis === 'yearly' ? yearly : lifetime
    // Counted from this tier's threshold, or from zero when the tier was kept from
    // last year (or reached on lifetime) and this year's total is still below it.
    const from = basis >= Number(tier.threshold) && next?.basis === tier.basis ? Number(tier.threshold) : 0
    const progress = next ? Math.max(0, Math.min(1, (basis - from) / (Number(next.threshold) - from || 1))) : 1
    return { tier, next, idx, tiers, lifetime, yearly, progress, toNext: next ? Math.max(0, r2(Number(next.threshold) - basis)) : 0, kept: floor > 0 && idx === floor }
  }

  const earned = (id, { thisYear = false } = {}) =>
    sum((payoutsByStaff[id] || []).filter(p => !thisYear || p.date.startsWith(year)), p => p.amount)

  const chain = id => {
    const out = []
    const seen = new Set([id])
    let p = staff[staff[id]?.uplineId]
    while (p && !seen.has(p.id)) { out.push(p); seen.add(p.id); p = staff[p.uplineId] }
    return out
  }
  const roleName = code => setup.roles.find(r => r.code === code)?.name || code
  const branchName = id => branches[id]?.name || ''
  const staffName = id => staff[id]?.short || staff[id]?.name || '—'

  const requests = byId(data.requests)
  const payoutsByRequest = group(data.payouts.filter(p => p.requestId), 'requestId')
  const archives = byId(data.archives)
  // A salary request with its lines and totals (what the salary slip prints).
  function slip(requestId) {
    const r = requests[requestId]
    const lines = payoutsByRequest[requestId] || []
    const s = staff[r.staffId]
    return { request: r, staff: s, lines, ...P.payslipTotals(lines.map(l => l.amount), setup.dealTypes.whtPct, s.whtExempt) }
  }
  // Commission type, as the current ERP labels each case line.
  const commType = l => (l.role ? `${roleName(l.role)} Incentive (${l.side === 'listing' ? 'Product' : 'Marketing'})`
    : l.side === 'listing' ? 'Product Handler Salary' : 'Sales Executive Salary')
  const salaryStatus = l => (!l.requestId ? 'none' : requests[l.requestId]?.status === 'clear' ? 'paid' : 'requested')
  // Branch Manager and Area Manager on a deal: the top of the agent's chain, and
  // the holder of the second-most-senior upline level in it.
  const levels = [...setup.roles].reverse()
  const branchManagerOf = id => { const c = chain(id); return c.length ? c[c.length - 1] : staff[id] }
  const areaManagerOf = id => (levels[1] ? chain(id).find(p => p.role === levels[1].code) || null : null)
  const titles = byId(data.titles)

  return {
    data, setup, year, today: data.asOf,
    staff, deals, listings, branches, closes,
    moneyInByDeal, moneyOutByDeal, payoutsByDeal, payoutsByStaff, closesByDeal, downline,
    cleared, received, tierInfo, earned, chain, roleName, branchName, staffName,
    requests, archives, titles, payoutsByRequest, slip, commType, salaryStatus, branchManagerOf, areaManagerOf,
    dealsOf: id => data.deals.filter(d => d.agentId === id || d.holderId === id),
    credit: id => credit[id] || { lifetime: 0, year: 0, deals: new Set() },
    bankAccount: id => setup.bankAccounts.find(a => a.id === id) || null,
    clientAccount: purpose => setup.bankAccounts.find(a => a.purpose === purpose) || setup.bankAccounts[0] || null,
  }
}

// Records in the chosen branch (null = every branch).
// Cleared cash on a deal that is not closed yet, when the deal can close now
// (all of it has cleared, or Setup pays as money comes in); 0 otherwise.
export function readyToClose(deal, m, setup) {
  if (deal.status !== 'submitted' && deal.status !== 'partial') return 0
  const got = Math.min(m.cleared(deal.id), deal.money.billed)
  const left = r2(got - sum(m.closesByDeal[deal.id] || [], c => c.claim))
  return left > 0 && (got >= deal.money.billed || setup.approvals?.payWhen === 'received') ? left : 0
}

export function inBranch(m, branchId) {
  if (branchId == null) return m.data
  const d = m.data
  const dealIds = new Set(d.deals.filter(x => x.branchId === branchId).map(x => x.id))
  return {
    ...d,
    staff: d.staff.filter(x => x.branchId === branchId),
    listings: d.listings.filter(x => x.branchId === branchId),
    customers: d.customers.filter(x => x.branchId === branchId),
    deals: d.deals.filter(x => dealIds.has(x.id)),
    moneyIn: d.moneyIn.filter(x => dealIds.has(x.dealId)),
    moneyOut: d.moneyOut.filter(x => dealIds.has(x.dealId)),
    closes: d.closes.filter(x => dealIds.has(x.dealId)),
    payouts: d.payouts.filter(x => dealIds.has(x.dealId)),
    requests: d.requests.filter(x => m.staff[x.staffId]?.branchId === branchId),
    vendorRequests: d.vendorRequests.filter(x => x.branchId === branchId),
    enquiries: d.enquiries.filter(x => m.listings[x.listingId]?.branchId === branchId),
    titles: d.titles.filter(x => x.branchId === branchId),
    areas: d.areas.filter(x => x.branchId === branchId),
  }
}

export { r2, sum, group }

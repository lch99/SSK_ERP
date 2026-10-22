// Browser-only stand-in for the ERP API while the app runs as a demo. The
// records are made up from the saved Setup (erpSample.js) and kept in this
// browser's localStorage, so actions taken in the demo stick. Changing Setup
// rebuilds them, so the ERP always pays by the current rules.
import { setupView } from './localApi.js'
import * as P from '../../shared/payout.js'
import { makeErpSample, setupSignature, erpBlockers, nextPayDate, payoutApprovers, payoutForClose, localToday, ERP_VERSION } from './erpSample.js'

const KEY = 'ssk-demo-erp-v1'
let memory = null

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* fall back to memory */ }
  return memory
}
function store(data) {
  memory = data
  try { localStorage.setItem(KEY, JSON.stringify(data)) } catch { /* memory only */ }
}

// { setup, data, blockers }: data is null until Setup has what the ERP needs.
function current({ rebuild = false } = {}) {
  const setup = setupView()
  const blockers = erpBlockers(setup)
  if (blockers.length) return { setup, data: null, blockers }
  let data = load()
  if (rebuild || !data || data.version !== ERP_VERSION || data.sig !== setupSignature(setup)) {
    data = makeErpSample(setup)
    store(data)
  }
  return { setup, data, blockers }
}

const reply = v => Promise.resolve(structuredClone(v))
const r2 = n => Math.round(n * 100) / 100
const sum = (xs, f) => r2(xs.reduce((t, x) => t + Number(f(x) || 0), 0))
const rm = n => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fail = msg => Promise.reject(Object.assign(new Error(msg), { status: 400, errors: [msg] }))
const str = v => String(v ?? '').trim()
const now = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

export const getErp = () => reply(current())
export const resetErp = () => reply(current({ rebuild: true }))

// Apply a change to the stored records and send everything back.
function change(fn) {
  const state = current()
  if (!state.data) return fail(state.blockers[0])
  const err = fn(state.data, state.setup, localToday())
  if (err) return fail(err)
  store(state.data)
  return reply(state)
}
const newId = data => Math.max(0, ...['staff', 'listings', 'customers', 'deals', 'moneyIn', 'closes', 'payouts', 'requests', 'archives', 'moneyOut']
  .flatMap(k => data[k].map(x => x.id))) + 1
const log = (data, today, dealId, field, before, after, by = 'admin') => data.audit.unshift({ at: `${today} ${now()}`, by, dealId, field, before, after })

// ── Closed Case: line status New / Pending Queries / Ready ──
// Ready means approved by whoever Setup names; it then waits for a salary request.
export const approvePayouts = ids => change((data, setup, today) => {
  const pick = new Set(ids)
  const lines = data.payouts.filter(p => pick.has(p.id) && (p.status === 'new' || p.status === 'queried'))
  if (!lines.length) return 'Nothing to approve: those lines are already Ready.'
  const byClose = {}
  for (const l of data.payouts) if (l.closeId) byClose[l.closeId] = (byClose[l.closeId] || 0) + l.amount
  for (const l of lines) {
    const deal = data.deals.find(d => d.id === l.dealId)
    Object.assign(l, { status: 'approved', query: null, approvedOn: today, approvedBy: payoutApprovers(setup, deal.branchId, byClose[l.closeId] || 0) })
  }
})

export const queryPayouts = (ids, reason) => change(data => {
  const text = str(reason)
  if (!text) return 'Say what needs checking.'
  const pick = new Set(ids)
  const lines = data.payouts.filter(p => pick.has(p.id) && p.status !== 'paid' && !p.requestId)
  if (!lines.length) return 'Lines already requested for salary cannot be queried.'
  for (const l of lines) Object.assign(l, { status: 'queried', query: text, approvedOn: null, approvedBy: null })
})

// Create Archive: every Ready line that has been requested for salary, as one ARC-… batch.
export const archiveCases = () => change((data, setup, today) => {
  const due = data.payouts.filter(p => !p.archiveId && p.requestId && (p.status === 'approved' || p.status === 'paid'))
  if (!due.length) return 'No Ready, salary-requested cases to archive.'
  const last = data.archives.at(-1)
  const no = last ? Number(last.code.slice(4, 9)) + 1 : 1
  const arc = { id: newId(data), code: `ARC-${String(no).padStart(5, '0')}-${today}`, date: today, count: due.length }
  data.archives.push(arc)
  for (const p of due) p.archiveId = arc.id
  for (const dealId of new Set(due.map(p => p.dealId))) {
    const deal = data.deals.find(d => d.id === dealId)
    if (deal.type !== 'project' && !deal.landlordCheck) deal.landlordCheck = { archiveId: arc.id, status: -1, on: null, remarks: '' }
  }
})

export const verifyLandlord = (dealId, status, remarks) => change((data, setup, today) => {
  const deal = data.deals.find(d => d.id === dealId)
  if (!deal?.landlordCheck) return 'This case is not archived yet.'
  if (![0, 1].includes(status)) return 'Pick Verified or Unable to verify.'
  if (status === 0 && !str(remarks)) return 'Say why it could not be verified.'
  deal.landlordCheck = { ...deal.landlordCheck, status, on: today, remarks: str(remarks) || 'Confirmed by phone.' }
})

// ── Salary / Incentives: requests per person ──
export const createRequests = (staffIds, kind) => change((data, setup, today) => {
  const pick = new Set(staffIds)
  const lines = data.payouts.filter(p => pick.has(p.staffId) && p.status === 'approved' && !p.requestId && (kind === 'incentives' ? p.role : !p.role))
  if (!lines.length) return 'Nobody picked has Ready lines to request.'
  const payOn = nextPayDate(setup.approvals, today)
  let id = newId(data)
  const count = data.requests.length
  ;[...new Set(lines.map(l => l.staffId))].forEach((sid, i) => {
    const r = { id: id++, code: `SAL-${today.slice(0, 7)}-${String(4801 + count + i).padStart(5, '0')}`, staffId: sid, kind, date: today, payOn, status: 'new', remark: null, paidOn: null }
    data.requests.push(r)
    for (const l of lines) if (l.staffId === sid) Object.assign(l, { requestId: r.id, requestOn: today })
  })
})

export const setRequestStatus = (id, status, remark) => change((data, setup, today) => {
  const r = data.requests.find(x => x.id === id)
  if (!r) return 'That request no longer exists.'
  if (r.status === 'clear') return 'This request has already been paid.'
  if (!['new', 'ready', 'clear', 'invalid'].includes(status)) return 'Unknown status.'
  if (status === 'invalid' && !str(remark)) return 'Say which document is not valid.'
  Object.assign(r, { status, remark: status === 'invalid' ? str(remark) : null, paidOn: status === 'clear' ? today : null })
  if (status === 'clear') for (const l of data.payouts) if (l.requestId === id) Object.assign(l, { status: 'paid', paidOn: today })
})

// ── Transactions (money in) ──
export const setMoneyInStatus = (id, status, reason) => change((data, setup, today) => {
  const t = data.moneyIn.find(x => x.id === id)
  if (!t) return 'That payment no longer exists.'
  if (!['draft', 'pending', 'cleared', 'returned', 'invalid'].includes(status)) return 'Unknown status.'
  if (t.status === 'cleared' && data.closes.some(c => c.dealId === t.dealId)) return 'This payment has already been paid out on a close.'
  Object.assign(t, { status, reason: status === 'returned' || status === 'invalid' ? str(reason) || null : null,
    clearsOn: status === 'cleared' || status === 'returned' ? today : t.clearsOn })
})

// Add Transaction: the same fields as the current form.
export const addTransaction = body => change((data, setup, today) => {
  const deal = data.deals.find(d => d.id === Number(body?.dealId))
  const amount = r2(Number(body?.amount))
  const errors = []
  if (!deal) errors.push('Select the submission (E-Form).')
  else if (deal.status === 'draft' || deal.status === 'cancelled') errors.push('That E-Form is not submitted.')
  if (!(amount > 0)) errors.push('Amount must be more than 0.')
  if (!body?.bankOn) errors.push('Bank-in date is required.')
  if (!['cash', 'cheque', 'online'].includes(body?.method)) errors.push('Pick how it was paid.')
  if (body?.method === 'cheque' && !str(body.chequeNo)) errors.push('Cheque number is required.')
  if (!['deposit', 'commission', 'rental', 'other'].includes(body?.purpose)) errors.push('Pick the purpose.')
  if (!str(body?.remark)) errors.push('Remarks are required.')
  if (errors.length) return errors.join(' ')
  const last = data.moneyIn.reduce((m, t) => Math.max(m, Number(t.code.slice(5)) || 0), 82400)
  data.moneyIn.push({ id: newId(data), code: `TRAN#${last + 1}`, dealId: deal.id, date: body.date || today, bankOn: body.bankOn, clearsOn: body.bankOn,
    amount, method: body.method, purpose: body.purpose, payer: str(body.payer) || deal.buyer.name,
    ref: body.method === 'cheque' ? `Cheque ${str(body.chequeNo)}` : str(body.reference) || '—', into: body.purpose === 'commission' ? 'operating' : 'client',
    status: 'draft', reason: null, cashMethod: body.method === 'cash' ? body.cashMethod || 'cashtocompany' : null, remark: str(body.remark) })
})

// ── Request Form (money out) ──
export const setMoneyOutStatus = (id, status, query) => change((data, setup, today) => {
  const m = data.moneyOut.find(x => x.id === id)
  if (!m) return 'That request no longer exists.'
  if (m.status === 'paid') return 'This has already been paid.'
  if (status === 'queried' && !str(query)) return 'Say what needs checking.'
  const manager = setup.branches.find(b => b.id === m.branchId)?.manager || 'Branch manager'
  Object.assign(m, {
    status, query: status === 'queried' ? str(query) : null,
    readyOn: status === 'ready' || status === 'paid' ? m.readyOn || today : null,
    approvedBy: status === 'ready' || status === 'paid' ? m.approvedBy || manager : null,
    paidOn: status === 'paid' ? today : null,
  })
})

// ── E-Forms: Request Close Case ──
// Closes on the cleared money not yet closed: makes the case lines (New) and,
// once fully closed, the request forms for money going back out.
export const closeDeal = id => change((data, setup, today) => {
  const deal = data.deals.find(d => d.id === id)
  if (!deal || !['submitted', 'partial'].includes(deal.status)) return 'Only a submitted E-Form can be closed.'
  const { billed, net, sst } = deal.money
  const cleared = sum(data.moneyIn.filter(t => t.dealId === id && t.status === 'cleared'), t => t.amount)
  const before = data.closes.filter(c => c.dealId === id)
  const claimedBefore = sum(before, c => c.claim)
  const claim = r2(Math.min(cleared, billed) - claimedBefore)
  if (claim <= 0) return 'There is no new cleared cash to close.'
  const full = claimedBefore + claim >= billed
  if (!full && setup.approvals?.payWhen !== 'received') return `Only ${rm(claimedBefore + claim)} of ${rm(billed)} is in. Setup pays agents after the client has paid in full.`

  // Each earner's tier credit so far: opening balance + the commission they earned on.
  const staffById = Object.fromEntries(data.staff.map(s => [s.id, s]))
  const year = today.slice(0, 4)
  const creditOf = sid => {
    let lifetime = staffById[sid].openingLifetime, yearly = 0
    for (const c of data.closes) for (const sd of c.sides) if (sd.staffId === sid) {
      lifetime += sd.base
      if (c.date.startsWith(year)) yearly += sd.base
    }
    return { lifetime: r2(lifetime), yearly: r2(yearly) }
  }
  const closeNet = full ? r2(net - sum(before, c => c.net)) : r2(net * claim / billed)
  const closeSst = full ? r2(sst - sum(before, c => c.sst)) : r2(sst * claim / billed)
  const { sides, lines } = payoutForClose(setup, staffById, deal, closeNet, creditOf)
  let nextId = newId(data)
  const close = { id: nextId++, dealId: id, date: today, claim, full, partNo: before.length + 1, net: closeNet, sst: closeSst, sides }
  data.closes.push(close)
  const last = data.payouts.reduce((m, p) => Math.max(m, Number(p.code.slice(5)) || 0), 110400)
  lines.forEach((l, i) => {
    data.payouts.push({ id: nextId++, code: `CASE-${last + 1 + i}`, closeId: close.id, dealId: id, date: today, time: now(),
      staffId: l.staffId, side: l.side, role: l.role, pct: l.pct, base: l.base, amount: l.amount, tierId: l.tierId,
      status: 'new', query: null, approvedOn: null, approvedBy: null, requestOn: null, requestId: null, archiveId: null, paidOn: null })
  })
  const was = deal.status
  deal.status = full ? 'closed' : 'partial'
  log(data, today, id, 'Status', was === 'partial' ? 'Closed Partial' : 'Submitted', full ? 'Closed Full' : 'Closed Partial')
  if (!full) return null
  deal.closedOn = today
  deal.docs = Object.fromEntries(Object.keys(deal.docs).map(k => [k, true]))
  const listing = data.listings.find(l => l.id === deal.listingId)
  if (listing) Object.assign(listing, { status: listing.type === 'sale' ? 'sold' : 'rented', closedOn: today, flags: listing.flags.filter(f => f !== 'Process Deal') })

  // Money that now goes back out, as request forms.
  const branch = setup.branches.find(b => b.id === deal.branchId)
  const fromAcc = purpose => setup.bankAccounts.find(a => a.purpose === purpose)?.id ?? setup.bankAccounts[0]?.id ?? null
  // Made-up payee accounts, fixed per deal.
  const acc = k => String(100000000000 + ((id * 7919 + k * 104729) % 899999999999)).replace(/(\d{4})(?=\d)/g, '$1 ')
  const out = (type, payee, amount) => {
    if (amount <= 0) return
    const used = data.moneyOut.filter(x => x.branchId === deal.branchId).length
    data.moneyOut.push({ id: nextId++, voucherNo: P.formatNumber(setup.numbering, 'voucher', branch, P.branchStart(setup.numbering, 'voucher', branch) + used),
      dealId: id, branchId: deal.branchId, staffId: deal.agentId, type, date: today, payee, amount: r2(amount),
      from: fromAcc(['balance', 'transfer', 'refund', 'ta'].includes(type) ? 'client' : 'operating'), method: 'online', chequeNo: null,
      approvedBy: null, status: 'new', query: null, readyOn: null, paidOn: null })
  }
  const ta = deal.rental?.taFee || 0
  if (ta) out('ta', { name: 'Messrs. Tan, Rahman & Co.', bank: 'Public Bank', account: acc(3) }, ta)
  if (deal.type !== 'project') out('balance', { name: deal.owner.name, bank: 'Maybank', account: acc(1) }, cleared - billed - ta)
  if (deal.coBroke) out('cobroke', { name: deal.coBroke.agency, bank: 'CIMB Bank', account: acc(2) }, deal.money.coBroke)
  if (deal.referral) out('referral', { name: deal.referral.name, bank: deal.referral.bank, account: deal.referral.account }, deal.money.referral)
  return null
})

// ── Customer Database, listings, staff: simple adds and updates ──
export const addCustomer = body => change((data, setup, today) => {
  const errors = []
  if (!str(body?.name)) errors.push('Name is required.')
  if (!str(body?.phone)) errors.push('Phone is required.')
  if (!['Sale', 'Rent'].includes(body?.type)) errors.push('Pick Sale or Rent.')
  if (errors.length) return errors.join(' ')
  const owner = data.staff.find(s => s.id === Number(body.ownerId)) || data.staff[0]
  data.customers.push({ id: newId(data), code: String(Math.max(...data.customers.map(c => Number(c.code) || 0)) + 1), date: body.date || today,
    name: str(body.name), phone: str(body.phone), type: body.type, area: str(body.area), from: body.from || 'others',
    budgetMin: Number(body.budgetMin) || 0, budgetMax: Number(body.budgetMax) || 0, action: 0, track: 0, remarks: str(body.remarks),
    ownerId: owner.id, branchId: owner.branchId, dealId: null, followUps: [] })
})

export const updateCustomer = (id, fields) => change(data => {
  const c = data.customers.find(x => x.id === id)
  if (!c) return 'That customer no longer exists.'
  if ('action' in fields) c.action = Number(fields.action)
  if ('track' in fields) c.track = Number(fields.track)
  if ('remarks' in fields) c.remarks = str(fields.remarks)
})

export const addListing = body => change((data, setup, today) => {
  const errors = []
  if (!['sale', 'rental'].includes(body?.type)) errors.push('Pick For Sale or For Rent.')
  if (!str(body?.title)) errors.push('Title (building) is required.')
  if (!str(body?.area)) errors.push('Area is required.')
  if (!(Number(body?.askPrice) > 0)) errors.push('Ad price is required.')
  if (errors.length) return errors.join(' ')
  const holder = data.staff.find(s => s.id === Number(body.holderId)) || data.staff[0]
  const branch = setup.branches.find(b => b.id === holder.branchId)
  const last = data.listings.reduce((m, l) => Math.max(m, Number(l.code.slice(5)) || 0), 122300)
  const ask = Number(body.askPrice)
  data.listings.push({ id: newId(data), code: `LIST-${last + 1}`, type: body.type, category: body.category || 'Condominium', title: str(body.title), area: str(body.area),
    city: '', state: body.state || 'Selangor', postcode: '', address: str(body.address) || `${str(body.title)}, ${str(body.area)}`,
    beds: Number(body.beds) || 0, baths: Number(body.baths) || 0, builtUp: Number(body.builtUp) || 0, land: null, tenure: body.tenure || 'Freehold',
    furnishing: body.furnishing || 'Partly furnished', askPrice: ask, bestPrice: Number(body.bestPrice) || ask, marketValue: Number(body.marketValue) || null, status: 'active', closedOn: null,
    branchId: branch?.id ?? holder.branchId, holderId: holder.id, creatorId: holder.id, flags: body.flags || [], portals: [], created: today, updated: today,
    views: 0, enquiries: 0, photos: 0, owner: { name: str(body.ownerName), ic: '', phone: str(body.ownerPhone) }, dealId: null, priceUpdated: today, photosOn: today,
    followUps: [], titleId: null })
})

export const addStaff = body => change((data, setup, today) => {
  const errors = []
  if (!str(body?.username)) errors.push('User name is required.')
  else if (data.staff.some(s => s.username === str(body.username))) errors.push('That user name is taken.')
  if (!str(body?.name)) errors.push('IC name is required.')
  if (!setup.branches.some(b => b.id === Number(body?.branchId))) errors.push('Pick the branch.')
  if (errors.length) return errors.join(' ')
  const branchId = Number(body.branchId)
  const last = data.staff.reduce((m, s) => Math.max(m, Number(s.code.slice(6)) || 0), 2400)
  data.staff.push({ id: newId(data), code: `STAFF-${String(last + 1).padStart(5, '0')}`, name: str(body.name), short: str(body.short) || str(body.name),
    sex: body.sex === 'female' ? 'F' : 'M', ic: str(body.ic), phone: str(body.phone), email: str(body.email), branchId, role: body.role || null,
    uplineId: Number(body.uplineId) || null, depth: 9, status: 'pending', joined: today, leftOn: null, renNo: str(body.renNo), bank: body.bank || '',
    account: str(body.account), openingLifetime: 0, tierFloorId: null, whtExempt: false, username: str(body.username), type: body.type || 'staff',
    birthday: body.birthday || '', language: body.language || '', education: str(body.education), address: str(body.address) })
})

export const setStaffStatus = (id, status) => change((data, setup, today) => {
  const s = data.staff.find(x => x.id === id)
  if (!s) return 'That person no longer exists.'
  if (!['active', 'inactive', 'pending'].includes(status)) return 'Unknown status.'
  Object.assign(s, { status, leftOn: status === 'inactive' ? today : null })
})

// ── Property: vendor requests and enquiries ──
export const setVendorRequest = (id, status) => change(data => {
  const v = data.vendorRequests.find(x => x.id === id)
  if (!v) return 'That request no longer exists.'
  v.status = Number(status)
})

export const updateEnquiry = (id, fields) => change(data => {
  const e = data.enquiries.find(x => x.id === id)
  if (!e) return 'That enquiry no longer exists.'
  if ('starred' in fields) e.starred = !!fields.starred
  if ('trashed' in fields) e.trashed = !!fields.trashed
})

// E-Form actions that raise a Request Form: Abort Case (returns what was paid
// in and aborts the form) and Transfer Deposit to Other.
export const raiseRequest = (dealId, type, body) => change((data, setup, today) => {
  const deal = data.deals.find(d => d.id === dealId)
  if (!deal || deal.status === 'draft') return 'Submit the E-Form first.'
  if (!['transfer', 'refund'].includes(type)) return 'Unknown request.'
  if (deal.status === 'cancelled') return 'This case is already aborted.'
  const cleared = sum(data.moneyIn.filter(t => t.dealId === dealId && t.status === 'cleared'), t => t.amount)
  if (type === 'refund') {
    if (data.closes.some(c => c.dealId === dealId)) return 'This case has been closed, so it can no longer be aborted.'
    if (!str(body?.reason)) return 'Say why the case is aborted.'
    Object.assign(deal, { status: 'cancelled', cancelledOn: today, cancelReason: str(body.reason) })
    log(data, today, dealId, 'Status', 'Submitted', 'Abort/Cancel')
    const listing = data.listings.find(l => l.id === deal.listingId)
    if (listing) listing.flags = listing.flags.filter(f => f !== 'Process Deal')
    if (cleared <= 0) return null
  }
  const amount = type === 'refund' ? cleared : r2(Number(body?.amount))
  if (!(amount > 0)) return 'Enter the amount to transfer.'
  if (type === 'transfer' && !str(body?.payee)) return 'Who is the deposit transferred to?'
  const branch = setup.branches.find(b => b.id === deal.branchId)
  const used = data.moneyOut.filter(x => x.branchId === deal.branchId).length
  data.moneyOut.push({ id: newId(data), voucherNo: P.formatNumber(setup.numbering, 'voucher', branch, P.branchStart(setup.numbering, 'voucher', branch) + used),
    dealId, branchId: deal.branchId, staffId: deal.agentId, type, date: today, amount,
    payee: type === 'refund' ? { name: deal.buyer.name, bank: str(body?.bank) || 'Maybank', account: str(body?.account) || '—' }
      : { name: str(body.payee), bank: str(body?.bank) || 'Public Bank', account: str(body?.account) || '—' },
    from: setup.bankAccounts.find(a => a.purpose === 'client')?.id ?? setup.bankAccounts[0]?.id ?? null, method: 'online', chequeNo: null,
    approvedBy: null, status: 'new', query: null, readyOn: null, paidOn: null })
})

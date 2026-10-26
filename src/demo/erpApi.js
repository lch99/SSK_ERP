// Browser-only stand-in for the ERP API while the app runs as a demo. The
// records are made up from the saved Setup (erpSample.js) and kept in this
// browser's localStorage, so actions taken in the demo stick. Changing Setup
// rebuilds them, so the ERP always pays by the current rules.
import { setupView } from './localApi.js'
import * as P from '../../shared/payout.js'
import { UPLOADS } from '../../shared/files.js'
import { makeErpSample, setupSignature, erpBlockers, nextPayDate, payoutApprovers, payoutForClose, localToday, docNames, ERP_VERSION } from './erpSample.js'

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
const newId = data => Math.max(0, ...['staff', 'listings', 'customers', 'deals', 'moneyIn', 'closes', 'payouts', 'requests', 'archives', 'moneyOut',
  'vendorRequests', 'enquiries', 'titles', 'areas', 'videos', 'propertyTypes'].flatMap(k => (data[k] || []).map(x => x.id))) + 1
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
// One payment, or several at once (Accounts clearing a bank statement): all or nothing.
export const setMoneyInStatus = (ids, status, reason) => change((data, setup, today) => {
  const list = [ids].flat().map(id => data.moneyIn.find(x => x.id === id))
  if (!list.length || list.some(t => !t)) return 'That payment no longer exists.'
  if (!['draft', 'pending', 'cleared', 'returned', 'invalid'].includes(status)) return 'Unknown status.'
  const used = list.find(t => t.status === 'cleared' && data.closes.some(c => c.dealId === t.dealId))
  if (used) return `${list.length > 1 ? `${used.code} has` : 'This payment has'} already been paid out on a close.`
  for (const t of list) {
    Object.assign(t, { status, reason: status === 'returned' || status === 'invalid' ? str(reason) || null : null,
      clearsOn: status === 'cleared' || status === 'returned' ? today : t.clearsOn })
  }
})

// Who pays for each purpose: the buyer or tenant puts down the deposit, the
// owner (or the developer) pays the balance commission.
const payerOf = (deal, purpose) => (purpose === 'commission' ? deal.owner?.name : deal.buyer?.name) || '—'

// The rules of the current Add Transaction form: a reference for cash and
// online transfers, a cheque number for cheques, the slip attached. Also: no
// bank-in date in the future.
function paymentErrors(b, today) {
  const errors = []
  if (!b.bankOn) errors.push('Bank-in date is required.')
  else if (b.bankOn > today) errors.push('The bank-in date cannot be in the future.')
  if (b.date && b.date > today) errors.push('The date cannot be in the future.')
  if (!['cash', 'cheque', 'online'].includes(b.method)) errors.push('Pick how it was paid.')
  else if (b.method === 'cheque' && !str(b.chequeNo)) errors.push('Enter the cheque number.')
  else if (b.method !== 'cheque' && !str(b.reference)) errors.push('Enter the reference number.')
  if (!['deposit', 'commission', 'rental', 'other'].includes(b.purpose)) errors.push('Pick the purpose.')
  if (!str(b.remark)) errors.push('Remarks are required.')
  return errors
}

// Add Transaction: the same fields as the current form.
export const addTransaction = body => change((data, setup, today) => {
  const b = body || {}
  const deal = data.deals.find(d => d.id === Number(b.dealId))
  const amount = r2(Number(b.amount))
  const errors = []
  if (!deal) errors.push('Select the submission (E-Form).')
  else if (deal.status === 'draft' || deal.status === 'cancelled') errors.push('That E-Form is not submitted.')
  if (!(amount > 0)) errors.push('Amount must be more than 0.')
  errors.push(...paymentErrors(b, today))
  if (!str(b.file)) errors.push('Attach the transfer slip or cheque copy.')
  if (errors.length) return errors.join(' ')
  const last = data.moneyIn.reduce((m, t) => Math.max(m, Number(t.code.slice(5)) || 0), 82400)
  data.moneyIn.push({ id: newId(data), code: `TRAN#${last + 1}`, dealId: deal.id, date: b.date || today, bankOn: b.bankOn, clearsOn: b.bankOn,
    amount, method: b.method, purpose: b.purpose, payer: str(b.payer) || payerOf(deal, b.purpose),
    ref: b.method === 'cheque' ? `Cheque ${str(b.chequeNo)}` : str(b.reference), into: b.purpose === 'commission' ? 'operating' : 'client',
    status: 'draft', reason: null, cashMethod: b.method === 'cash' ? b.cashMethod || 'cashtocompany' : null, remark: str(b.remark), file: str(b.file) })
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
    // Already requested by hand from the E-Form's Actions.
    if (amount <= 0 || data.moneyOut.some(x => x.dealId === id && x.type === type)) return
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
  // Edit entry: the same fields as Add.
  if ('name' in fields && !str(fields.name)) return 'Name is required.'
  if ('phone' in fields && !str(fields.phone)) return 'Phone is required.'
  for (const k of ['name', 'phone', 'area', 'type', 'from', 'date']) if (k in fields) c[k] = str(fields[k])
  for (const k of ['budgetMin', 'budgetMax']) if (k in fields) c[k] = Number(fields[k]) || 0
  if ('ownerId' in fields && data.staff.some(s => s.id === Number(fields.ownerId))) c.ownerId = Number(fields.ownerId)
})

export const addListing = body => change((data, setup, today) => {
  const errors = []
  if (!['sale', 'rental'].includes(body?.type)) errors.push('Pick For Sale or For Rent.')
  if (!str(body?.title)) errors.push('Title (building) is required.')
  if (!str(body?.area)) errors.push('Area is required.')
  if (!(Number(body?.askPrice) > 0)) errors.push('Ad price is required.')
  if (!str(body?.unit)) errors.push('Unit Number & Jalan is required.')
  if (!str(body?.ownerName)) errors.push('Owner Name is required.')
  if (!validPhone(body?.ownerPhone)) errors.push('Please enter a valid phone number for the owner.')
  if (Object.values(body || {}).some(v => typeof v === 'string' && EMOJI.test(v))) errors.push('Emojis are not allowed.')
  // The same unit, owner phone, title and type is one listing (the current ERP's duplicate check).
  const digits = p => String(p || '').replace(/\D/g, '')
  const dup = data.listings.find(l => l.type === body?.type && same(l.title, body?.title) && digits(l.owner.phone) === digits(body?.ownerPhone) && same(l.address.split(',')[0], body?.unit))
  if (dup) errors.push(`This unit is already listed as ${dup.code}.`)
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
    views: 0, viewsApp: 0, enquiries: 0, photos: Number(body.photos) || 0, videos: Number(body.videos) || 0, owner: { name: str(body.ownerName), ic: '', phone: str(body.ownerPhone) }, dealId: null, priceUpdated: today, photosOn: today,
    followUps: [], titleId: data.titles.find(t => same(t.name, body.title) && same(t.area, body.area))?.id ?? null,
    share: { users: [], pmId: null, coPh: [] }, marketingRemarks: '', remarksPrivate: true, description: str(body.desc), remarks: str(body.remarks), draft: !!body.draft })
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
    account: str(body.account), openingLifetime: 0, tierFloorId: body.tierFloorId || null, whtExempt: false, username: str(body.username), type: body.type || 'staff',
    birthday: body.birthday || '', language: body.language || '', education: str(body.education), address: str(body.address),
    // The client's new HR form: registration, public profile, documents, access.
    phone2: str(body.phone2), regType: body.regType || 'REN', regNo: str(body.regNo), bio: str(body.bio), socials: body.socials || {}, awards: body.awards || [],
    docs: body.docs || {}, marketing: [], lastActive: null, expiresOn: body.expiresOn || `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`,
    access: body.access || { agent: true, profilePage: false, profileDoc: false, addListing: true, landlordVerify: false, vendorRequests: false, tripIncentive: false },
    extra: body.extra || {} })
  const made = data.staff.at(-1)
  if (made.regNo) made.renNo = `${made.regType} ${made.regNo}`
})

export const setStaffStatus = (id, status) => change((data, setup, today) => {
  const s = data.staff.find(x => x.id === id)
  if (!s) return 'That person no longer exists.'
  if (!['active', 'inactive', 'pending'].includes(status)) return 'Unknown status.'
  Object.assign(s, { status, leftOn: status === 'inactive' ? today : null })
})

// ── Property: vendor requests and enquiries ──
export const setVendorRequest = (id, status, listingId) => change(data => {
  const v = data.vendorRequests.find(x => x.id === id)
  if (!v) return 'That request no longer exists.'
  v.status = Number(status)
  if (listingId) v.listingId = Number(listingId)
})

export const updateEnquiry = (id, fields) => change(data => {
  const e = data.enquiries.find(x => x.id === id)
  if (!e) return 'That enquiry no longer exists.'
  if ('starred' in fields) e.starred = !!fields.starred
  if ('trashed' in fields) e.trashed = !!fields.trashed
})

// E-Form actions that raise a Request Form (the six entry forms of the current
// ERP). Every amount is limited by the case's cleared cash not yet paid out.
// Abort Case also aborts the form and returns everything received.
const CASH_SHORT = {
  balance: 'Not enough cash to balance to vendor.', transfer: 'Cannot transfer more than the cash in transactions.',
  cobroke: 'Co-bro fees cannot be more than the cash in transactions.', referral: 'Introducer fees cannot be more than the cash in transactions.',
  ta: 'Your tenancy fees cannot be more than the cash in transactions.',
}
export const raiseRequest = (dealId, type, body) => change((data, setup, today) => {
  const deal = data.deals.find(d => d.id === dealId)
  if (!deal || deal.status === 'draft') return 'Submit the E-Form first.'
  if (!['balance', 'transfer', 'refund', 'cobroke', 'referral', 'ta'].includes(type)) return 'Unknown request.'
  if (deal.status === 'cancelled') return 'This case is already aborted.'
  const cleared = sum(data.moneyIn.filter(t => t.dealId === dealId && t.status === 'cleared'), t => t.amount)
  const free = r2(cleared - sum(data.moneyOut.filter(x => x.dealId === dealId), x => x.amount))
  const b = body || {}
  let amount, payee
  if (type === 'refund') {
    if (data.closes.some(c => c.dealId === dealId)) return 'This case has been closed, so it can no longer be aborted.'
    if (!str(b.reason)) return 'Say why the case is aborted.'
    Object.assign(deal, { status: 'cancelled', cancelledOn: today, cancelReason: str(b.reason) })
    log(data, today, dealId, 'Status', 'Submitted', 'Abort/Cancel')
    const listing = data.listings.find(l => l.id === deal.listingId)
    if (listing) listing.flags = listing.flags.filter(f => f !== 'Process Deal')
    if (free <= 0) return null
    amount = free
    payee = { name: deal.buyer.name, bank: str(b.bank) || 'Maybank', account: str(b.account) || '—' }
  } else {
    amount = r2(Number(b.amount))
    const errors = []
    if (type === 'balance' || type === 'transfer') {
      if (!str(b.bank)) errors.push('Please select a bank.')
      if (!str(b.account)) errors.push('Enter the bank account number.')
    }
    if (type === 'transfer') {
      if (!str(b.letter)) errors.push('Please upload a transfer deposit letter.')
      if (!str(b.payee)) errors.push('Who is the deposit transferred to?')
      if (!str(b.ic)) errors.push("Enter the recipient's IC no.")
    }
    if (type === 'cobroke' && !str(b.letter)) errors.push('Please upload the invoice from the co-bro agency.')
    if (type === 'ta') {
      if (!str(b.payee)) errors.push("Enter the tenant's name.")
      if (!str(b.ic)) errors.push("Enter the tenant's IC no.")
    }
    if (!(amount > 0)) errors.push('The amount cannot be negative or zero.')
    else if (amount > free) errors.push(`${CASH_SHORT[type]} (${rm(Math.max(0, free))} available)`)
    if (errors.length) return errors.join(' ')
    payee = {
      balance: { name: deal.owner.name, bank: str(b.bank), account: str(b.account) },
      transfer: { name: str(b.payee), ic: str(b.ic), bank: str(b.bank), account: str(b.account) },
      cobroke: { name: deal.coBroke?.agency || str(b.payee) || 'Co-bro agency', bank: str(b.bank) || '—', account: str(b.account) || '—' },
      referral: { name: deal.referral?.name || str(b.payee) || 'Introducer', bank: deal.referral?.bank || str(b.bank) || '—', account: deal.referral?.account || str(b.account) || '—' },
      ta: { name: str(b.payee), ic: str(b.ic), bank: str(b.bank) || '—', account: str(b.account) || '—' },
    }[type]
  }
  const branch = setup.branches.find(x => x.id === deal.branchId)
  const used = data.moneyOut.filter(x => x.branchId === deal.branchId).length
  data.moneyOut.push({ id: newId(data), voucherNo: P.formatNumber(setup.numbering, 'voucher', branch, P.branchStart(setup.numbering, 'voucher', branch) + used),
    dealId, branchId: deal.branchId, staffId: deal.agentId, type, date: today, amount, payee,
    from: setup.bankAccounts.find(a => a.purpose === (['cobroke', 'referral'].includes(type) ? 'operating' : 'client'))?.id ?? setup.bankAccounts[0]?.id ?? null,
    method: 'online', chequeNo: null, letter: str(b.letter) || null, receipt: null,
    approvedBy: null, status: 'new', query: null, readyOn: null, paidOn: null })
})

// ── E-Forms: new, edit, submit, delete, documents ──
const PARTY_KEYS = ['name', 'ic', 'phone', 'address', 'email']
const cleanParty = p => Object.fromEntries(PARTY_KEYS.map(k => [k, str(p?.[k])]))
const cleanOthers = list => (Array.isArray(list) ? list : []).map(cleanParty).filter(p => p.name || p.ic)
const icDigits = ic => String(ic || '').replace(/\D/g, '')
const STATUS_LABEL = { draft: 'Draft', submitted: 'Submitted', partial: 'Closed Partial', closed: 'Closed Full', cancelled: 'Abort/Cancel' }

// Builds the E-Form fields from the form body and checks them. Returns { errors, fields }.
function dealFields(body, data, setup, { submit, dealId = null }) {
  const b = body || {}
  const errors = []
  const type = b.type
  if (!P.DEAL_TYPES.includes(type) || !setup.dealTypes[type]?.enabled) errors.push('Pick the form type.')
  const agent = data.staff.find(s => s.id === Number(b.agentId))
  if (!agent) errors.push('Pick the agent (sale staff).')
  const price = r2(Number(b.price))
  if (!(price > 0)) errors.push(type === 'rental' ? 'Enter the monthly rent.' : 'Enter the selling price.')
  const fee = r2(Number(b.fee))
  if (submit && !(fee > 0)) errors.push('Enter the Vendor Professional Fees.')
  const listing = type !== 'project' && b.listingId ? data.listings.find(l => l.id === Number(b.listingId)) : null
  if (type !== 'project' && b.listingId && !listing) errors.push('That listing no longer exists.')
  if (listing) {
    if (listing.type !== type) errors.push(`${listing.code} is a ${listing.type === 'sale' ? 'sale' : 'rental'} listing.`)
    const other = data.deals.find(d => d.listingId === listing.id && d.id !== dealId && d.status !== 'cancelled')
    if (other) errors.push(`${listing.code} is already on E-Form ${other.code}.`)
  }
  if (submit && type !== 'project' && !listing) errors.push('Pick the listing this deal is for.')
  // The product handler must hold the listing, or one of its co-product-handler slots.
  const holderId = type === 'project' ? null : b.holderId ? Number(b.holderId) : listing?.holderId ?? null
  if (listing && holderId != null) {
    const allowed = new Set([listing.holderId, ...(listing.share?.coPh || []).map(c => c.staffId)])
    if (!allowed.has(holderId)) errors.push(`${data.staff.find(s => s.id === holderId)?.short || 'That person'} is not a product handler of ${listing.code}.`)
  }
  const buyer = cleanParty(b.buyer), owner = cleanParty(b.owner)
  const party = type === 'rental' ? ['tenant', 'landlord'] : type === 'project' ? ['purchaser', 'developer'] : ['purchaser', 'vendor']
  if (submit && !buyer.name) errors.push(`Enter the ${party[0]}'s name.`)
  if (submit && !owner.name) errors.push(`Enter the ${party[1]}'s name.`)
  const otherBuyers = cleanOthers(b.otherBuyers), otherOwners = cleanOthers(b.otherOwners)
  for (const p of [...otherBuyers, ...otherOwners]) if (p.name && icDigits(p.ic).length !== 12) errors.push(`Enter the full 12-digit NRIC for ${p.name}.`)
  const coBroke = b.coBroke ? { agency: str(b.coBroke.agency), licence: str(b.coBroke.licence), agent: str(b.coBroke.agent), phone: str(b.coBroke.phone), address: str(b.coBroke.address) } : null
  if (coBroke && submit && !coBroke.agency) errors.push('Enter the co-bro agency name.')
  const referral = b.referral ? { name: str(b.referral.name), ic: str(b.referral.ic), phone: str(b.referral.phone), bank: str(b.referral.bank), account: str(b.referral.account) } : null
  if (referral && submit && !referral.name) errors.push("Enter the introducer's IC name.")
  const dt = setup.dealTypes
  const money = P.dealMoney({ fee, sstPct: dt.sstPct, sstMode: dt.sstMode, coBroke: !!coBroke, coaSharePct: dt.coaSharePct, referral: !!referral, referralPct: dt.referralPct })
  if (referral && money.referral > r2(money.fee * 0.2)) errors.push(`Introducer fees cannot be more than 20% of the Vendor Professional Fees (${rm(r2(money.fee * 0.2))}).`)
  const rental = type === 'rental' ? { months: Number(b.rental?.months) || 12, deposit: Number(b.rental?.deposit ?? 2), utility: Number(b.rental?.utility ?? 0.5),
    advance: Number(b.rental?.advance ?? 1), taFee: r2(Number(b.rental?.taFee) || 0) } : null
  const property = listing ? { title: listing.title, category: listing.category, address: listing.address }
    : { title: str(b.property?.title) || 'Developer project', category: str(b.property?.category) || 'Condominium', address: str(b.property?.address), developer: type === 'project' ? owner.name : undefined }
  if (type === 'project' && submit && !property.address) errors.push('Enter the unit address.')
  return { errors, agent, listing, fields: {
    type, date: b.date || localToday(), listingId: listing?.id ?? null, agentId: agent?.id, holderId, branchId: agent?.branchId,
    property, price, fee, feePct: price ? r2(fee / price * 100) : 0, sstPct: Number(dt.sstPct) || 0, sstMode: dt.sstMode, money,
    buyer, owner, otherBuyers, otherOwners, coBroke, referral, rental, remark: str(b.remark),
  } }
}

export const addDeal = body => change((data, setup, today) => {
  const submit = !!body?.submit
  const { errors, fields, listing } = dealFields(body, data, setup, { submit })
  if (errors.length) return errors.join(' ')
  const branch = setup.branches.find(b => b.id === fields.branchId)
  const codes = new Set(data.deals.map(d => d.code))
  let seq = P.branchStart(setup.numbering, fields.type, branch) + data.deals.filter(d => d.branchId === branch.id && d.type === fields.type).length
  while (codes.has(P.formatNumber(setup.numbering, fields.type, branch, seq))) seq++
  const id = newId(data)
  const docs = Object.fromEntries(docNames(fields.type, !!fields.coBroke).map(n => [n, !!body?.files?.[n]]))
  data.deals.push({ id, code: P.formatNumber(setup.numbering, fields.type, branch, seq), ...fields, status: submit ? 'submitted' : 'draft', submittedOn: submit ? today : null,
    docs, files: { ...(body?.files || {}) }, cancelledOn: null, cancelReason: null, closedOn: null })
  if (listing) {
    listing.dealId = id
    if (submit && !listing.flags.includes('Process Deal')) listing.flags = ['Process Deal', ...listing.flags]
  }
  log(data, today, id, 'Status', '—', submit ? 'Submitted' : 'Draft')
})

// Edit an E-Form. Who and what (people, listing, price, fees) can change only
// before any of it is closed; parties, documents and remarks can change any time.
export const updateDeal = (id, body) => change((data, setup, today) => {
  const deal = data.deals.find(d => d.id === id)
  if (!deal) return 'That E-Form no longer exists.'
  if (deal.status === 'cancelled') return 'This case was aborted, so it can no longer be edited.'
  const locked = data.closes.some(c => c.dealId === id)
  const submit = deal.status !== 'draft' || !!body?.submit
  const { errors, fields, listing } = dealFields({ ...body, type: locked ? deal.type : body?.type }, data, setup, { submit, dealId: id })
  if (errors.length) return errors.join(' ')
  const before = { ...deal }
  const keep = locked ? ['type', 'listingId', 'agentId', 'holderId', 'branchId', 'property', 'price', 'fee', 'feePct', 'sstPct', 'sstMode', 'money', 'coBroke', 'referral', 'rental'] : []
  for (const [k, v] of Object.entries(fields)) if (!keep.includes(k)) deal[k] = v
  if (!locked && before.listingId !== deal.listingId) {
    const old = data.listings.find(l => l.id === before.listingId)
    if (old) { old.dealId = null; old.flags = old.flags.filter(f => f !== 'Process Deal') }
    if (listing) listing.dealId = id
  }
  if (deal.status === 'draft' && body?.submit) {
    Object.assign(deal, { status: 'submitted', submittedOn: today })
    if (listing && !listing.flags.includes('Process Deal')) listing.flags = ['Process Deal', ...listing.flags]
  }
  // Documents follow the deal type and co-broke.
  deal.docs = Object.fromEntries(docNames(deal.type, !!deal.coBroke).map(n => [n, !!before.docs?.[n]]))
  const name = sid => data.staff.find(s => s.id === sid)?.short || '—'
  const changes = [
    ['Status', STATUS_LABEL[before.status], STATUS_LABEL[deal.status]],
    [deal.type === 'rental' ? 'Rent' : 'Selling Price', before.price.toLocaleString('en-MY'), deal.price.toLocaleString('en-MY')],
    ['Vendor Professional Fees', before.fee.toLocaleString('en-MY'), deal.fee.toLocaleString('en-MY')],
    ['Agent Name', name(before.agentId), name(deal.agentId)], ['Product Handler', name(before.holderId), name(deal.holderId)],
    [deal.type === 'rental' ? 'Tenant' : 'Purchaser', before.buyer.name, deal.buyer.name], [deal.type === 'rental' ? 'Landlord' : 'Vendor', before.owner.name, deal.owner.name],
    ['Got Co-Bro Agency', before.coBroke ? 'Yes' : 'No', deal.coBroke ? 'Yes' : 'No'], ['Introducer', before.referral?.name || '—', deal.referral?.name || '—'],
  ]
  for (const [field, a, b] of changes) if (a !== b) log(data, today, id, field, a, b)
})

export const deleteDeal = id => change(data => {
  const deal = data.deals.find(d => d.id === id)
  if (!deal) return 'That E-Form no longer exists.'
  if (data.closes.some(c => c.dealId === id)) return 'This case has been closed, so it cannot be deleted.'
  if (data.moneyIn.some(t => t.dealId === id) || data.moneyOut.some(x => x.dealId === id)) return 'This E-Form has transactions. Delete them first, or use Abort Case.'
  const listing = data.listings.find(l => l.id === deal.listingId)
  if (listing) { listing.dealId = null; listing.flags = listing.flags.filter(f => f !== 'Process Deal') }
  data.deals = data.deals.filter(d => d.id !== id)
})

// Supporting Document Attachments: upload (or replace) one document.
export const setDealDoc = (id, name, fileName) => change((data, setup, today) => {
  const deal = data.deals.find(d => d.id === id)
  if (!deal) return 'That E-Form no longer exists.'
  if (!str(fileName)) return 'Choose the file to upload.'
  const had = deal.files?.[name] || (deal.docs?.[name] ? 'Uploaded' : 'Missing')
  deal.docs = { ...deal.docs, [name]: true }
  deal.files = { ...(deal.files || {}), [name]: str(fileName) }
  log(data, today, id, name, had, str(fileName))
})

// Request Invoice (Type 01): gives the E-Form its invoice number.
export const requestInvoice = id => change((data, setup, today) => {
  const deal = data.deals.find(d => d.id === id)
  if (!deal || deal.status === 'draft') return 'Submit the E-Form first.'
  if (!deal.invoiceOn) Object.assign(deal, { invoiceNo: `INV-${deal.code}`, invoiceOn: today })
})

// ── Closed Case: re-run, delete and unarchive ──
// Each earner's tier credit, leaving out one close (for a re-run).
function creditWithout(data, closeId, today) {
  const staffById = Object.fromEntries(data.staff.map(s => [s.id, s]))
  const year = today.slice(0, 4)
  return sid => {
    let lifetime = staffById[sid].openingLifetime, yearly = 0
    for (const c of data.closes) if (c.id !== closeId) for (const sd of c.sides) if (sd.staffId === sid) {
      lifetime += sd.base
      if (c.date.startsWith(year)) yearly += sd.base
    }
    return { lifetime: r2(lifetime), yearly: r2(yearly) }
  }
}

// Make Close Case Rerun: works a close's lines out again on today's tiers and
// uplines (after a rank or upline change). Only before anyone has requested them.
export const rerunClose = closeId => change((data, setup, today) => {
  const close = data.closes.find(c => c.id === closeId)
  if (!close) return 'That close no longer exists.'
  const old = data.payouts.filter(p => p.closeId === closeId)
  if (old.some(l => l.requestId || l.archiveId || l.status === 'paid')) return 'Some of these lines are already requested for salary, so the case cannot be re-run.'
  const deal = data.deals.find(d => d.id === close.dealId)
  const staffById = Object.fromEntries(data.staff.map(s => [s.id, s]))
  const { sides, lines } = payoutForClose(setup, staffById, deal, close.net, creditWithout(data, closeId, today))
  close.sides = sides
  const codes = old.map(l => l.code)
  let last = data.payouts.reduce((m, p) => Math.max(m, Number(p.code.slice(5)) || 0), 110400)
  data.payouts = data.payouts.filter(p => p.closeId !== closeId)
  let nextId = newId(data)
  lines.forEach((l, i) => data.payouts.push({ id: nextId++, code: codes[i] || `CASE-${++last}`, closeId, dealId: deal.id, date: close.date, time: now(),
    staffId: l.staffId, side: l.side, role: l.role, pct: l.pct, base: l.base, amount: l.amount, tierId: l.tierId,
    status: 'new', query: null, approvedOn: null, approvedBy: null, requestOn: null, requestId: null, archiveId: null, paidOn: null }))
  log(data, today, deal.id, 'Case lines', `${old.length} lines`, `Re-run: ${lines.length} lines`)
})

// Delete a close's case lines (the last close on a case, before anything is requested or paid out).
export const deleteClose = closeId => change((data, setup, today) => {
  const close = data.closes.find(c => c.id === closeId)
  if (!close) return 'That close no longer exists.'
  const closes = data.closes.filter(c => c.dealId === close.dealId)
  if (closes.at(-1).id !== closeId) return 'Delete the later close on this case first.'
  if (data.payouts.some(p => p.closeId === closeId && (p.requestId || p.archiveId || p.status === 'paid'))) return 'These lines are already requested for salary.'
  const deal = data.deals.find(d => d.id === close.dealId)
  const auto = ['balance', 'cobroke', 'referral', 'ta']
  if (close.full && data.moneyOut.some(x => x.dealId === deal.id && auto.includes(x.type) && x.date >= close.date && (x.status === 'ready' || x.status === 'paid')))
    return 'Payments out made by this close are already approved.'
  if (close.full) data.moneyOut = data.moneyOut.filter(x => !(x.dealId === deal.id && auto.includes(x.type) && x.date >= close.date))
  data.payouts = data.payouts.filter(p => p.closeId !== closeId)
  data.closes = data.closes.filter(c => c.id !== closeId)
  const was = deal.status
  deal.status = closes.length > 1 ? 'partial' : 'submitted'
  deal.closedOn = null
  const listing = data.listings.find(l => l.id === deal.listingId)
  if (listing && (listing.status === 'sold' || listing.status === 'rented')) Object.assign(listing, { status: 'active', closedOn: null, flags: ['Process Deal', ...listing.flags.filter(f => f !== 'Process Deal')] })
  log(data, today, deal.id, 'Status', STATUS_LABEL[was], STATUS_LABEL[deal.status])
})

export const unarchive = archiveId => change(data => {
  const arc = data.archives.find(a => a.id === archiveId)
  if (!arc) return 'That archive no longer exists.'
  for (const p of data.payouts) if (p.archiveId === archiveId) p.archiveId = null
  for (const d of data.deals) if (d.landlordCheck?.archiveId === archiveId && d.landlordCheck.status === -1) delete d.landlordCheck
  data.archives = data.archives.filter(a => a.id !== archiveId)
})

// ── Transactions: edit and delete ──
const usedOnClose = (data, t) => t.status === 'cleared' && data.closes.some(c => c.dealId === t.dealId)
export const updateTransaction = (id, body) => change((data, setup, today) => {
  const t = data.moneyIn.find(x => x.id === id)
  if (!t) return 'That payment no longer exists.'
  if (usedOnClose(data, t)) return 'This payment has already been paid out on a close, so it cannot be edited.'
  const b = body || {}
  const deal = data.deals.find(d => d.id === Number(b.dealId ?? t.dealId))
  const amount = r2(Number(b.amount ?? t.amount))
  // Unchanged fields keep what was saved; a cheque's ref is "Cheque <no.>".
  const was = t.method === 'cheque' ? { chequeNo: t.ref.replace(/^Cheque /, ''), reference: '' } : { chequeNo: '', reference: t.ref === '—' ? '' : t.ref }
  const next = { date: t.date, bankOn: t.bankOn, method: t.method, purpose: t.purpose, remark: t.remark, ...was, ...b }
  const errors = []
  if (!deal || deal.status === 'draft' || deal.status === 'cancelled') errors.push('Select a submitted E-Form.')
  if (!(amount > 0)) errors.push('Amount must be more than 0.')
  errors.push(...paymentErrors(next, today))
  if (errors.length) return errors.join(' ')
  const method = next.method
  Object.assign(t, { dealId: deal.id, amount, method, bankOn: next.bankOn, date: next.date, purpose: next.purpose, remark: str(next.remark),
    cashMethod: method === 'cash' ? next.cashMethod || t.cashMethod || 'cashtocompany' : null,
    ref: method === 'cheque' ? `Cheque ${str(next.chequeNo)}` : str(next.reference), file: str(b.file) || t.file })
})
export const deleteTransaction = id => change(data => {
  const t = data.moneyIn.find(x => x.id === id)
  if (!t) return 'That payment no longer exists.'
  if (usedOnClose(data, t)) return 'This payment has already been paid out on a close, so it cannot be deleted.'
  data.moneyIn = data.moneyIn.filter(x => x.id !== id)
})

// ── Request forms: payment date, cheque, bank, receipt; delete ──
export const updateMoneyOut = (id, body) => change(data => {
  const x = data.moneyOut.find(m => m.id === id)
  if (!x) return 'That request no longer exists.'
  const b = body || {}
  if (b.paidOn !== undefined && b.paidOn && x.status !== 'paid' && x.status !== 'ready') return 'Set it Payment Ready first.'
  if (b.method && !['online', 'cheque'].includes(b.method)) return 'Pick online transfer or cheque.'
  if (b.paidOn) x.paidOn = b.paidOn
  if (b.method) x.method = b.method
  if (b.chequeNo !== undefined) x.chequeNo = str(b.chequeNo) || null
  if (b.bank !== undefined) x.payee = { ...x.payee, bank: str(b.bank) }
  if (b.account !== undefined) x.payee = { ...x.payee, account: str(b.account) }
  if (b.receipt !== undefined) x.receipt = str(b.receipt) || null
  if (b.letter !== undefined) x.letter = str(b.letter) || null
})
export const deleteMoneyOut = id => change(data => {
  const x = data.moneyOut.find(m => m.id === id)
  if (!x) return 'That request no longer exists.'
  if (x.status === 'ready' || x.status === 'paid') return 'Approved requests cannot be deleted.'
  data.moneyOut = data.moneyOut.filter(m => m.id !== id)
})

// ── Salary requests: delete (the lines go back to Not Requested) ──
export const deleteSalaryRequest = id => change(data => {
  const r = data.requests.find(x => x.id === id)
  if (!r) return 'That request no longer exists.'
  if (r.status === 'clear') return 'This request has already been paid.'
  for (const p of data.payouts) if (p.requestId === id) Object.assign(p, { requestId: null, requestOn: null })
  data.requests = data.requests.filter(x => x.id !== id)
})

// ── Listings: edit, follow-up, share, delete ──
const PHONE = /^(01)[02-46-9]-*[0-9]{7}$|^(01)[1]-*[0-9]{8}$/
export const validPhone = p => PHONE.test(String(p || '').replace(/\s/g, ''))
const EMOJI = /\p{Extended_Pictographic}/u
const LISTING_EDIT = ['askPrice', 'bestPrice', 'marketValue', 'flags', 'status', 'trackingPrice', 'holderId', 'portals', 'marketingRemarks', 'remarksPrivate',
  'description', 'remarks', 'photoSet', 'videoSet', 'share', 'title', 'area', 'category', 'beds', 'baths', 'builtUp', 'tenure', 'furnishing', 'commission']
export const updateListing = (id, fields) => change((data, setup, today) => {
  const l = data.listings.find(x => x.id === id)
  if (!l) return 'That listing no longer exists.'
  const f = fields || {}
  for (const [k, v] of Object.entries(f)) if (typeof v === 'string' && EMOJI.test(v)) return 'Emojis are not allowed.'
  if (f.owner) {
    if (!str(f.owner.name)) return 'Owner Name is required.'
    if (!validPhone(f.owner.phone)) return 'Please enter a valid phone number.'
    l.owner = { ...l.owner, name: str(f.owner.name), phone: str(f.owner.phone) }
  }
  if (f.status && !['active', 'rented', 'invalid', 'sold_other', 'outdated', 'sold'].includes(f.status)) return 'Unknown status.'
  if (f.holderId != null && !data.staff.some(s => s.id === Number(f.holderId))) return 'Pick the new listing owner.'
  if ('askPrice' in f && !(Number(f.askPrice) >= 0)) return 'The price cannot be negative.'
  const maxVideos = UPLOADS.listingVideo.maxFiles
  if (f.videoSet?.length > maxVideos) return `A listing holds up to ${maxVideos} videos. Delete one before adding another.`
  for (const k of LISTING_EDIT) {
    if (!(k in f)) continue
    if (k === 'askPrice' && Number(f.askPrice) !== l.askPrice) Object.assign(l, { priceBefore: l.askPrice, priceUpdated: today })
    l[k] = ['askPrice', 'bestPrice', 'marketValue', 'beds', 'baths', 'builtUp', 'trackingPrice', 'commission'].includes(k) ? (f[k] === '' || f[k] == null ? null : Number(f[k]))
      : k === 'holderId' ? Number(f[k]) : f[k]
  }
  if (f.photoSet) Object.assign(l, { photos: f.photoSet.length, photosOn: today })
  if (f.videoSet) l.videos = f.videoSet.length
  l.updated = today
})
export const addListingFollowUp = (id, body) => change((data, setup, today) => {
  const l = data.listings.find(x => x.id === id)
  if (!l) return 'That listing no longer exists.'
  const b = body || {}
  if (!['0', '1', '2', '3', 0, 1, 2, 3].includes(b.action)) return 'Pick the follow-up action.'
  if (b.appointmentDate && !b.appointmentTime) return 'Pick the appointment time.'
  l.followUps.push({ date: b.date || today, action: Number(b.action), by: Number(b.by) || l.holderId, remark: str(b.remark) || '—',
    appointment: b.appointmentDate ? { date: b.appointmentDate, time: b.appointmentTime } : null })
  l.followUps.sort((a, c) => a.date.localeCompare(c.date))
  l.updated = today
})
export const deleteListing = id => change(data => {
  const l = data.listings.find(x => x.id === id)
  if (!l) return 'That listing no longer exists.'
  if (data.deals.some(d => d.listingId === id)) return 'This listing has an E-Form, so it cannot be deleted. Set it Not Valid instead.'
  data.listings = data.listings.filter(x => x.id !== id)
  data.enquiries = data.enquiries.filter(e => e.listingId !== id)
})

// ── Titles (buildings) and areas ──
const same = (a, b) => str(a).toLowerCase() === str(b).toLowerCase()
export const saveTitle = body => change((data, setup, today) => {
  const b = body || {}
  if (!str(b.name)) return 'Enter the title name.'
  if (!str(b.area)) return 'Pick the area.'
  const dup = data.titles.find(t => t.id !== b.id && t.status === 0 && same(t.name, b.name) && same(t.area, b.area))
  if (dup) return `${dup.name} in ${dup.area} already exists.`
  const area = data.areas.find(a => same(a.name, b.area))
  const fields = { name: str(b.name), area: area?.name || str(b.area), state: area?.state || str(b.state), category: Number(b.category) || 2,
    handlerId: b.handlerId ? Number(b.handlerId) : null, managerId: b.managerId ? Number(b.managerId) : null, remark: str(b.remark),
    branchId: area?.branchId ?? setup.branches[0]?.id }
  if (b.id) {
    const t = data.titles.find(x => x.id === b.id)
    if (!t) return 'That title no longer exists.'
    Object.assign(t, fields)
    for (const l of data.listings) if (l.titleId === t.id) Object.assign(l, { title: t.name })
  } else data.titles.push({ id: newId(data), ...fields, status: b.request ? 1 : 0, requestedBy: b.request ? Number(b.requestedBy) || null : null, requestedOn: b.request ? today : null })
})
// 0 Approved · 1 Pending (requested) · 2 Rejected · 3 Disabled
export const setTitleStatus = (ids, status) => change(data => {
  if (![0, 2, 3].includes(status)) return 'Unknown status.'
  const pick = data.titles.filter(t => ids.includes(t.id))
  if (status === 0) {
    const dups = pick.filter(t => data.titles.some(o => o.id !== t.id && o.status === 0 && same(o.name, t.name) && same(o.area, t.area)))
    if (dups.length) return `Already in the list: ${dups.map(t => `${t.name} (${t.area})`).join(', ')}. Reject ${dups.length > 1 ? 'these' : 'it'} instead.`
  }
  for (const t of pick) t.status = status
})
export const deleteTitle = (id, replacementId) => change(data => {
  const t = data.titles.find(x => x.id === id)
  if (!t) return 'That title no longer exists.'
  const on = data.listings.filter(l => l.titleId === id)
  const to = data.titles.find(x => x.id === Number(replacementId) && x.id !== id && x.status === 0)
  if (on.length && !to) return `${on.length} listing${on.length > 1 ? 's are' : ' is'} filed under ${t.name}. Pick the replacement title for ${on.length > 1 ? 'them' : 'it'}.`
  for (const l of on) Object.assign(l, { titleId: to.id, title: to.name, area: to.area })
  data.titles = data.titles.filter(x => x.id !== id)
})
export const saveArea = body => change((data, setup, today) => {
  const b = body || {}
  if (!str(b.name)) return 'Enter the area name.'
  if (data.areas.some(a => a.id !== b.id && same(a.name, b.name) && same(a.state, b.state))) return `${str(b.name)} is already in the list.`
  const fields = { name: str(b.name), state: str(b.state) || 'Selangor', branchId: Number(b.branchId) || setup.branches[0]?.id, managerId: b.managerId ? Number(b.managerId) : null }
  if (b.id) {
    const a = data.areas.find(x => x.id === b.id)
    if (!a) return 'That area no longer exists.'
    for (const l of data.listings) if (l.area === a.name) l.area = fields.name
    for (const t of data.titles) if (t.area === a.name) t.area = fields.name
    Object.assign(a, fields)
  } else data.areas.push({ id: newId(data), ...fields, status: 0, requestedBy: null, requestedOn: null })
})
export const setAreaStatus = (id, status) => change(data => {
  const a = data.areas.find(x => x.id === id)
  if (!a) return 'That area no longer exists.'
  if (![0, 1].includes(status)) return 'Unknown status.'
  a.status = status
})
export const deleteArea = id => change(data => {
  const a = data.areas.find(x => x.id === id)
  if (!a) return 'That area no longer exists.'
  const n = data.listings.filter(l => l.area === a.name && l.status === 'active').length
  if (n) return `${n} active listing${n > 1 ? 's are' : ' is'} in ${a.name}. Disable the area instead, or move ${n > 1 ? 'them' : 'it'} first.`
  data.areas = data.areas.filter(x => x.id !== id)
})

// ── Customers: edit and follow-up ──
export const addCustomerFollowUp = (id, body) => change((data, setup, today) => {
  const c = data.customers.find(x => x.id === id)
  if (!c) return 'That customer no longer exists.'
  const b = body || {}
  if (!str(b.action)) return 'Pick the follow-up action.'
  const listing = b.listingId ? data.listings.find(l => l.code === str(b.listingId).toUpperCase() || l.id === Number(b.listingId)) : null
  if (b.listingId && !listing) return `There is no listing ${str(b.listingId)}.`
  c.followUps.push({ date: b.date || today, action: str(b.action), note: str(b.remark) || '—', property: str(b.property) || listing?.title || '', price: Number(b.price) || null, listingId: listing?.id ?? null })
  c.followUps.sort((a, x) => a.date.localeCompare(x.date))
  if (str(b.remark)) c.remarks = str(b.remark)
})

// ── Staff: edit, marketing staffs, delete ──
const STAFF_EDIT = ['name', 'short', 'ic', 'phone', 'phone2', 'email', 'sex', 'birthday', 'address', 'language', 'education', 'bank', 'account', 'type', 'role',
  'regType', 'regNo', 'bio', 'socials', 'awards', 'access', 'docs', 'expiresOn', 'tierFloorId', 'whtExempt', 'branchId', 'extra']
export const updateStaff = (id, fields) => change(data => {
  const s = data.staff.find(x => x.id === id)
  if (!s) return 'That person no longer exists.'
  const f = fields || {}
  if ('username' in f) {
    if (!str(f.username)) return 'User name is required.'
    if (data.staff.some(x => x.id !== id && x.username === str(f.username))) return 'That user name is taken.'
    s.username = str(f.username)
  }
  if ('name' in f && !str(f.name)) return 'Full name is required.'
  if ('uplineId' in f) {
    const up = f.uplineId ? Number(f.uplineId) : null
    // No one can sit under themselves or under their own team.
    for (let p = up; p != null; p = data.staff.find(x => x.id === p)?.uplineId ?? null) if (p === id) return 'That upline is in this person’s own team.'
    s.uplineId = up
  }
  for (const k of STAFF_EDIT) if (k in f) s[k] = typeof f[k] === 'string' ? str(f[k]) : f[k]
  if ('regNo' in f || 'regType' in f) s.renNo = s.regNo ? `${s.regType || 'REN'} ${s.regNo}` : ''
  if ('tierFloorId' in f) s.tierFloorId = f.tierFloorId || null
})
export const setMarketingStaffs = (id, list) => change(data => {
  const s = data.staff.find(x => x.id === id)
  if (!s) return 'That person no longer exists.'
  const rows = (list || []).filter(r => data.staff.some(x => x.id === Number(r.staffId))).map(r => ({ staffId: Number(r.staffId), customers: !!r.customers, listings: !!r.listings, shared: !!r.shared }))
  if (new Set(rows.map(r => r.staffId)).size !== rows.length) return 'Each person can be added once.'
  if (rows.some(r => r.staffId === id)) return 'Pick someone other than this person.'
  s.marketing = rows
})
export const deleteStaff = id => change(data => {
  const s = data.staff.find(x => x.id === id)
  if (!s) return 'That person no longer exists.'
  const busy = data.deals.some(d => d.agentId === id || d.holderId === id) || data.payouts.some(p => p.staffId === id) || data.listings.some(l => l.holderId === id)
    || data.customers.some(c => c.ownerId === id) || data.staff.some(x => x.uplineId === id)
  if (busy) return `${s.short} has deals, listings, customers or a team. Set them Inactive instead.`
  data.staff = data.staff.filter(x => x.id !== id)
})

// ── Video gallery ──
export const saveVideo = body => change(data => {
  const b = body || {}
  if (!str(b.title)) return 'Enter the title.'
  if (!b.date) return 'Pick the date.'
  if (!b.id && !str(b.file)) return 'Choose the video file.'
  const fields = { cate: b.cate === 'meeting' ? 'meeting' : 'training', title: str(b.title), date: b.date, description: str(b.description), minutes: Number(b.minutes) || 5 }
  if (b.id) {
    const v = data.videos.find(x => x.id === b.id)
    if (!v) return 'That video no longer exists.'
    Object.assign(v, fields)
  } else data.videos.push({ id: newId(data), ...fields, file: str(b.file) })
})
export const deleteVideo = id => change(data => {
  if (!data.videos.some(v => v.id === id)) return 'That video no longer exists.'
  data.videos = data.videos.filter(v => v.id !== id)
})

// ── System: property types ──
export const addPropertyType = name => change(data => {
  if (!str(name)) return 'Enter the type name.'
  data.propertyTypes ||= []
  if (data.propertyTypes.some(t => same(t.name, name))) return `${str(name)} is already in the list.`
  data.propertyTypes.push({ id: newId(data), name: str(name) })
})
export const deletePropertyType = id => change(data => {
  const t = (data.propertyTypes || []).find(x => x.id === id)
  if (!t) return 'That type no longer exists.'
  const n = data.listings.filter(l => l.category === t.name).length
  if (n) return `${n} listing${n > 1 ? 's use' : ' uses'} ${t.name}.`
  data.propertyTypes = data.propertyTypes.filter(x => x.id !== id)
})

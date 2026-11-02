// Every list the ERP pages through, described once: what a search looks in, the
// filters, the sorts, the counts shown on filter chips, and the extras each row
// carries from other records (an E-Form's cleared cash, its listing's code…).
// Fields are the records' own (the shapes src/demo/erpSample.js makes; a dot
// reaches into a part, e.g. 'buyer.name'). The server turns a description into
// SQL (backend/src/db/lists.js, through each field's column in records.js); the
// demo runs it on the records in this browser (listPage below). Both give the
// same rows, total, counts and extras (backend/test/listParity.test.js).
//
// search: [field | { via: field, of: kind, fields: [fields] }]   a word may be in the record or in the one it points at
// of: kind                       the records of another kind (the SST account pages through closes)
// filters: { key: rule } — the page sends ?key=value
//   { eq: field | [fields] }     one value or several, comma-separated ('none' = empty); with several fields any may match
//   { is: field }                the same text, whatever the case (a payment's reference)
//   { from: field } { to: field } at least / at most (dates 'YYYY-MM-DD' or numbers); an empty field never matches
//   { yes: field }               'true' / '1', or 'false' / '0'
//   { notNull: field }           'true': has a value; 'false': has none
//   { oneOf: field, sets: { name: [values] | { not: [values] } } }   e.g. kind=agent
//   { team: [fields], self }     everyone under that person (and them, unless self: false); any field may match
//   { custom: name, values? }    CUSTOM below here, and the same rule in SQL on the server (values: what it takes, when not true / false)
//   { via: field, of: kind, rule }   the record this one points at passes `rule` (a payment's E-Form is in that branch)
// sorts:  { key: field }; ?sort=-key is newest / biggest first; then by id, the same way.
// counts: 'field'                { value: n } for each value, leaving out the filter of the same name
//         { set: { key: value } | ctx => …, ignores? }   n with those filters set as well
//         { only: ctx => { key: value }, sum: field, keep?, distinct? }   { n, sum } over these filters alone (and of the page's, those it keeps);
//                                with distinct: field, also how many different values it has ({ n, sum, distinct })
//         { only, custom: name, keep? }   CUSTOM_COUNTS below here over those records, and the same on the server
//         { sum: field, distinct? }       { n, sum (, distinct) } over the page's own search and filters
//         ?counts=a,b asks for those counts only; ?counts=0 for none (a later page)
// extras (on each row as `$`):
//         { sum: field, of: kind, by: field, where?: { field: [values] }, not?: { field: [values] } } → a number (null in values: empty)
//         { count: true, of: kind, by: field, where?, not? }   how many → a number
//         { pick: [fields], of: kind, by: field }   the records of that kind that point at this one, by id
//         { field, of: kind, from: field }          one field of the record this one points at
//         { pick: [fields], of: kind, from: field }  some of its fields ({ … } or null)
//         `from` may start with '$.' to go on from an extra worked out above it (the agent on a payment's E-Form)
// download: { file, sheet, widths?, columns: [[label, field | row => value]] }   the Excel download (downloadRows)
// readers: { area: record => record }   other areas that may read the list too, with what they may not see taken out
// fields: [fields]               the rows carry only these (a list over another kind that needs a few of its fields)
import { teamOf } from './access.js'
import { payslipTotals } from './payout.js'
import { MONEY_IN_STATUS, PURPOSES, METHODS, CASH_METHODS } from './labels.js'

export const DEFAULT_SIZE = 50
export const MAX_SIZE = 200
export const AGENT_TYPES = ['staff', 'sale-staff']

export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const monthStart = day => `${day.slice(0, 8)}01`
const monthEnd = day => addDays(`${Number(day.slice(5, 7)) === 12 ? Number(day.slice(0, 4)) + 1 : day.slice(0, 4)}-${String(Number(day.slice(5, 7)) % 12 + 1).padStart(2, '0')}-01`, -1)
// A payment's or close's E-Form, for filters and searches through it.
const viaDeal = rule => ({ via: 'dealId', of: 'deals', rule })

// How much cleared cash on an E-Form can close now: what has cleared (up to the
// bill) less what is closed, once all of it has cleared or Setup pays as money
// comes in; 0 otherwise. The E-Form pages and the "Ready to close" filter use it.
export function readyLeft(deal, { cleared, closed }, setup) {
  if (deal.status !== 'submitted' && deal.status !== 'partial') return 0
  const got = Math.min(cleared, deal.money.billed)
  const left = Math.round((got - closed) * 100) / 100
  return left > 0 && (got >= deal.money.billed || setup?.approvals?.payWhen === 'received') ? left : 0
}

// An E-Form for someone without E-Form access (they record payments on it):
// the parties' details are left out. The server's whole-state read does the same.
export function withoutParties(d) {
  const blank = { name: '', ic: '', phone: '', address: '', email: '' }
  return { ...d, buyer: blank, owner: blank, otherBuyers: [], otherOwners: [], referral: null, coBroke: d.coBroke && { agency: d.coBroke.agency } }
}

// A Ready payout line not requested yet (Request salary / incentives; agents claim or stack their own).
const OPEN_LINE = { status: 'approved', requested: 'false', archived: 'false' }
// A person's own lines (salary) have no upline level; incentives (from their downline's deals) have one.
const READY_PAY = kind => ({ of: 'payouts', by: 'staffId', where: { status: ['approved'], requestId: [null], archiveId: [null], ...(kind === 'salary' && { role: [null] }) },
  not: { stacked: [true], ...(kind === 'incentives' && { role: [null] }) } })

const DEAL_CASH = {
  cleared: { sum: 'amount', of: 'moneyIn', by: 'dealId', where: { status: ['cleared'] } },
  closed: { sum: 'claim', of: 'closes', by: 'dealId' },
}

export const LISTS = {
  staff: {
    area: 'staff',
    search: ['name', 'short', 'code', 'phone', 'ic', 'email', 'username'],
    filters: {
      branchId: { eq: 'branchId' }, status: { eq: 'status' }, type: { eq: 'type' }, position: { eq: 'role' }, tierId: { eq: 'tierFloorId' },
      uplineId: { eq: 'uplineId' }, hasRole: { notNull: 'role' },
      // agent: Agent and Sales Agent accounts; office: everyone else (src/erp/model.js isAgent).
      kind: { oneOf: 'type', sets: { agent: AGENT_TYPES, office: { not: AGENT_TYPES } } },
      teamOf: { team: ['id'], self: false },
      joinedFrom: { from: 'joined' }, joinedTo: { to: 'joined' }, expiresFrom: { from: 'expiresOn' }, expiresBy: { to: 'expiresOn' },
    },
    sorts: { name: 'name', code: 'code', joined: 'joined', expiresOn: 'expiresOn', branch: 'branchId', status: 'status' },
    sort: 'name',
    counts: {
      status: 'status',
      leaders: { set: { hasRole: 'true' } },
      joinedThisMonth: { set: ctx => ({ joinedFrom: monthStart(ctx.today) }) },
      // Registration (expiry date) running out within 30 days.
      expiring: { set: ctx => ({ expiresFrom: ctx.today, expiresBy: addDays(ctx.today, 30) }) },
    },
  },

  listings: {
    area: 'listings',
    search: ['code', 'title', 'address', 'area', 'owner.name', 'owner.phone'],
    filters: {
      type: { eq: 'type' }, status: { eq: 'status' }, branchId: { eq: 'branchId' }, holderId: { eq: 'holderId' }, creatorId: { eq: 'creatorId' },
      titleId: { eq: 'titleId' }, area: { eq: 'area' }, category: { eq: 'category' }, draft: { yes: 'draft' },
      priceFrom: { from: 'askPrice' }, priceTo: { to: 'askPrice' }, createdFrom: { from: 'created' }, createdTo: { to: 'created' },
    },
    sorts: { created: 'created', updated: 'updated', price: 'askPrice', code: 'code', views: 'views' },
    sort: '-created',
    counts: { status: 'status', type: 'type' },
  },

  customers: {
    area: 'customers',
    search: ['name', 'phone', 'code', 'area'],
    filters: { type: { eq: 'type' }, track: { eq: 'track' }, action: { eq: 'action' }, ownerId: { eq: 'ownerId' }, branchId: { eq: 'branchId' },
      source: { eq: 'from' }, from: { from: 'date' }, to: { to: 'date' } },
    sorts: { date: 'date', name: 'name' },
    sort: '-date',
    counts: { track: 'track', type: 'type' },
  },

  deals: {
    area: 'deals', readers: { moneyIn: withoutParties },
    search: ['code', 'buyer.name', 'owner.name', 'property.title', 'property.address'],
    filters: {
      status: { eq: 'status' }, type: { eq: 'type' }, branchId: { eq: 'branchId' }, agentId: { eq: 'agentId' }, holderId: { eq: 'holderId' },
      listingId: { eq: 'listingId' }, projectId: { eq: 'projectId' }, lvStatus: { eq: 'landlordCheck.status' },
      // Either side of the deal (the sales agent or the listing holder).
      staffId: { eq: ['agentId', 'holderId'] },
      // A leader and everyone under them, on either side.
      teamOf: { team: ['agentId', 'holderId'] },
      // Cleared cash that can be closed now (readyLeft).
      ready: { custom: 'readyToClose' },
      from: { from: 'date' }, to: { to: 'date' }, closedFrom: { from: 'closedOn' }, closedTo: { to: 'closedOn' },
      priceFrom: { from: 'price' }, priceTo: { to: 'price' },
    },
    sorts: { date: 'date', code: 'code', price: 'price', fee: 'fee', billed: 'money.billed', title: 'property.title', status: 'status', closedOn: 'closedOn' },
    sort: '-date',
    counts: {
      status: 'status', type: 'type',
      // The page's "N submitted in <year> · RM … in fees".
      year: { only: ctx => ({ from: `${ctx.today.slice(0, 4)}-01-01`, to: `${ctx.today.slice(0, 4)}-12-31`, status: 'submitted,partial,closed' }), sum: 'fee', keep: ['branchId'] },
    },
    extras: {
      listingCode: { field: 'code', of: 'listings', from: 'listingId' },
      listingCreator: { field: 'creatorId', of: 'listings', from: 'listingId' },
      ...DEAL_CASH,
      received: { sum: 'amount', of: 'moneyIn', by: 'dealId', not: { status: ['invalid', 'returned'] } },
      outs: { pick: ['id', 'type', 'voucherNo', 'amount', 'status'], of: 'moneyOut', by: 'dealId' },
      // Any close at all locks its cleared payments (shared/erpActions.js usedOnClose).
      closeIds: { pick: ['id'], of: 'closes', by: 'dealId' },
    },
  },

  moneyIn: {
    area: 'moneyIn',
    search: ['code', 'payer', 'ref', 'remark', { via: 'dealId', of: 'deals', fields: ['code'] }],
    filters: {
      status: { eq: 'status' }, dealId: { eq: 'dealId' }, method: { eq: 'method' }, purpose: { eq: 'purpose' },
      // The E-Form's branch (the top bar's branch) and its sales agent.
      branchId: viaDeal({ eq: 'branchId' }), agentId: viaDeal({ eq: 'agentId' }),
      from: { from: 'date' }, to: { to: 'date' }, clearedFrom: { from: 'clearsOn' }, clearedTo: { to: 'clearsOn' },
      // The same slip recorded twice: the same reference or cheque, or the same amount banked in on the same day.
      ref: { is: 'ref' }, amount: { eq: 'amount' }, bankOn: { eq: 'bankOn' },
    },
    sorts: { date: 'date', amount: 'amount', bankOn: 'bankOn', code: 'code', status: 'status', recorded: 'id' },
    sort: '-date',
    counts: {
      status: 'status',
      // Draft and Pending: still to check against the bank statement.
      toCheck: { only: () => ({ status: 'draft,pending' }), sum: 'amount', keep: ['branchId'] },
      clearedThisMonth: { only: ctx => ({ status: 'cleared', clearedFrom: monthStart(ctx.today), clearedTo: monthEnd(ctx.today) }), sum: 'amount', keep: ['branchId'] },
    },
    extras: {
      deal: { pick: ['code', 'type', 'agentId'], of: 'deals', from: 'dealId' },
      agent: { pick: ['short', 'name'], of: 'staff', from: '$.deal.agentId' },
    },
    download: {
      file: 'payments-in', sheet: 'Payments in', widths: [14, 22, 12, 22, 14, 16, 16, 18, 13, 30, 10, 24, 22],
      columns: [
        ['ID', 'code'], ['Staff', t => t.$.agent?.short || t.$.agent?.name || ''], ['Date', 'date'], ['Form ID', '$.deal.code'], ['Amount', 'amount'],
        ['Method', t => METHODS[t.method]], ['Cash Method', t => CASH_METHODS[t.cashMethod]], ['Purpose', t => PURPOSES[t.purpose]], ['Bank-In Date', 'bankOn'],
        ['Remark', 'remark'], ['Status', t => MONEY_IN_STATUS[t.status]?.label], ['Reason', 'reason'], ['Reference', 'ref'],
      ],
    },
  },

  // The SST account: the SST on each closed claim.
  sst: {
    area: 'moneyIn', of: 'closes',
    search: [{ via: 'dealId', of: 'deals', fields: ['code'] }],
    filters: { branchId: viaDeal({ eq: 'branchId' }), dealId: { eq: 'dealId' }, from: { from: 'date' }, to: { to: 'date' }, sstFrom: { from: 'sst' } },
    sorts: { date: 'date', sst: 'sst' },
    sort: '-date',
    counts: {
      month: { only: ctx => ({ sstFrom: '0.01', from: monthStart(ctx.today), to: monthEnd(ctx.today) }), sum: 'sst', keep: ['branchId'] },
      year: { only: ctx => ({ sstFrom: '0.01', from: `${ctx.today.slice(0, 4)}-01-01`, to: `${ctx.today.slice(0, 4)}-12-31` }), sum: 'sst', keep: ['branchId'] },
    },
    extras: { dealCode: { field: 'code', of: 'deals', from: 'dealId' } },
  },

  closes: {
    area: 'payouts',
    search: [],
    filters: { dealId: { eq: 'dealId' }, from: { from: 'date' }, to: { to: 'date' } },
    sorts: { date: 'date' },
    sort: '-date',
  },

  // Payout lines (Closed Case): one per person paid on each close. Salary requests and
  // pays them (and an agent claims their own), so that area may read them too.
  payouts: {
    area: 'payouts', readers: { salary: r => r },
    search: ['code', { via: 'dealId', of: 'deals', fields: ['code'] }, { via: 'staffId', of: 'staff', fields: ['name', 'short'] }],
    filters: { status: { eq: 'status' }, staffId: { eq: 'staffId' }, dealId: { eq: 'dealId' }, closeId: { eq: 'closeId' }, side: { eq: 'side' }, role: { eq: 'role' },
      requestId: { eq: 'requestId' }, archiveId: { eq: 'archiveId' }, stacked: { yes: 'stacked' }, from: { from: 'date' }, to: { to: 'date' },
      // In a weekly archive; in a salary / incentive request.
      archived: { notNull: 'archiveId' }, requested: { notNull: 'requestId' },
      // The E-Form's branch (the top bar's), and a branch manager's whole team (on the agent who sold it).
      branchId: viaDeal({ eq: 'branchId' }), agentTeam: viaDeal({ team: ['agentId'] }),
      // The close it came from: full, partial or balance (closeType in src/erp/model.js).
      closeType: { custom: 'closeType', values: ['full', 'partial', 'balance'] },
      // An upline incentive (true) or the person's own salary line (false); the earner's branch.
      incentive: { notNull: 'role' }, staffBranch: { via: 'staffId', of: 'staff', rule: { eq: 'branchId' } },
    },
    sorts: { date: 'date', amount: 'amount', code: 'code', status: 'status', close: 'closeId', stackedOn: 'stackedOn' },
    sort: '-date',
    counts: {
      status: 'status',
      // New and Pending Queries: waiting for approval, on how many closes.
      waiting: { only: () => ({ status: 'new,queried', archived: 'false' }), sum: 'amount', distinct: 'closeId', keep: ['branchId'] },
      // Ready, salary not requested yet, for how many people.
      ready: { only: () => ({ status: 'approved', requested: 'false', archived: 'false' }), sum: 'amount', distinct: 'staffId', keep: ['branchId'] },
      // What the next weekly archive takes (shared/erpActions.js archiveCases): every branch.
      due: { only: () => ({ status: 'approved,paid', requested: 'true', archived: 'false' }), sum: 'amount' },
      // Request salary / incentives: Ready lines not requested, for how many people (by the earner's branch);
      // the ones agents stacked wait for them to claim.
      salaryReady: { only: () => ({ ...OPEN_LINE, incentive: 'false', stacked: 'false' }), sum: 'amount', distinct: 'staffId', keep: ['staffBranch'] },
      incentivesReady: { only: () => ({ ...OPEN_LINE, incentive: 'true', stacked: 'false' }), sum: 'amount', distinct: 'staffId', keep: ['staffBranch'] },
      salaryStacked: { only: () => ({ ...OPEN_LINE, incentive: 'false', stacked: 'true' }), sum: 'amount', distinct: 'staffId', keep: ['staffBranch'] },
      incentivesStacked: { only: () => ({ ...OPEN_LINE, incentive: 'true', stacked: 'true' }), sum: 'amount', distinct: 'staffId', keep: ['staffBranch'] },
      // The lines found, added up, and on how many closes (My commission).
      lines: { sum: 'amount', distinct: 'closeId' },
    },
    extras: {
      close: { pick: ['date', 'claim', 'net', 'full', 'partNo'], of: 'closes', from: 'closeId' },
      deal: { pick: ['code', 'type', 'price', 'branchId', 'agentId', 'holderId', 'property.title', 'money.billed'], of: 'deals', from: 'dealId' },
      requestStatus: { field: 'status', of: 'requests', from: 'requestId' },
      archive: { pick: ['code', 'date'], of: 'archives', from: 'archiveId' },
    },
  },

  // People with Ready pay not requested yet (Request salary / incentives), with what waits for each.
  payees: {
    area: 'salary', of: 'staff', fields: ['id', 'code', 'name', 'short', 'branchId', 'status', 'type', 'bank', 'account', 'whtExempt'],
    search: ['name', 'short', 'code'],
    filters: { branchId: { eq: 'branchId' }, ready: { custom: 'readyPay', values: ['salary', 'incentives'] } },
    sorts: { name: 'short', code: 'code' }, sort: 'name',
    extras: {
      salary: { sum: 'amount', ...READY_PAY('salary') }, salaryLines: { count: true, ...READY_PAY('salary') },
      incentives: { sum: 'amount', ...READY_PAY('incentives') }, incentivesLines: { count: true, ...READY_PAY('incentives') },
    },
  },

  // Salary and incentive requests (Pay requests).
  requests: {
    area: 'salary',
    search: ['code', { via: 'staffId', of: 'staff', fields: ['name', 'short'] }],
    filters: { status: { eq: 'status' }, kind: { eq: 'kind' }, staffId: { eq: 'staffId' }, from: { from: 'date' }, to: { to: 'date' },
      paidFrom: { from: 'paidOn' }, paidTo: { to: 'paidOn' },
      // The person's branch (the top bar's).
      branchId: { via: 'staffId', of: 'staff', rule: { eq: 'branchId' } } },
    sorts: { date: 'date', payOn: 'payOn', code: 'code', status: 'status' },
    sort: '-date',
    counts: {
      status: 'status', kind: 'kind',
      // New Request and Payment Ready: what is still to pay; Payment Clear this year, with the tax withheld.
      unpaid: { only: () => ({ status: 'new,ready' }), custom: 'payslips', keep: ['branchId', 'staffId'] },
      paidThisYear: { only: ctx => ({ status: 'clear', paidFrom: `${ctx.today.slice(0, 4)}-01-01`, paidTo: `${ctx.today.slice(0, 4)}-12-31` }), custom: 'payslips', keep: ['branchId', 'staffId'] },
    },
    extras: {
      gross: { sum: 'amount', of: 'payouts', by: 'requestId' },
      // The payee, as the salary slip prints them.
      staff: { pick: ['name', 'short', 'code', 'ic', 'renNo', 'phone', 'email', 'bank', 'account', 'whtExempt'], of: 'staff', from: 'staffId' },
    },
  },

  archives: {
    area: 'payouts',
    search: ['code'], filters: { from: { from: 'date' }, to: { to: 'date' } },
    sorts: { date: 'date' }, sort: '-date',
  },

  moneyOut: {
    area: 'moneyOut',
    search: ['voucherNo', 'payee.name'],
    filters: { status: { eq: 'status' }, type: { eq: 'type' }, dealId: { eq: 'dealId' }, branchId: { eq: 'branchId' }, staffId: { eq: 'staffId' },
      from: { from: 'date' }, to: { to: 'date' } },
    sorts: { date: 'date', amount: 'amount', voucherNo: 'voucherNo' },
    sort: '-date',
    counts: { status: 'status', type: 'type' },
  },

  vendorRequests: {
    area: 'listings',
    search: ['ticket', 'name', 'phone', 'area'],
    filters: { status: { eq: 'status' }, branchId: { eq: 'branchId' }, listingId: { eq: 'listingId' } },
    sorts: { date: 'date' }, sort: '-date',
    counts: { status: 'status' },
  },

  enquiries: {
    area: 'listings',
    search: ['name', 'phone', 'message'],
    filters: { listingId: { eq: 'listingId' }, starred: { yes: 'starred' }, trashed: { yes: 'trashed' } },
    sorts: { date: 'date' }, sort: '-date',
    counts: { trashed: 'trashed', starred: { set: { starred: 'true' } } },
  },

  titles: {
    area: 'listings',
    search: ['name', 'area'],
    filters: { status: { eq: 'status' }, branchId: { eq: 'branchId' }, category: { eq: 'category' }, area: { eq: 'area' } },
    sorts: { name: 'name', area: 'area', requestedOn: 'requestedOn' }, sort: 'name',
    counts: { status: 'status' },
  },

  areas: {
    area: 'listings',
    search: ['name', 'state'],
    filters: { status: { eq: 'status' }, branchId: { eq: 'branchId' }, state: { eq: 'state' } },
    sorts: { name: 'name', requestedOn: 'requestedOn' }, sort: 'name',
    counts: { status: 'status' },
  },

  videos: {
    area: 'videos',
    search: ['title', 'description'], filters: { cate: { eq: 'cate' } },
    sorts: { date: 'date', title: 'title' }, sort: '-date',
    counts: { cate: 'cate' },
  },

  propertyTypes: { area: 'listings', search: ['name'], sorts: { name: 'name' }, sort: 'name' },

  projects: {
    area: 'projects',
    search: ['name', 'developer', 'location'], filters: { status: { eq: 'status' } },
    sorts: { name: 'name', launchedOn: 'launchedOn' }, sort: 'name',
    counts: { status: 'status' },
  },

  v1Eforms: {
    area: 'deals',
    search: ['code', 'address'], filters: { staffId: { eq: 'staffId' }, type: { eq: 'type' }, status: { eq: 'status' } },
    sorts: { date: 'date', code: 'code' }, sort: '-date',
  },

  v1Overrides: {
    area: 'deals',
    search: [], filters: { staffId: { eq: 'staffId' }, year: { eq: 'year' } },
    sorts: { year: 'year' }, sort: '-year',
  },
}

// A row as the list sends it: only its `fields`, when it names them (the server does the same).
export const trimmed = (spec, r) => (spec.fields ? { ...Object.fromEntries(spec.fields.filter(f => f in r).map(f => [f, r[f]])), ...(r.$ && { $: r.$ }) } : r)

// The records a list pages through, in the demo store's data.
export const recordsOf = (data, key) => (key === 'v1Eforms' ? data.v1?.eforms : key === 'v1Overrides' ? data.v1?.overrides : data[LISTS[key]?.of || key]) || []

// A list's Excel download, as rows of cells: the header, then one row per record
// (a JS number stays a number, so Excel adds it up). The server and the demo both use it.
export function downloadRows(spec, rows) {
  const cols = spec.download.columns
  return [cols.map(c => c[0]), ...rows.map(r => cols.map(([, v]) => (typeof v === 'function' ? v(r) : get(r, v)) ?? ''))]
}

// ── The demo's engine: a description run on records in this browser ─────────
const get = (r, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), r)
// How a filter's value is read, here and on the server (backend/src/db/lists.js).
export const many = v => String(v).split(',').map(s => s.trim()).filter(Boolean)
export const valueOf = s => (s === 'none' ? null : /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s)
export const truthy = v => v === true || v === 'true' || v === '1' || v === 1
// A person's id, or null for anything else (a team filter then matches nobody).
export const personId = v => (/^\d+$/.test(String(v)) ? Number(v) : null)
const same = (a, b) => a === b || (a != null && b != null && String(a) === String(b))
const atLeast = (v, x) => (typeof v === 'number' ? v >= Number(x) : String(v) >= String(x))
const atMost = (v, x) => (typeof v === 'number' ? v <= Number(x) : String(v) <= String(x))
const r2 = n => Math.round(n * 100) / 100
// Counts key booleans as the tables store them (0 / 1).
const countKey = v => (typeof v === 'boolean' ? String(Number(v)) : v == null ? '' : String(v))

// A close: 'full', 'partial' (part of the claim) or 'balance' (the rest, after a partial).
export const closeKind = c => (!c.full ? 'partial' : c.partNo > 1 ? 'balance' : 'full')

const CUSTOM = {
  readyToClose: (r, v, ctx) => truthy(v) === (readyLeft(r, ctx.cash().get(r.id), ctx.setup) > 0),
  closeType: (r, v, ctx) => { const c = ctx.byId('closes').get(r.closeId); return !!c && closeKind(c) === v },
  readyPay: (r, v, ctx) => !!ctx.once(`readyPay:${v}`, () => {
    const has = new Set()
    if (v === 'salary' || v === 'incentives') for (const p of ctx.data?.payouts || []) if (isReady(p) && !p.stacked && !!p.role === (v === 'incentives')) has.add(p.staffId)
    return has
  }).has(r.id),
}
const isReady = p => p.status === 'approved' && p.requestId == null && p.archiveId == null

// Counts worked out in code (the server runs the same on the rows its SQL finds).
export const CUSTOM_COUNTS = {
  // Each request's slip (payslipTotals: gross, withholding tax unless the person is exempt, net), added up.
  payslips: (hits, ctx) => {
    const gross = new Map()
    const ids = new Set(hits.map(r => r.id))
    for (const p of ctx.data?.payouts || []) if (ids.has(p.requestId)) gross.set(p.requestId, [...(gross.get(p.requestId) || []), p.amount])
    return addSlips(hits.map(r => ({ amounts: gross.get(r.id) || [], exempt: !!ctx.byId('staff').get(r.staffId)?.whtExempt })), ctx.setup)
  },
}
// { n, gross, wht, net } of slips [{ amounts, exempt }].
export function addSlips(slips, setup) {
  const t = slips.map(x => payslipTotals(x.amounts, setup?.dealTypes?.whtPct, x.exempt))
  const add = k => r2(t.reduce((a, x) => a + x[k], 0))
  return { n: t.length, gross: add('gross'), wht: add('wht'), net: add('net') }
}

// The counts a request asks for: ?counts=0 none, ?counts=a,b those, otherwise all.
export const countsWanted = (spec, params) => Object.entries(spec.counts || {})
  .filter(([k]) => (params.counts === '0' ? false : !params.counts || many(params.counts).includes(k)))

function test(rule, r, v, ctx) {
  if (rule.eq) {
    const vals = many(v).map(valueOf)
    return [].concat(rule.eq).some(f => { const x = get(r, f); return vals.some(want => (want === null ? x == null : same(x, want))) })
  }
  if (rule.from) { const x = get(r, rule.from); return x != null && atLeast(x, v) }
  if (rule.to) { const x = get(r, rule.to); return x != null && atMost(x, v) }
  if (rule.yes) return !!get(r, rule.yes) === truthy(v)
  if (rule.notNull) return (get(r, rule.notNull) != null) === truthy(v)
  if (rule.oneOf) {
    const set = rule.sets[v]
    if (!set) return true
    const x = get(r, rule.oneOf)
    return Array.isArray(set) ? set.includes(x) : !set.not.includes(x)
  }
  if (rule.team) {
    const id = personId(v)
    if (id == null) return false
    const ids = ctx.team(id)
    return (rule.self !== false || r.id !== id) && rule.team.some(f => ids.has(get(r, f)))
  }
  if (rule.custom) return CUSTOM[rule.custom](r, v, ctx)
  if (rule.is) return String(get(r, rule.is) ?? '').trim().toLowerCase() === String(v).trim().toLowerCase()
  if (rule.via) { const x = ctx.byId(rule.of).get(get(r, rule.via)); return !!x && test(rule.rule, x, v, ctx) }
  return true
}

// The extras of `rows`, from the records in `data`: Map(id → { key: value }).
function extrasOf(defs, rows, data) {
  const out = new Map(rows.map(r => [r.id, {}]))
  const ids = new Set(rows.map(r => r.id))
  for (const [key, e] of Object.entries(defs)) {
    if (e.from) {
      const byId = new Map((data[e.of] || []).map(x => [x.id, x]))
      for (const r of rows) {
        const x = byId.get(get({ ...r, $: out.get(r.id) }, e.from))
        out.get(r.id)[key] = e.pick ? (x ? Object.fromEntries(e.pick.map(f => [f, get(x, f) ?? null])) : null) : x?.[e.field] ?? null
      }
      continue
    }
    const linked = new Map()
    for (const x of data[e.of] || []) {
      const to = get(x, e.by)
      if (!ids.has(to) || !Object.entries(e.where || {}).every(([f, vals]) => vals.includes(get(x, f) ?? null))
        || !Object.entries(e.not || {}).every(([f, vals]) => !vals.includes(get(x, f) ?? null))) continue
      linked.set(to, [...(linked.get(to) || []), x])
    }
    for (const r of rows) {
      const mine = linked.get(r.id) || []
      out.get(r.id)[key] = e.sum ? r2(mine.reduce((t, x) => t + Number(get(x, e.sum) || 0), 0)) : e.count ? mine.length
        : [...mine].sort((a, b) => a.id - b.id).map(x => Object.fromEntries(e.pick.map(f => [f, get(x, f) ?? null])))
    }
  }
  return out
}

function compare(a, b) {
  if (a == null || b == null) return a == null ? (b == null ? 0 : -1) : 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

// One page of `records` (already limited to what the viewer may see), as the
// server gives it: { rows, total, counts, page, size }. ctx: { data (every
// record, for extras and teams), today, setup }. counts=0 leaves the counts out
// (a later page: the first one had them).
export const listPage = (records, spec, params = {}, ctx = {}) => run(records, spec, params, ctx, false)
// Every matching record, sorted, with extras (an Excel download): { rows, total }.
export const listAll = (records, spec, params = {}, ctx = {}) => run(records, spec, { ...params, counts: '0' }, ctx, true)

// { n, sum (, distinct) } of records.
const addUp = (hits, def) => ({ n: hits.length, sum: r2(hits.reduce((t, r) => t + Number(get(r, def.sum) || 0), 0)),
  ...(def.distinct && { distinct: new Set(hits.map(r => get(r, def.distinct))).size }) })

function run(records, spec, params, ctx, all) {
  // Teams, E-Form cash and lookups by id are worked out once per call, not once per record.
  const teams = new Map(), byKind = new Map(), memo = new Map()
  let cashByDeal = null
  const c = {
    ...ctx,
    once: (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key) },
    team: id => { if (!teams.has(id)) teams.set(id, ctx.team ? ctx.team(id) : teamOf(id, ctx.data?.staff || [])); return teams.get(id) },
    cash: () => (cashByDeal ||= extrasOf(DEAL_CASH, ctx.data?.deals || [], ctx.data || {})),
    byId: kind => { if (!byKind.has(kind)) byKind.set(kind, new Map((ctx.data?.[kind] || []).map(x => [x.id, x]))); return byKind.get(kind) },
  }
  const words = String(params.q || '').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)
  // The texts a word may be in: the record's own, and those of the records it points at.
  const texts = r => (spec.search || []).flatMap(f => {
    if (typeof f === 'string') return [get(r, f)]
    const x = c.byId(f.of).get(get(r, f.via))
    return x ? f.fields.map(g => get(x, g)) : []
  }).map(v => String(v ?? '').toLowerCase())
  const found = r => { if (!words.length) return true; const t = texts(r); return words.every(w => t.some(x => x.includes(w))) }
  const active = Object.entries(spec.filters || {}).filter(([k]) => params[k] !== undefined && params[k] !== '')
  const pass = (r, except = [], extra = {}) => found(r) &&
    active.every(([k, rule]) => except.includes(k) || k in extra || test(rule, r, params[k], c)) &&
    Object.entries(extra).every(([k, v]) => test(spec.filters[k], r, v, c))
  const matching = records.filter(r => pass(r))

  const sorts = String(params.sort || spec.sort || '').split(',').filter(Boolean)
    .map(s => ({ desc: s.startsWith('-'), field: spec.sorts?.[s.replace(/^-/, '')] })).filter(s => s.field)
  if (!sorts.length && spec.sort) sorts.push({ desc: spec.sort.startsWith('-'), field: spec.sorts[spec.sort.replace(/^-/, '')] })
  const tie = sorts[0]?.desc ?? true
  const ordered = [...matching].sort((a, b) => {
    for (const s of sorts) { const d = compare(get(a, s.field), get(b, s.field)); if (d) return s.desc ? -d : d }
    return tie ? b.id - a.id : a.id - b.id
  })

  const size = Math.min(MAX_SIZE, Math.max(1, Number.parseInt(params.size, 10) || DEFAULT_SIZE))
  const page = Math.max(1, Number.parseInt(params.page, 10) || 1)
  const rows = all ? ordered : ordered.slice((page - 1) * size, page * size)

  const counts = {}
  for (const [key, def] of countsWanted(spec, params)) {
    if (typeof def === 'string') {
      counts[key] = {}
      for (const r of records) if (pass(r, [key])) { const k = countKey(get(r, def)); counts[key][k] = (counts[key][k] || 0) + 1 }
    } else if (def.only) {
      // Its own filters, and of the page's only those it keeps (the chosen branch).
      const set = { ...Object.fromEntries(active.filter(([k]) => (def.keep || []).includes(k)).map(([k]) => [k, params[k]])), ...def.only(c) }
      const hits = records.filter(r => Object.entries(set).every(([k, v]) => test(spec.filters[k], r, v, c)))
      if (def.custom) { counts[key] = CUSTOM_COUNTS[def.custom](hits, c); continue }
      counts[key] = addUp(hits, def)
    } else if (def.sum) {
      counts[key] = addUp(matching, def)
    } else {
      const set = typeof def.set === 'function' ? def.set(c) : def.set
      counts[key] = records.filter(r => pass(r, def.ignores || [], set)).length
    }
  }

  const extras = spec.extras ? extrasOf(spec.extras, rows, ctx.data || {}) : null
  return { rows: (extras ? rows.map(r => ({ ...r, $: extras.get(r.id) })) : rows).map(r => trimmed(spec, r)), total: matching.length, counts, page, size }
}

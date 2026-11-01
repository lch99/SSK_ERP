// Every list the ERP pages through, described once: what a search looks in, the
// filters, the sorts, the counts shown on filter chips, and the extras each row
// carries from other records (an E-Form's cleared cash, its listing's code…).
// Fields are the records' own (the shapes src/demo/erpSample.js makes; a dot
// reaches into a part, e.g. 'buyer.name'). The server turns a description into
// SQL (backend/src/db/lists.js, through each field's column in records.js); the
// demo runs it on the records in this browser (listPage below). Both give the
// same rows, total, counts and extras (backend/test/listParity.test.js).
//
// filters: { key: rule } — the page sends ?key=value
//   { eq: field | [fields] }     one value or several, comma-separated ('none' = empty); with several fields any may match
//   { from: field } { to: field } at least / at most (dates 'YYYY-MM-DD' or numbers); an empty field never matches
//   { yes: field }               'true' / '1', or 'false' / '0'
//   { notNull: field }           'true': has a value; 'false': has none
//   { oneOf: field, sets: { name: [values] | { not: [values] } } }   e.g. kind=agent
//   { team: [fields], self }     everyone under that person (and them, unless self: false); any field may match
//   { custom: name }             CUSTOM below here, and the same rule in SQL on the server
// sorts:  { key: field }; ?sort=-key is newest / biggest first; then by id, the same way.
// counts: 'field'                { value: n } for each value, leaving out the filter of the same name
//         { set: { key: value } | ctx => …, ignores? }   n with those filters set as well
//         { only: ctx => { key: value }, sum: field }    { n, sum } over these filters alone (not the page's)
// extras (on each row as `$`):
//         { sum: field, of: kind, by: field, where?: { field: [values] }, not?: { field: [values] } } → a number
//         { pick: [fields], of: kind, by: field }   the records of that kind that point at this one, by id
//         { field, of: kind, from: field }          one field of the record this one points at
import { teamOf } from './access.js'

export const DEFAULT_SIZE = 50
export const MAX_SIZE = 200
export const AGENT_TYPES = ['staff', 'sale-staff']

export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const monthStart = day => `${day.slice(0, 8)}01`

// How much cleared cash on an E-Form can close now: what has cleared (up to the
// bill) less what is closed, once all of it has cleared or Setup pays as money
// comes in; 0 otherwise. The E-Form pages and the "Ready to close" filter use it.
export function readyLeft(deal, { cleared, closed }, setup) {
  if (deal.status !== 'submitted' && deal.status !== 'partial') return 0
  const got = Math.min(cleared, deal.money.billed)
  const left = Math.round((got - closed) * 100) / 100
  return left > 0 && (got >= deal.money.billed || setup?.approvals?.payWhen === 'received') ? left : 0
}

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
    area: 'deals',
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
      year: { only: ctx => ({ from: `${ctx.today.slice(0, 4)}-01-01`, to: `${ctx.today.slice(0, 4)}-12-31`, status: 'submitted,partial,closed' }), sum: 'fee' },
    },
    extras: {
      listingCode: { field: 'code', of: 'listings', from: 'listingId' },
      ...DEAL_CASH,
      received: { sum: 'amount', of: 'moneyIn', by: 'dealId', not: { status: ['invalid', 'returned'] } },
      outs: { pick: ['id', 'type', 'voucherNo', 'amount', 'status'], of: 'moneyOut', by: 'dealId' },
    },
  },

  moneyIn: {
    area: 'moneyIn',
    search: ['code', 'payer', 'ref'],
    filters: { status: { eq: 'status' }, dealId: { eq: 'dealId' }, method: { eq: 'method' }, purpose: { eq: 'purpose' }, from: { from: 'date' }, to: { to: 'date' } },
    sorts: { date: 'date', amount: 'amount', bankOn: 'bankOn', code: 'code' },
    sort: '-date',
    counts: { status: 'status' },
  },

  closes: {
    area: 'payouts',
    search: [],
    filters: { dealId: { eq: 'dealId' }, from: { from: 'date' }, to: { to: 'date' } },
    sorts: { date: 'date' },
    sort: '-date',
  },

  payouts: {
    area: 'payouts',
    search: ['code'],
    filters: { status: { eq: 'status' }, staffId: { eq: 'staffId' }, dealId: { eq: 'dealId' }, closeId: { eq: 'closeId' }, side: { eq: 'side' }, role: { eq: 'role' },
      requestId: { eq: 'requestId' }, archiveId: { eq: 'archiveId' }, stacked: { yes: 'stacked' }, from: { from: 'date' }, to: { to: 'date' } },
    sorts: { date: 'date', amount: 'amount', code: 'code' },
    sort: '-date',
    counts: { status: 'status' },
  },

  requests: {
    area: 'salary',
    search: ['code'],
    filters: { status: { eq: 'status' }, kind: { eq: 'kind' }, staffId: { eq: 'staffId' }, from: { from: 'date' }, to: { to: 'date' } },
    sorts: { date: 'date', payOn: 'payOn', code: 'code' },
    sort: '-date',
    counts: { status: 'status', kind: 'kind' },
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

// The records a list pages through, in the demo store's data.
export const recordsOf = (data, key) => (key === 'v1Eforms' ? data.v1?.eforms : key === 'v1Overrides' ? data.v1?.overrides : data[key]) || []

// ── The demo's engine: a description run on records in this browser ─────────
const get = (r, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), r)
const many = v => String(v).split(',').map(s => s.trim()).filter(Boolean)
const valueOf = s => (s === 'none' ? null : /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s)
const same = (a, b) => a === b || (a != null && b != null && String(a) === String(b))
const truthy = v => v === true || v === 'true' || v === '1' || v === 1
const atLeast = (v, x) => (typeof v === 'number' ? v >= Number(x) : String(v) >= String(x))
const atMost = (v, x) => (typeof v === 'number' ? v <= Number(x) : String(v) <= String(x))
const r2 = n => Math.round(n * 100) / 100
// Counts key booleans as the tables store them (0 / 1).
const countKey = v => (typeof v === 'boolean' ? String(Number(v)) : v == null ? '' : String(v))

const CUSTOM = {
  readyToClose: (r, v, ctx) => truthy(v) === (readyLeft(r, cash(r, ctx.data), ctx.setup) > 0),
}
function cash(deal, data) {
  const ex = extrasOf(DEAL_CASH, [deal], data)
  return ex.get(deal.id)
}

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
    const ids = ctx.team(Number(v))
    return (rule.self !== false || r.id !== Number(v)) && rule.team.some(f => ids.has(get(r, f)))
  }
  if (rule.custom) return CUSTOM[rule.custom](r, v, ctx)
  return true
}

// The extras of `rows`, from the records in `data`: Map(id → { key: value }).
function extrasOf(defs, rows, data) {
  const out = new Map(rows.map(r => [r.id, {}]))
  const ids = new Set(rows.map(r => r.id))
  for (const [key, e] of Object.entries(defs)) {
    if (e.from) {
      const byId = new Map((data[e.of] || []).map(x => [x.id, x]))
      for (const r of rows) out.get(r.id)[key] = byId.get(get(r, e.from))?.[e.field] ?? null
      continue
    }
    const linked = (data[e.of] || []).filter(x => ids.has(get(x, e.by)) &&
      Object.entries(e.where || {}).every(([f, vals]) => vals.includes(get(x, f))) &&
      Object.entries(e.not || {}).every(([f, vals]) => !vals.includes(get(x, f))))
    for (const r of rows) {
      const mine = linked.filter(x => get(x, e.by) === r.id)
      out.get(r.id)[key] = e.sum ? r2(mine.reduce((t, x) => t + Number(get(x, e.sum) || 0), 0))
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
// record, for extras and teams), today, setup }.
export function listPage(records, spec, params = {}, ctx = {}) {
  const c = { ...ctx, team: ctx.team || (id => teamOf(id, ctx.data?.staff || [])) }
  const words = String(params.q || '').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)
  const found = r => words.every(w => (spec.search || []).some(f => String(get(r, f) ?? '').toLowerCase().includes(w)))
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
  const rows = ordered.slice((page - 1) * size, page * size)

  const counts = {}
  for (const [key, def] of Object.entries(spec.counts || {})) {
    if (typeof def === 'string') {
      counts[key] = {}
      for (const r of records) if (pass(r, [key])) { const k = countKey(get(r, def)); counts[key][k] = (counts[key][k] || 0) + 1 }
    } else if (def.only) {
      const set = def.only(c)
      const hits = records.filter(r => Object.entries(set).every(([k, v]) => test(spec.filters[k], r, v, c)))
      counts[key] = { n: hits.length, sum: r2(hits.reduce((t, r) => t + Number(get(r, def.sum) || 0), 0)) }
    } else {
      const set = typeof def.set === 'function' ? def.set(c) : def.set
      counts[key] = records.filter(r => pass(r, def.ignores || [], set)).length
    }
  }

  const extras = spec.extras ? extrasOf(spec.extras, rows, ctx.data || {}) : null
  return { rows: extras ? rows.map(r => ({ ...r, $: extras.get(r.id) })) : rows, total: matching.length, counts, page, size }
}

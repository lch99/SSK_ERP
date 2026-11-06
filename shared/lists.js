// Every list the ERP pages through, described once: what a search looks in, the
// filters, the sorts, the counts shown on filter chips, and the extras each row
// carries from other records (an E-Form's cleared cash, its listing's code…).
// Fields are the records' own (the shapes src/demo/erpSample.js makes; a dot
// reaches into a part, e.g. 'buyer.name'). The server turns a description into
// SQL (backend/src/db/lists.js, through each field's column in records.js); the
// demo runs it on the records in this browser (listPage below). Both give the
// same rows, total, counts and extras (backend/test/listParity.test.js).
//
// search: [field | { via: field, of: kind, fields: [fields] } | { digits: field }]   a word may be in the record or in the one it points at;
//                                { digits }: a phone number, by its digits (3 or more), whatever dashes or spaces it is written with
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
// sorts:  { key: field | { count: kind, by: field, on? } | { last: child, field } | { computed: name } }; ?sort=-key is newest / biggest first; then by id, the same way.
//         { computed } by a value worked out in code for every record (COMPUTED below here; the server the same)
//         { count } sorts by how many records of that kind point at this one (by its id, or its `on` field);
//         { last } by a field of the record's newest child row (a listing's latest follow-up date)
// counts: 'field'                { value: n } for each value, leaving out the filter of the same name
//         { set: { key: value } | ctx => …, ignores? }   n with those filters set as well
//         { only: ctx => { key: value }, sum: field, keep?, distinct? }   { n, sum } over these filters alone (and of the page's, those it keeps);
//                                with by: field, { value: n } for each value of that field instead ({ value: { n, sum } } with
//                                sum; month: true groups a date by its month, 'YYYY-MM': a trend in one read)
//                                with distinct: field, also how many different values it has ({ n, sum, distinct });
//                                with range: field, its lowest and highest value ({ …, range: { min, max } })
//         { only?, custom: name, keep? }  CUSTOM_COUNTS below here over those records (without only: those the page finds), and the same
//                                on the server; it may read the page's params (a report's period)
//         { sum?, distinct?, range?, by? }   the same over the page's own search and filters
//         ?counts=a,b asks for those counts only; ?counts=0 for none (a later page)
// extras (on each row as `$`):
//         { sum: field, of: kind, by: field, where?: { field: [values] }, not?: { field: [values] } } → a number (null in values: empty)
//         { count: true, of: kind, by: field, where?, not? }   how many → a number
//         { pick: [fields], of: kind, by: field }   the records of that kind that point at this one, by id
//         { field, of: kind, from: field }          one field of the record this one points at
//         { pick: [fields], of: kind, from: field, many? }  some of its fields ({ … } or null); with many, `from` holds
//                                several ids and the extra is a list (a viewing's listings)
//         `from` may start with '$.' to go on from an extra worked out above it (the agent on a payment's E-Form)
//         sums, counts and picks link on this record's id, or on its `on` field (listings by an area's name)
//         { custom: name }                CUSTOM_EXTRAS below here for the page's rows, and the same on the server
// download: { file, sheet, widths?, columns: [[label, field | (row, { setup }) => value]] }   the Excel download (downloadRows)
// readers: { area: record => record }   other areas that may read the list too, with what they may not see taken out
// fields: [fields]               the rows carry only these (a list over another kind that needs a few of its fields)
// mine: (record, viewer) => bool  each person's own, whatever their role (notifications); viewer: { key, branchId }
// market: true                   for a team or branch role, their reach and every active listing (the Whole agency);
//                                the server hides the owner of those they aren't tied to
// filters { custom, viewer: true }   the server puts the viewer's own key in (their favourites, their unread)
// area: null                     everyone may read it (their own)
import { teamOf } from './access.js'
import { payslipTotals, tiersFor, computeTierIndex, DEAL_TYPES } from './payout.js'
import { buildingRankings, noticeFor, categoryGroup, priceRating, hotLists, reviewOverdue, isHandedAway, isOutdated, KEY_FLAG, RATING, HOT_LISTS, LISTING_RULES } from './listings.js'
import { projectDeals, incentiveProgress } from './projects.js'
import { DEAL_STATUS, MONEY_IN_STATUS, PURPOSES, METHODS, CASH_METHODS, MONEY_OUT_STATUS, MONEY_OUT_TYPES, STAFF_STATUS, ACCOUNT_TYPES } from './labels.js'

export const DEFAULT_SIZE = 50
export const MAX_SIZE = 200
export const AGENT_TYPES = ['staff', 'sale-staff']

export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const monthStart = day => `${day.slice(0, 8)}01`
const monthEnd = day => addDays(`${Number(day.slice(5, 7)) === 12 ? Number(day.slice(0, 4)) + 1 : day.slice(0, 4)}-${String(Number(day.slice(5, 7)) % 12 + 1).padStart(2, '0')}-01`, -1)
// A payment's or close's E-Form, for filters and searches through it.
const viaDeal = rule => ({ via: 'dealId', of: 'deals', rule })
// Home's figures: the first day of the month `n` months before `day`'s ('2026-11-06', 9 → '2026-02-01'), and `day`'s year.
const monthsBefore = (day, n) => { const m = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 - n; return `${Math.floor(m / 12)}-${String(m % 12 + 1).padStart(2, '0')}-01` }
const yearOf = ctx => ({ from: `${ctx.today.slice(0, 4)}-01-01`, to: `${ctx.today.slice(0, 4)}-12-31` })
const tenMonths = ctx => ({ from: monthsBefore(ctx.today, 9) })
// E-Forms that count as business (not drafts or aborted), and those sent at all (not drafts).
const LIVE = 'submitted,partial,closed', SENT = 'submitted,partial,closed,cancelled'
const HOME = ['branchId']

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

// Listings: the listing rules of shared/listings.js as filters (the server runs the same in SQL).
const HOLDER = { via: 'holderId', of: 'staff', fields: ['short', 'name'] }
const LISTINGS = {
  area: 'listings',
  filters: {
    type: { eq: 'type' }, status: { eq: 'status' }, branchId: { eq: 'branchId' }, holderId: { eq: 'holderId' }, creatorId: { eq: 'creatorId' },
    titleId: { eq: 'titleId' }, area: { eq: 'area' }, category: { eq: 'category' }, draft: { yes: 'draft' },
    priceFrom: { from: 'askPrice' }, priceTo: { to: 'askPrice' }, createdFrom: { from: 'created' }, createdTo: { to: 'created' },
    bedsFrom: { from: 'beds' }, photosFrom: { from: 'photos' }, priceChanged: { notNull: 'priceBefore' },
    // Property type group (1 landed, 2 high-rise, 3 commercial), price against market value, the hot lists ('any' of them).
    group: { custom: 'categoryGroup', values: ['1', '2', '3'] },
    band: { custom: 'priceBand', values: ['red', 'orange', 'green', 'blue'] },
    hot: { custom: 'hotList', values: ['any', 'hotSale', 'superHot', 'rentKing'] },
    marketValue: { custom: 'marketValue', values: ['complete', 'incomplete'] },
    // A setting (Key On Agent Hand…), ever followed up, the latest follow-up's action.
    flag: { custom: 'flag', values: [KEY_FLAG, 'Vacant', 'Process Deal'] },
    followed: { custom: 'followedUp', values: ['true', 'false'] },
    lastAction: { custom: 'lastFollowUp', values: ['0', '1', '2', '3'] },
    // The viewer's favourites (their own: the server puts their key in).
    fav: { custom: 'favouriteOf', viewer: true, values: ['0'] },
    // Listing roles: a branch manager's whole team, the listings whose nearest area manager up the
    // holder's chain is this person, a building's project handler, made from an owner request.
    holderTeam: { team: ['holderId'] },
    areaManager: { custom: 'areaManagerOf' },
    titleHandler: { via: 'titleId', of: 'titles', rule: { eq: 'handlerId' } },
    fromOwner: { custom: 'fromOwnerRequest', values: ['true', 'false'] },
    // Free for an E-Form: none on it yet, this E-Form's own (its id), or one that was aborted.
    freeFor: { custom: 'freeForDeal', values: ['0', '1'] },
    // Held by a stand-in while this person's account was off (shared/listings.js handedAway).
    handedAwayFrom: { custom: 'handedAwayFrom', values: ['1', '2', '3', '9'] },
    // Active and not updated within the outdated window by that day (shared/listings.js isOutdated).
    outdatedBy: { custom: 'outdatedBy', values: ['2026-11-02', '2027-03-01'] },
  },
  sorts: { created: 'created', updated: 'updated', price: 'askPrice', priceUpdated: 'priceUpdated', photosOn: 'photosOn', code: 'code', views: 'views',
    title: 'title', followUp: { last: 'followUps', field: 'date' } },
  sort: '-updated',
  counts: {
    // area: where someone's listings are (the Agent Profile's areas of expertise).
    status: 'status', type: 'type', category: 'category', area: 'area',
    group1: { set: { group: '1' } }, group2: { set: { group: '2' } }, group3: { set: { group: '3' } },
    hotSale: { set: { hot: 'hotSale' } }, superHot: { set: { hot: 'superHot' } }, rentKing: { set: { hot: 'rentKing' } },
    // System → Automatic rules: active listings, by price band and hot list, past the outdated window, who handles
    // them; and looks at owners' details in the last 30 days.
    active: { only: () => ({ status: 'active' }) },
    ...Object.fromEntries(Object.keys(RATING).map(k => [`band_${k}`, { only: () => ({ status: 'active', band: k }) }])),
    ...Object.fromEntries(Object.keys(HOT_LISTS).map(k => [`activeHot_${k}`, { only: () => ({ status: 'active', hot: k }) }])),
    pastWindow: { only: ctx => ({ outdatedBy: ctx.today }) },
    handlers: { only: () => ({ status: 'active' }), custom: 'handlerMix' },
    ownerLooks: { only: () => ({}), custom: 'ownerLooks' },
    // Reports: the follow-ups each person made in the page's period (from, to), by action.
    followUpsBy: { custom: 'followUpsBy' },
  },
  extras: {
    deal: { pick: ['code', 'date', 'price', 'status'], of: 'deals', from: 'dealId' },
    title: { pick: ['name', 'managerId', 'handlerId', 'managerPermanent', 'handlerPermanent'], of: 'titles', from: 'titleId' },
  },
}

// Agents and office staff: one staff list, told apart by `kind`. The cards count everyone of
// that kind (in the chosen branch) whatever else is picked, so they keep only these filters.
const STAFF_KEEP = ['kind', 'branchId']
const STAFF = {
  area: 'staff',
  // A phone or IC number by its digits, however it was typed (the same-person check on Add).
  search: ['name', 'short', 'code', 'phone', 'ic', 'email', 'username', { digits: 'phone' }, { digits: 'ic' }],
  filters: {
    branchId: { eq: 'branchId' }, status: { eq: 'status' }, type: { eq: 'type' }, position: { eq: 'role' }, tierId: { eq: 'tierFloorId' },
    uplineId: { eq: 'uplineId' }, hasRole: { notNull: 'role' },
    // These people (ids, comma-separated): the org chart's rows on screen.
    ids: { eq: 'id' },
    // agent: Agent and Sales Agent accounts; office: everyone else (src/erp/model.js isAgent).
    kind: { oneOf: 'type', sets: { agent: AGENT_TYPES, office: { not: AGENT_TYPES } } },
    teamOf: { team: ['id'], self: false }, inTeam: { team: ['id'] },
    joinedFrom: { from: 'joined' }, joinedTo: { to: 'joined' }, lastActiveTo: { to: 'lastActive' }, expiresFrom: { from: 'expiresOn' }, expiresBy: { to: 'expiresOn' },
    // Still working here and the account runs out before this day (renew it).
    expiringBefore: { custom: 'expiringBefore', values: ['2026-12-01'] },
    // The tier each is on today (by their commission so far: tierCredit), by its code (T1…).
    tier: { custom: 'tierIs', values: ['T1', 'T2', 'T3'] },
  },
  sorts: { name: 'name', short: 'short', code: 'code', joined: 'joined', expiresOn: 'expiresOn', branch: 'branchId', status: 'status', lastActive: 'lastActive',
    type: 'type', tier: { computed: 'tierRank' }, closing: { computed: 'lifetime' }, earned: { computed: 'yearly' } },
  sort: 'name',
  counts: {
    // By status and account type, with the page's other filters (the Status chips, the Account type filter).
    status: 'status', type: 'type',
    // Everyone of this kind by status (the first card: how many, active, left, waiting for HR).
    everyone: { only: () => ({}), by: 'status', keep: STAFF_KEEP },
    joinedThisMonth: { only: ctx => ({ joinedFrom: monthStart(ctx.today) }), keep: STAFF_KEEP },
    // Registration (expiry date) running out within 30 days, or run out already.
    expiring: { only: ctx => ({ expiringBefore: addDays(ctx.today, 30) }), keep: STAFF_KEEP },
  },
}
const branchOf = (ctx, id) => ctx.setup?.branches?.find(b => b.id === id)?.name || ''
const maskIc = ic => (ic ? String(ic).replace(/\d{4}$/, '••••') : '')
const STAFF_CONTACT = [['Phone', 'phone'], ['Email', 'email'], ['IC no.', s => maskIc(s.ic)], ['Status', s => STAFF_STATUS[s.status]?.label || s.status],
  ['Joined', 'joined'], ['Account expiry', 'expiresOn']]
const LAST_ACTIVE = ['Last activity', s => (s.lastActive ? String(s.lastActive).slice(0, 10) : '')]

export const LISTS = {
  // Agents (kind=agent); `office` below is the same list for office staff, with its own Excel columns.
  staff: {
    ...STAFF,
    counts: {
      ...STAFF.counts,
      // Automatic rules: pending accounts two days or less from being suspended, active ones locking within 15 days.
      // Each person's tier and commission this year (Reports): everyone of this kind at once.
      standing: { only: () => ({}), custom: 'standingOfEach', keep: STAFF_KEEP },
      suspendSoon: { only: ctx => ({ status: 'pending', joinedTo: addDays(ctx.today, 2 - LISTING_RULES.pendingDays) }) },
      lockSoon: { only: ctx => ({ status: 'active', lastActiveTo: addDays(ctx.today, 14 - LISTING_RULES.idleDays) }) },
      // Leaders of everyone of this kind, by upline level (the Leaders card and the Level filter's choices).
      leaders: { only: () => ({ hasRole: 'true' }), by: 'role', keep: STAFF_KEEP },
      // How many are on each tier, of everyone of this kind (the Tier filter's choices).
      tiers: { only: () => ({}), custom: 'tierCounts', keep: STAFF_KEEP },
    },
    extras: {
      credit: { custom: 'tierCredit' }, team: { custom: 'teamSize' },
      upline: { pick: ['short', 'name', 'code'], of: 'staff', from: 'uplineId' },
    },
    download: {
      file: 'agents', sheet: 'Agents', widths: [14, 22, 26, 14, 16, 24, 8, 10, 22, 14, 8, 8, 14, 28, 18, 10, 12, 14, 18, 18, 14],
      columns: [
        ['Staff ID', 'code'], ['Name', 'short'], ['IC name', 'name'], ['User name', 'username'], ['Branch', (s, c) => branchOf(c, s.branchId)],
        ['Upline level', (s, c) => (s.role ? `${s.role} · ${c.setup?.roles?.find(r => r.code === s.role)?.name || s.role}` : '')], ['Tier', '$.credit.tier'],
        ['Agent rate %', (s, c) => { const t = tiersFor(c.setup || {}, s.branchId).find(x => x.name === s.$.credit.tier); return t ? Number(t.agentRate) : '' }],
        ['Upline', s => s.$.upline?.short || s.$.upline?.name || ''], ['Upline staff ID', '$.upline.code'], ['Direct', '$.team.direct'], ['In team', '$.team.team'],
        ...STAFF_CONTACT, ['Closing, lifetime (RM)', '$.credit.lifetime'], ['Commission this year (RM)', '$.credit.yearly'], LAST_ACTIVE,
      ],
    },
  },
  office: {
    ...STAFF, of: 'staff',
    download: {
      file: 'office-staff', sheet: 'Office staff', widths: [14, 22, 26, 14, 18, 16, 14, 28, 18, 10, 12, 14, 14],
      columns: [
        ['Staff ID', 'code'], ['Name', 'short'], ['IC name', 'name'], ['User name', 'username'], ['Account type', s => ACCOUNT_TYPES[s.type] || s.type],
        ['Branch', (s, c) => branchOf(c, s.branchId)], ...STAFF_CONTACT, LAST_ACTIVE,
      ],
    },
  },

  listings: { ...LISTINGS, search: ['code', 'title', 'area', 'address', HOLDER] },

  // The Whole agency: a team or branch role's own listings and every active one (agents bring
  // customers to any of them; pickers and viewings too). The address is not searched: units stay hidden.
  agency: { ...LISTINGS, of: 'listings', market: true, search: ['code', 'title', 'area', HOLDER] },

  customers: {
    area: 'customers',
    search: ['name', 'phone', 'code', 'area', 'remarks', { digits: 'phone' }],
    filters: { type: { eq: 'type' }, track: { eq: 'track' }, action: { eq: 'action' }, ownerId: { eq: 'ownerId' }, branchId: { eq: 'branchId' },
      source: { eq: 'from' }, from: { from: 'date' }, to: { to: 'date' } },
    sorts: { date: 'date', name: 'name', type: 'type', budget: 'budgetMin' },
    sort: '-date',
    counts: {
      track: 'track', type: 'type',
      // Active and still on Admin Follow-Up.
      adminFollowUp: { only: () => ({ track: '0', action: '0' }), keep: ['branchId'] },
    },
    extras: { dealCode: { field: 'code', of: 'deals', from: 'dealId' } },
  },

  deals: {
    area: 'deals', readers: { moneyIn: withoutParties },
    search: ['code', 'buyer.name', 'owner.name', 'property.title', 'property.address'],
    filters: {
      status: { eq: 'status' }, type: { eq: 'type' }, branchId: { eq: 'branchId' }, agentId: { eq: 'agentId' }, holderId: { eq: 'holderId' },
      listingId: { eq: 'listingId' }, projectId: { eq: 'projectId' }, lvStatus: { eq: 'landlordCheck.status' }, lvArchive: { eq: 'landlordCheck.archiveId' },
      title: { eq: 'property.title' },
      // Either side of the deal (the sales agent or the listing holder).
      staffId: { eq: ['agentId', 'holderId'] },
      // A leader and everyone under them, on either side; agentTeam: as the sales agent only.
      teamOf: { team: ['agentId', 'holderId'] }, agentTeam: { team: ['agentId'] },
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
      // A person's E-Forms this year (staffId), by who sold them: their own, the rest on their listings.
      yearByAgent: { only: ctx => ({ from: `${ctx.today.slice(0, 4)}-01-01`, to: `${ctx.today.slice(0, 4)}-12-31`, status: 'submitted,partial,closed' }), by: 'agentId', keep: ['staffId', 'branchId'] },
      // Home: ten months of fees (and by deal type) and billing, the year's mix, the pipeline, what waits, the branches.
      feesByMonth: { only: ctx => ({ ...tenMonths(ctx), status: LIVE }), by: 'date', month: true, sum: 'fee', keep: HOME },
      ...Object.fromEntries(DEAL_TYPES.map(t => [`feesByMonth_${t}`, { only: ctx => ({ ...tenMonths(ctx), status: LIVE, type: t }), by: 'date', month: true, sum: 'fee', keep: HOME }])),
      billedByMonth: { only: ctx => ({ ...tenMonths(ctx), status: SENT }), by: 'date', month: true, sum: 'money.billed', keep: HOME },
      billedYear: { only: ctx => ({ ...yearOf(ctx), status: SENT }), sum: 'money.billed', keep: HOME },
      mixYear: { only: ctx => ({ ...yearOf(ctx), status: LIVE }), by: 'type', sum: 'fee', keep: HOME },
      byStatus: { only: () => ({}), by: 'status', sum: 'fee', keep: HOME },
      endedYear: { only: ctx => ({ ...yearOf(ctx), status: 'closed,cancelled' }), by: 'status', sum: 'fee', keep: HOME },
      stale: { only: ctx => ({ status: 'submitted', to: addDays(ctx.today, -46) }), keep: HOME },
      // The commission flow and the menu (src/erp/waiting.jsx): E-Forms whose cleared cash can be closed now.
      readyToClose: { only: () => ({ ready: 'true' }), keep: HOME },
      collecting: { only: () => ({ status: 'submitted,partial' }), custom: 'collected', keep: HOME },
      branchesMonth: { only: ctx => ({ from: monthStart(ctx.today), to: monthEnd(ctx.today), status: LIVE }), by: 'branchId', sum: 'fee' },
      branchesYear: { only: ctx => ({ ...yearOf(ctx), status: LIVE }), by: 'branchId', sum: 'fee' },
      // An agent's Home (agentId, agentTeam): their billing this month and last, their team's month, E-Forms short of cash.
      ownByMonth: { only: ctx => ({ from: monthsBefore(ctx.today, 1), status: LIVE }), by: 'date', month: true, sum: 'money.billed', keep: ['agentId'] },
      teamFees: { only: ctx => ({ from: monthStart(ctx.today), to: monthEnd(ctx.today), status: LIVE }), sum: 'fee', keep: ['agentTeam'] },
      teamBilled: { only: ctx => ({ from: monthStart(ctx.today), to: monthEnd(ctx.today), status: LIVE }), sum: 'money.billed', keep: ['agentTeam'] },
      short: { only: () => ({ status: 'submitted,partial' }), custom: 'shortOfCash', keep: ['agentId'] },
      // Reports, over the page's own filters: by sales agent (billed, fees, cleared up to each bill),
      // by building (full closes), by person on either side.
      perAgent: { by: 'agentId', sum: 'money.billed' },
      feesPerAgent: { by: 'agentId', sum: 'fee' },
      clearedPerAgent: { custom: 'clearedByAgent' },
      perBuilding: { custom: 'byBuilding' },
      perPerson: { custom: 'byPerson' },
      // Listings on the product side only (the holder is not also the sales agent), by holder.
      productSide: { custom: 'productSide' },
      // Landlord checks: everyone's by status, and the unverified ones by archive.
      checks: { only: () => ({}), by: 'landlordCheck.status' },
      unverifiedByArchive: { only: () => ({ lvStatus: '-1' }), by: 'landlordCheck.archiveId' },
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
      branchId: viaDeal({ eq: 'branchId' }), agentId: viaDeal({ eq: 'agentId' }), staffId: viaDeal({ eq: ['agentId', 'holderId'] }),
      from: { from: 'date' }, to: { to: 'date' }, clearedFrom: { from: 'clearsOn' }, clearedTo: { to: 'clearsOn' },
      // The same slip recorded twice: the same reference or cheque, or the same amount banked in on the same day.
      ref: { is: 'ref' }, amount: { eq: 'amount' }, bankOn: { eq: 'bankOn' },
    },
    sorts: { date: 'date', amount: 'amount', bankOn: 'bankOn', clearsOn: 'clearsOn', code: 'code', status: 'status', recorded: 'id' },
    sort: '-date',
    counts: {
      status: 'status',
      // Draft and Pending: still to check against the bank statement.
      toCheck: { only: () => ({ status: 'draft,pending' }), sum: 'amount', keep: ['branchId'] },
      returned60: { only: ctx => ({ status: 'returned', from: addDays(ctx.today, -60) }), keep: HOME },
      // An agent's Home (staffId): returned or rejected in the last 60 days.
      bounced60: { only: ctx => ({ status: 'returned,invalid', from: addDays(ctx.today, -60) }), keep: ['staffId'] },
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
    filters: { dealId: { eq: 'dealId' }, from: { from: 'date' }, to: { to: 'date' }, branchId: viaDeal({ eq: 'branchId' }),
      staffId: viaDeal({ eq: ['agentId', 'holderId'] }) },
    sorts: { date: 'date' },
    sort: '-date',
    // Home: ten months of net commission closed, everything claimed, and the year's net by the E-Form's branch;
    // an agent's closes this month (staffId: on either side of the E-Form).
    counts: {
      thisMonth: { only: ctx => ({ from: monthStart(ctx.today), to: monthEnd(ctx.today) }), keep: ['staffId', 'branchId'] },
      netByMonth: { only: ctx => tenMonths(ctx), by: 'date', month: true, sum: 'net', keep: HOME },
      claimByMonth: { only: ctx => tenMonths(ctx), by: 'date', month: true, sum: 'claim', keep: HOME },
      // Reports, over the page's own filters: claimed by the E-Form's sales agent; by each person on a side.
      claimPerAgent: { custom: 'claimByDealAgent' },
      perPerson: { custom: 'sidesByPerson' },
      claimed: { only: () => ({}), sum: 'claim', keep: HOME },
      netByBranchYear: { only: ctx => yearOf(ctx), custom: 'netByDealBranch' },
    },
    extras: { deal: { pick: ['code', 'property.title'], of: 'deals', from: 'dealId' } },
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
      queried: { only: () => ({ status: 'queried', archived: 'false' }), distinct: 'dealId', keep: HOME },
      // The commission flow (src/erp/waiting.jsx): Ready lines nobody has requested or stacked, by how many people; their salary lines.
      readyToRequest: { only: () => ({ ...OPEN_LINE, stacked: 'false' }), distinct: 'staffId', keep: HOME },
      salaryToRequest: { only: () => ({ ...OPEN_LINE, stacked: 'false', incentive: 'false' }), keep: HOME },
      // Reports, over the page's own filters: each person's payout, and on how many archived E-Forms.
      perPerson: { custom: 'linesByPerson' },
      // Each person's own pay (no upline level) and incentives (an upline level).
      payByKind: { custom: 'payByKind' },
      paidByBranchYear: { only: ctx => yearOf(ctx), custom: 'paidByDealBranch' },
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
      // A person's lines (staffId): paid to date, and earned this year (own deals and upline overrides).
      paid: { only: () => ({ status: 'paid' }), sum: 'amount', keep: ['staffId'] },
      thisYear: { only: ctx => ({ from: `${ctx.today.slice(0, 4)}-01-01`, to: `${ctx.today.slice(0, 4)}-12-31` }), sum: 'amount', keep: ['staffId'] },
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
      unpaidPayOn: { only: () => ({ status: 'new,ready' }), range: 'payOn', keep: ['branchId', 'staffId'] },
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

  // Payments out (request forms).
  moneyOut: {
    area: 'moneyOut',
    search: ['voucherNo', 'payee.name', { via: 'dealId', of: 'deals', fields: ['code'] }],
    filters: { status: { eq: 'status' }, type: { eq: 'type' }, dealId: { eq: 'dealId' }, branchId: { eq: 'branchId' }, staffId: { eq: 'staffId' },
      from: { from: 'date' }, to: { to: 'date' } },
    sorts: { date: 'date', amount: 'amount', voucherNo: 'voucherNo', paidOn: 'paidOn', status: 'status', type: 'type' },
    sort: '-date',
    counts: {
      status: 'status', type: 'type',
      // Not paid yet, and Payment Ready (what Accounts can pay now).
      unpaid: { only: () => ({ status: 'new,queried,ready' }), sum: 'amount', keep: ['branchId'] },
      toApprove: { only: () => ({ status: 'new,queried' }), keep: HOME },
      ready: { only: () => ({ status: 'ready' }), sum: 'amount', keep: ['branchId'] },
    },
    extras: {
      deal: { pick: ['code', 'type', 'property.title'], of: 'deals', from: 'dealId' },
      staff: { pick: ['short', 'name'], of: 'staff', from: 'staffId' },
    },
    download: {
      file: 'request-forms', sheet: 'Request forms', widths: [14, 24, 12, 14, 18, 26, 16, 20, 22, 14, 14, 16, 13, 22, 28],
      columns: [
        ['No.', 'voucherNo'], ['Type', x => MONEY_OUT_TYPES[x.type]], ['Date', 'date'], ['Form', '$.deal.code'], ['Staff', x => x.$.staff?.short || x.$.staff?.name || ''],
        ['Pay to', 'payee.name'], ['IC', 'payee.ic'], ['Bank', 'payee.bank'], ['Bank Account Number', 'payee.account'], ['Amount', 'amount'], ['Cheque No.', 'chequeNo'],
        ['Status', x => MONEY_OUT_STATUS[x.status]?.label], ['Payment Date', 'paidOn'], ['Receipt', 'receipt'], ['Reasons', 'query'],
      ],
    },
  },

  // Owner requests: owners who asked through the website to list their property.
  vendorRequests: {
    area: 'listings',
    search: ['ticket', 'name', 'phone', 'area', { digits: 'phone' }],
    filters: { status: { eq: 'status' }, branchId: { eq: 'branchId' }, listingId: { eq: 'listingId' } },
    sorts: { date: 'date' }, sort: '-date',
    counts: { status: 'status' },
    extras: { listingCode: { field: 'code', of: 'listings', from: 'listingId' } },
  },

  // Enquiries on listings from the website and app: the inbox, starred and trash.
  enquiries: {
    area: 'listings',
    search: ['name', 'phone', 'message', { digits: 'phone' }],
    filters: { listingId: { eq: 'listingId' }, starred: { yes: 'starred' }, trashed: { yes: 'trashed' } },
    sorts: { date: 'date' }, sort: '-date',
    counts: {
      inbox: { only: () => ({ trashed: 'false' }) }, star: { only: () => ({ starred: 'true', trashed: 'false' }) }, trash: { only: () => ({ trashed: 'true' }) },
    },
    extras: { listing: { pick: ['code', 'title', 'holderId'], of: 'listings', from: 'listingId' } },
  },

  // Buildings and estates (titles), with how many listings each has and who leads it.
  titles: {
    area: 'listings',
    search: ['name', 'area'],
    filters: { status: { eq: 'status' }, branchId: { eq: 'branchId' }, category: { eq: 'category' }, area: { eq: 'area' } },
    sorts: { name: 'name', area: 'area', requestedOn: 'requestedOn', listings: { count: 'listings', by: 'titleId' } }, sort: 'name',
    // leads: approved buildings with a Project Manager / Project Handler, held for good, close to changing hands (Automatic rules).
    counts: { status: 'status', leads: { only: () => ({ status: '0' }), custom: 'buildingLeads' } },
    extras: { listings: { count: true, of: 'listings', by: 'titleId' }, ranking: { custom: 'buildingRanking' } },
  },

  // Areas, with how many listings carry each area's name.
  areas: {
    area: 'listings',
    search: ['name', 'state'],
    filters: { status: { eq: 'status' }, branchId: { eq: 'branchId' }, state: { eq: 'state' } },
    sorts: { name: 'name', requestedOn: 'requestedOn', listings: { count: 'listings', by: 'area', on: 'name' } }, sort: 'name',
    counts: { status: 'status', state: 'state' },
    extras: { listings: { count: true, of: 'listings', by: 'area', on: 'name' } },
  },

  videos: {
    area: 'videos',
    search: ['title', 'description'], filters: { cate: { eq: 'cate' } },
    sorts: { date: 'date', title: 'title' }, sort: '-date',
    // On how many dates.
    counts: { cate: 'cate', dates: { distinct: 'date' } },
  },

  propertyTypes: { area: 'listings', search: ['name'], sorts: { name: 'name' }, sort: 'name' },

  // Viewings (appointments): those booked or hosted (as the listing's product handler) by someone in the viewer's reach.
  viewings: {
    area: 'listings',
    search: ['code', 'customer.name', { via: 'requestedBy', of: 'staff', fields: ['short', 'name'] }, { via: 'handlerId', of: 'staff', fields: ['short', 'name'] },
      { via: 'listingIds.0', of: 'listings', fields: ['code', 'title'] }],
    filters: {
      status: { eq: 'status' }, staffId: { eq: ['requestedBy', 'handlerId'] }, handlerId: { eq: 'handlerId' }, requestedBy: { eq: 'requestedBy' }, from: { from: 'date' }, to: { to: 'date' },
      // The (first) listing's branch (the top bar's); one listing among those viewed.
      branchId: { via: 'listingIds.0', of: 'listings', rule: { eq: 'branchId' } }, listing: { custom: 'viewsListing' },
      // Waiting for the viewer: to confirm as the host, or to review as the one who booked (the server puts their key in).
      waitingFor: { custom: 'waitingFor', viewer: true, values: ['0'] },
      // A review overdue at this time ('YYYY-MM-DD HH:MM').
      reviewDue: { custom: 'reviewDue', values: ['2026-11-02 12:00', '2026-12-31 23:59'] },
    },
    sorts: { date: 'date', time: 'time' }, sort: 'date,time',
    counts: {
      status: 'status',
      today: { only: ctx => ({ status: 'confirmed', from: ctx.today, to: ctx.today }), keep: ['branchId'] },
      week: { only: ctx => ({ status: 'new,rescheduled,confirmed', from: ctx.today, to: addDays(ctx.today, 6) }), keep: ['branchId'] },
      done30: { only: ctx => ({ status: 'done', from: addDays(ctx.today, -30) }), keep: ['branchId'] },
      // Today or tomorrow and still not confirmed by the product handler.
      unconfirmed: { only: ctx => ({ status: 'new,rescheduled', to: addDays(ctx.today, 1) }), keep: HOME },
      overdue: { only: ctx => ({ reviewDue: `${ctx.today} 23:59` }) },
      // Reports, over the page's own filters: booked, hosted, viewed and with a keen buyer, by person.
      perPerson: { custom: 'viewingsBy' },
    },
    extras: { listings: { pick: ['code', 'title', 'area', 'category', 'type', 'status', 'holderId', 'titleId', 'branchId'], of: 'listings', from: 'listingIds', many: true } },
  },

  // Notifications: each person's own (to them, their branch or everyone), newest first.
  notices: {
    area: null, mine: (n, who) => noticeFor(n, who.key, who.branchId),
    search: ['text'],
    filters: { cat: { eq: 'cat' }, unread: { custom: 'unreadBy', viewer: true, values: ['0'] } },
    sorts: { at: 'at' }, sort: '-at',
    counts: { cat: 'cat' },
  },

  // Developers' projects, with their sales and each incentive's progress (counted for the whole company).
  projects: {
    area: 'projects',
    search: ['name', 'developer', 'location'], filters: { status: { eq: 'status' } },
    sorts: { name: 'name', launchedOn: 'launchedOn', added: 'id' }, sort: 'name',
    counts: { status: 'status' },
    extras: { sales: { custom: 'projectSales' } },
  },

  // The first system's (V1) E-Forms and yearly Overide summaries: read only.
  v1Eforms: {
    area: 'deals',
    search: ['code', 'address', { via: 'staffId', of: 'staff', fields: ['name', 'short'] }],
    filters: { staffId: { eq: 'staffId' }, type: { eq: 'type' }, status: { eq: 'status' }, from: { from: 'date' }, to: { to: 'date' } },
    sorts: { date: 'date', code: 'code', price: 'price', total: 'total', status: 'status' }, sort: '-date',
    // All of them: how many, the closing total, and the years they span.
    counts: { all: { only: () => ({}), sum: 'closing', range: 'date' } },
    extras: { staff: { pick: ['short', 'name'], of: 'staff', from: 'staffId' } },
    download: {
      file: 'old-eforms', sheet: 'Old E-Forms', widths: [16, 12, 10, 22, 40, 14, 14, 14, 14],
      columns: [['Code', 'code'], ['Date', 'date'], ['Type', 'type'], ['Staff', r => r.$.staff?.short || r.$.staff?.name || ''], ['Address', 'address'],
        ['Price', 'price'], ['Total', 'total'], ['Closing Total', 'closing'], ['Status', r => DEAL_STATUS[r.status]?.label]],
    },
  },

  v1Overrides: {
    area: 'deals',
    search: [], filters: { staffId: { eq: 'staffId' }, year: { eq: 'year' } },
    sorts: { year: 'year', override: 'override', sales: 'sales', cases: 'cases' }, sort: '-year',
    // The years there are; the overides and team sales of the rows found.
    counts: { years: 'year', override: { sum: 'override' }, sales: { sum: 'sales' } },
    extras: { staff: { pick: ['short', 'name', 'code'], of: 'staff', from: 'staffId' } },
    download: {
      file: 'overide-summary', sheet: 'Overide Summary', widths: [24, 8, 10, 16, 16],
      columns: [['Staff', r => r.$.staff?.short || r.$.staff?.name || ''], ['Year', 'year'], ['Cases', 'cases'], ['Team Sales', 'sales'], ['Overide', 'override']],
    },
  },
}

// A row as the list sends it: only its `fields`, when it names them (the server does the same).
export const trimmed = (spec, r) => (spec.fields ? { ...Object.fromEntries(spec.fields.filter(f => f in r).map(f => [f, r[f]])), ...(r.$ && { $: r.$ }) } : r)

// The records a list pages through, in the demo store's data.
export const recordsOf = (data, key) => (key === 'v1Eforms' ? data.v1?.eforms : key === 'v1Overrides' ? data.v1?.overrides : data[LISTS[key]?.of || key]) || []

// A list's Excel download, as rows of cells: the header, then one row per record
// (a JS number stays a number, so Excel adds it up). The server and the demo both use it.
// `ctx`: { setup } (a branch's name).
export function downloadRows(spec, rows, ctx = {}) {
  const cols = spec.download.columns
  return [cols.map(c => c[0]), ...rows.map(r => cols.map(([, v]) => (typeof v === 'function' ? v(r, ctx) : get(r, v)) ?? ''))]
}

// ── The demo's engine: a description run on records in this browser ─────────
const get = (r, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), r)
// How a filter's value is read, here and on the server (backend/src/db/lists.js).
export const many = v => String(v).split(',').map(s => s.trim()).filter(Boolean)
export const valueOf = s => (s === 'none' ? null : /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s)
export const truthy = v => v === true || v === 'true' || v === '1' || v === 1
// A phone number without its dashes, spaces, + and brackets (searching by digits).
export const phoneDigits = v => String(v ?? '').replace(/[- +()]/g, '')
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
  categoryGroup: (r, v) => categoryGroup(r.category) === Number(v),
  priceBand: (r, v) => priceRating(r)?.band === v,
  hotList: (r, v) => (v === 'any' ? hotLists(r).length > 0 : hotLists(r).includes(v)),
  marketValue: (r, v) => (v === 'complete' ? !!Number(r.marketValue) : v === 'incomplete' ? !Number(r.marketValue) : true),
  flag: (r, v) => (r.flags || []).includes(v),
  followedUp: (r, v) => (r.followUps || []).length > 0 === truthy(v),
  lastFollowUp: (r, v) => r.followUps?.length > 0 && same(r.followUps.at(-1).action, valueOf(v)),
  favouriteOf: (r, v, ctx) => (ctx.data?.favourites?.[personId(v)]?.listings || []).includes(r.id),
  // The nearest upline holding the second-most-senior level (an area manager) of the listing's holder.
  areaManagerOf: (r, v, ctx) => ctx.once('areaManagers', () => areaManagers(ctx.data?.staff || [], ctx.setup)).get(r.holderId) === personId(v),
  expiringBefore: (r, v) => r.status !== 'inactive' && r.expiresOn != null && String(r.expiresOn) < String(v),
  tierIs: (r, v, ctx) => tiersNow(ctx).get(r.id)?.tier === v,
  handedAwayFrom: (r, v) => isHandedAway(r, personId(v)),
  freeForDeal: (r, v, ctx) => r.dealId == null || same(r.dealId, valueOf(v)) || ctx.byId('deals').get(r.dealId)?.status === 'cancelled',
  fromOwnerRequest: (r, v, ctx) => ctx.once('fromOwner', () => new Set((ctx.data?.vendorRequests || []).map(x => x.listingId).filter(x => x != null))).has(r.id) === truthy(v),
  viewsListing: (r, v) => personId(v) != null && (r.listingIds || []).includes(personId(v)),
  waitingFor: (r, v) => personId(v) != null && ((r.handlerId === personId(v) && ['new', 'rescheduled'].includes(r.status)) || (r.requestedBy === personId(v) && r.status === 'review')),
  reviewDue: (r, v) => reviewOverdue(r, String(v)),
  outdatedBy: (r, v) => isOutdated(r, String(v).slice(0, 10)),
  // Not read yet by that person (their key: staff id, 0 = an office account).
  unreadBy: (r, v) => personId(v) != null && !(r.readBy || []).includes(personId(v)),
  readyPay: (r, v, ctx) => !!ctx.once(`readyPay:${v}`, () => {
    const has = new Set()
    if (v === 'salary' || v === 'incentives') for (const p of ctx.data?.payouts || []) if (isReady(p) && !p.stacked && !!p.role === (v === 'incentives')) has.add(p.staffId)
    return has
  }).has(r.id),
}
// Each person's area manager: the nearest one up their chain at the second-most-senior upline level
// (src/erp/model.js areaManagerOf). Map(staffId → their area manager's id).
export function areaManagers(staff, setup) {
  const code = [...(setup?.roles || [])].reverse()[1]?.code
  const byId = new Map(staff.map(s => [s.id, s]))
  const out = new Map()
  if (!code) return out
  for (const s of staff) {
    const seen = new Set([s.id])
    for (let up = byId.get(s.uplineId); up && !seen.has(up.id); up = byId.get(up.uplineId)) {
      seen.add(up.id)
      if (up.role === code) { out.set(s.id, up.id); break }
    }
  }
  return out
}
const isReady = p => p.status === 'approved' && p.requestId == null && p.archiveId == null

// Counts worked out in code (the server runs the same on the rows its SQL finds).
// Buildings (approved): how many have a Project Manager / Project Handler, how many hold the post for good,
// and how many are close to changing hands (the leader among the rest is past 60% of the threshold).
// rankings: shared/listings.js buildingRankings (the server works them out for these buildings only).
export function leadCounts(titles, rankings) {
  const close = kind => titles.filter(t => {
    const top = rankings.get(t.id)?.[kind]?.[0]
    const rule = kind === 'sale' ? LISTING_RULES.projectManager : LISTING_RULES.projectHandler
    return top && top.n >= rule.win * 0.6 && top.n < rule.win && top.staffId !== (kind === 'sale' ? t.managerId : t.handlerId)
  }).length
  return { pm: titles.filter(t => t.managerId).length, ph: titles.filter(t => t.handlerId).length,
    forGood: titles.filter(t => t.managerPermanent || t.handlerPermanent).length, closePm: close('sale'), closePh: close('rental') }
}

// A viewing's review outcomes that mean the buyer is keen.
export const KEEN = ['interested', 'second', 'offer']
// { key: total } of [key, amount] pairs from each record (a missing key is '').
function sumsBy(hits, pairs) {
  const out = {}
  for (const r of hits) for (const [k, v] of pairs(r)) out[countKey(k)] = (out[countKey(k)] || 0) + v
  for (const k of Object.keys(out)) out[k] = r2(out[k])
  return out
}

// { value: { n, sum } } of records grouped by their E-Form's branch (closes and payout lines have none of their own).
const byDealBranch = (hits, ctx, field) => {
  const out = {}
  for (const r of hits) {
    const k = countKey(ctx.byId('deals').get(r.dealId)?.branchId)
    const g = (out[k] ||= { n: 0, sum: 0 })
    g.n++
    g.sum += Number(r[field] || 0)
  }
  for (const g of Object.values(out)) g.sum = r2(g.sum)
  return out
}

export const CUSTOM_COUNTS = {
  // Open E-Forms: how much is billed, and how much of it has cleared (each capped at its bill).
  collected: (hits, ctx) => {
    const cash = ctx.cash()
    return { n: hits.length, billed: r2(hits.reduce((t, d) => t + Number(d.money?.billed || 0), 0)),
      collected: r2(hits.reduce((t, d) => t + Math.min(cash.get(d.id)?.cleared || 0, Number(d.money?.billed || 0)), 0)) }
  },
  netByDealBranch: (hits, ctx) => byDealBranch(hits, ctx, 'net'),
  // Active listings: handled by a co-product handler (the last pick), by their main product handler,
  // with a co-PH slot locked in (key or exclusive), with a slot ending within 7 days.
  handlerMix: (hits, ctx) => {
    const week = addDays(ctx.today, 7)
    const slots = l => l.share?.coPh || []
    return {
      byCoPh: hits.filter(l => ['coPh', 'locked'].includes(l.phLog?.at(-1)?.from)).length,
      byMain: hits.filter(l => l.share?.pmId && l.share.pmId === l.holderId).length,
      ending: hits.filter(l => slots(l).some(c => !c.locked && c.until && c.until >= ctx.today && c.until <= week)).length,
      locked: hits.filter(l => slots(l).some(c => c.locked)).length,
    }
  },
  // Looks at an owner's details in the last 30 days (each Show is logged on the listing).
  ownerLooks: (hits, ctx) => {
    const from = addDays(ctx.today, -30)
    return { n: hits.reduce((t, l) => t + (l.ownerViews || []).filter(x => x.at >= from).length, 0) }
  },
  // Reports. Each E-Form's cleared cash, capped at its bill, by its sales agent.
  clearedByAgent: (hits, ctx) => {
    const cash = ctx.cash()
    return sumsBy(hits, d => [[d.agentId, Math.min(cash.get(d.id)?.cleared || 0, Number(d.money?.billed || 0))]])
  },
  // Full closes by their listing's building: how many sales and rentals, their prices, and the fees.
  byBuilding: (hits, ctx) => {
    const out = {}
    for (const d of hits) {
      const t = ctx.byId('listings').get(d.listingId)?.titleId
      if (t == null || !ctx.byId('titles').has(t)) continue
      const g = (out[countKey(t)] ||= { sales: 0, saleValue: 0, rentals: 0, rentValue: 0, fees: 0 })
      if (d.type === 'rental') { g.rentals++; g.rentValue += Number(d.price || 0) } else { g.sales++; g.saleValue += Number(d.price || 0) }
      g.fees += Number(d.money?.billed || 0)
    }
    for (const g of Object.values(out)) for (const k of ['saleValue', 'rentValue', 'fees']) g[k] = r2(g[k])
    return out
  },
  // Each person on either side of the E-Forms (once each): how many, sales and rentals, prices, and billed when sent.
  byPerson: hits => {
    const out = {}
    for (const d of hits) for (const id of new Set([d.agentId, d.holderId].filter(x => x != null))) {
      const g = (out[countKey(id)] ||= { cases: 0, sales: 0, rental: 0, price: 0, submission: 0 })
      g.cases++
      if (d.type === 'rental') g.rental++; else g.sales++
      g.price += Number(d.price || 0)
      if (d.status !== 'draft') g.submission += Number(d.money?.billed || 0)
    }
    for (const g of Object.values(out)) { g.price = r2(g.price); g.submission = r2(g.submission) }
    return out
  },
  productSide: hits => {
    const out = {}
    for (const d of hits) if (d.holderId != null && d.holderId !== d.agentId) out[countKey(d.holderId)] = (out[countKey(d.holderId)] || 0) + 1
    return out
  },
  payByKind: hits => {
    const out = {}
    for (const l of hits) { const g = (out[countKey(l.staffId)] ||= { own: 0, incentive: 0 }); g[l.role ? 'incentive' : 'own'] += Number(l.amount || 0) }
    for (const g of Object.values(out)) { g.own = r2(g.own); g.incentive = r2(g.incentive) }
    return out
  },
  standingOfEach: (hits, ctx) => Object.fromEntries(hits.map(r => { const t = tiersNow(ctx).get(r.id); return [countKey(r.id), { tier: t?.tier ?? null, yearly: t?.yearly ?? 0 }] })),
  // Closes by their E-Form's sales agent: the claims.
  claimByDealAgent: (hits, ctx) => sumsBy(hits, c => [[ctx.byId('deals').get(c.dealId)?.agentId, Number(c.claim || 0)]]),
  // Each person on a close's sides: the claims they were on (once a close) and their sides' base.
  sidesByPerson: hits => {
    const out = {}
    for (const c of hits) {
      const base = new Map()
      for (const sd of c.sides || []) if (sd.staffId != null) base.set(sd.staffId, (base.get(sd.staffId) || 0) + Number(sd.base || 0))
      for (const [id, b] of base) { const g = (out[countKey(id)] ||= { closing: 0, comm: 0 }); g.closing += Number(c.claim || 0); g.comm += b }
    }
    for (const g of Object.values(out)) { g.closing = r2(g.closing); g.comm = r2(g.comm) }
    return out
  },
  // Each person's payout lines: the total, and on how many E-Forms some were archived.
  linesByPerson: hits => {
    const out = {}, archived = {}
    for (const l of hits) {
      const k = countKey(l.staffId)
      const g = (out[k] ||= { payout: 0, archived: 0 })
      g.payout += Number(l.amount || 0)
      if (l.archiveId) (archived[k] ||= new Set()).add(l.dealId)
    }
    for (const [k, g] of Object.entries(out)) { g.payout = r2(g.payout); g.archived = archived[k]?.size || 0 }
    return out
  },
  // The follow-ups each person made in the page's period, by action (0 calls, 1 viewing, 2 nego, 3 closing).
  followUpsBy: (hits, ctx) => {
    const { from = '', to = '9999-12-31' } = ctx.params || {}
    const out = {}
    for (const l of hits) for (const f of l.followUps || []) {
      if (f.by == null || f.date < from || f.date > to) continue
      const g = (out[countKey(f.by)] ||= { n: {}, total: 0 })
      g.n[f.action] = (g.n[f.action] || 0) + 1
      g.total++
    }
    return out
  },
  // Viewings by person: booked, hosted, viewed (done), and done with a keen buyer.
  viewingsBy: hits => {
    const out = {}
    const row = id => (out[countKey(id)] ||= { booked: 0, hosted: 0, done: 0, keen: 0 })
    for (const v of hits) {
      const b = row(v.requestedBy)
      b.booked++
      if (v.status === 'done') { b.done++; if (KEEN.includes(v.review?.outcome)) b.keen++ }
      row(v.handlerId).hosted++
    }
    return out
  },
  buildingLeads: (hits, ctx) => leadCounts(hits, ctx.once('buildingRankings', () => buildingRankings({ listings: ctx.data?.listings || [], deals: ctx.data?.deals || [] }))),
  // E-Forms whose payments in (not returned or invalid) don't cover the bill yet: how many, and the first one's id.
  shortOfCash: (hits, ctx) => {
    const got = ctx.once('received', () => {
      const m = new Map()
      for (const t of ctx.data?.moneyIn || []) if (t.status !== 'invalid' && t.status !== 'returned') m.set(t.dealId, (m.get(t.dealId) || 0) + Number(t.amount || 0))
      return m
    })
    const short = hits.filter(d => r2(got.get(d.id) || 0) < Number(d.money?.billed || 0))
    return { n: short.length, first: short.length ? Math.min(...short.map(d => d.id)) : null }
  },
  paidByDealBranch: (hits, ctx) => byDealBranch(hits, ctx, 'amount'),
  tierCounts: (hits, ctx) => {
    const out = {}
    for (const r of hits) { const t = tiersNow(ctx).get(r.id)?.tier; if (t) out[t] = (out[t] || 0) + 1 }
    return out
  },
  // Each request's slip (payslipTotals: gross, withholding tax unless the person is exempt, net), added up.
  payslips: (hits, ctx) => {
    const gross = new Map()
    const ids = new Set(hits.map(r => r.id))
    for (const p of ctx.data?.payouts || []) if (ids.has(p.requestId)) gross.set(p.requestId, [...(gross.get(p.requestId) || []), p.amount])
    return addSlips(hits.map(r => ({ amounts: gross.get(r.id) || [], exempt: !!ctx.byId('staff').get(r.staffId)?.whtExempt })), ctx.setup)
  },
}
// Each person's tier credit (shared/erpRules.js tierCredit, for everyone at once) and the tier it puts
// them on today (as src/erp/model.js tierInfo): Map(staffId → { lifetime, yearly, tier, rank }).
// `credit`: Map(staffId → { total, yearly }) of their close sides, without the opening balance.
export function tiersOf(staff, credit, setup) {
  const out = new Map()
  for (const s of staff) {
    const c = credit.get(s.id) || { total: 0, yearly: 0 }
    const lifetime = r2((Number(s.openingLifetime) || 0) + c.total), yearly = r2(c.yearly)
    const tiers = tiersFor(setup, s.branchId)
    const rank = tiers.length ? computeTierIndex(lifetime, yearly, tiers, Math.max(0, tiers.findIndex(t => t.id === s.tierFloorId))) : -1
    out.set(s.id, { lifetime, yearly, tier: tiers[rank]?.name ?? null, rank })
  }
  return out
}
// Close sides added up per person: Map(staffId → { total, yearly }) (the server adds them up in SQL).
export function sidesByStaff(closes, year) {
  const out = new Map()
  for (const c of closes) for (const sd of c.sides || []) {
    if (sd.staffId == null) continue
    const x = out.get(sd.staffId) || { total: 0, yearly: 0 }
    x.total += Number(sd.base) || 0
    if (String(c.date).startsWith(year)) x.yearly += Number(sd.base) || 0
    out.set(sd.staffId, x)
  }
  return out
}
const tiersNow = ctx => ctx.once('tiers', () => tiersOf(ctx.data?.staff || [], sidesByStaff(ctx.data?.closes || [], ctx.today.slice(0, 4)), ctx.setup))

// Values worked out in code for every record, to sort by.
const COMPUTED = {
  lifetime: (r, ctx) => tiersNow(ctx).get(r.id)?.lifetime ?? 0,
  yearly: (r, ctx) => tiersNow(ctx).get(r.id)?.yearly ?? 0,
  tierRank: (r, ctx) => tiersNow(ctx).get(r.id)?.rank ?? -1,
}

// Extras worked out in code for the page's rows: Map(id → value) (the server runs the same on the rows it reads).
const CUSTOM_EXTRAS = {
  tierCredit: (rows, ctx) => new Map(rows.map(r => { const t = tiersNow(ctx).get(r.id); return [r.id, t ? { lifetime: t.lifetime, yearly: t.yearly, tier: t.tier } : { lifetime: 0, yearly: 0, tier: null }] })),
  // How many people report to each (direct) and are under them at any depth (team).
  teamSize: (rows, ctx) => {
    const kids = ctx.once('downline', () => { const m = new Map(); for (const s of ctx.data?.staff || []) if (s.uplineId != null) m.set(s.uplineId, [...(m.get(s.uplineId) || []), s.id]); return m })
    return new Map(rows.map(r => [r.id, { direct: (kids.get(r.id) || []).length, team: ctx.team(r.id).size - 1 }]))
  },
  // Who leads each building: shared/listings.js buildingRankings ({ sale, rental } rankings).
  buildingRanking: (rows, ctx) => {
    const all = ctx.once('buildingRankings', () => buildingRankings({ listings: ctx.data?.listings || [], deals: ctx.data?.deals || [] }))
    return new Map(rows.map(r => [r.id, all.get(r.id) || { sale: [], rental: [] }]))
  },
}

// A project's sales (shared/projects.js projectDeals: its E-Forms by the project's name, not drafts or
// aborted) and each incentive's progress: { units, value, fee, month, progress: { [incentiveId]: … } }.
// `deals`: E-Forms that include every one of the project's; `today` for this month and the incentives' status.
export function projectSales(project, deals, today) {
  const sold = projectDeals(deals, project)
  const add = k => r2(sold.reduce((t, d) => t + Number(d[k] || 0), 0))
  return { units: sold.length, value: add('price'), fee: add('fee'), month: sold.filter(d => d.date.startsWith(today.slice(0, 7))).length,
    progress: Object.fromEntries((project.incentives || []).map(i => [i.id, incentiveProgress(i, project, deals, today)])) }
}
CUSTOM_EXTRAS.projectSales = (rows, ctx) => new Map(rows.map(p => [p.id, projectSales(p, ctx.data?.deals || [], ctx.today)]))

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
// ctx: the run's (for custom extras).
function extrasOf(defs, rows, data, ctx) {
  const out = new Map(rows.map(r => [r.id, {}]))
  for (const [key, e] of Object.entries(defs)) {
    if (e.custom) {
      const got = CUSTOM_EXTRAS[e.custom](rows, ctx)
      for (const r of rows) out.get(r.id)[key] = got.get(r.id) ?? null
      continue
    }
    const at = r => (e.on ? get(r, e.on) : r.id)
    const ids = new Set(rows.map(at))
    if (e.from) {
      const byId = new Map((data[e.of] || []).map(x => [x.id, x]))
      const picked = x => (x ? Object.fromEntries(e.pick.map(f => [f, get(x, f) ?? null])) : null)
      for (const r of rows) {
        const at = get({ ...r, $: out.get(r.id) }, e.from)
        if (e.many) { out.get(r.id)[key] = (at || []).map(id => byId.get(id)).filter(Boolean).map(x => ({ id: x.id, ...picked(x) })); continue }
        const x = byId.get(at)
        out.get(r.id)[key] = e.pick ? picked(x) : x?.[e.field] ?? null
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
      const mine = linked.get(at(r)) || []
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

// { n, sum (, distinct, range) } of records.
// { value: n } for each value of def.by, or { value: { n, sum } } with a sum; month: by 'YYYY-MM'.
function groupBy(hits, def) {
  const groups = new Map()
  for (const r of hits) {
    const v = get(r, def.by)
    const k = def.month ? String(v ?? '').slice(0, 7) : countKey(v)
    const g = groups.get(k) || { n: 0, sum: 0 }
    g.n++
    if (def.sum) g.sum += Number(get(r, def.sum) || 0)
    groups.set(k, g)
  }
  return Object.fromEntries([...groups].map(([k, g]) => [k, def.sum ? { n: g.n, sum: r2(g.sum) } : g.n]))
}

function addUp(hits, def) {
  const vals = def.range ? hits.map(r => get(r, def.range)).filter(v => v != null).sort(compare) : null
  return { n: hits.length, ...(def.sum && { sum: r2(hits.reduce((t, r) => t + Number(get(r, def.sum) || 0), 0)) }),
    ...(def.distinct && { distinct: new Set(hits.map(r => get(r, def.distinct))).size }),
    ...(def.range && { range: { min: vals[0] ?? null, max: vals.at(-1) ?? null } }) }
}

function run(all_records, spec, params, ctx, all) {
  // A list of each person's own: theirs only, whatever their role.
  const records = spec.mine ? all_records.filter(r => spec.mine(r, ctx.viewer || { key: 0, branchId: null })) : all_records
  // Teams, E-Form cash and lookups by id are worked out once per call, not once per record.
  const teams = new Map(), byKind = new Map(), memo = new Map()
  let cashByDeal = null
  const c = {
    ...ctx,
    // The page's own params (a report's period, for a count that reads it).
    params,
    once: (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key) },
    team: id => { if (!teams.has(id)) teams.set(id, ctx.team ? ctx.team(id) : teamOf(id, ctx.data?.staff || [])); return teams.get(id) },
    cash: () => (cashByDeal ||= extrasOf(DEAL_CASH, ctx.data?.deals || [], ctx.data || {}, c)),
    byId: kind => { if (!byKind.has(kind)) byKind.set(kind, new Map((ctx.data?.[kind] || []).map(x => [x.id, x]))); return byKind.get(kind) },
  }
  const words = String(params.q || '').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)
  // The texts a word may be in: the record's own, and those of the records it points at.
  const texts = r => (spec.search || []).flatMap(f => {
    if (typeof f === 'string') return [get(r, f)]
    if (f.digits) return []
    const x = c.byId(f.of).get(get(r, f.via))
    return x ? f.fields.map(g => get(x, g)) : []
  }).map(v => String(v ?? '').toLowerCase())
  const phones = (spec.search || []).filter(f => f.digits)
  const found = r => {
    if (!words.length) return true
    const t = texts(r), p = phones.map(f => phoneDigits(get(r, f.digits)))
    return words.every(w => t.some(x => x.includes(w)) || (phoneDigits(w).length >= 3 && p.some(x => x.includes(phoneDigits(w)))))
  }
  const active = Object.entries(spec.filters || {}).filter(([k]) => params[k] !== undefined && params[k] !== '')
  const pass = (r, except = [], extra = {}) => found(r) &&
    active.every(([k, rule]) => except.includes(k) || k in extra || test(rule, r, params[k], c)) &&
    Object.entries(extra).every(([k, v]) => test(spec.filters[k], r, v, c))
  const matching = records.filter(r => pass(r))

  const sorts = String(params.sort || spec.sort || '').split(',').filter(Boolean)
    .map(s => ({ desc: s.startsWith('-'), field: spec.sorts?.[s.replace(/^-/, '')] })).filter(s => s.field)
  if (!sorts.length && spec.sort) sorts.push({ desc: spec.sort.startsWith('-'), field: spec.sorts[spec.sort.replace(/^-/, '')] })
  // A count sort: how many records of that kind point at each one.
  const sortValue = f => {
    if (typeof f === 'string') return r => get(r, f)
    if (f.last) return r => get(r[f.last]?.at(-1), f.field) ?? null
    if (f.computed) return r => COMPUTED[f.computed](r, c)
    const n = c.once(`count:${f.count}:${f.by}`, () => {
      const m = new Map()
      for (const x of ctx.data?.[f.count] || []) { const k = get(x, f.by); m.set(k, (m.get(k) || 0) + 1) }
      return m
    })
    return r => n.get(f.on ? get(r, f.on) : r.id) || 0
  }
  for (const s of sorts) s.value = sortValue(s.field)
  const tie = sorts[0]?.desc ?? true
  const ordered = [...matching].sort((a, b) => {
    for (const s of sorts) { const d = compare(s.value(a), s.value(b)); if (d) return s.desc ? -d : d }
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
      counts[key] = def.by ? groupBy(hits, def) : addUp(hits, def)
    } else if (def.set) {
      const set = typeof def.set === 'function' ? def.set(c) : def.set
      counts[key] = records.filter(r => pass(r, def.ignores || [], set)).length
    } else {
      counts[key] = def.custom ? CUSTOM_COUNTS[def.custom](matching, c) : def.by ? groupBy(matching, def) : addUp(matching, def)
    }
  }

  const extras = spec.extras ? extrasOf(spec.extras, rows, ctx.data || {}, c) : null
  return { rows: (extras ? rows.map(r => ({ ...r, $: extras.get(r.id) })) : rows).map(r => trimmed(spec, r)), total: matching.length, counts, page, size }
}

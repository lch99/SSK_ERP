// Role-based access for the ERP: what each account type may do in each area,
// and whose records it sees. One copy, used by the page (to hide what a role
// can't use) and by the actions (to refuse it), as the server must too.
//
// Roles are the account types of the current ERP (staff `type`), plus the
// Superadmin. The boss can change the levels and reach of every role except
// the Superadmin's in System → Roles & access; these are the recommended ones.

// Levels, lowest first. Each one includes the ones before it.
export const LEVELS = ['none', 'view', 'edit', 'full']
export const LEVEL_LABEL = { none: 'No access', view: 'View', edit: 'Edit', full: 'Full' }
export const LEVEL_HELP = {
  none: 'Hidden from the menu, and the pages are closed.',
  view: 'Can look, but not add or change anything.',
  edit: 'Can add and change records.',
  full: 'Can also approve, pay out, lock and delete.',
}

// Whose records a role sees.
export const SCOPES = ['team', 'branch', 'all']
export const SCOPE_LABEL = { team: 'Own and downline', branch: 'Own branch', all: 'All branches' }
export const SCOPE_HELP = {
  team: 'Only their own records and those of the people under them in the upline chart.',
  branch: 'Every record in the branch they belong to.',
  all: 'Every branch, with the branch picker in the top bar.',
}

// What Edit and Full mean in each area, for the Roles & access page.
export const AREAS = [
  { key: 'customers', label: 'Customers', edit: 'Add customers, follow-ups and remarks', full: 'Same as Edit' },
  { key: 'listings', label: 'Properties & listings', edit: 'Add and update listings, follow-ups, enquiries', full: 'Delete listings; owner requests, buildings and areas' },
  { key: 'deals', label: 'Deals (E-Forms)', edit: 'Submit and update E-Forms, upload documents', full: 'Delete E-Forms' },
  { key: 'projects', label: 'Projects', edit: 'Add and update projects', full: 'Same as Edit' },
  { key: 'moneyIn', label: 'Money in', edit: 'Record and correct payments', full: 'Clear or reject payments, delete them' },
  { key: 'payouts', label: 'Payouts', edit: 'Raise Pending Queries', full: 'Close cases, approve, archive, rerun and delete closes' },
  { key: 'moneyOut', label: 'Payments out', edit: 'Raise and correct payment requests', full: 'Mark paid or queried, delete' },
  { key: 'salary', label: 'Salary', edit: 'Request salary, incentives and creator fees', full: 'Pay requests, mark Not Valid, delete' },
  { key: 'invoices', label: 'Invoices & receipts', edit: 'Request invoices', full: 'Same as Edit' },
  { key: 'staff', label: 'Agents & staff', edit: 'Add and update agents and staff', full: 'Lock, unlock and delete accounts; marketing access' },
  { key: 'videos', label: 'Training videos', edit: 'Add and update videos', full: 'Delete videos' },
  { key: 'reports', label: 'Reports', edit: 'Same as View', full: 'Verify landlords' },
  { key: 'system', label: 'System settings', edit: 'Same as View', full: 'Change company details and property types' },
]
export const AREA_KEYS = AREAS.map(a => a.key)

const row = (...levels) => Object.fromEntries(AREA_KEYS.map((k, i) => [k, levels[i]]))
//                         cust    list    deals   proj    in      payout  out     salary  invoice staff   videos  reports system
const FULL = row('full', 'full', 'full', 'full', 'full', 'full', 'full', 'full', 'full', 'full', 'full', 'full', 'full')

// Roles. `type` is the staff account type it matches (null: not a staff type).
export const ROLES = [
  { key: 'superadmin', label: 'Superadmin', type: null, locked: true, desc: 'The owner. Everything, in every branch, plus Setup and Roles & access.',
    scope: 'all', levels: FULL },
  { key: 'admin-staff', label: 'Admin (Level 2)', type: 'admin-staff', desc: 'Senior office admin: runs the whole office, including approvals.',
    scope: 'all', levels: row('full', 'full', 'full', 'full', 'full', 'full', 'full', 'full', 'full', 'full', 'full', 'full', 'view') },
  { key: 'admin-staff2', label: 'Admin (Level 1)', type: 'admin-staff2', desc: 'Branch admin: keys in the day-to-day work but cannot approve or pay.',
    scope: 'branch', levels: row('edit', 'edit', 'edit', 'view', 'edit', 'view', 'edit', 'view', 'edit', 'edit', 'view', 'view', 'none') },
  { key: 'account', label: 'Accounting', type: 'account', desc: 'Money in and out, payouts and salary for every branch.',
    scope: 'all', levels: row('none', 'none', 'view', 'view', 'full', 'full', 'full', 'full', 'full', 'view', 'view', 'full', 'none') },
  { key: 'staff', label: 'Agent', type: 'staff', desc: 'Sells: their own customers, listings and E-Forms, and their downline\'s.',
    scope: 'team', levels: row('edit', 'edit', 'edit', 'view', 'view', 'view', 'edit', 'edit', 'none', 'view', 'view', 'view', 'none') },
  { key: 'sale-staff', label: 'Sales staff', type: 'sale-staff', desc: 'Sales support: customers, listings and E-Forms, no money.',
    scope: 'team', levels: row('edit', 'edit', 'edit', 'view', 'none', 'none', 'none', 'edit', 'none', 'view', 'view', 'none', 'none') },
  { key: 'sale-marketing', label: 'Marketing', type: 'sale-marketing', desc: 'Leads and listings for the branch, nothing else.',
    scope: 'branch', levels: row('edit', 'view', 'none', 'view', 'none', 'none', 'none', 'none', 'none', 'none', 'view', 'none', 'none') },
]
export const ROLE_KEYS = ROLES.map(r => r.key)
export const roleOf = key => ROLES.find(r => r.key === key)
// The role that goes with a staff account type (Agent when unknown).
export const roleForType = type => ROLES.find(r => r.type === type)?.key || 'staff'

// The role of a signed-in account: its staff account type when it has one,
// else its sign-in role (shared/roles.js) mapped to the nearest account type.
const SIGN_IN = { superadmin: 'superadmin', manager: 'admin-staff', accountant: 'account', admin: 'admin-staff2', staff: 'staff' }
export const roleForUser = user => (user?.type ? roleForType(user.type) : SIGN_IN[user?.role] || 'staff')

// The recommended policy: { [role]: { scope, levels: { [area]: level } } }.
export function defaultPolicy() {
  return Object.fromEntries(ROLES.map(r => [r.key, { scope: r.scope, levels: { ...r.levels } }]))
}

// A saved policy, made whole: unknown roles and areas dropped, missing ones
// filled from the recommended policy, and the Superadmin always full.
export function tidyPolicy(saved) {
  const base = defaultPolicy()
  for (const r of ROLES) {
    const s = saved?.[r.key]
    if (!s || r.locked) continue
    if (SCOPES.includes(s.scope)) base[r.key].scope = s.scope
    for (const a of AREA_KEYS) if (LEVELS.includes(s.levels?.[a])) base[r.key].levels[a] = s.levels[a]
  }
  return base
}

export function levelOf(policy, role, area) {
  return policy?.[role]?.levels?.[area] || 'none'
}
// May `role` work at `level` (or above) in `area`?
export function allows(policy, role, area, level = 'view') {
  return LEVELS.indexOf(levelOf(policy, role, area)) >= LEVELS.indexOf(level)
}
export const scopeOf = (policy, role) => policy?.[role]?.scope || 'team'

// Only the Superadmin changes Setup and Roles & access.
export const managesAccess = role => role === 'superadmin'

// What each ERP action needs. Every action in src/erp/ErpContext.jsx must be
// here (a test checks), so a new action can't slip past the roles.
const need = (area, level) => ({ area, level })
export const ACTIONS = {
  addCustomer: need('customers', 'edit'), updateCustomer: need('customers', 'edit'), addCustomerFollowUp: need('customers', 'edit'),
  addListing: need('listings', 'edit'), updateListing: need('listings', 'edit'), addListingFollowUp: need('listings', 'edit'), updateEnquiry: need('listings', 'edit'),
  deleteListing: need('listings', 'full'), setVendorRequest: need('listings', 'full'),
  saveTitle: need('listings', 'full'), setTitleStatus: need('listings', 'full'), deleteTitle: need('listings', 'full'),
  saveArea: need('listings', 'full'), setAreaStatus: need('listings', 'full'), deleteArea: need('listings', 'full'),
  addDeal: need('deals', 'edit'), updateDeal: need('deals', 'edit'), setDealDoc: need('deals', 'edit'), requestInvoice: need('invoices', 'edit'),
  deleteDeal: need('deals', 'full'),
  addTransaction: need('moneyIn', 'edit'), updateTransaction: need('moneyIn', 'edit'),
  setMoneyInStatus: need('moneyIn', 'full'), deleteTransaction: need('moneyIn', 'full'),
  queryPayouts: need('payouts', 'edit'),
  closeDeal: need('payouts', 'full'), rerunClose: need('payouts', 'full'), deleteClose: need('payouts', 'full'),
  approvePayouts: need('payouts', 'full'), archiveCases: need('payouts', 'full'), unarchive: need('payouts', 'full'),
  raiseRequest: need('moneyOut', 'edit'), updateMoneyOut: need('moneyOut', 'edit'),
  setMoneyOutStatus: need('moneyOut', 'full'), deleteMoneyOut: need('moneyOut', 'full'),
  createRequests: need('salary', 'edit'), setRequestStatus: need('salary', 'full'), deleteSalaryRequest: need('salary', 'full'),
  addStaff: need('staff', 'edit'), updateStaff: need('staff', 'edit'),
  setStaffStatus: need('staff', 'full'), setMarketingStaffs: need('staff', 'full'), deleteStaff: need('staff', 'full'),
  saveVideo: need('videos', 'edit'), deleteVideo: need('videos', 'full'),
  verifyLandlord: need('reports', 'full'),
  addPropertyType: need('system', 'full'), deletePropertyType: need('system', 'full'),
}

// Why `role` may not run `action`, or null when it may.
export function refusal(policy, role, action) {
  const n = ACTIONS[action]
  if (!n) return role === 'superadmin' ? null : `"${action}" has no access rule yet, so only the Superadmin can use it.`
  if (allows(policy, role, n.area, n.level)) return null
  const area = AREAS.find(a => a.key === n.area).label
  return `${roleOf(role)?.label || role} has ${LEVEL_LABEL[levelOf(policy, role, n.area)].toLowerCase()} on ${area}; this needs ${LEVEL_LABEL[n.level]}.`
}

// What each page address needs, by its start (the longest match wins).
// Addresses not listed (the dashboard, your own settings) are open to all.
const PATHS = [
  ['customers', 'customers'],
  ['listing-new', 'listings', 'edit'], ['listings', 'listings'], ['listing-roles', 'listings'], ['vendor-requests', 'listings'],
  ['appointments', 'listings'], ['enquiries', 'listings'], ['titles', 'listings'], ['areas', 'listings'],
  ['deals', 'deals'], ['deals/new', 'deals', 'edit'], ['old-records', 'deals'],
  ['projects', 'projects'], ['projects/new', 'projects', 'edit'],
  ['money-in', 'moneyIn'], ['money-in/new', 'moneyIn', 'edit'],
  ['payouts', 'payouts'], ['commission', 'payouts'],
  ['money-out', 'moneyOut'],
  ['salary', 'salary'], ['salary/request', 'salary', 'edit'], ['salary/incentives', 'salary', 'edit'], ['salary/creator', 'salary', 'edit'],
  ['invoices', 'invoices'],
  ['staff', 'staff'], ['staff/new', 'staff', 'edit'], ['org-chart', 'staff'],
  ['videos', 'videos'], ['reports', 'reports'], ['system', 'system'],
]
export function pathNeeds(path) {
  const p = String(path).replace(/^\/+/, '')
  let best = null
  for (const [start, area, level = 'view'] of PATHS) {
    if ((p === start || p.startsWith(`${start}/`)) && (!best || start.length > best.start.length)) best = { start, area, level }
  }
  return best && { area: best.area, level: best.level }
}
// May `role` open the page at `path`? Setup, Roles & access and sign-in users are the Superadmin's.
export function opens(policy, role, path) {
  const first = String(path).replace(/^\/+/, '').split('/')[0]
  if (first === 'setup' || first === 'access' || first === 'users') return managesAccess(role)
  const n = pathNeeds(path)
  return !n || allows(policy, role, n.area, n.level)
}

// The people a viewer answers for: themselves and everyone under them.
export function teamOf(staffId, staff) {
  const under = new Map()
  for (const s of staff) if (s.uplineId != null) under.set(s.uplineId, [...(under.get(s.uplineId) || []), s.id])
  const team = new Set()
  const stack = staffId == null ? [] : [staffId]
  while (stack.length) {
    const id = stack.pop()
    if (team.has(id)) continue
    team.add(id)
    stack.push(...(under.get(id) || []))
  }
  return team
}

// The records `who` = { staffId, branchId } may see under `scope`. `data` is
// the ERP data (all branches); records the scope does not cover are left out.
export function visibleData(data, who, scope) {
  if (scope === 'all') return data
  const staffById = new Map(data.staff.map(s => [s.id, s]))
  const branchId = who.branchId ?? staffById.get(who.staffId)?.branchId ?? null
  const mine = scope === 'branch'
    ? new Set(data.staff.filter(s => s.branchId === branchId).map(s => s.id))
    : teamOf(who.staffId, data.staff)
  const deals = data.deals.filter(x => (scope === 'branch' ? x.branchId === branchId : mine.has(x.agentId) || mine.has(x.holderId)))
  const dealIds = new Set(deals.map(x => x.id))
  const listings = data.listings.filter(x => (scope === 'branch' ? x.branchId === branchId : mine.has(x.holderId) || mine.has(x.creatorId)))
  const listingIds = new Set(listings.map(x => x.id))
  const inBranch = x => x.branchId === branchId
  return {
    ...data,
    staff: data.staff.filter(x => mine.has(x.id)),
    listings,
    customers: data.customers.filter(x => (scope === 'branch' ? inBranch(x) : mine.has(x.ownerId))),
    deals,
    moneyIn: data.moneyIn.filter(x => dealIds.has(x.dealId)),
    moneyOut: data.moneyOut.filter(x => dealIds.has(x.dealId)),
    closes: data.closes.filter(x => dealIds.has(x.dealId)),
    payouts: data.payouts.filter(x => (scope === 'branch' ? dealIds.has(x.dealId) : mine.has(x.staffId))),
    requests: data.requests.filter(x => mine.has(x.staffId)),
    vendorRequests: data.vendorRequests.filter(x => (scope === 'branch' ? inBranch(x) : listingIds.has(x.listingId))),
    enquiries: data.enquiries.filter(x => listingIds.has(x.listingId)),
    titles: data.titles.filter(inBranch),
    areas: data.areas.filter(inBranch),
  }
}

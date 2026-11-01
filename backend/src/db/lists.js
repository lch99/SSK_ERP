// Every ERP list the API serves: what it searches, filters, sorts and counts,
// which access area it needs, and whose records each reach sees, the same
// rules as visibleData() in shared/access.js (team = own + downline).
const { MODELS } = require('./records');
const { eq, from, to, yes } = require('./list');
const { localToday, addDays } = require('./days');

// Records reached through their E-Form (payments, closes, request forms).
const viaDeal = (b, v, col = 'deal_id') => b.whereIn(col, sub => {
  sub.select('id').from('deals');
  if (v.scope === 'branch') sub.where('branch_id', v.branchId);
  else sub.where(x => x.whereIn('agent_id', v.team).orWhereIn('holder_id', v.team));
});
const viaListing = (b, v, col = 'listing_id') => b.whereIn(col, sub => {
  sub.select('id').from('listings');
  if (v.scope === 'branch') sub.where('branch_id', v.branchId);
  else sub.where(x => x.whereIn('holder_id', v.team).orWhereIn('creator_id', v.team));
});
// The people a viewer answers for: their team, or everyone in their branch.
const mine = (b, v, col) => (v.scope === 'branch'
  ? b.whereIn(col, sub => sub.select('id').from('staff').where('branch_id', v.branchId))
  : b.whereIn(col, v.team));
const inBranch = (b, v, col = 'branch_id') => b.where(col, v.branchId);
const either = (cols) => (b, v) => b.where(x => cols.forEach((c, i) => (i ? x.orWhereIn(c, v.team) : x.whereIn(c, v.team))));

const monthStart = () => `${localToday().slice(0, 8)}01`;

const LISTS = {
  staff: {
    area: 'staff', table: 'staff',
    search: ['staff.name', 'staff.short_name', 'staff.code', 'staff.phone', 'staff.ic_no', 'staff.email', 'staff.username'],
    filters: {
      branchId: eq('staff.branch_id'), status: eq('staff.status'), type: eq('staff.type'), position: eq('staff.position'),
      tierId: eq('staff.tier_floor_id'), uplineId: eq('staff.upline_id'),
      // agent: Agent and Sales Agent accounts; office: everyone else (src/erp/model.js isAgent).
      kind: (b, v) => (v === 'office' ? b.whereNotIn('staff.type', ['staff', 'sale-staff']) : b.whereIn('staff.type', ['staff', 'sale-staff'])),
      // teamOf: everyone under that person (worked out before the query: params.teamIds).
      teamOf: (b, v, p) => b.whereIn('staff.id', p.teamIds || []).whereNot('staff.id', Number(v)),
      joinedFrom: from('staff.joined_on'), joinedTo: to('staff.joined_on'), expiresBy: to('staff.expires_on'),
    },
    sorts: { name: 'staff.name', code: 'staff.code', joined: 'staff.joined_on', expiresOn: 'staff.expires_on', branch: 'staff.branch_id', status: 'staff.status' },
    sort: 'name',
    counts: {
      status: 'staff.status',
      leaders: { where: b => b.whereNotNull('staff.position') },
      joinedThisMonth: { where: b => b.where('staff.joined_on', '>=', monthStart()) },
      // Registration (expiry date) running out within 30 days.
      expiring: { where: b => b.whereBetween('staff.expires_on', [localToday(), addDays(localToday(), 30)]) },
    },
    scope: { branch: (b, v) => inBranch(b, v, 'staff.branch_id'), team: (b, v) => b.whereIn('staff.id', v.team) },
  },

  listings: {
    area: 'listings', table: 'listings',
    search: ['code', 'title', 'address', 'area', 'owner_name', 'owner_phone'],
    filters: {
      type: eq('type'), status: eq('status'), branchId: eq('branch_id'), holderId: eq('holder_id'), creatorId: eq('creator_id'),
      titleId: eq('title_id'), area: eq('area'), category: eq('category'), draft: yes('draft'),
      priceFrom: from('ask_price'), priceTo: to('ask_price'), createdFrom: from('created_on'), createdTo: to('created_on'),
    },
    sorts: { created: 'created_on', updated: 'updated_on', price: 'ask_price', code: 'code', views: 'views' },
    sort: '-created',
    counts: { status: 'status', type: 'type' },
    scope: { branch: inBranch, team: either(['holder_id', 'creator_id']) },
  },

  customers: {
    area: 'customers', table: 'customers',
    search: ['name', 'phone', 'code', 'area'],
    filters: { type: eq('type'), track: eq('track'), action: eq('action'), ownerId: eq('owner_id'), branchId: eq('branch_id'), source: eq('source'),
      from: from('date'), to: to('date') },
    sorts: { date: 'date', name: 'name' },
    sort: '-date',
    counts: { track: 'track', type: 'type' },
    scope: { branch: inBranch, team: (b, v) => b.whereIn('owner_id', v.team) },
  },

  deals: {
    area: 'deals', table: 'deals',
    search: ['code', 'buyer_name', 'owner_name', 'property_title', 'property_address'],
    filters: { status: eq('status'), type: eq('type'), branchId: eq('branch_id'), agentId: eq('agent_id'), holderId: eq('holder_id'),
      listingId: eq('listing_id'), projectId: eq('project_id'), lvStatus: eq('lv_status'),
      // Either side of the deal (the sales agent or the listing holder).
      staffId: (b, v) => b.where(x => x.where('agent_id', Number(v)).orWhere('holder_id', Number(v))),
      from: from('date'), to: to('date'), closedFrom: from('closed_on'), closedTo: to('closed_on') },
    sorts: { date: 'date', code: 'code', price: 'price', fee: 'fee', closedOn: 'closed_on' },
    sort: '-date',
    counts: { status: 'status', type: 'type' },
    scope: { branch: inBranch, team: either(['agent_id', 'holder_id']) },
  },

  moneyIn: {
    area: 'moneyIn', table: 'money_in',
    search: ['code', 'payer', 'ref'],
    filters: { status: eq('status'), dealId: eq('deal_id'), method: eq('method'), purpose: eq('purpose'), from: from('date'), to: to('date') },
    sorts: { date: 'date', amount: 'amount', bankOn: 'bank_on', code: 'code' },
    sort: '-date',
    counts: { status: 'status' },
    scope: { branch: viaDeal, team: viaDeal },
  },

  closes: {
    area: 'payouts', table: 'closes',
    search: [],
    filters: { dealId: eq('deal_id'), from: from('date'), to: to('date') },
    sorts: { date: 'date' },
    sort: '-date',
    scope: { branch: viaDeal, team: viaDeal },
  },

  payouts: {
    area: 'payouts', table: 'payout_lines',
    search: ['code'],
    filters: { status: eq('status'), staffId: eq('staff_id'), dealId: eq('deal_id'), closeId: eq('close_id'), side: eq('side'), role: eq('role'),
      requestId: eq('request_id'), archiveId: eq('archive_id'), stacked: yes('stacked'), from: from('date'), to: to('date') },
    sorts: { date: 'date', amount: 'amount', code: 'code' },
    sort: '-date',
    counts: { status: 'status' },
    scope: { branch: viaDeal, team: (b, v) => b.whereIn('staff_id', v.team) },
  },

  requests: {
    area: 'salary', table: 'pay_requests',
    search: ['code'],
    filters: { status: eq('status'), kind: eq('kind'), staffId: eq('staff_id'), from: from('date'), to: to('date') },
    sorts: { date: 'date', payOn: 'pay_on', code: 'code' },
    sort: '-date',
    counts: { status: 'status', kind: 'kind' },
    scope: { branch: (b, v) => mine(b, v, 'staff_id'), team: (b, v) => mine(b, v, 'staff_id') },
  },

  archives: {
    area: 'payouts', table: 'archives',
    search: ['code'], filters: { from: from('date'), to: to('date') },
    sorts: { date: 'date' }, sort: '-date',
  },

  moneyOut: {
    area: 'moneyOut', table: 'money_out',
    search: ['voucher_no', 'payee_name'],
    filters: { status: eq('status'), type: eq('type'), dealId: eq('deal_id'), branchId: eq('branch_id'), staffId: eq('staff_id'),
      from: from('date'), to: to('date') },
    sorts: { date: 'date', amount: 'amount', voucherNo: 'voucher_no' },
    sort: '-date',
    counts: { status: 'status', type: 'type' },
    scope: { branch: viaDeal, team: viaDeal },
  },

  vendorRequests: {
    area: 'listings', table: 'vendor_requests',
    search: ['ticket', 'name', 'phone', 'area'],
    filters: { status: eq('status'), branchId: eq('branch_id'), listingId: eq('listing_id') },
    sorts: { date: 'date' }, sort: '-date',
    counts: { status: 'status' },
    scope: { branch: inBranch, team: viaListing },
  },

  enquiries: {
    area: 'listings', table: 'enquiries',
    search: ['name', 'phone', 'message'],
    filters: { listingId: eq('listing_id'), starred: yes('starred'), trashed: yes('trashed') },
    sorts: { date: 'date' }, sort: '-date',
    counts: { trashed: 'trashed', starred: { where: b => b.where('starred', 1), ignores: ['starred'] } },
    scope: { branch: viaListing, team: viaListing },
  },

  titles: {
    area: 'listings', table: 'titles',
    search: ['name', 'area'],
    filters: { status: eq('status'), branchId: eq('branch_id'), category: eq('category'), area: eq('area') },
    sorts: { name: 'name', area: 'area', requestedOn: 'requested_on' }, sort: 'name',
    counts: { status: 'status' },
    scope: { branch: inBranch, team: inBranch },
  },

  areas: {
    area: 'listings', table: 'areas',
    search: ['name', 'state'],
    filters: { status: eq('status'), branchId: eq('branch_id'), state: eq('state') },
    sorts: { name: 'name', requestedOn: 'requested_on' }, sort: 'name',
    counts: { status: 'status' },
    scope: { branch: inBranch, team: inBranch },
  },

  videos: {
    area: 'videos', table: 'videos',
    search: ['title', 'description'], filters: { cate: eq('cate') },
    sorts: { date: 'date', title: 'title' }, sort: '-date',
    counts: { cate: 'cate' },
  },

  propertyTypes: { area: 'listings', table: 'property_types', search: ['name'], sorts: { name: 'name' }, sort: 'name' },

  projects: {
    area: 'projects', table: 'projects',
    search: ['name', 'developer', 'location'], filters: { status: eq('status') },
    sorts: { name: 'name', launchedOn: 'launched_on' }, sort: 'name',
    counts: { status: 'status' },
  },

  v1Eforms: {
    area: 'deals', table: 'v1_eforms',
    search: ['code', 'address'], filters: { staffId: eq('staff_id'), type: eq('type'), status: eq('status') },
    sorts: { date: 'date', code: 'code' }, sort: '-date',
    scope: { branch: (b, v) => mine(b, v, 'staff_id'), team: (b, v) => mine(b, v, 'staff_id') },
  },

  v1Overrides: {
    area: 'deals', table: 'v1_overrides',
    search: [], filters: { staffId: eq('staff_id'), year: eq('year') },
    sorts: { year: 'year' }, sort: '-year',
    scope: { branch: (b, v) => mine(b, v, 'staff_id'), team: (b, v) => mine(b, v, 'staff_id') },
  },
};

for (const [key, spec] of Object.entries(LISTS)) spec.model = MODELS[key];

// The viewer's reach as a where clause on `spec`'s table (nothing for 'all').
// A reach a list has no rule for sees nothing, never everything.
function scopeFor(spec, viewer) {
  if (viewer.scope === 'all' || !spec.scope) return () => {};
  const rule = spec.scope[viewer.scope];
  if (!rule || (viewer.scope === 'branch' && viewer.branchId == null)) return b => b.whereRaw('1 = 0');
  return b => rule(b, viewer);
}

module.exports = { LISTS, scopeFor };

// What one signed-in person may receive and change in stage one (db/erpState.js),
// by the rules of shared/access.js (their role's level per area and their reach:
// own + downline, branch, or all).
//   forViewer(data, viewer)        — the records sent to them
//   checkAction(name, args, …)     — their arguments (who they act as) and what the action touched
//   changedIds(before, after)      — which records an action changed, for the audit log
const AC = require('../../../shared/access.js');
const L = require('../../../shared/listings.js');
const SL = require('../../../shared/lists.js');
const { AGENT_TYPES } = SL;

// Kinds of record limited by reach (visibleData), and the access area each belongs to.
const AREA_OF = {
  customers: 'customers', listings: 'listings', deals: 'deals', projects: 'projects', moneyIn: 'moneyIn', moneyOut: 'moneyOut',
  closes: 'payouts', payouts: 'payouts', archives: 'payouts', requests: 'salary', vendorRequests: 'listings', enquiries: 'listings',
  viewings: 'listings', titles: 'listings', areas: 'listings', videos: 'videos',
};
// Kinds emptied for a role with no access to their area (nothing on the pages it opens needs them).
const DROPPED_WITHOUT_ACCESS = ['customers', 'projects', 'moneyIn', 'moneyOut', 'closes', 'payouts', 'archives', 'requests', 'videos'];
// What everyone may see about colleagues outside their reach (the staff directory).
const DIRECTORY = ['id', 'code', 'name', 'short', 'sex', 'branchId', 'role', 'uplineId', 'status', 'type', 'joined', 'leftOn', 'tierFloorId',
  'openingLifetime', 'renNo', 'regType', 'regNo', 'phone', 'email', 'socials', 'awards', 'bio', 'lastActive', 'expiresOn'];
const NAME_ONLY = ['id', 'code', 'name', 'short', 'branchId', 'role', 'uplineId', 'status', 'type'];
const pick = (r, keys) => Object.fromEntries(keys.filter(k => k in r).map(k => [k, r[k]]));

const keyOf = v => v.staffId ?? 0;   // a person's key for notices and favourites; 0 = an office account
const sees = (v, area) => AC.allows(v.policy, v.role, area, 'view');
const who = v => ({ staffId: v.staffId, branchId: v.branchId });

// May this person see a listing's owner (shared/listings.js listingRoles, as the listing page decides)?
function seesOwner(l, v, data) {
  if (v.scope === 'all') return true;
  if (v.staffId == null) return AC.allows(v.policy, v.role, 'listings', 'edit');
  const byId = new Map(data.staff.map(s => [s.id, s]));
  const leaders = [];
  for (let up = byId.get(byId.get(l.holderId)?.uplineId), seen = new Set(); up && !seen.has(up.id); up = byId.get(up.uplineId)) { seen.add(up.id); leaders.push(up.id); }
  const title = data.titles.find(t => t.id === l.titleId) || null;
  // Office editors may ask too; agents only when tied to the listing.
  const agent = AGENT_TYPES.includes(AC.roleOf(v.role)?.type);
  return L.listingRoles(l, v.staffId, { title, leaders }).length > 0 || (!agent && AC.allows(v.policy, v.role, 'listings', 'edit'));
}

function forViewer(data, v) {
  if (!data) return data;
  const all = v.scope === 'all';
  const out = all ? { ...data } : AC.visibleData(data, who(v), v.scope);
  const mine = new Set(out.staff.map(s => s.id));
  // Everyone at the company, by name; private details only for those in reach.
  const listed = sees(v, 'staff') ? DIRECTORY : NAME_ONLY;
  out.staff = data.staff.map(s => (mine.has(s.id) ? s : { ...pick(s, listed), marketing: [] }));
  if (!all) {
    // Every listing still on the market (the whole agency sells them), without the owner or the unit for those not tied to it.
    const inReach = new Set(out.listings.map(l => l.id));
    const market = data.listings.filter(l => !inReach.has(l.id) && l.status === 'active').map(l => (seesOwner(l, v, data) ? l
      : { ...l, owner: { name: '', ic: '', phone: '' }, address: L.hideAddress(l), remarks: null, ownerViews: [] }));
    out.listings = [...out.listings, ...market];
    out.titles = data.titles;
    out.areas = data.areas;
    const deals = new Set(out.deals.map(d => d.id));
    out.audit = (data.audit || []).filter(a => deals.has(a.dealId));
  }
  if (v.role !== 'superadmin') {
    const branchId = v.branchId ?? data.staff.find(s => s.id === v.staffId)?.branchId ?? null;
    out.notices = (data.notices || []).filter(n => L.noticeFor(n, keyOf(v), branchId));
    out.favourites = data.favourites?.[keyOf(v)] ? { [keyOf(v)]: data.favourites[keyOf(v)] } : {};
  }
  for (const kind of DROPPED_WITHOUT_ACCESS) if (!sees(v, AREA_OF[kind])) out[kind] = [];
  if (!sees(v, 'deals')) {
    // The E-Forms stay (pages link to them) without the parties' details.
    out.deals = out.deals.map(SL.withoutParties);
    if (out.v1) out.v1 = { eforms: [], overrides: [] };
  }
  return out;
}

// ── Actions ──────────────────────────────────────────────────────────────────
// Arguments that name who is acting: always the signed-in person (0: an office account).
const ACTOR_ARG = { claimPay: 0, stackPay: 0, readNotices: 1, toggleFavourite: 2, confirmViewing: 1, cancelViewing: 2, addViewingRemark: 2, revealOwner: 1 };
const ACTOR_FIELD = { addListingFollowUp: [1, 'by'], saveTitle: [0, 'requestedBy'], rescheduleViewing: [1, 'by'], scheduleDowntime: [0, 'by'] };

const one = i => a => [a[i]];
const each = i => a => [].concat(a[i] ?? []);
const idIn = (i, f) => a => (a[i]?.[f] != null ? [a[i][f]] : []);
// The records an action works on, which must be in the person's reach.
const TARGET = {
  approvePayouts: ['payouts', each(0)], queryPayouts: ['payouts', each(0)], verifyLandlord: ['deals', one(0)], createRequests: ['staff', each(0)],
  setRequestStatus: ['requests', one(0)], deleteSalaryRequest: ['requests', one(0)],
  setMoneyInStatus: ['moneyIn', each(0)], updateTransaction: ['moneyIn', one(0)], deleteTransaction: ['moneyIn', one(0)], addTransaction: ['deals', idIn(0, 'dealId')],
  setMoneyOutStatus: ['moneyOut', one(0)], updateMoneyOut: ['moneyOut', one(0)], deleteMoneyOut: ['moneyOut', one(0)],
  closeDeal: ['deals', one(0)], raiseRequest: ['deals', one(0)], updateDeal: ['deals', one(0)], deleteDeal: ['deals', one(0)], setDealDoc: ['deals', one(0)],
  requestInvoice: ['deals', one(0)], rerunClose: ['closes', one(0)], deleteClose: ['closes', one(0)],
  updateCustomer: ['customers', one(0)], addCustomerFollowUp: ['customers', one(0)],
  updateListing: ['listings', one(0)], addListingFollowUp: ['listings', one(0)], deleteListing: ['listings', one(0)],
  updateStaff: ['staff', one(0)], setStaffStatus: ['staff', one(0)], setMarketingStaffs: ['staff', one(0)], deleteStaff: ['staff', one(0)], returnListings: ['staff', one(0)],
  setVendorRequest: ['vendorRequests', one(0)], updateEnquiry: ['enquiries', one(0)],
  setTitleStatus: ['titles', each(0)], deleteTitle: ['titles', one(0)], saveTitle: ['titles', idIn(0, 'id')],
  setAreaStatus: ['areas', one(0)], deleteArea: ['areas', one(0)], saveArea: ['areas', idIn(0, 'id')],
  confirmViewing: ['viewings', one(0)], rescheduleViewing: ['viewings', one(0)], cancelViewing: ['viewings', one(0)],
  reviewViewing: ['viewings', one(0)], addViewingRemark: ['viewings', one(0)],
  // The agent bringing the customer, or the agent an E-Form is for.
  bookViewing: ['staff', idIn(0, 'requestedBy')], addDeal: ['staff', idIn(0, 'agentId')],
};
// New records of these kinds must be in the person's reach once made.
const MADE_IN_REACH = ['customers', 'listings', 'deals', 'moneyIn', 'moneyOut', 'closes', 'payouts', 'requests', 'viewings', 'staff'];
// Fields of a staff record no one changes on their own record; the account type also needs Full on staff.
const OWN_LOCKED = ['type', 'access', 'status', 'branchId'];

const refuse = msg => Object.assign(new Error(msg), { status: 403, errors: [msg] });
const NOT_YOURS = 'That is not yours to change: it is outside the people and records your role reaches.';

// The arguments to run, with who is acting set to the signed-in person.
function actorArgs(name, args, v) {
  const out = [...args];
  if (Object.hasOwn(ACTOR_ARG, name)) out[ACTOR_ARG[name]] = keyOf(v);
  if (Object.hasOwn(ACTOR_FIELD, name)) {
    const [i, f] = ACTOR_FIELD[name];
    out[i] = { ...(out[i] || {}), [f]: v.staffId ?? (f === 'requestedBy' ? null : 0) };
  }
  return out;
}

// Before: the records the action works on are in reach, and a staff record's
// protected fields are not changed by the person themselves or without Full.
function checkBefore(name, args, data, v) {
  if (name === 'revealOwner') {
    const l = data.listings.find(x => x.id === args[0]);
    if (l && !seesOwner(l, v, data)) throw refuse('Only the people tied to this listing may see its owner.');
  }
  if (name === 'updateStaff' || name === 'setStaffStatus') {
    const fields = name === 'setStaffStatus' ? { status: args[1] } : args[1] || {};
    const s = data.staff.find(x => x.id === args[0]);
    const touched = OWN_LOCKED.filter(k => k in fields && s && JSON.stringify(fields[k]) !== JSON.stringify(s[k]));
    if (touched.length && args[0] === v.staffId) throw refuse('You cannot change your own account type, status, branch or access switches.');
    if (touched.includes('type') && !AC.allows(v.policy, v.role, 'staff', 'full')) throw refuse('Changing an account type needs Full on Agents & staff.');
  }
  if (name === 'deleteStaff' && args[0] === v.staffId) throw refuse('You cannot delete your own record.');
  if (v.scope === 'all' || !Object.hasOwn(TARGET, name)) return;
  const [kind, ids] = TARGET[name];
  const want = ids(args).filter(x => x != null && x !== '');
  if (!want.length) return;
  const reach = new Set((kind === 'staff' ? AC.visibleData(data, who(v), v.scope).staff : AC.visibleData(data, who(v), v.scope)[kind] || []).map(x => x.id));
  if (want.some(id => !reach.has(Number(id)))) throw refuse(NOT_YOURS);
}

// After: anything new the action made is in reach too.
function checkAfter(before, after, v) {
  if (v.scope === 'all') return;
  const was = Object.fromEntries(MADE_IN_REACH.map(k => [k, new Set((before[k] || []).map(x => x.id))]));
  const shown = AC.visibleData(after, who(v), v.scope);
  for (const k of MADE_IN_REACH) {
    const reach = new Set((shown[k] || []).map(x => x.id));
    if ((after[k] || []).some(x => !was[k].has(x.id) && !reach.has(x.id))) throw refuse(NOT_YOURS);
  }
}

// { kind: [ids] } of the records an action added, changed or removed (not their contents).
function changedIds(before, after) {
  const out = {};
  for (const k of Object.keys(after)) {
    if (!Array.isArray(after[k]) || k === 'audit') continue;
    const was = new Map((before[k] || []).map(x => [x.id, JSON.stringify(x)]));
    const now = new Set(after[k].map(x => x.id));
    const ids = [...after[k].filter(x => was.get(x.id) !== JSON.stringify(x)).map(x => x.id), ...[...was.keys()].filter(id => !now.has(id))];
    if (ids.length) out[k] = ids.slice(0, 50);
  }
  return out;
}

// The start-up read (GET /erp/start, and an action's reply to a page that asks for it): what every page
// uses and is small, a person's own included: the staff directory, buildings, areas, property types, the
// last manual checks, their favourites and planned downtime. Every other kind is read a page at a time
// (/api/erp/<list>), so it goes empty here.
const START = new Set(['asOf', 'staff', 'titles', 'areas', 'propertyTypes', 'runs', 'favourites', 'downtime']);
// The record kinds of it, for loadState({ only }).
const START_KINDS = ['staff', 'titles', 'areas', 'propertyTypes', 'downtime'];
function startUp(data) {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, START.has(k) ? v : Array.isArray(v) ? []
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).map(x => [x, []])) : v]));
}

// The ids of the records an action made, by kind (a page opens what it just added).
function addedIds(before, after) {
  const out = {};
  for (const k of Object.keys(after)) {
    if (!Array.isArray(after[k])) continue;
    const was = new Set((before[k] || []).map(x => x.id));
    const ids = after[k].filter(x => !was.has(x.id)).map(x => x.id);
    if (ids.length) out[k] = ids;
  }
  return out;
}

module.exports = { forViewer, actorArgs, checkBefore, checkAfter, changedIds, seesOwner, startUp, addedIds, START_KINDS };

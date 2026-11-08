// The old phone app's words (old-subsaleking-app, read 2026-11-08): the ids it
// keeps in its own code (property categories 1–5 with their sub-types, states,
// listing tracking 0–5) and the shapes it reads, made from the new records.
// Nothing here decides who may see or change what: the records come through
// the same reads and actions as the ERP's pages (appV1/index.js).
const L = require('../../../shared/listings.js');

// Categories and sub-types as the old ERP numbered them (db_property_cate, db_property_cate_sub). The app
// sends these ids back in its searches ('type-1' = residential = 1 and 2, banners pick 3, 4, 5); a listing's
// category in the new records is the sub-type's name. A type the old ERP never had falls in by its group.
const CATEGORIES = [
  { id: 1, name: 'Residential landed property', subs: [[1, 'Double Storey'], [2, 'Single Storey'], [3, '3 Storey'], [4, 'Super Link'], [5, 'Semi-D'], [6, 'Bungalow'], [7, 'Residential Land']] },
  { id: 2, name: 'Residential non landed property', subs: [[8, 'Condominium'], [9, 'Apartment'], [10, 'Flat'], [11, 'Town House'], [12, 'Serviced Residence'], [13, 'Studio'], [14, 'Soho'], [25, 'Duplex'], [26, 'Triplex'], [27, 'Penthouse']] },
  { id: 3, name: 'Commercial', subs: [[15, 'Shop'], [16, 'Office'], [17, 'Hotel'], [18, 'Resort'], [19, 'Commercial Land']] },
  { id: 4, name: 'Industrial', subs: [[20, 'Link Factory'], [21, 'Semi-D Factory'], [22, 'Bungalow Factory'], [23, 'Warehouse'], [24, 'Industrial Land']] },
  { id: 5, name: 'Land', subs: [[28, 'Agriculture Land'], [29, 'Industrial Land'], [30, 'Commercial Land'], [31, 'Residential Land']] },
];
const SUB_BY_NAME = new Map();
for (const c of CATEGORIES) for (const [id, name] of c.subs) if (!SUB_BY_NAME.has(name.toLowerCase())) SUB_BY_NAME.set(name.toLowerCase(), { id, name, cateId: c.id });
// The old "type-N" shortcuts (search_filters_screen: All Residential, All Commercial…).
const TYPE_SHORTCUT = { 'type-1': [1, 2], 'type-2': [3], 'type-3': [4], 'type-4': [5] };
// A new property type the old list never had: its group (shared/listings.js categoryGroup) → an old category.
const GROUP_CATE = { 1: 1, 2: 2, 3: 3 };

// Where a listing's category sits in the old app's lists.
function categoryOf(name) {
  const known = SUB_BY_NAME.get(String(name || '').trim().toLowerCase());
  if (known) return known;
  const cateId = GROUP_CATE[L.categoryGroup(name)] || 1;
  return { id: 0, name: String(name || ''), cateId };
}
const cateName = id => CATEGORIES.find(c => c.id === id)?.name || '';
// The category names (the records' own) that old category and sub-type ids stand for; `others` are the
// names on file the old list doesn't know, which go by their group.
function categoryNames({ cateIds = [], subIds = [] }, others = []) {
  const names = new Set();
  for (const c of CATEGORIES) {
    if (cateIds.includes(c.id)) for (const [, n] of c.subs) names.add(n);
    for (const [id, n] of c.subs) if (subIds.includes(id)) names.add(n);
  }
  for (const n of others) if (cateIds.includes(categoryOf(n).cateId)) names.add(n);
  return [...names];
}

// States as the old ERP numbered them (db_property_state; the app's banners send 2 for Selangor).
const STATES = ['Federal Territory of Kuala Lumpur', 'Selangor', 'Putrajaya', 'Johor', 'Kedah', 'Kelantan', 'Malacca', 'Negeri Sembilan', 'Pahang',
  'Terengganu', 'Penang', 'Perak', 'Perlis', 'Sabah', 'Sarawak'];
const stateId = name => STATES.indexOf(name) + 1 || 0;

// Listing tracking: the old numbers ↔ the new statuses.
const TRACKING = { active: 0, sold: 1, rented: 2, invalid: 3, sold_other: 4, outdated: 5 };
const STATUS_OF = Object.fromEntries(Object.entries(TRACKING).map(([s, n]) => [n, s]));
const TYPE = { sale: 'sales', rental: 'rental' };
const TYPE_OF = { sales: 'sale', sale: 'sale', rental: 'rental', rent: 'rental' };
// Furnishing and tenure: the old codes the app shows and sends.
const FURNISH = { Unfurnished: 'non-furnish', 'Fully furnished': 'furnitured', 'Partly furnished': 'partial_furnished' };
const FURNISH_OF = Object.fromEntries(Object.entries(FURNISH).map(([w, c]) => [c, w]));
const TENURE = { Freehold: 'FREEHOLD', Leasehold: 'LEASEHOLD' };
const TENURE_OF = { FREEHOLD: 'Freehold', LEASEHOLD: 'Leasehold', LISTHOLD: 'Leasehold' };

// The listing's settings (flags) as the old check boxes, and the app's status labels (search filters).
const FLAG = {
  property_key_on_agent: L.KEY_FLAG, property_vacant: 'Vacant', property_first_prior: 'Vacant', property_exclusive: 'Exclusive',
  property_follow_up: 'Need Follow-Up', property_slobber: 'Process Deal', property_hot_list: 'Process L&L', property_owner_occupied: 'Owner Occupied',
  property_tenanted: 'Tenanted', property_on_hold: 'On Hold', property_friendly_tenant: 'Friendly Tenant',
};
const STATUS_LABEL = {
  'key-on-agent-hand': L.KEY_FLAG, vacant: 'Vacant', exclusive: 'Exclusive', 'need-follow-up': 'Need Follow-Up', 'owner-occupied': 'Owner Occupied',
  'process-deal': 'Process Deal', tenanted: 'Tenanted', 'process-l-l': 'Process L&L', 'on-hold': 'On Hold', 'friendly-tenant': 'Friendly Tenant',
};
// The details form's switches (POST /property/:id/details/update) → flags.
const FLAG_FIELD = {
  is_key_on_agent_hand: L.KEY_FLAG, is_vacant: 'Vacant', is_exclusive: 'Exclusive', is_need_follow_up: 'Need Follow-Up', is_owner_occupied: 'Owner Occupied',
  is_process_deal: 'Process Deal', is_tenanted: 'Tenanted', is_process_ll: 'Process L&L', is_on_hold: 'On Hold', is_friendly_tenant: 'Friendly Tenant',
};
// The old property_status (1 key, 2 vacant, 3 owner occupied, 4 tenanted), from the flags.
const statusId = flags => (flags.includes(L.KEY_FLAG) ? 1 : flags.includes('Vacant') ? 2 : flags.includes('Owner Occupied') ? 3 : flags.includes('Tenanted') ? 4 : 0);

const FOLLOW_UP_LABEL = { 0: 'Call for Follow-up', 1: 'Viewing', 2: 'Call for Nego', 3: 'Closing' };

const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const at = day => (day ? `${day} 00:00:00` : null);
const yes = v => (v ? 1 : 0);

// A listing as the app reads it (PropertyListing.fromMapV1). `ctx`: names of the people on it, the viewer,
// what of the owner they see ('full', 'ask', 'none': routes decide), favourites, buildings' leads, photos' links.
function listingOf(l, ctx) {
  const flags = l.flags || [];
  const cat = categoryOf(l.category);
  const title = ctx.titles?.get(l.titleId) || null;
  const name = id => (id == null ? null : ctx.names.get(id) ?? null);
  const roles = ctx.roles || [];
  const tied = roles.length > 0;
  const seesOwner = ctx.sight === 'full';
  const photos = (l.photoSet || []).filter(p => p.published !== false);
  const cover = photos.find(p => p.cover) || photos[0] || null;
  const last = (l.followUps || []).at(-1) || null;
  const hot = L.hotLists(l);
  const display = [l.title, l.category].filter(Boolean).join(', ');
  return {
    property_id: l.id, hq_id: 0, property_run_id: l.code, property_tracking: TRACKING[l.status] ?? 0, property_type: TYPE[l.type] || 'sales',
    name: display, display_name: display, property_name: l.title, property_title: l.title,
    slug: `${slug(display)}-${l.type === 'rental' ? 'for-rent' : 'for-sale'}-${l.id}`,
    property_unit: tied || ctx.inReach ? l.unit || null : null,
    property_price: l.bestPrice ?? l.askPrice ?? null, property_price_asking: l.askPrice ?? null, property_price_close: null,
    property_price_extra: l.marketValue ?? l.marketValueText ?? null, bank_value: null,
    property_room: l.beds ?? null, property_bath: l.baths ?? null, carpark: l.carpark ?? null, utilities_rooms: null,
    property_cover: cover ? ctx.photoUrl(cover) : null,
    property_desc: l.description || null,
    // Private remarks: only those tied to the listing (and the office in reach) read them.
    property_marketing_remarks: l.remarksPrivate && !tied && !ctx.inReach ? null : l.marketingRemarks || null,
    property_remarks: l.remarks || null,
    property_follow_up_remarks: tied ? last?.remark || null : null,
    property_tenure: TENURE[l.tenure] || l.tenure || null, property_land_built: l.builtUp ?? null,
    property_built_area_width: null, property_built_area_length: null, property_restriction: l.restriction || null,
    property_furnish: FURNISH[l.furnishing] || l.furnishing || null, property_specs: l.specs || null,
    area_id: ctx.areaIds?.get(l.area) ?? 0, area_name: l.area || '', state_id: stateId(l.state), state_name: l.state || '',
    cate_id: cat.cateId, cate_name: cateName(cat.cateId), sub_id: cat.id, sub_name: cat.name || l.category || '', group_id: 0, group_name: '',
    vendor_name: seesOwner ? l.owner?.name || '' : null, vendor_contact: seesOwner ? l.owner?.phone || '' : null,
    property_status: statusId(flags),
    ...Object.fromEntries(Object.entries(FLAG).map(([k, f]) => [k, yes(flags.includes(f))])),
    property_images_count: l.photos || photos.length || 0, property_follow_up_remarks_count: (l.followUps || []).length,
    user_favourite_count: 0, my_listing: tied, is_user_favourite: yes(ctx.favourites?.has(l.id)),
    is_hot_sales_listing: yes(hot.includes('hotSale')), is_super_hot_listing: yes(hot.includes('superHot')), is_trip_incentive_listing: 0,
    property_date: at(l.created), property_mdate: at(l.updated), last_modified_at: at(l.updated),
    last_follow_up_at: tied ? at(last?.date) : null,
    staff_id: l.creatorId ?? null, staff_name: name(l.creatorId),
    branch_manager_id: l.branchManagerId ?? null, branch_manager_name: name(l.branchManagerId),
    area_manager_id: l.areaManagerId ?? null, area_manager_name: name(l.areaManagerId),
    project_manager_id: title?.managerId ?? null, project_manager_name: name(title?.managerId),
    title_handler_id: title?.handlerId ?? null, title_handler_name: name(title?.handlerId),
    project_handler_id: l.holderId ?? null, project_handler_name: name(l.holderId),
    main_product_handler_id: l.share?.pmId ?? null, main_product_handler_name: name(l.share?.pmId),
    person_incharge_id: l.holderId ?? null, person_incharge_name: name(l.holderId), person_incharge_contact: ctx.phones?.get(l.holderId) ?? null,
    ...(ctx.details && { property_images: photos.map(p => imageOf(p, ctx)) }),
  };
}

const imageOf = (p, ctx) => ({ image_id: p.id, image_url: ctx.photoUrl(p, 'file'), image_cover: yes(p.cover) });

// A person as the app reads them (User.fromMapV1). Their own profile carries the private parts.
function userOf(s, { own = false, roles = [], accessLevel = 1, username = null } = {}) {
  return {
    user_id: s.id, hq_id: 0, user_name: username ?? s.username ?? s.code ?? '', name_card_name: s.short || s.name || '', ic_name: s.name || '',
    ...(own && { ic_no: s.ic || '', email: s.email || '', phone_number1: s.phone || '', house_address: s.address || '' }),
    agent_profile_page_enabled: yes(s.access?.profilePage), access_level: accessLevel, roles,
  };
}

// The old access level (1 agent, 2 team leaders and unit managers, 3 area managers and above), from the upline position.
const ACCESS_LEVEL = { AGA: 1, PTL: 2, TL: 2, PUM: 2, UM: 2, PAM: 3, AM: 3, BM: 3, DM: 3, GSM: 3, TSM: 2 };

// A notice as the app reads it (NotificationData.fromMap). Its link to a listing makes it a property one,
// which the app opens on a tap.
const CATEGORY = { good: 'good_news', bad: 'bad_news', listing: 'listing' };
const CAT_OF = { good_news: ['good'], bad_news: ['bad'], listing: ['listing'], off_listing: [] };
function noticeOf(n, who) {
  const listing = /^listings\/(\d+)$/.exec(n.link || '');
  return {
    id: n.id, title: L.NOTICE_CAT[n.cat]?.label || 'Notice', body: n.text, user_id: who, sender_id: 0,
    type: listing ? 'property.listing_tracking_updated' : 'other', category: CATEGORY[n.cat] || 'other',
    reference_id: listing ? Number(listing[1]) : null, params: {}, unread: yes(!(n.readBy || []).includes(who)),
    last_modified_at: n.at, created_at: n.at,
  };
}

// A follow-up as the app reads it (PropertyFollowUp.fromMapV1; staff.* keys are folded by the app).
const followUpOf = (f, i, l, names) => ({
  follow_id: i + 1, property_id: l.id, 'staff.user_id': f.by ?? null, 'staff.name_card_name': names.get(f.by) ?? null,
  follow_date: f.date, follow_up_date: f.date, follow_up_remarks: f.remark === '—' ? '' : f.remark || '',
  follow_up_action: f.action, follow_up_action_label: FOLLOW_UP_LABEL[f.action] || 'N/A', follow_up_name: '', follow_up_price: null,
  follow_up_list_id: null, property_appointment_date: f.appointment?.date || null,
});

module.exports = {
  CATEGORIES, TYPE_SHORTCUT, categoryOf, categoryNames, cateName, STATES, stateId, TRACKING, STATUS_OF, TYPE, TYPE_OF, FURNISH_OF, TENURE_OF,
  STATUS_LABEL, FLAG_FIELD, FOLLOW_UP_LABEL, ACCESS_LEVEL, CAT_OF, listingOf, imageOf, userOf, noticeOf, followUpOf, slug,
};

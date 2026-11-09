// The old phone app's listing search (POST /v1/property/search and the filter
// lists beside it), turned into the Whole agency list (shared/lists.js agency:
// the viewer's own reach plus every active listing, owners hidden where they
// aren't tied) with its filters, plus a few the old app has that the ERP's pages
// don't (state, area by id, bathrooms, built-up size…) as extra SQL on the same rows.
// The old rules this follows: old-subsaleking-api PropertyRepository::searchProperty.
const O = require('./old');

const ids = v => String(v ?? '').split(',').map(x => Number.parseInt(x, 10)).filter(Number.isFinite);
const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const truthy = v => v === true || v === 1 || v === '1' || v === 'true';

// The places the app's banners stand for (their buildings, by the old title ids the records kept).
const BANNER_PLACES = {
  'banner-best-lifestyle-kepong': [2397, 3987],
  'banner-best-lifestyle-bukit-jalil': [2179, 906, 2177, 901, 2178, 1579, 1951, 1772, 1574, 1748, 933, 981, 1500, 1206, 2765, 1047, 1938, 2049, 2168],
};
const BANNER_NAMES = { 'banner-hot-demand-kota-damansara': ['Kota Damansara', 'Mutiara Damansara', 'Damansara Perdana'] };

// The old search's sorts → the list's.
const SORT = { newest: '-created', '': '-created', lowest: 'price', highest: '-price', updated: '-updated', photo: '-photosOn', has_photo: '-updated', hot: '-updated', rent: '-updated', sold: '-updated' };

// p: the app's query and body together. me: the viewer's staff id. Returns { params, extra(b) } for listPage on LISTS.agency.
function searchOf(p, me, { categories = [], areaNames = new Map() } = {}) {
  const params = { size: Math.min(200, Math.max(1, Number.parseInt(p.per_page, 10) || 10)), page: Math.max(1, Number.parseInt(p.page, 10) || 1) };
  const extra = [];
  const q = String(p.keywords ?? '').trim();
  if (q) params.q = q;
  const type = O.TYPE_OF[String(p.type || '').toLowerCase()];
  if (type) params.type = type;

  // Which tracking: the one asked for, Rent Out / Sold for those sorts, else active (a listing code or number typed:
  // active, sold, rented and outdated, as the old app).
  let tracking = num(p.property_tracking_id);
  const sort = String(p.sort ?? '').trim();
  if (tracking == null && sort === 'rent') tracking = 2;
  if (tracking == null && sort === 'sold') tracking = 1;
  const lookingUp = /^list-/i.test(q) || (/^\d+$/.test(q) && q.length >= 5);
  params.status = tracking != null ? O.STATUS_OF[tracking] || 'active' : lookingUp ? 'active,sold,rented,outdated' : 'active';
  params.sort = SORT[sort] || '-created';

  // The viewer's own listings, by their part in them.
  const role = String(p.property_staff_role || '');
  if (me == null && role) extra.push(b => b.whereRaw('1 = 0'));
  else if (role === 'product-handler' || role === 'person-incharge') params.holderId = String(me);
  else if (role === 'branch-manager') params.holderTeam = String(me);
  else if (role === 'project-handler') { params.titleHandler = String(me); params.type = 'rental'; }
  else if (role === 'project-manager') {
    params.type = 'sale';
    extra.push(b => b.whereIn('listings.title_id', sub => sub.select('id').from('titles').whereRaw("json_extract(titles.more, '$.managerId') = ?", [me])));
  } else if (role === 'main-product-handler') extra.push(b => b.whereRaw("json_extract(listings.share, '$.pmId') = ?", [me]));
  else if (role === 'co-product-handler') extra.push(b => b.whereRaw("json_contains(json_extract(listings.share, '$.coPh[*].staffId'), cast(? as json))", [String(me)]));

  // Tags: the viewer's own (creator, outdated), the home shortcuts and banners.
  const tag = String(p.s_tag || '');
  let places = ids(p.property_place_id_list);
  if (tag === 'me-listing-creator') params.creatorId = String(me ?? 0);
  if (tag === 'me-listing-outdated') { params.creatorId = String(me ?? 0); params.status = 'outdated'; }
  if (tag === 'shortcut-hot-sales-listing') { params.hot = 'hotSale'; params.type = 'sale'; }
  if (tag === 'shortcut-super-hot-listing') { params.hot = 'superHot'; params.type = 'sale'; }
  if (tag === 'shortcut-rent-king-product') { params.hot = 'rentKing'; params.type = 'rental'; }
  if (tag === 'favourite') params.fav = '0';
  if (tag === 'banner-event-sinland-bop') params.createdTo = '2022-05-31';
  if (BANNER_PLACES[tag]) places = places.length ? places.filter(x => BANNER_PLACES[tag].includes(x)) : BANNER_PLACES[tag];
  if (BANNER_NAMES[tag]) extra.push(b => b.where(w => { for (const n of BANNER_NAMES[tag]) w.orWhere('listings.title', 'like', `%${n}%`); }));

  if (truthy(p.is_user_favourite)) params.fav = '0';
  if (truthy(p.is_not_empty_property_images)) params.photosFrom = '1';
  if (num(p.property_hot)) params.band = 'red';
  const flag = O.STATUS_LABEL[String(p.property_status_label || '')];
  if (flag) params.flag = flag;
  // A listing whose person in charge is on the trip incentive (their access switch), sales only.
  if (truthy(p.is_trip_incentive_listings)) {
    params.type = 'sale';
    extra.push(b => b.whereIn('listings.holder_id', sub => sub.select('id').from('staff').whereRaw("json_extract(staff.access, '$.tripIncentive') = true")));
  }

  // Categories: the old ids (or a "type-N" shortcut) → the category names on file.
  const cateIds = ids(p.property_category_id_list);
  const picked = cateIds.length ? cateIds : O.TYPE_SHORTCUT[String(p.property_category || '')] || [];
  const subIds = ids(p.property_category_sub_id_list);
  if (picked.length || subIds.length) {
    const names = O.categoryNames({ cateIds: picked, subIds }, categories);
    extra.push(b => (names.length ? b.whereIn('listings.category', names) : b.whereRaw('1 = 0')));
  }
  if (places.length) params.titleId = places.join(',');
  const states = ids(p.property_state_id_list).map(i => O.STATES[i - 1]).filter(Boolean);
  if (states.length || ids(p.property_state_id_list).length) extra.push(b => (states.length ? b.whereIn('listings.state', states) : b.whereRaw('1 = 0')));
  const areaIds = ids(p.property_area_id_list);
  if (areaIds.length) {
    const names = areaIds.map(i => areaNames.get(i)).filter(Boolean);
    extra.push(b => (names.length ? b.whereIn('listings.area', names) : b.whereRaw('1 = 0')));
  }
  if (num(p.min_price)) params.priceFrom = String(num(p.min_price));
  if (num(p.max_price)) params.priceTo = String(num(p.max_price));
  if (num(p.bedrooms)) extra.push(b => b.where('listings.beds', num(p.bedrooms)));
  if (num(p.bathrooms)) extra.push(b => b.where('listings.baths', num(p.bathrooms)));
  if (num(p.min_built_up_size)) extra.push(b => b.where('listings.built_up', '>=', num(p.min_built_up_size)));
  if (num(p.max_built_up_size)) extra.push(b => b.where('listings.built_up', '<=', num(p.max_built_up_size)));
  const desc = String(p.property_desc ?? '').trim().replace(/^-\s*/, '');
  if (desc) extra.push(b => b.where('listings.description', 'like', `%${desc.replace(/[!%_]/g, c => `!${c}`)}%`));
  const furnish = O.FURNISH_OF[String(p.property_furnish || '')];
  if (furnish) extra.push(b => b.where('listings.furnishing', furnish));
  const reno = String(p.property_renovation || '');
  if (reno === 'renovated') extra.push(b => b.whereRaw("json_unquote(json_extract(listings.more, '$.specs')) = 'renovated'"));
  if (reno === 'not_renovated') extra.push(b => b.whereRaw("coalesce(json_unquote(json_extract(listings.more, '$.specs')), '') <> 'renovated'"));
  // Listings shared with a person (the team banner's search).
  if (num(p.staff)) extra.push(b => b.whereRaw("json_contains(coalesce(json_extract(listings.share, '$.users'), json_array()), cast(? as json))", [String(num(p.staff))]));

  return { params, extra: b => { for (const f of extra) f(b); } };
}

// The pagination block the app reads (Paginated.fromJson).
function pagination({ page, size, total }, shown) {
  const last = Math.max(1, Math.ceil(total / size));
  const from = total ? (page - 1) * size + 1 : null;
  return {
    page: { previous: page > 1 ? page - 1 : null, current: page, next: page < last ? page + 1 : null, total: last },
    entries: { per_page: size, current: shown, from, to: from == null ? null : from + shown - 1, total },
  };
}

// The category names on file (a type the old list never had goes by its group), read again every 5 minutes.
let onFile = { at: 0, names: [] };
async function categoriesOnFile(q) {
  if (Date.now() - onFile.at > 5 * 60000) onFile = { at: Date.now(), names: (await q('listings').distinct('category').whereNotNull('category')).map(r => r.category) };
  return onFile.names;
}

module.exports = { searchOf, pagination, categoriesOnFile, ids, num, truthy };

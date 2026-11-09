// /api/public — what the website (www.subsaleking.com) reads from the new system, in place of the old
// database it reads today (old-subsaleking-next: GetPropertyListings, GetPropertyListingDetails,
// IncrementListingViewsClicksCounter, GetPropertyCategories / Areas / Titles / SearchKeywords,
// VendorEnquiry, GetStaffAgentProfile, Get/ToggleStaffSavedListing). Nobody signs in for it, so it
// gives public fields only: never an owner, a unit number, private remarks or anything of the ERP's
// records beyond listings and the agents who chose a public profile. A listing is public when it is
// not a draft and not marked Process Deal, Process L&L or On Hold (the old site's rule).
//
//   GET  /listings?q&type&category&categoryIds&subCategoryIds&areaIds&stateIds&titleIds&minPrice&maxPrice&bedrooms(3 | 3+)
//                 &bathrooms&renovated&furnish&label&description&catalog&tracking&staff&role&exclude&hasImages&sort&page&size
//                                              → { rows, total, page, size }
//   GET  /listings/:id                         → one listing, with its photos
//   POST /listings/:id/look { kind: view | click, via: web | app }   counts for the day (db/listingDaily.js)
//   GET  /photos/:fileId[/preview]             a public listing's published photo (the small preview for lists)
//   GET  /categories, /areas, /titles?areaId, /keywords?q          what the search picks from, with counts
//   POST /owner-requests { name, email, phone, propertyName, subCategoryId, price, type }   → { ticket }
//   GET  /agents/:username                     an agent's public profile (only if their profile page is on)
//   GET  /agents/:username/photo               their profile photo, if they set one in My profile
//   GET  /saved, POST /saved/:listingId        a signed-in staff member's saved listings (toggle) — needs the ERP's sign-in
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const L = require('../../../shared/listings.js');
const { LISTS } = require('../db/lists');
const { listPage } = require('../db/list');
const { MODELS, toRecords, parseJson } = require('../db/records');
const { loadSetup } = require('../db/setupStore');
const { countLook } = require('../db/listingDaily');
const { localToday } = require('../db/days');
const { requireAuth } = require('../middleware/auth');
const { storage } = require('../files/storage');
const O = require('../appV1/old');
const { searchOf, categoriesOnFile, ids, num, truthy } = require('../appV1/search');

const router = express.Router();
const SPEC = LISTS.listings;
const MAX_SIZE = 50;
const wrap = fn => (req, res, next) => fn(req, res).catch(err => (err.status && err.status < 500 ? res.status(err.status).json({ error: err.message }) : next(err)));
const refuse = (status, message) => Object.assign(new Error(message), { status });
const idParam = v => (/^\d+$/.test(String(v)) ? Number(v) : null);
const origin = req => process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`;

// ── Which listings are public ───────────────────────────────────────────────
const HIDDEN_FLAGS = ['Process Deal', 'Process L&L', 'On Hold'];
const publicScope = b => {
  b.where('listings.draft', false);
  for (const f of HIDDEN_FLAGS) b.whereRaw("not json_contains(coalesce(listings.flags, json_array()), json_quote(?))", [f]);
};
const isPublic = l => l && !l.draft && !(l.flags || []).some(f => HIDDEN_FLAGS.includes(f));
// The site's tracking choices → statuses ("all" for visitors: on the market or outdated).
const TRACKING = { active: 'active', sold: 'sold,sold_other', rented: 'rented,sold_other', 'sold-rented': 'sold,rented,sold_other', outdated: 'outdated', pending: 'outdated', all: 'active,outdated' };

// ── A listing as the site shows it ──────────────────────────────────────────
const photoUrl = (req, p, part = 'preview') => {
  const id = /^files\/(\d+)\//.exec(String(p.preview || ''))?.[1];
  return id ? `${origin(req)}/api/public/photos/${id}${part === 'preview' ? '/preview' : ''}` : p.url || null;
};
const PUBLIC_FLAGS = [L.KEY_FLAG, 'Vacant', 'Exclusive', 'Owner Occupied', 'Tenanted', 'Friendly Tenant'];

async function contextFor(rows) {
  const people = [...new Set(rows.map(l => l.holderId).filter(x => x != null))];
  const staff = people.length ? await db('staff').whereIn('id', people).select('id', 'code', 'username', 'short_name', 'name', 'phone', 'email', 'access', 'status') : [];
  const areas = [...new Set(rows.map(l => l.area).filter(Boolean))];
  const titleIds = [...new Set(rows.map(l => l.titleId).filter(x => x != null))];
  return {
    people: new Map(staff.map(s => [s.id, s])),
    areaIds: new Map((areas.length ? await db('areas').whereIn('name', areas).select('id', 'name') : []).map(a => [a.name, a.id])),
    titles: new Map((titleIds.length ? await db('titles').whereIn('id', titleIds).select('id', 'name') : []).map(t => [t.id, t.name])),
  };
}

const contactOf = s => (s && s.status === 'active' ? {
  id: s.id, code: s.code, username: s.username, name: s.short_name || s.name, phone: s.phone || null, email: s.email || null,
  hasProfilePage: !!parseJson(s.access)?.profilePage,
} : null);

function listingOf(req, l, ctx, { details = false } = {}) {
  const cat = O.categoryOf(l.category);
  const photos = (l.photoSet || []).filter(p => p.published !== false);
  const cover = photos.find(p => p.cover) || photos[0] || null;
  const band = L.priceRating(l)?.band || null;
  return {
    id: l.id, code: l.code, type: l.type === 'rental' ? 'rent' : 'sale', status: l.status,
    title: { id: l.titleId ?? null, name: ctx.titles.get(l.titleId) || l.title }, area: l.area ? { id: ctx.areaIds.get(l.area) ?? null, name: l.area } : null,
    state: l.state ? { id: O.stateId(l.state) || null, name: l.state } : null,
    category: { id: cat.cateId, name: O.cateName(cat.cateId) }, subCategory: { id: cat.id || null, name: cat.name || l.category || null },
    description: l.description || null, bestPrice: l.bestPrice ?? null, askingPrice: l.askPrice ?? null, marketValue: l.marketValue ?? null,
    priceBand: band, beds: l.beds ?? null, baths: l.baths ?? null, builtUp: l.builtUp ?? null, tenure: l.tenure || null,
    furnishing: l.furnishing || null, renovated: l.specs === 'renovated',
    marketingRemarks: l.remarksPrivate ? null : l.marketingRemarks || null,
    flags: (l.flags || []).filter(f => PUBLIC_FLAGS.includes(f)), hotLists: L.hotLists(l),
    photoCount: photos.length || l.photos || 0, coverUrl: cover ? photoUrl(req, cover) : null,
    contact: contactOf(ctx.people.get(l.holderId)),
    createdOn: l.created || null, updatedOn: l.updated || null,
    ...(details && { photos: photos.map(p => ({ id: p.id, cover: !!p.cover, url: photoUrl(req, p, 'file'), previewUrl: photoUrl(req, p) })) }),
  };
}

// ── Search ──────────────────────────────────────────────────────────────────
const SORT = { 'recent-update': 'updated', 'recent-photo': 'photo', 'price-asc': 'lowest', 'price-desc': 'highest', hot: 'hot', newest: 'newest' };
const CATALOG = { 'hot-sales': 'shortcut-hot-sales-listing', 'super-hot': 'shortcut-super-hot-listing', 'rent-king': 'shortcut-rent-king-product' };
const CATEGORY = { residential: 'type-1', 'residential-landed': null, commercial: 'type-2', industrial: 'type-3', land: 'type-4' };
const FURNISH = { furnished: 'furnitured', 'non-furnish': 'non-furnish', 'partial-furnish': 'partial_furnished' };
const ROLES = new Set(['product-handler', 'person-in-charge', 'main-product-handler', 'co-product-handler', 'project-handler', 'project-manager', 'branch-manager']);

// The site's query → the old app's search words (appV1/search.js does the rest) and a few of its own.
async function searchFor(query) {
  const p = query || {};
  const atLeast = (v, col) => (/\+$/.test(String(v ?? '')) && num(String(v).replace('+', '')) ? b => b.where(col, '>=', num(String(v).replace('+', ''))) : null);
  const role = String(p.role || '');
  const staff = num(p.staff);
  const app = {
    page: p.page, per_page: Math.min(MAX_SIZE, Number.parseInt(p.size, 10) || 10), keywords: p.q, sort: SORT[p.sort] || 'updated',
    type: p.type === 'rent' ? 'rental' : p.type === 'sale' ? 'sales' : '',
    property_category: CATEGORY[p.category] || '', property_category_id_list: p.category === 'residential-landed' ? '1' : p.categoryIds,
    property_category_sub_id_list: p.subCategoryIds, property_area_id_list: p.areaIds, property_state_id_list: p.stateIds, property_place_id_list: p.titleIds,
    min_price: p.minPrice, max_price: p.maxPrice, bedrooms: atLeast(p.bedrooms) ? '' : p.bedrooms, bathrooms: atLeast(p.bathrooms) ? '' : p.bathrooms,
    property_renovation: p.renovated == null || p.renovated === '' ? '' : truthy(p.renovated) ? 'renovated' : 'not_renovated',
    property_furnish: FURNISH[p.furnish] || '', property_status_label: p.label, property_desc: p.description, s_tag: CATALOG[p.catalog] || '',
    is_not_empty_property_images: truthy(p.hasImages) ? 1 : '', property_staff_role: staff != null && ROLES.has(role) ? role : '',
  };
  const categories = app.property_category || app.property_category_id_list ? await categoriesOnFile(db) : [];
  const areaNames = new Map((ids(p.areaIds).length ? await db('areas').whereIn('id', ids(p.areaIds)).select('id', 'name') : []).map(a => [a.id, a.name]));
  const { params, extra } = searchOf(app, staff, { categories, areaNames });
  // The site's own: tracking choices, "3+" rooms, listings to leave out, a creator's listings, photos or none.
  const q = String(p.q ?? '').trim();
  const lookingUp = /^list-/i.test(q) || /^\d+$/.test(q);
  params.status = TRACKING[p.tracking] || (lookingUp ? TRACKING.all : TRACKING.active);
  if (role === 'creator' && staff != null) params.creatorId = String(staff);
  const more = [atLeast(p.bedrooms, 'listings.beds'), atLeast(p.bathrooms, 'listings.baths')].filter(Boolean);
  const exclude = ids(p.exclude);
  if (exclude.length) more.push(b => b.whereNotIn('listings.id', exclude));
  if (p.hasImages != null && p.hasImages !== '' && !truthy(p.hasImages)) more.push(b => b.where(w => w.whereNull('listings.photo_count').orWhere('listings.photo_count', 0)));
  delete params.fav;
  return { params: { ...params, counts: '0' }, scope: b => { publicScope(b); extra(b); for (const f of more) f(b); } };
}

router.get('/listings', wrap(async (req, res) => {
  const { params, scope } = await searchFor(req.query);
  const out = await listPage(db, SPEC, params, scope);
  const ctx = await contextFor(out.rows);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ rows: out.rows.map(l => listingOf(req, l, ctx)), total: out.total, page: out.page, size: out.size });
}));

async function publicListing(id) {
  const row = id == null ? null : await db('listings').where('id', id).first();
  const [l] = row ? await toRecords(db, MODELS.listings, [row]) : [];
  if (!isPublic(l)) throw refuse(404, 'Listing not found.');
  return l;
}

router.get('/listings/:id', wrap(async (req, res) => {
  const l = await publicListing(idParam(req.params.id));
  res.set('Cache-Control', 'public, max-age=60');
  res.json(listingOf(req, l, await contextFor([l]), { details: true }));
}));

const looks = rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many at once.' } });
router.post('/listings/:id/look', looks, wrap(async (req, res) => {
  const l = await publicListing(idParam(req.params.id));
  await countLook(db, l.id, { via: req.body?.via === 'app' ? 'app' : 'web', kind: req.body?.kind === 'click' ? 'click' : 'view' });
  res.json({ ok: true });
}));

// A published photo of a public listing, by its upload's id (lists use the small preview).
const photo = part => wrap(async (req, res) => {
  const id = idParam(req.params.fileId);
  const f = id == null ? null : await db('files').where({ id, entity: 'listings' }).first();
  const l = f ? await publicListing(Number(f.entity_id)).catch(() => null) : null;
  const shown = l && (l.photoSet || []).some(p => p.published !== false && String(p.preview || '').startsWith(`files/${id}/`));
  const key = shown && (part === 'preview' ? f.preview_key : f.storage_key);
  if (!key) return res.status(404).json({ error: 'Not found.' });
  res.set({ 'Content-Type': part === 'preview' ? 'image/webp' : f.mime, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  const stream = storage.open(key);
  stream.on('error', err => { console.error('Public photo:', err.message); if (res.headersSent) res.destroy(err); else res.status(404).json({ error: 'Not found.' }); });
  stream.pipe(res);
});
router.get('/photos/:fileId/preview', photo('preview'));
router.get('/photos/:fileId', photo('file'));

// ── What the search picks from ──────────────────────────────────────────────
// Public listings per value of `column`, over the site's filters.
async function countsBy(column, query = {}) {
  const { scope } = await searchFor({ ...query, q: '', sort: '' });
  const b = db('listings').where('listings.status', 'active');
  scope(b);
  return new Map((await b.whereNotNull(column).groupBy(column).select({ k: column }).count({ n: '*' })).map(r => [r.k, Number(r.n)]));
}

router.get('/categories', wrap(async (req, res) => {
  const counts = await countsBy('listings.category', req.query);
  res.set('Cache-Control', 'public, max-age=300');
  res.json(O.CATEGORIES.map(c => {
    const subs = c.subs.map(([id, name]) => ({ id, name, count: counts.get(name) || 0 }));
    for (const [name, n] of counts) if (O.categoryOf(name).id === 0 && O.categoryOf(name).cateId === c.id) subs.push({ id: null, name, count: n });
    return { id: c.id, name: c.name, count: subs.reduce((a, s) => a + s.count, 0), subCategories: subs };
  }));
}));

router.get('/areas', wrap(async (req, res) => {
  const counts = await countsBy('listings.area', { ...req.query, areaIds: '' });
  const areas = counts.size ? await db('areas').where('status', 0).whereIn('name', [...counts.keys()]).orderBy('name').select('id', 'name', 'state') : [];
  res.set('Cache-Control', 'public, max-age=300');
  res.json(areas.map(a => ({ id: a.id, name: a.name, state: a.state || null, count: counts.get(a.name) || 0 })));
}));

router.get('/titles', wrap(async (req, res) => {
  const area = idParam(req.query.areaId);
  const counts = await countsBy('listings.title_id', { ...req.query, titleIds: '', ...(area != null && { areaIds: String(area) }) });
  const titles = counts.size ? await db('titles').where('status', 0).whereIn('id', [...counts.keys()]).orderBy('name').select('id', 'name', 'area') : [];
  res.set('Cache-Control', 'public, max-age=300');
  res.json(titles.map(t => ({ id: t.id, name: t.name, area: t.area || null, count: counts.get(t.id) || 0 })));
}));

// Search suggestions: areas and buildings whose name has what was typed (at most 20).
router.get('/keywords', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  if (q.length < 2) return res.json([]);
  const like = `%${q.replace(/[!%_]/g, c => `!${c}`)}%`;
  const areas = await db('areas').where('status', 0).whereRaw("name like ? escape '!'", [like]).orderBy('name').limit(10).select('id', 'name');
  const titles = await db('titles').where('status', 0).whereRaw("name like ? escape '!'", [like]).orderBy('name').limit(20 - areas.length).select('id', 'name', 'area');
  res.set('Cache-Control', 'public, max-age=300');
  res.json([...areas.map(a => ({ kind: 'area', id: a.id, name: a.name })), ...titles.map(t => ({ kind: 'title', id: t.id, name: t.name, area: t.area || null }))]);
}));

// ── An owner's enquiry ("Advertise as owner"): an Owner request for the office ──
const enquiries = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many enquiries. Try again later.' } });
router.post('/owner-requests', enquiries, wrap(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 100);
  const phone = String(b.phone || '').trim().slice(0, 30);
  const email = String(b.email || '').trim().slice(0, 120);
  if (!name) throw refuse(400, 'Enter your name.');
  if (String(phone).replace(/\D/g, '').length < 7) throw refuse(400, 'Enter a phone number we can reach you on.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw refuse(400, 'This does not look like an e-mail address.');
  const sub = O.CATEGORIES.flatMap(c => c.subs).find(([id]) => id === num(b.subCategoryId));
  let ticket;
  do ticket = Array.from({ length: 10 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
  while (await db('vendor_requests').where('ticket', ticket).first('id'));
  await db('vendor_requests').insert({
    ticket, date: localToday(), name, phone, branch_id: null, category: sub ? sub[1] : '', area: '',
    for_type: b.type === 'rent' ? 'Rent' : 'Sale', price: num(b.price), status: 0, listing_id: null, handled_by: null,
    more: JSON.stringify({ email: email || null, property: String(b.propertyName || '').trim().slice(0, 200) || null, via: 'website' }),
  });
  res.json({ ticket });
}));

// ── An agent's public profile ───────────────────────────────────────────────
async function agentFor(username) {
  const row = await db('staff').where('username', String(username || '')).where('status', 'active').first();
  const [s] = row ? await toRecords(db, MODELS.staff, [row]) : [];
  if (!s || !s.access?.profilePage) throw refuse(404, 'Agent not found.');
  return s;
}

router.get('/agents/:username', wrap(async (req, res) => {
  const s = await agentFor(req.params.username);
  const setup = await loadSetup(db).catch(() => null);
  const upline = s.uplineId ? await db('staff').where('id', s.uplineId).first('username', 'short_name', 'name', 'access') : null;
  const held = db('listings').where('holder_id', s.id).where('draft', false);
  const byArea = await held.clone().whereNotNull('area').groupBy('area').select({ name: 'area' }).count({ n: '*' }).orderBy('n', 'desc').limit(3);
  const byCategory = await held.clone().whereNotNull('category').groupBy('category').select({ name: 'category' }).count({ n: '*' }).orderBy('n', 'desc').limit(3);
  const areaIds = new Map((byArea.length ? await db('areas').whereIn('name', byArea.map(a => a.name)).select('id', 'name') : []).map(a => [a.name, a.id]));
  const user = await db('users').where('staff_id', s.id).first('profile');
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    id: s.id, code: s.code, username: s.username, name: s.short || s.name, phone: s.phone || null, email: s.email || null, sex: s.sex || null,
    bio: s.bio || null, socials: s.socials || {}, awards: s.awards || [], registration: s.regNo ? { type: s.regType || null, number: s.regNo } : (s.renNo ? { type: 'REN', number: s.renNo } : null),
    joinedOn: s.joined || null, position: s.role ? setup?.roles?.find(r => r.code === s.role)?.name || s.role : null,
    photoUrl: parseJson(user?.profile)?.photo ? `${origin(req)}/api/public/agents/${encodeURIComponent(s.username)}/photo` : null,
    upline: upline && parseJson(upline.access)?.profilePage ? { username: upline.username, name: upline.short_name || upline.name } : null,
    topAreas: byArea.map(a => ({ id: areaIds.get(a.name) ?? null, name: a.name, count: Number(a.n) })),
    topCategories: byCategory.map(c => ({ id: O.categoryOf(c.name).id || null, name: c.name, count: Number(c.n) })),
    listings: Number((await held.clone().where('status', 'active').modify(publicScope).count({ n: '*' }).first()).n),
  });
}));

router.get('/agents/:username/photo', wrap(async (req, res) => {
  const s = await agentFor(req.params.username);
  const photo = parseJson((await db('users').where('staff_id', s.id).first('profile'))?.profile)?.photo;
  const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(String(photo || ''));
  if (!m) return res.status(404).json({ error: 'No photo.' });
  res.set({ 'Content-Type': m[1], 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
  res.send(Buffer.from(m[2], 'base64'));
}));

// ── A staff member's saved listings (signed in with the ERP's account) ──────
router.get('/saved', requireAuth, wrap(async (req, res) => {
  const me = req.user.staffId;
  if (me == null) return res.json({ rows: [], total: 0, page: 1, size: 10 });
  const size = Math.min(MAX_SIZE, Number.parseInt(req.query.size, 10) || 10);
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const base = () => db('listings').join('saved_listings', 'saved_listings.listing_id', 'listings.id').where('saved_listings.staff_id', me).where('listings.status', 'active').modify(publicScope);
  const { n } = await base().count({ n: '*' }).first();
  const rows = await toRecords(db, MODELS.listings, await base().orderBy('saved_listings.saved_at', 'desc').limit(size).offset((page - 1) * size).select('listings.*'));
  const ctx = await contextFor(rows);
  res.json({ rows: rows.map(l => listingOf(req, l, ctx)), total: Number(n), page, size });
}));

router.post('/saved/:listingId', requireAuth, wrap(async (req, res) => {
  const me = req.user.staffId;
  if (me == null) throw refuse(400, 'Only people on the staff list keep saved listings.');
  const l = await publicListing(idParam(req.params.listingId));
  const had = await db('saved_listings').where({ staff_id: me, listing_id: l.id }).del();
  if (!had) await db('saved_listings').insert({ staff_id: me, listing_id: l.id });
  res.json({ saved: !had });
}));

module.exports = router;

// The old phone app's API (old-subsaleking-app ≤ 1.3.6 calls https://api.subsaleking.com/v1,
// an address built into each release): the same addresses and replies, answered from the new
// records, so the installed apps keep working when the old database is switched off (point
// api.subsaleking.com at this server; the app then signs in again, as its old tokens mean nothing
// here). Only what the app calls is here (read from its code, 2026-11-08); offers answer "coming
// soon" as before. Who may see or change what is the ERP's own rule: reads go through the same
// lists (the Whole agency, owners hidden where the viewer isn't tied) and saves through the same
// shared actions (db/runAction.js) as the ERP's pages.
//
// Replies: { success: true, status_code: 200, data, pagination? }; refusals:
// { success: false, status_code, error: { type, description } }, with the types the app knows
// (UNAUTHENTICATED and ACCOUNT_DISABLED sign it out; INCOMPATIBLE_APP asks for an update:
// APP_MIN_VERSION_ANDROID / APP_MIN_VERSION_IOS, compared with its client-app-version header).
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const AC = require('../../../shared/access.js');
const L = require('../../../shared/listings.js');
const { UPLOADS } = require('../../../shared/files.js');
const { AGENT_TYPES } = require('../../../shared/lists.js');
const { validatePassword } = require('../../../shared/roles.js');
const { tidyProfile, checkProfile } = require('../../../shared/profile.js');
const { SECRET, AUTH_DISABLED, toReqUser } = require('../middleware/auth');
const { viewerOf } = require('../middleware/access');
const { closedNow, keepsWorking } = require('../middleware/downtime');
const { markActive } = require('../db/activity');
const { checkSignIn, tokenFor } = require('../auth/signIn');
const { LISTS, scopeFor } = require('../db/lists');
const { listPage, rawRows } = require('../db/list');
const { oneRecord, shown, paramsOf } = require('../db/reads');
const { MODELS, toRecords, parseJson } = require('../db/records');
const { inReach } = require('../db/erpGuard');
const { runAction } = require('../db/runAction');
const { audit } = require('../db/audit');
const { localToday } = require('../db/days');
const { countLook } = require('../db/listingDaily');
const FILES = require('../files/files');
const O = require('./old');
const { searchOf, pagination, categoriesOnFile, ids, num, truthy } = require('./search');

const router = express.Router();
const APP_TOKEN = process.env.APP_TOKEN_EXPIRES_IN || '90d';
// The app reads how long its sign-in lasts (token_expires_in, seconds).
const APP_TOKEN_SECONDS = (() => { const m = /^(\d+)\s*([dhm]?)$/.exec(APP_TOKEN); return m ? Number(m[1]) * ({ d: 86400, h: 3600, m: 60, '': 1 })[m[2]] : 90 * 86400; })();
const DEMO_USER = { id: null, username: 'demo', name: 'Demo', role: 'superadmin', branchId: null, staffId: null };

// ── Replies ──────────────────────────────────────────────────────────────────
const ok = (res, data = null, page = null) => res.json({ success: true, status_code: 200, ...(data != null && { ...(page && { pagination: page }), data }) });
const fail = (res, status, type, description) => res.status(status).json({ success: false, status_code: status, error: { type, description } });
const TYPE_OF_STATUS = { 400: 'BAD_REQUEST', 401: 'UNAUTHENTICATED', 403: 'INSUFFICIENT_PRIVILEGES', 404: 'RESOURCE_NOT_FOUND', 413: 'BAD_REQUEST' };
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  if (err.status && err.status < 500) return fail(res, err.status, err.code || TYPE_OF_STATUS[err.status] || 'BAD_REQUEST', err.message);
  console.error(err);
  fail(res, 500, 'SERVER_ERROR', 'An internal error has occurred while processing your request.');
});
const refuse = (status, message, code) => Object.assign(new Error(message), { status, code });
const idParam = v => (/^\d+$/.test(String(v)) ? Number(v) : null);

// ── The app's version: too old to use the new system → "update the app" ─────
const newer = (a, b) => {
  const pa = String(a).split(/[.+]/).map(Number), pb = String(b).split(/[.+]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};
const minVersion = platform => (/ios/i.test(platform) ? process.env.APP_MIN_VERSION_IOS : process.env.APP_MIN_VERSION_ANDROID) || '';
router.use((req, res, next) => {
  const version = req.get('client-app-version');
  const min = minVersion(req.get('client-app-platform') || '');
  if (version && min && newer(min, version)) return fail(res, 403, 'INCOMPATIBLE_APP', 'Incompatible App: please update the SubSaleKing app to keep using it.');
  next();
});

// ── Open: hello, versions, sign in ──────────────────────────────────────────
router.get(['/', ''], (req, res) => ok(res, 'Welcome to SubSaleKing API'));
router.get('/version-info', (req, res) => ok(res, {
  name: 'subsaleking', description: 'API for SubSaleKing APP', version: '1.0',
  android_app: { app_version_min: process.env.APP_MIN_VERSION_ANDROID || '1.0.0', app_version_latest: process.env.APP_LATEST_VERSION_ANDROID || process.env.APP_MIN_VERSION_ANDROID || '1.0.0' },
  ios_app: { app_version_min: process.env.APP_MIN_VERSION_IOS || '1.0.0', app_version_latest: process.env.APP_LATEST_VERSION_IOS || process.env.APP_MIN_VERSION_IOS || '1.0.0' },
}));

// The person's own picture of themselves: their staff record, with what they changed in My profile on top.
async function profileOf(u) {
  const staff = u.staff_id ? (await toRecords(db, MODELS.staff, await db('staff').where('id', u.staff_id)))[0] : null;
  const mine = parseJson(u.profile) || {};
  const s = { id: staff?.id ?? 0, code: staff?.code, short: u.name || staff?.short, name: mine.icName || staff?.name || u.name, ic: staff?.ic,
    phone: mine.phone || staff?.phone, email: mine.email || staff?.email, address: mine.address || staff?.address, access: staff?.access };
  const roles = [staff?.type || (u.role === 'superadmin' ? 'admin' : u.role)];
  if (staff && (await db('staff').where('upline_id', staff.id).first('id'))) roles.push('sale-staff-upline');
  return O.userOf(s, { own: true, username: u.username, roles, accessLevel: O.ACCESS_LEVEL[staff?.role] || 1 });
}

// As the ERP's own sign-in: 30 tries per 15 minutes from one address.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => fail(res, 429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Try again in a few minutes.') });

router.all('/login', loginLimiter, express.json(), wrap(async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) throw refuse(405, 'Method not allowed.', 'NOT_ALLOWED');
  const b = { ...req.query, ...(req.body || {}) };
  const u = await checkSignIn(db, b.username, b.password);
  const p = await profileOf(u);
  await audit({ user: toReqUser(u) }, { action: 'sign_in', entity: 'user', entityId: u.id, detail: { via: 'phone app', version: req.get('client-app-version') || null } });
  ok(res, { id: p.user_id, hq_id: 0, username: u.username, name_card_name: p.name_card_name, fullname: p.ic_name, token: tokenFor(u, APP_TOKEN),
    token_type: 'Bearer', token_expires_in: APP_TOKEN_SECONDS, roles: p.roles, access_level: p.access_level });
}));

// ── Signed in from here: the account as it stands now, only Active people ───
router.use(async (req, res, next) => {
  try {
    if (AUTH_DISABLED) { req.user = DEMO_USER; return next(); }
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    let payload = null;
    try { payload = token && jwt.verify(token, SECRET); } catch { payload = null; }
    if (!payload) return fail(res, 401, 'UNAUTHENTICATED', 'Please sign in again.');
    const u = await db('users').where('id', payload.id).first();
    if (!u || Number(u.token_version) !== Number(payload.v)) return fail(res, 401, 'UNAUTHENTICATED', 'Please sign in again.');
    const staff = u.staff_id ? await db('staff').where('id', u.staff_id).first('type', 'branch_id', 'status') : null;
    if (!u.is_active || u.locked || (staff && staff.status !== 'active')) return fail(res, 401, 'ACCOUNT_DISABLED', 'This account has been disabled');
    req.user = toReqUser(u, staff);
    req.account = u;
    markActive(db, u.staff_id).catch(err => console.error('Last activity:', err.message));
    // Planned maintenance closes the app too (the technical team and the Superadmin keep working).
    const w = await closedNow();
    if (w && !(await keepsWorking(req.user))) return fail(res, 503, 'MAINTENANCE', `SubSaleKing is closed for planned maintenance until ${w.end}. ${w.message || ''}`.trim());
    next();
  } catch (err) { next(err); }
});
// Bodies are small, except photos sent inside the request (their own route reads up to 60 MB).
const smallJson = express.json({ limit: '1mb' });
router.use((req, res, next) => (/\/images\/upload$/.test(req.path) ? next() : smallJson(req, res, next)));

// ── The person ──────────────────────────────────────────────────────────────
router.get(['/user', '/user/', '/user/profile'], wrap(async (req, res) => ok(res, await profileOf(req.account || {}))));

// Profile changes go to My profile (the ERP's own page shows them too); the staff record stays the office's.
router.all('/user/profile', wrap(async (req, res) => {
  if (!['POST', 'PUT'].includes(req.method)) throw refuse(405, 'Method not allowed.', 'NOT_ALLOWED');
  const u = req.account;
  if (!u) throw refuse(400, 'Sign-in is off on this server.');
  const was = tidyProfile({ ...(parseJson(u.profile) || {}), name: u.name });
  const b = req.body || {};
  const next = { ...was, icName: b.fullname ?? was.icName, phone: b.phone ?? was.phone, email: b.email ?? was.email, address: b.address ?? was.address };
  const problems = Object.values(checkProfile(next));
  if (problems.length) throw refuse(400, problems[0], 'VALIDATION_ERROR');
  const { name, ...rest } = tidyProfile(next);
  await db('users').where('id', u.id).update({ profile: JSON.stringify(rest), profile_saved_at: db.fn.now() });
  await audit(req, { action: 'update_profile', entity: 'user', entityId: u.id, detail: { via: 'phone app', filled: Object.keys(rest).filter(k => rest[k]) } });
  ok(res);
}));

// A new password signs out the person's other sessions (and this one: the app asks them to sign in again).
router.all('/user/password', wrap(async (req, res) => {
  if (!['POST', 'PUT'].includes(req.method)) throw refuse(405, 'Method not allowed.', 'NOT_ALLOWED');
  const u = req.account;
  if (!u) throw refuse(400, 'Sign-in is off on this server.');
  if (!(await bcrypt.compare(String(req.body?.current_password || ''), u.password_hash || ''))) throw refuse(400, 'Current Password is incorrect');
  const why = validatePassword(req.body?.new_password);
  if (why) throw refuse(400, why, 'VALIDATION_ERROR');
  await db('users').where('id', u.id).update({ password_hash: await bcrypt.hash(req.body.new_password, 12), token_version: Number(u.token_version) + 1, password_changed_at: db.fn.now() });
  await audit(req, { action: 'change_password', entity: 'user', entityId: u.id, detail: { via: 'phone app' } });
  ok(res, true);
}));

// The phone's push-notification token (kept for when push is set up).
router.all('/user/device', wrap(async (req, res) => {
  if (!['POST', 'PUT'].includes(req.method)) throw refuse(405, 'Method not allowed.', 'NOT_ALLOWED');
  const token = String(req.body?.fcm_token || '').trim().slice(0, 255);
  const platform = String(req.body?.device_platform || '').trim().toLowerCase().slice(0, 20);
  if (!token || !platform) throw refuse(400, 'Failed to save user device');
  if (!req.user.id) return ok(res, true);
  await db.transaction(async trx => {
    await trx('app_devices').where('fcm_token', token).whereNot('user_id', req.user.id).del();
    const row = { platform, fcm_token: token, app_version: (req.get('client-app-version') || '').slice(0, 20) || null, updated_at: trx.fn.now() };
    const had = await trx('app_devices').where('user_id', req.user.id).first('id');
    if (had) await trx('app_devices').where('id', had.id).update(row);
    else await trx('app_devices').insert({ user_id: req.user.id, ...row });
  });
  ok(res, true);
}));

// The old team banner came from the branch's own "B.M" account; branches are records of their own now.
router.get('/user/team-sale-staff', (req, res) => ok(res));

// ── Notifications: the person's own notices ─────────────────────────────────
const noticeKey = v => v.staffId ?? 0;
router.get('/user/notification/list', wrap(async (req, res) => {
  const v = await viewerOf(req);
  const spec = LISTS.notices;
  const cat = O.CAT_OF[String(req.query.category || 'all')];
  const params = { size: Math.min(200, Number.parseInt(req.query.per_page, 10) || 20), page: Number.parseInt(req.query.page, 10) || 1, counts: '0',
    ...(cat && { cat: cat.length ? cat.join(',') : 'none' }) };
  const out = await listPage(db, spec, params, b => { scopeFor(spec, v)(b); if (String(req.query.category) === 'other') b.whereNotIn('notices.cat', ['good', 'bad', 'listing']); });
  const rows = await shown(spec, v, out.rows);
  ok(res, rows.map(n => O.noticeOf(n, noticeKey(v))), pagination(out, rows.length));
}));

router.get('/user/notification/count/unread', wrap(async (req, res) => {
  const v = await viewerOf(req);
  const spec = LISTS.notices;
  const out = await listPage(db, spec, paramsOf(spec, v, { size: 1, unread: '0', counts: 'cat' }), scopeFor(spec, v));
  const by = out.counts.cat || {};
  const all = Object.values(by).reduce((a, b) => a + b, 0);
  ok(res, { counts: all, all, good_news: by.good || 0, bad_news: by.bad || 0, listing: by.listing || 0, off_listing: 0 });
}));

router.all('/user/notification/:id/read', wrap(async (req, res) => {
  const id = idParam(req.params.id);
  if (id == null) throw refuse(400, 'Failed!');
  await runAction(req, 'readNotices', [[id]]);
  ok(res, true);
}));

// ── Favourites ──────────────────────────────────────────────────────────────
async function favouritesOf(v) {
  const row = await db('favourites').where('viewer_id', noticeKey(v)).first();
  return { listings: new Set(parseJson(row?.listings) || []), titles: new Set(parseJson(row?.titles) || []) };
}
for (const [path, kind] of [['listings', 'listings'], ['titles', 'titles']]) {
  router.all(`/user/favourite/property/${path}/:id`, wrap(async (req, res) => {
    if (!['POST', 'DELETE'].includes(req.method)) throw refuse(405, 'Method not allowed.', 'NOT_ALLOWED');
    const id = idParam(req.params.id);
    const v = await viewerOf(req);
    if (id == null || !(await db(kind).where('id', id).first('id'))) throw refuse(404, 'Not found.');
    const has = (await favouritesOf(v))[kind].has(id);
    if (has !== (req.method === 'POST')) await runAction(req, 'toggleFavourite', [kind, id]);
    ok(res, true);
  }));
}

// ── Listings ────────────────────────────────────────────────────────────────
const AGENCY = LISTS.agency;
const origin = req => process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`;

// What a page of listings needs besides themselves: the people's names and phones, the buildings' leads,
// the holders' uplines (who is tied as a leader), the viewer's favourites, the areas' ids.
async function contextFor(req, v, rows) {
  const titleIds = [...new Set(rows.map(l => l.titleId).filter(x => x != null))];
  const titles = new Map((titleIds.length ? await toRecords(db, MODELS.titles, await db('titles').whereIn('id', titleIds)) : []).map(t => [t.id, t]));
  const holders = [...new Set(rows.map(l => l.holderId).filter(x => x != null))];
  const chain = holders.length ? rawRows(await db.raw(
    `with recursive up(id) as (select id from staff where id in (${holders.map(() => '?').join(', ')}) union select s.upline_id from staff s join up on s.id = up.id where s.upline_id is not null)
     select staff.id, staff.upline_id from staff join up on staff.id = up.id`, holders)) : [];
  const uplineOf = new Map(chain.map(r => [r.id, r.upline_id]));
  const people = new Set();
  for (const l of rows) {
    for (const id of [l.creatorId, l.holderId, l.branchManagerId, l.areaManagerId, l.share?.pmId]) if (id != null) people.add(id);
    const t = titles.get(l.titleId);
    if (t?.managerId != null) people.add(t.managerId);
    if (t?.handlerId != null) people.add(t.handlerId);
  }
  const staff = people.size ? await db('staff').whereIn('id', [...people]).select('id', 'short_name', 'name', 'phone', 'access') : [];
  const areaNames = [...new Set(rows.map(l => l.area).filter(Boolean))];
  const areas = areaNames.length ? await db('areas').whereIn('name', areaNames).select('id', 'name') : [];
  const office = !AGENT_TYPES.includes(AC.roleOf(v.role)?.type) && AC.allows(v.policy, v.role, 'listings', 'edit');
  const leadersOf = holderId => { const out = []; for (let up = uplineOf.get(holderId), seen = new Set(); up != null && !seen.has(up); up = uplineOf.get(up)) { seen.add(up); out.push(up); } return out; };
  const scopeIn = l => v.scope === 'all' || (v.scope === 'branch' ? l.branchId === v.branchId : (v.team || []).includes(l.holderId) || (v.team || []).includes(l.creatorId));
  return {
    titles, favourites: (await favouritesOf(v)).listings, areaIds: new Map(areas.map(a => [a.name, a.id])),
    names: new Map(staff.map(s => [s.id, s.short_name || s.name])), phones: new Map(staff.map(s => [s.id, s.phone])),
    rolesOf: l => L.listingRoles(l, v.staffId, { title: titles.get(l.titleId), leaders: leadersOf(l.holderId) }),
    // What of the owner the viewer sees (the page's useOwnerSight): the handler and creator in full; others tied
    // to it and the office's listing editors on asking (logged); everyone else, nothing.
    sightOf: (l, roles) => (roles.includes('holder') || roles.includes('creator') ? 'full' : roles.length || office ? 'ask' : 'none'),
    inReach: scopeIn,
    // An upload: a signed link (its small preview in lists); a photo brought over from the old ERP: its address on the
    // old file server, as the app always showed it (until the files are copied).
    photoUrl: (p, part = 'preview') => {
      const id = /^files\/(\d+)\//.exec(String(p.preview || ''))?.[1];
      return id ? `${origin(req)}${FILES.signedUrl(Number(id), part === 'file' ? 'file' : 'preview')}` : p.url || null;
    },
  };
}
const shapeAll = (ctx, rows, { details = false } = {}) => rows.map(l => {
  const roles = ctx.rolesOf(l);
  return O.listingOf(l, { ...ctx, roles, sight: details === 'reveal' ? 'full' : ctx.sightOf(l, roles), inReach: ctx.inReach(l), details: !!details });
});

// The category names on file (a type the old app's list never had goes by its group).
// Only read when the search picks a category.
const categoriesFor = p => (p.property_category || p.property_category_id_list ? categoriesOnFile(db) : []);
const areaNamesById = async list => new Map((list.length ? await db('areas').whereIn('id', list).select('id', 'name') : []).map(a => [a.id, a.name]));

router.all('/property/search', wrap(async (req, res) => {
  const v = await viewerOf(req);
  const p = { ...req.query, ...(req.body || {}) };
  const { params, extra } = searchOf(p, v.staffId, { categories: await categoriesFor(p), areaNames: await areaNamesById(ids(p.property_area_id_list)) });
  const out = await listPage(db, AGENCY, paramsOf(AGENCY, v, { ...params, counts: '0' }), b => { scopeFor(AGENCY, v)(b); extra(b); });
  const rows = await shown(AGENCY, v, out.rows);
  ok(res, shapeAll(await contextFor(req, v, rows), rows), pagination(out, rows.length));
}));

// One listing the viewer may see (their reach, or any active one), as the Whole agency shows it.
async function listingFor(req, id) {
  const v = await viewerOf(req);
  const rec = id == null ? null : await oneRecord(AGENCY, v, id);
  if (!rec) throw refuse(404, 'Listing not found.');
  return { v, l: (await shown(AGENCY, v, [rec]))[0] };
}

router.get('/property/:id/details', wrap(async (req, res) => {
  const { v, l } = await listingFor(req, idParam(req.params.id));
  const ctx = await contextFor(req, v, [l]);
  const roles = ctx.rolesOf(l);
  let reveal = false;
  // Opening a listing's details in the app is pressing Show: logged, once a day per person.
  if (ctx.sightOf(l, roles) === 'ask') {
    const today = localToday();
    const me = noticeKey(v);
    const seen = (l.ownerViews || []).some(x => x.by === me && String(x.at).startsWith(today));
    // If the look can't be logged (the ERP refuses saves until it is set up), the owner stays hidden.
    reveal = seen || await runAction(req, 'revealOwner', [l.id]).then(() => true, err => { if (err.status && err.status < 500) return false; throw err; });
  }
  ok(res, shapeAll(ctx, [l], { details: reveal ? 'reveal' : true })[0]);
}));

router.get('/property/:id/views-clicks-count', wrap(async (req, res) => {
  const { l } = await listingFor(req, idParam(req.params.id));
  const clicks = await db('listing_daily').where('listing_id', l.id).sum({ web: 'clicks_web', app: 'clicks_app' }).first();
  ok(res, { property_details_views_count_web: l.views || 0, property_listitem_clicks_count_web: Number(clicks?.web) || 0,
    property_details_views_count_app: l.viewsApp || 0, property_listitem_clicks_count_app: Number(clicks?.app) || 0 });
}));

// Opening a listing in the app, or tapping it in a list, counts for that day (db/listingDaily.js).
router.post('/property/:id/details-views-count', wrap(async (req, res) => {
  const { l } = await listingFor(req, idParam(req.params.id));
  await countLook(db, l.id, { via: 'app', kind: 'view' });
  ok(res, true);
}));
router.post('/property/:id/listitem-clicks-count', wrap(async (req, res) => {
  const { l } = await listingFor(req, idParam(req.params.id));
  await countLook(db, l.id, { via: 'app', kind: 'click' });
  ok(res, true);
}));

// Changes run the ERP's own action on the listing (its access rule and reach checks).
const update = (req, id, fields) => runAction(req, 'updateListing', [id, fields]);

router.all('/property/:id/details/update', wrap(async (req, res) => {
  if (!['POST', 'PUT'].includes(req.method)) throw refuse(405, 'Method not allowed.', 'NOT_ALLOWED');
  const { l } = await listingFor(req, idParam(req.params.id));
  const b = req.body || {};
  const f = {};
  const text = (k, to) => { if (b[k] !== undefined) f[to] = String(b[k] ?? '').trim(); };
  text('property_desc', 'description');
  text('property_marketing_remarks', 'marketingRemarks');
  text('property_unit', 'unit');
  text('renovation', 'renovation');
  const n = (k, to) => { if (b[k] !== undefined) f[to] = b[k] === '' || b[k] == null ? null : num(b[k]); };
  n('property_price', 'bestPrice');
  n('property_price_asking', 'askPrice');
  n('property_price_extra', 'marketValue');
  n('built_up_size', 'builtUp');
  n('bedroom', 'beds');
  n('bathroom', 'baths');
  if (b.furnishing !== undefined) f.furnishing = O.FURNISH_OF[b.furnishing] || String(b.furnishing || '');
  if (b.tenure !== undefined) f.tenure = O.TENURE_OF[String(b.tenure || '').toUpperCase()] || String(b.tenure || '');
  const flags = new Set(l.flags || []);
  let flagged = false;
  for (const [k, flag] of Object.entries(O.FLAG_FIELD)) {
    if (b[k] === undefined) continue;
    flagged = true;
    if (truthy(b[k])) flags.add(flag); else flags.delete(flag);
  }
  if (flagged) f.flags = [...flags];
  await update(req, l.id, f);
  ok(res, true);
}));

router.all('/property/:id/listing-tracking', wrap(async (req, res) => {
  if (!['POST', 'PUT'].includes(req.method)) throw refuse(405, 'Method not allowed.', 'NOT_ALLOWED');
  const { l } = await listingFor(req, idParam(req.params.id));
  const status = O.STATUS_OF[num(req.body?.tracking_id)];
  if (!status) throw refuse(400, 'Pick the listing tracking.');
  await update(req, l.id, { status, ...(req.body?.tracking_price != null && { trackingPrice: num(req.body.tracking_price) }) });
  ok(res, true);
}));

// ── Photos (the album): kept as uploads, shown from signed links ────────────
router.get('/property/:id/images/list', wrap(async (req, res) => {
  const { v, l } = await listingFor(req, idParam(req.params.id));
  const ctx = await contextFor(req, v, [l]);
  ok(res, (l.photoSet || []).filter(p => p.published !== false).map(p => O.imageOf(p, ctx)));
}));

router.all('/property/:id/images/upload', express.json({ limit: '60mb' }), wrap(async (req, res) => {
  if (!['POST', 'PUT'].includes(req.method)) throw refuse(405, 'Method not allowed.', 'NOT_ALLOWED');
  const { v, l } = await listingFor(req, idParam(req.params.id));
  const images = Array.isArray(req.body?.images) ? req.body.images : [];
  if (!images.length) throw refuse(400, 'Pick the photos to upload.');
  const had = l.photoSet || [];
  if (had.length + images.length > UPLOADS.photo.maxFiles) throw refuse(400, `A listing holds up to ${UPLOADS.photo.maxFiles} photos. Delete some before adding more.`);
  // Checked before anything is kept: the person may change this listing.
  const why = AC.refusal(v.policy, v.role, 'updateListing');
  if (why) throw refuse(403, why);
  if (v.scope !== 'all' && !(await inReach(db, 'listings', [l.id], v)).has(l.id)) throw refuse(403, 'This listing is not one you can change.');
  let next = Math.max(0, ...had.map(p => Number(p.id) || 0)) + 1;
  const added = [];
  for (const img of images) {
    const buffer = Buffer.from(String(img?.encoded || ''), 'base64');
    const saved = await FILES.saveBuffer(db, req.user, { kind: 'photo', name: img?.filename || `photo-${next}.jpg`, buffer });
    added.push({ id: next++, name: saved.name, published: true, cover: false, preview: saved.ref });
  }
  if (!had.some(p => p.cover) && added.length) added[0].cover = true;
  await update(req, l.id, { photoSet: [...had, ...added] });
  const ctx = await contextFor(req, v, [l]);
  ok(res, added.map(p => O.imageOf(p, ctx)));
}));

router.delete('/property/:id/images', wrap(async (req, res) => {
  const { l } = await listingFor(req, idParam(req.params.id));
  const gone = new Set((Array.isArray(req.body?.image_ids) ? req.body.image_ids : []).map(Number));
  if (!gone.size) throw refuse(400, 'Pick the photos to delete.');
  const left = (l.photoSet || []).filter(p => !gone.has(Number(p.id)));
  if (left.length && !left.some(p => p.cover)) left[0] = { ...left[0], cover: true };
  await update(req, l.id, { photoSet: left });
  ok(res, true);
}));

router.all('/property/:id/images/:imageId/cover', wrap(async (req, res) => {
  if (!['POST', 'PUT'].includes(req.method)) throw refuse(405, 'Method not allowed.', 'NOT_ALLOWED');
  const { l } = await listingFor(req, idParam(req.params.id));
  const id = idParam(req.params.imageId);
  if (!(l.photoSet || []).some(p => Number(p.id) === id)) throw refuse(404, 'Photo not found.');
  await update(req, l.id, { photoSet: l.photoSet.map(p => ({ ...p, cover: Number(p.id) === id })) });
  ok(res, true);
}));

// ── Follow-ups ──────────────────────────────────────────────────────────────
router.get('/property/:id/follow-up/list', wrap(async (req, res) => {
  const { l } = await listingFor(req, idParam(req.params.id));
  const by = [...new Set((l.followUps || []).map(f => f.by).filter(x => x != null))];
  const names = new Map((by.length ? await db('staff').whereIn('id', by).select('id', 'short_name', 'name') : []).map(s => [s.id, s.short_name || s.name]));
  ok(res, (l.followUps || []).map((f, i) => O.followUpOf(f, i, l, names)));
}));

router.post('/property/:id/follow-up/add', wrap(async (req, res) => {
  const { l } = await listingFor(req, idParam(req.params.id));
  const v = await viewerOf(req);
  await runAction(req, 'addListingFollowUp', [l.id, { action: String(num(req.body?.action_id) ?? ''), remark: String(req.body?.remarks || '').trim(), by: v.staffId }]);
  ok(res, true);
}));

// ── Sharing: the Main Product Handler and the co-product handler slots ──────
const SLOTS = L.LISTING_RULES.coPhSlots;
async function mayShare(req, v, l) {
  if (AC.refusal(v.policy, v.role, 'updateListing')) return false;
  return v.scope === 'all' || (await inReach(db, 'listings', [l.id], v)).has(l.id);
}
router.get('/property/share-product-handler/permissions', wrap(async (req, res) => {
  const { v, l } = await listingFor(req, idParam(req.query.property_id));
  const all = await mayShare(req, v, l);
  ok(res, all ? { share_bm: 'view_only', share_main_ph: 'all', share_co_ph: 'all', share_ph: (l.share?.coPh || []).some(c => c.locked) ? 'view_only' : 'all' }
    : { share_ph: 'view_only' });
}));

router.get('/property/share-product-handler/choices', wrap(async (req, res) => {
  const { l } = await listingFor(req, idParam(req.query.property_id));
  const taken = new Set(String(req.query.type) === 'co_ph' ? (l.share?.coPh || []).map(c => c.staffId) : []);
  const people = await db('staff').where('status', 'active').whereIn('type', AGENT_TYPES).orderBy('short_name').select('id', 'code', 'username', 'short_name', 'name');
  ok(res, people.filter(s => !taken.has(s.id)).map(s => O.userOf({ id: s.id, code: s.code, username: s.username, short: s.short_name, name: s.name })));
}));

router.get('/property/share-product-handler/records', wrap(async (req, res) => {
  const { l } = await listingFor(req, idParam(req.query.property_id));
  const type = req.query.type ? String(req.query.type) : null;
  const slot = num(req.query.slot_no);
  const share = l.share || {};
  const rows = [
    ...(share.pmId != null ? [{ type: 'main_ph', slot_no: 1, staffId: share.pmId, until: null, from: null }] : []),
    ...(share.coPh || []).map((c, i) => ({ type: 'co_ph', slot_no: i + 1, staffId: c.staffId, until: c.until, from: c.from, locked: c.locked })),
  ].filter(r => (!type || r.type === type) && (slot == null || r.slot_no === slot));
  const names = new Map((rows.length ? await db('staff').whereIn('id', rows.map(r => r.staffId)).select('id', 'username', 'short_name', 'name', 'status') : []).map(s => [s.id, s]));
  ok(res, rows.map((r, i) => {
    const s = names.get(r.staffId) || {};
    return { id: i + 1, property_id: l.id, 'staff.user_id': r.staffId, 'staff.user_name': s.username || '', 'staff.name_card_name': s.short_name || s.name || '',
      'staff.ic_name': s.name || '', 'staff.status': s.status === 'active' ? 1 : 0, type: r.type, slot_no: r.slot_no, status_id: r.locked ? 2 : 1,
      valid_until: r.until ? `${r.until} 23:59:59` : null, last_modified_by: null, last_modified_at: null, created_by: null, created_at: r.from ? `${r.from} 00:00:00` : null };
  }));
}));

// "7 days", "1 month"… from today.
function validUntil(text) {
  const m = /(\d+)\s*(day|week|month|year)/i.exec(String(text || ''));
  if (!m) return null;
  const d = new Date(`${localToday()}T00:00:00Z`);
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'day') d.setUTCDate(d.getUTCDate() + n);
  if (unit === 'week') d.setUTCDate(d.getUTCDate() + 7 * n);
  if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + n);
  if (unit === 'year') d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}

router.post('/property/share-product-handler/add', wrap(async (req, res) => {
  const b = req.body || {};
  const { l } = await listingFor(req, idParam(b.property_id));
  const staffId = num(b.staff_id);
  if (staffId == null) throw refuse(400, 'Staff Id is required.');
  const share = { users: l.share?.users || [], pmId: l.share?.pmId ?? null, coPh: [...(l.share?.coPh || [])] };
  if (b.type === 'main_ph') share.pmId = staffId;
  else if (b.type === 'co_ph') {
    const slot = num(b.slot_no) || 1;
    if (slot < 1 || slot > SLOTS) throw refuse(400, `A listing has ${SLOTS} co-product handler slots.`);
    const slots = Array.from({ length: SLOTS }, (_, i) => share.coPh[i] || null);
    slots[slot - 1] = { staffId, until: validUntil(b.valid_for), locked: false, from: localToday() };
    share.coPh = slots.filter(Boolean);
  } else throw refuse(400, 'Pick Main Product Handler or Co-Product Handler.');
  await update(req, l.id, { share });
  ok(res, true);
}));

// ── Lists the app picks from ────────────────────────────────────────────────
// Active listings per building, area or category name, over the app's search filters (type, price, category, state, area).
async function activeCounts(req, v, column, p = {}) {
  const { params, extra } = searchOf({ ...p, keywords: '', sort: '' }, v.staffId, { categories: await categoriesFor(p), areaNames: await areaNamesById(ids(p.property_area_id_list)) });
  const b = db('listings').where('listings.status', 'active').where('listings.draft', false);
  if (params.type) b.where('listings.type', params.type);
  if (params.priceFrom) b.where('listings.ask_price', '>=', Number(params.priceFrom));
  if (params.priceTo) b.where('listings.ask_price', '<=', Number(params.priceTo));
  extra(b);
  return new Map((await b.whereNotNull(column).groupBy(column).select({ k: column }).count({ n: '*' })).map(r => [r.k, Number(r.n)]));
}

router.get('/property/keywords/list', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const areas = db('areas').where('status', 0).modify(b => q && b.where('name', 'like', `%${q}%`)).distinct('name').orderBy('name');
  const titles = db('titles').where('status', 0).modify(b => q && b.where(w => w.where('name', 'like', `%${q}%`).orWhere('area', 'like', `%${q}%`))).select('name', 'area').groupBy('name', 'area').orderBy('name');
  const all = [...(await areas).map(a => ({ name: a.name, area: null })), ...(await titles).map(t => ({ name: t.name, area: t.area || null }))];
  const size = Math.min(50000, Math.max(1, Number.parseInt(req.query.per_page, 10) || 10));
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const rows = all.slice((page - 1) * size, page * size);
  ok(res, rows, pagination({ page, size, total: all.length }, rows.length));
}));

const titleRow = (t, counts) => ({ id: t.id, name: t.name, property_count: counts.get(t.id) || 0 });
async function titlesWhere(req, where) {
  const v = await viewerOf(req);
  const b = db('titles').where('titles.status', 0).orderBy('titles.name').select('titles.id', 'titles.name');
  where(b);
  if (truthy(req.query.is_user_favourite)) b.whereIn('titles.id', [...(await favouritesOf(v)).titles]);
  const rows = await b;
  return rows.map(t => titleRow(t, new Map()));
}
router.get('/property/title/list', wrap(async (req, res) => {
  const counts = await activeCounts(req, await viewerOf(req), 'listings.title_id');
  ok(res, (await titlesWhere(req, () => {})).map(t => ({ ...t, property_count: counts.get(t.id) || 0 })));
}));
router.get('/property/area/:id/title/list', wrap(async (req, res) => {
  const area = await db('areas').where('id', idParam(req.params.id) ?? 0).first('name');
  if (!area) return ok(res, []);
  const counts = await activeCounts(req, await viewerOf(req), 'listings.title_id');
  ok(res, (await titlesWhere(req, b => b.where('titles.area', area.name))).map(t => ({ ...t, property_count: counts.get(t.id) || 0 })));
}));

// The old categories with their sub-types and how many active listings each has (a new type falls in by its group).
async function categoryList(req, p = {}) {
  const counts = await activeCounts(req, await viewerOf(req), 'listings.category', p);
  return O.CATEGORIES.map(c => {
    const subs = c.subs.map(([id, name]) => ({ id, name, property_count: counts.get(name) || 0 }));
    for (const [name, n] of counts) if (O.categoryOf(name).id === 0 && O.categoryOf(name).cateId === c.id) subs.push({ id: 0, name, property_count: n });
    return { id: c.id, name: c.name, property_count: subs.reduce((a, s) => a + s.property_count, 0), category_subs: subs };
  });
}
router.get('/property/category/list', wrap(async (req, res) => ok(res, await categoryList(req))));

router.all('/property/filter/area/list', wrap(async (req, res) => {
  const p = { ...req.query, ...(req.body || {}) };
  const counts = await activeCounts(req, await viewerOf(req), 'listings.area', { ...p, property_area_id_list: '' });
  const areas = await db('areas').where('status', 0).whereIn('name', [...counts.keys()]).select('id', 'name');
  const rows = areas.map(a => ({ area_id: a.id, area_name: a.name, area_property_count: counts.get(a.name) || 0 }));
  rows.sort(p.sort === 'highest-property-count' ? (a, b) => b.area_property_count - a.area_property_count || a.area_name.localeCompare(b.area_name) : (a, b) => a.area_name.localeCompare(b.area_name));
  ok(res, rows);
}));

router.all('/property/filter/places/list', wrap(async (req, res) => {
  const p = { ...req.query, ...(req.body || {}) };
  const counts = await activeCounts(req, await viewerOf(req), 'listings.title_id', { ...p, property_place_id_list: '' });
  const titles = counts.size ? await db('titles').whereIn('id', [...counts.keys()]).orderBy('name').select('id', 'name') : [];
  ok(res, titles.map(t => ({ id: t.id, name: t.name, property_count: counts.get(t.id) || 0 })));
}));

router.all('/property/filter/category-places/list', wrap(async (req, res) => {
  const p = { ...req.query, ...(req.body || {}) };
  const v = await viewerOf(req);
  const out = [];
  const titles = new Map();
  for (const c of O.CATEGORIES) {
    if (ids(p.property_category_id_list).length && !ids(p.property_category_id_list).includes(c.id)) continue;
    const counts = await activeCounts(req, v, 'listings.title_id', { ...p, property_category_id_list: String(c.id), property_category: '', property_place_id_list: '' });
    const missing = [...counts.keys()].filter(id => !titles.has(id));
    if (missing.length) for (const t of await db('titles').whereIn('id', missing).select('id', 'name')) titles.set(t.id, t.name);
    out.push({ id: c.id, name: c.name, places: [...counts].map(([id, n]) => ({ id, name: titles.get(id) || '', property_count: n })).sort((a, b) => a.name.localeCompare(b.name)) });
  }
  ok(res, out);
}));

// ── An owner's enquiry from the app's Owners' guide: kept as an Owner request for the branch ──
router.post('/property/enquiry', wrap(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 100);
  const phone = String(b.contact_no || '').trim().slice(0, 30);
  if (!name || !phone) throw refuse(400, 'Enter the name and contact number.');
  const v = await viewerOf(req);
  let ticket;
  do ticket = Array.from({ length: 10 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
  while (await db('vendor_requests').where('ticket', ticket).first('id'));
  const [id] = await db('vendor_requests').insert({
    ticket, date: localToday(), name, phone, branch_id: v.branchId ?? null, category: String(b.property_category || '').trim().slice(0, 40),
    area: String(b.property_location || '').trim().slice(0, 100), for_type: /rent/i.test(String(b.inquiry_type || '')) ? 'Rent' : 'Sale', price: null,
    status: 0, listing_id: null, handled_by: null,
    more: JSON.stringify({ property: String(b.property_name || '').trim().slice(0, 200) || null, via: 'phone app', by: v.staffId ?? null }),
  });
  await audit(req, { action: 'owner_request', entity: 'vendor_requests', entityId: id, detail: { via: 'phone app' } });
  ok(res, 'Email sent');
}));

// ── Offers: switched off in the old app's server too ────────────────────────
router.all(['/offers', '/offers/:id', '/offers/:id/accept', '/offers/:id/delete'], (req, res) => fail(res, 400, 'COMING_SOON', 'This feature will be available soon'));

router.use((req, res) => fail(res, 404, 'RESOURCE_NOT_FOUND', 'Not found.'));
router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.too.large') return fail(res, 413, 'BAD_REQUEST', 'That is too much to send at once. Send fewer photos at a time.');
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'BAD_REQUEST', 'Malformed JSON input.');
  console.error(err);
  fail(res, 500, 'SERVER_ERROR', 'An internal error has occurred while processing your request.');
});

module.exports = router;

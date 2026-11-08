// The old phone app's addresses (appV1/): played as the app plays them, with
// its headers and the fields its code reads, against the new records. Who may
// see and change what must be the ERP's own rule (the same list and actions).
process.env.AUTH_DISABLED = 'false';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const { db, migrate, startApi } = require('./helpers');
const { seedDemo } = require('../src/db/demoSeed');
const { MODELS, toRecords } = require('../src/db/records');
const AC = require('../../shared/access.js');

let api, data, v1, agent, mine, outsider;
const PASSWORD = 'correct horse battery';
const HEADERS = { 'client-app-platform': 'android', 'client-app-id': 'com.subsaleking.app', 'client-app-version': '1.3.6' };

const app = token => async (method, path, body, headers = {}) => {
  const r = await fetch(`${v1}${path}`, { method, headers: { 'Content-Type': 'application/json', accept: 'application/json', ...HEADERS, ...headers, ...(token && { Authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const anon = app(null);
const listing = async id => (await toRecords(db, MODELS.listings, await db('listings').where('id', id)))[0];
async function account(username, staffId, role = 'staff') {
  await db('users').insert({ username, name: username, role, branch_id: null, staff_id: staffId, password_hash: await bcrypt.hash(PASSWORD, 4) });
  const r = await anon('POST', '/login', { username, password: PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return app(r.body.data.token);
}

before(async () => {
  await migrate();
  data = (await seedDemo({ asOf: '2026-10-28' })).data;
  api = await startApi();
  v1 = api.base.replace(/\/api$/, '/v1');
  // An agent who holds active listings, and one with nothing to do with them.
  agent = data.staff.find(s => s.type === 'staff' && s.status === 'active' && data.listings.filter(l => l.holderId === s.id && l.status === 'active').length >= 2);
  const team = AC.teamOf(agent.id, data.staff);
  outsider = data.staff.find(s => s.type === 'staff' && s.status === 'active' && !team.has(s.id) && !AC.teamOf(s.id, data.staff).has(agent.id));
  mine = await account('agent-app', agent.id);
});
after(async () => { await api.close(); await db.destroy(); });

test('open addresses, the envelope, and refusals the app understands', async () => {
  const hello = await anon('GET', '/');
  assert.deepEqual(hello.body, { success: true, status_code: 200, data: 'Welcome to SubSaleKing API' });
  const info = await anon('GET', '/version-info');
  assert.ok(info.body.data.android_app.app_version_min && info.body.data.ios_app);
  const bad = await anon('POST', '/login', { username: agent.username, password: 'wrong one' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.success, false);
  assert.equal(bad.body.error.type, 'LOGIN_INVALID_CREDENTIALS');
  assert.equal(typeof bad.body.error.description, 'string');
  assert.equal((await anon('GET', '/user/profile')).body.error.type, 'UNAUTHENTICATED');
  assert.equal((await mine('GET', '/offers')).body.error.type, 'COMING_SOON');
  assert.equal((await mine('GET', '/no/such/thing')).body.error.type, 'RESOURCE_NOT_FOUND');
  process.env.APP_MIN_VERSION_ANDROID = '1.4.0';
  try {
    assert.equal((await mine('GET', '/user/profile')).body.error.type, 'INCOMPATIBLE_APP', 'an app older than the minimum is asked to update');
    assert.equal((await mine('GET', '/user/profile', undefined, { 'client-app-version': '1.4.0+12' })).status, 200);
  } finally { delete process.env.APP_MIN_VERSION_ANDROID; }
});

test('sign in and the profile: the old ids, roles and access level; profile changes go to My profile', async () => {
  const r = await anon('POST', '/login', { username: 'agent-app', password: PASSWORD });
  for (const k of ['id', 'hq_id', 'username', 'name_card_name', 'fullname', 'token', 'token_type', 'token_expires_in', 'roles', 'access_level']) assert.ok(k in r.body.data, k);
  assert.equal(r.body.data.id, agent.id, 'the staff id, as the old user_id');
  const p = (await mine('GET', '/user/profile')).body.data;
  assert.equal(p.user_id, agent.id);
  assert.ok(p.roles.includes('staff'));
  assert.equal(p.phone_number1, agent.phone);
  assert.equal((await mine('POST', '/user/profile', { fullname: agent.name, phone: '012-999 8888', email: 'me@example.com', address: 'Kepong' })).status, 200);
  const after = (await mine('GET', '/user/profile')).body.data;
  assert.deepEqual([after.phone_number1, after.email, after.house_address], ['012-999 8888', 'me@example.com', 'Kepong']);
  assert.equal((await db('staff').where('id', agent.id).first('phone')).phone, agent.phone, 'the staff record stays the office\'s');
  assert.equal((await mine('POST', '/user/profile', { email: 'not an email' })).body.error.type, 'VALIDATION_ERROR');

  assert.equal((await mine('POST', '/user/device', { fcm_token: 'tok-1', device_platform: 'android' })).status, 200);
  assert.equal((await mine('POST', '/user/device', { fcm_token: 'tok-2', device_platform: 'ios' })).status, 200);
  const devices = await db('app_devices').select('fcm_token', 'platform', 'app_version');
  assert.deepEqual(devices, [{ fcm_token: 'tok-2', platform: 'ios', app_version: '1.3.6' }], 'one phone per account');
});

test('search: every active listing, the owner and unit only where the viewer is tied, the old paging', async () => {
  const r = await mine('POST', '/property/search?page=1&per_page=20&sort=updated', {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const active = data.listings.filter(l => l.status === 'active' && !l.draft).length;
  assert.equal(r.body.pagination.entries.total, active, 'the Whole agency: every active listing');
  assert.deepEqual(Object.keys(r.body.pagination.page), ['previous', 'current', 'next', 'total']);
  assert.equal(r.body.data.length, 20);
  for (const row of r.body.data) {
    const l = data.listings.find(x => x.id === row.property_id);
    assert.equal(row.property_run_id, l.code);
    const holder = l.holderId === agent.id || l.creatorId === agent.id;
    if (!holder) assert.equal(row.vendor_contact, null, `${l.code}: no owner for someone not handling it`);
    else assert.equal(row.vendor_contact, l.owner.phone);
  }
  const page2 = await mine('POST', '/property/search?page=2&per_page=20&sort=updated', {});
  assert.equal(page2.body.pagination.page.current, 2);
  assert.ok(!page2.body.data.some(x => r.body.data.some(y => y.property_id === x.property_id)));

  const own = await mine('POST', '/property/search?per_page=50', { property_staff_role: 'product-handler' });
  assert.ok(own.body.data.length >= 2 && own.body.data.every(x => x.project_handler_id === agent.id && x.vendor_name !== null && x.my_listing === true));
  const rentals = await mine('POST', '/property/search?type=rental&per_page=50', {});
  assert.ok(rentals.body.data.length && rentals.body.data.every(x => x.property_type === 'rental'));
  const sold = await mine('POST', '/property/search?per_page=50', { property_tracking_id: 1 });
  assert.equal(sold.body.pagination.entries.total, data.listings.filter(l => l.status === 'sold' && (l.holderId === agent.id || l.creatorId === agent.id || AC.teamOf(agent.id, data.staff).has(l.holderId) || AC.teamOf(agent.id, data.staff).has(l.creatorId))).length,
    'past listings: only the viewer\'s reach, as the ERP');
  const code = data.listings.find(l => l.status === 'active').code;
  const found = await mine('POST', `/property/search?keywords=${code}`, {});
  assert.ok(found.body.data.some(x => x.property_run_id === code));
  const commercial = await mine('POST', '/property/search?per_page=50', { property_category: 'type-2' });
  assert.ok(commercial.body.data.every(x => x.cate_id === 3));
});

test('details: the owner for the handler; a leader sees it on opening, logged once a day; photos, follow-ups, counts', async () => {
  const l = data.listings.find(x => x.holderId === agent.id && x.status === 'active');
  const d = (await mine('GET', `/property/${l.id}/details`)).body.data;
  assert.equal(d.vendor_contact, l.owner.phone);
  assert.ok(Array.isArray(d.property_images));
  const theirs = data.listings.find(x => x.status === 'active' && !x.draft && ![x.holderId, x.creatorId].some(id => AC.teamOf(agent.id, data.staff).has(id))
    && x.holderId !== agent.id && x.creatorId !== agent.id && x.share?.pmId !== agent.id && !(x.share?.coPh || []).some(c => c.staffId === agent.id)
    && !(x.share?.users || []).includes(agent.id) && !AC.teamOf(agent.id, data.staff).has(x.holderId));
  const o = (await mine('GET', `/property/${theirs.id}/details`)).body.data;
  const leader = data.staff.find(s => s.id === data.staff.find(x => x.id === theirs.holderId)?.uplineId);
  if (!leader || leader.id !== agent.id) {
    assert.equal(o.vendor_contact, null);
    assert.equal(o.property_unit, null);
  }
  // A leader above the handler is tied: opening the details shows the owner and logs it, once a day.
  const led = data.listings.find(x => x.status === 'active' && x.holderId != null && data.staff.find(s => s.id === x.holderId)?.uplineId != null
    && x.creatorId !== data.staff.find(s => s.id === x.holderId).uplineId);
  const boss = data.staff.find(s => s.id === data.staff.find(s2 => s2.id === led.holderId).uplineId);
  const asLeader = await account('leader-app', boss.id);
  const before = (await listing(led.id)).ownerViews?.length || 0;
  const seen = (await asLeader('GET', `/property/${led.id}/details`)).body.data;
  assert.equal(seen.vendor_contact, led.owner.phone);
  await asLeader('GET', `/property/${led.id}/details`);
  assert.equal(((await listing(led.id)).ownerViews || []).length, before + 1, 'logged once a day');

  const views = (await listing(l.id)).viewsApp || 0;
  assert.equal((await mine('POST', `/property/${l.id}/details-views-count`)).status, 200);
  assert.equal((await mine('GET', `/property/${l.id}/views-clicks-count`)).body.data.property_details_views_count_app, views + 1);

  assert.equal((await mine('POST', `/property/${l.id}/follow-up/add`, { action_id: 2, remarks: 'Owner open to RM 20k less' })).status, 200);
  const fu = (await mine('GET', `/property/${l.id}/follow-up/list`)).body.data.at(-1);
  assert.deepEqual([fu.follow_up_action, fu.follow_up_action_label, fu.follow_up_remarks, fu['staff.user_id']], [2, 'Call for Nego', 'Owner open to RM 20k less', agent.id]);
});

test('changes go through the ERP\'s own actions: the handler may, someone outside the team may not', async () => {
  const l = data.listings.find(x => x.holderId === agent.id && x.status === 'active');
  const r = await mine('POST', `/property/${l.id}/details/update`, { property_desc: 'Corner unit, renovated', property_price_asking: 650000, is_key_on_agent_hand: true, is_vacant: false, property_unit: 'A-12-3' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = await listing(l.id);
  assert.deepEqual([after.description, after.askPrice, after.flags.includes('Key On Agent Hand'), after.flags.includes('Vacant'), after.unit], ['Corner unit, renovated', 650000, true, false, 'A-12-3']);
  const stranger = await account('outsider-app', outsider.id);
  const no = await stranger('POST', `/property/${l.id}/details/update`, { property_desc: 'mine now' });
  assert.equal(no.status, 403);
  assert.equal(no.body.error.type, 'INSUFFICIENT_PRIVILEGES');
  assert.equal((await stranger('POST', `/property/${l.id}/listing-tracking`, { tracking_id: 1 })).status, 403);
  // Sharing: the handler may; the choices and the slot as the old app shows them.
  assert.equal((await mine('GET', `/property/share-product-handler/permissions?property_id=${l.id}`)).body.data.share_co_ph, 'all');
  assert.deepEqual((await stranger('GET', `/property/share-product-handler/permissions?property_id=${l.id}`)).body.data, { share_ph: 'view_only' });
  const choices = (await mine('GET', `/property/share-product-handler/choices?property_id=${l.id}&type=co_ph`)).body.data;
  assert.ok(choices.some(u => u.user_id === outsider.id));
  assert.equal((await mine('POST', '/property/share-product-handler/add', { property_id: l.id, staff_id: outsider.id, type: 'co_ph', slot_no: 1, valid_for: '7 days' })).status, 200);
  const shared = await listing(l.id);
  assert.equal(shared.share.coPh[0].staffId, outsider.id);
  assert.ok(shared.share.coPh[0].until > '2026-01-01');
  const rec = (await mine('GET', `/property/share-product-handler/records?property_id=${l.id}&type=co_ph&slot_no=1`)).body.data;
  assert.equal(rec[0]['staff.user_id'], outsider.id);
  assert.equal((await mine('POST', `/property/${l.id}/listing-tracking`, { tracking_id: 1, tracking_price: 640000 })).status, 200);
  assert.equal((await listing(l.id)).status, 'sold');
});

test('photos: sent inside the request, checked and kept as uploads, shown from signed links', async () => {
  const l = data.listings.find(x => x.holderId === agent.id && x.status === 'active' && x.id !== data.listings.find(y => y.holderId === agent.id && y.status === 'active').id) || data.listings.find(x => x.holderId === agent.id);
  const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#ec003f' } }).png().toBuffer();
  const up = await mine('POST', `/property/${l.id}/images/upload`, { images: [{ filename: 'front.png', encoded: png.toString('base64') }, { filename: 'kitchen.png', encoded: png.toString('base64') }] });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const list = (await mine('GET', `/property/${l.id}/images/list`)).body.data;
  const added = list.slice(-2);
  assert.ok(added.every(p => /^http:\/\/127\.0\.0\.1:\d+\/api\/files\/\d+\?exp=\d+&sig=/.test(p.image_url)));
  const img = await fetch(added[0].image_url);
  assert.equal(img.status, 200);
  const bad = await mine('POST', `/property/${l.id}/images/upload`, { images: [{ filename: 'x.png', encoded: Buffer.from('not a picture').toString('base64') }] });
  assert.equal(bad.status, 400, 'checked by its first bytes, as every upload');
  assert.equal((await mine('POST', `/property/${l.id}/images/${added[1].image_id}/cover`)).status, 200);
  assert.equal((await listing(l.id)).photoSet.find(p => p.cover).id, added[1].image_id);
  assert.equal((await mine('DELETE', `/property/${l.id}/images`, { image_ids: [added[0].image_id] })).status, 200);
  assert.ok(!(await listing(l.id)).photoSet.some(p => p.id === added[0].image_id));
  const linked = await db('files').where('entity', 'listings').where('entity_id', String(l.id)).count({ n: '*' }).first();
  assert.ok(Number(linked.n) >= 2, 'the uploads belong to the listing');
  const d = (await mine('POST', `/property/search?keywords=${l.code}`, {})).body.data.find(x => x.property_id === l.id);
  assert.ok(/\/api\/files\/\d+\/preview\?exp=/.test(d.property_cover), 'lists show the small preview');
});

test('favourites, notifications and the lists the app picks from', async () => {
  const l = data.listings.find(x => x.status === 'active' && !x.draft);
  assert.equal((await mine('POST', `/user/favourite/property/listings/${l.id}`)).status, 200);
  assert.equal((await mine('POST', `/user/favourite/property/listings/${l.id}`)).status, 200, 'adding twice keeps it');
  const favs = await mine('POST', '/property/search?per_page=50', { is_user_favourite: true });
  assert.deepEqual(favs.body.data.map(x => x.property_id), [l.id]);
  assert.equal(favs.body.data[0].is_user_favourite, 1);
  assert.equal((await mine('DELETE', `/user/favourite/property/listings/${l.id}`)).status, 200);
  assert.equal((await mine('POST', '/property/search', { is_user_favourite: true })).body.pagination.entries.total, 0);

  await db('notices').insert({ to_whom: String(agent.id), at: '2026-10-28 09:00', cat: 'good', text: `${l.code} dropped in price.`, link: `listings/${l.id}`, read_by: '[]' });
  const counts = (await mine('GET', '/user/notification/count/unread')).body.data;
  assert.ok(counts.all >= 1 && counts.good_news >= 1);
  const list = await mine('GET', '/user/notification/list?page=1&per_page=50&category=good_news');
  const n = list.body.data.find(x => x.reference_id === l.id);
  assert.deepEqual([n.type, n.category, n.unread, typeof n.params], ['property.listing_tracking_updated', 'good_news', 1, 'object']);
  assert.equal((await mine('POST', `/user/notification/${n.id}/read`)).status, 200);
  assert.equal((await mine('GET', '/user/notification/count/unread')).body.data.good_news, counts.good_news - 1);

  const cats = (await mine('GET', '/property/category/list')).body.data;
  assert.deepEqual(cats.map(c => c.id), [1, 2, 3, 4, 5]);
  const activeNow = (await db('listings').where({ status: 'active', draft: false }).count({ n: '*' }).first()).n;
  assert.equal(cats.reduce((a, c) => a + c.property_count, 0), Number(activeNow), 'every active listing falls in one category');
  const areas = (await mine('POST', '/property/filter/area/list', {})).body.data;
  assert.ok(areas.length && areas.every(a => a.area_id > 0 && a.area_property_count > 0));
  const inArea = await mine('POST', '/property/search?per_page=200', { property_area_id_list: String(areas[0].area_id) });
  assert.equal(inArea.body.pagination.entries.total, areas[0].area_property_count);
  assert.ok((await mine('GET', '/property/title/list')).body.data.some(t => t.property_count > 0));
  assert.ok((await mine('GET', '/property/keywords/list?per_page=50000')).body.data.length > 0);
  assert.equal((await mine('POST', '/property/enquiry', { name: 'Mr Owner', contact_no: '012-3456789', inquiry_type: 'Rent', property_category: 'Condominium', property_name: 'Vista', property_location: 'Kepong' })).status, 200);
  const req = await db('vendor_requests').orderBy('id', 'desc').first();
  assert.deepEqual([req.name, req.for_type, req.status], ['Mr Owner', 'Rent', 0]);
});

test('a new password signs the app out; a locked agent is turned away', async () => {
  const who = data.staff.filter(s => s.type === 'staff' && s.status === 'active' && s.id !== agent.id && s.id !== outsider.id)[3];
  const call = await account('pw-app', who.id);
  assert.equal((await call('POST', '/user/password', { current_password: 'nope', new_password: 'another long one' })).body.error.description, 'Current Password is incorrect');
  assert.equal((await call('POST', '/user/password', { current_password: PASSWORD, new_password: 'another long one' })).status, 200);
  assert.equal((await call('GET', '/user/profile')).body.error.type, 'UNAUTHENTICATED');
  const again = await anon('POST', '/login', { username: 'pw-app', password: 'another long one' });
  assert.equal(again.status, 200);
  await db('staff').where('id', who.id).update({ status: 'locked' });
  assert.equal((await app(again.body.data.token)('GET', '/user/profile')).body.error.type, 'ACCOUNT_DISABLED');
  assert.equal((await anon('POST', '/login', { username: 'pw-app', password: 'another long one' })).body.error.type, 'LOGIN_ACCOUNT_DISABLED');
});

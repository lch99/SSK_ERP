// The website's reads (/api/public): public listings only (no drafts, nothing marked Process Deal,
// Process L&L or On Hold), never an owner, unit or private remark; the site's filters; photos without
// signing in; looks counted per day; owner enquiries kept; agents' profiles only when switched on;
// saved listings for a signed-in staff member.
process.env.AUTH_DISABLED = 'false';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const { db, migrate, startApi } = require('./helpers');
const { seedDemo } = require('../src/db/demoSeed');
const FILES = require('../src/files/files');
const L = require('../../shared/listings.js');

let api, data, base;
const get = async path => { const r = await fetch(`${base}${path}`); return { status: r.status, body: await r.json().catch(() => null), headers: r.headers }; };
const post = async (path, body, token) => {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body || {}) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const HIDDEN = ['Process Deal', 'Process L&L', 'On Hold'];
const isPublic = l => !l.draft && !(l.flags || []).some(f => HIDDEN.includes(f));

before(async () => {
  await migrate();
  data = (await seedDemo({ asOf: '2026-10-28' })).data;
  api = await startApi();
  base = `${api.base}/public`;
});
after(async () => { await api.close(); await db.destroy(); });

test('search: public active listings only, no owner details anywhere, the site\'s paging', async () => {
  const r = await get('/listings?size=50&sort=recent-update');
  assert.equal(r.status, 200);
  assert.equal(r.body.total, data.listings.filter(l => l.status === 'active' && isPublic(l)).length);
  const text = JSON.stringify(r.body);
  for (const l of data.listings) {
    if (l.owner?.phone) assert.ok(!text.includes(l.owner.phone), `${l.code}: no owner phone`);
    if (l.owner?.name && l.owner.name.length > 6) assert.ok(!text.includes(`"${l.owner.name}"`), `${l.code}: no owner name`);
  }
  for (const row of r.body.rows) {
    assert.deepEqual(Object.keys(row).filter(k => /owner|unit|address|ic\b|remarksPrivate/i.test(k)), []);
    if (row.contact) assert.deepEqual(Object.keys(row.contact).sort(), ['code', 'email', 'hasProfilePage', 'id', 'name', 'phone', 'username']);
  }
  // Never found by its unit: the address (which holds it) is not searched.
  const withUnit = data.listings.find(l => l.status === 'active' && isPublic(l) && /^[A-Z]?-?\d+-\d+/.test(l.address || ''));
  if (withUnit) {
    const unit = withUnit.address.split(',')[0].trim();
    assert.ok(!(await get(`/listings?q=${encodeURIComponent(unit)}&size=50`)).body.rows.some(x => x.id === withUnit.id), `${unit} finds nothing`);
  }
  const page2 = await get('/listings?size=50&page=2&sort=recent-update');
  assert.ok(!page2.body.rows.some(x => r.body.rows.some(y => y.id === x.id)));
  // A listing marked On Hold is not public.
  const held = data.listings.find(l => l.status === 'active' && isPublic(l));
  await db('listings').where('id', held.id).update({ flags: JSON.stringify([...(held.flags || []), 'On Hold']) });
  assert.equal((await get(`/listings?q=${held.code}`)).body.rows.length, 0);
  assert.equal((await get(`/listings/${held.id}`)).status, 404);
  await db('listings').where('id', held.id).update({ flags: JSON.stringify(held.flags || []) });
});

test('the site\'s filters and sorts', async () => {
  const rent = await get('/listings?type=rent&size=50');
  assert.ok(rent.body.rows.length && rent.body.rows.every(x => x.type === 'rent'));
  const cheap = (await get('/listings?sort=price-asc&size=20')).body.rows.map(x => x.askingPrice);
  assert.deepEqual(cheap, [...cheap].sort((a, b) => a - b));
  const beds = await get('/listings?bedrooms=3%2B&size=50');
  assert.ok(beds.body.rows.every(x => x.beds >= 3));
  assert.equal(beds.body.total, data.listings.filter(l => l.status === 'active' && isPublic(l) && l.beds >= 3).length);
  const commercial = await get('/listings?category=commercial&size=50');
  assert.ok(commercial.body.rows.every(x => x.category.id === 3));
  const areas = (await get('/areas')).body;
  assert.ok(areas.length && areas.every(a => a.id > 0 && a.count > 0));
  const inArea = await get(`/listings?areaIds=${areas[0].id}&size=50`);
  assert.equal(inArea.body.total, areas[0].count);
  const titles = (await get(`/titles?areaId=${areas[0].id}`)).body;
  assert.equal(titles.reduce((a, t) => a + t.count, 0), areas[0].count, 'every listing in the area sits in one of its buildings');
  const cats = (await get('/categories')).body;
  assert.equal(cats.reduce((a, c) => a + c.count, 0), data.listings.filter(l => l.status === 'active' && isPublic(l)).length);
  const hot = await get('/listings?catalog=super-hot&size=50');
  assert.ok(hot.body.rows.every(x => x.hotLists.includes('superHot')));
  const word = areas[0].name.slice(0, 4);
  assert.ok((await get(`/keywords?q=${encodeURIComponent(word)}`)).body.some(k => k.name.includes(word)));
  // One agent's listings (their profile page): only those they are in charge of, never the whole agency.
  const holder = data.listings.find(l => l.status === 'active' && isPublic(l)).holderId;
  const theirs = await get(`/listings?role=person-in-charge&staff=${holder}&size=50`);
  assert.ok(theirs.body.total > 0 && theirs.body.rows.every(x => x.contact?.id === holder), 'only the agent in charge');
  assert.ok(theirs.body.total < (await get('/listings?size=1')).body.total);
});

test('what the live site shows: car parks, trip incentive, viewing labels, the map\'s address and the banners', async () => {
  const pub = data.listings.filter(l => l.status === 'active' && isPublic(l));
  // Car parks: exactly 1, or 2 and more (the site's Carpark filter).
  const [a, b, c] = pub;
  for (const [l, n] of [[a, 1], [b, 2], [c, 5]]) await db.raw("update listings set more = json_set(coalesce(more, json_object()), '$.carpark', ?) where id = ?", [n, l.id]);
  const parks = await db('listings').where({ status: 'active', draft: false }).whereRaw("json_extract(more, '$.carpark') is not null").select('id', db.raw("json_extract(more, '$.carpark') as n"));
  const publicIds = new Set(pub.map(l => l.id));
  const count = test => parks.filter(r => publicIds.has(r.id) && test(Number(r.n))).length;
  const one = await get('/listings?carparks=1&size=50');
  assert.ok(one.body.rows.some(x => x.id === a.id) && one.body.rows.every(x => x.carParks === 1));
  assert.equal(one.body.total, count(n => n === 1));
  const twoUp = await get('/listings?carparks=2%2B&size=50');
  assert.ok([b.id, c.id].every(id => twoUp.body.rows.some(x => x.id === id)) && twoUp.body.rows.every(x => x.carParks >= 2));
  assert.equal(twoUp.body.total, count(n => n >= 2));
  assert.equal((await get('/listings?carparks=lots&size=1')).body.total, (await get('/listings?size=1')).body.total, 'nonsense is no filter');
  // Trip incentive: the person in charge's switch, for sale and rent alike.
  const held = pub.find(l => l.holderId != null);
  const holder = held.holderId;
  const access = JSON.parse((await db('staff').where('id', holder).first('access')).access || '{}');
  await db('staff').where('id', holder).update({ access: JSON.stringify({ ...access, tripIncentive: true }) });
  const theirs = (await get(`/listings?role=person-in-charge&staff=${holder}&size=50`)).body.rows;
  assert.ok(theirs.length && theirs.every(x => x.tripIncentive === true));
  assert.equal((await get(`/listings/${held.id}`)).body.tripIncentive, true);
  const other = pub.find(l => l.holderId !== holder && l.holderId != null);
  if (other && !JSON.parse((await db('staff').where('id', other.holderId).first('access')).access || '{}').tripIncentive) assert.equal((await get(`/listings/${other.id}`)).body.tripIncentive, false);
  await db('staff').where('id', holder).update({ access: JSON.stringify(access) });
  // Labels: Fast View and Easy View when the key is with the agent; Easy View when vacant; Exclusive.
  await db('listings').where('id', a.id).update({ flags: JSON.stringify([L.KEY_FLAG, 'Exclusive']) });
  await db('listings').where('id', b.id).update({ flags: JSON.stringify(['Vacant']) });
  await db('listings').where('id', c.id).update({ flags: JSON.stringify(['Tenanted']) });
  assert.deepEqual((await get(`/listings/${a.id}`)).body.labels, ['Fast View', 'Easy View', 'Exclusive']);
  assert.deepEqual((await get(`/listings/${b.id}`)).body.labels, ['Easy View']);
  assert.deepEqual((await get(`/listings/${c.id}`)).body.labels, []);
  for (const l of [a, b, c]) await db('listings').where('id', l.id).update({ flags: JSON.stringify(l.flags || []) });
  // The map: the building's address when it has one.
  const titled = pub.find(l => l.titleId != null);
  const t = await db('titles').where('id', titled.titleId).first('more');
  await db.raw("update titles set more = json_set(coalesce(more, json_object()), '$.searchAddress', ?) where id = ?", ['Jalan Mulia 1/2, Taman Mulia Jaya, Ampang Jaya, Selangor, Malaysia', titled.titleId]);
  assert.equal((await get(`/listings/${titled.id}`)).body.title.address, 'Jalan Mulia 1/2, Taman Mulia Jaya, Ampang Jaya, Selangor, Malaysia');
  await db('titles').where('id', titled.titleId).update({ more: t.more });
  assert.equal((await get(`/listings/${titled.id}`)).body.title.address, (JSON.parse(t.more || '{}').searchAddress || '').trim() || null);
  // A banner shows only its buildings; a banner without a rule shows everything, as the site does.
  const kepong = (await get('/listings?catalog=best-lifestyle-kepong&size=50')).body;
  assert.ok(kepong.rows.every(x => [2397, 3987].includes(x.title.id)));
  assert.equal((await get('/listings?catalog=high-end-wangsa-maju&size=1')).body.total, (await get('/listings?size=1')).body.total);
});

test('details with photos served without signing in; looks counted per day', async () => {
  const l = data.listings.find(x => x.status === 'active' && isPublic(x));
  const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#2266cc' } }).png().toBuffer();
  const f = await FILES.saveBuffer(db, { id: null }, { kind: 'photo', name: 'front.png', buffer: png });
  await db('files').where('id', f.id).update({ entity: 'listings', entity_id: String(l.id) });
  await db('listings').where('id', l.id).update({ photo_set: JSON.stringify([{ id: 1, name: 'front.png', published: true, cover: true, preview: f.ref },
    { id: 2, name: 'old.jpg', published: true, cover: false, url: 'https://storage.subsaleking.com/property-images/x/old.jpg' }]) });
  const d = (await get(`/listings/${l.id}`)).body;
  assert.equal(d.photos.length, 2);
  assert.match(d.coverUrl, new RegExp(`/api/public/photos/${f.id}/preview$`));
  assert.equal(d.photos[1].url, 'https://storage.subsaleking.com/property-images/x/old.jpg');
  const img = await fetch(d.coverUrl);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/webp');
  assert.match(img.headers.get('cache-control'), /public/);
  // The website (another address) may show it: no same-origin-only header.
  assert.equal(img.headers.get('cross-origin-resource-policy'), 'cross-origin');
  // A photo stops being public with its listing.
  await db('listings').where('id', l.id).update({ draft: true });
  assert.equal((await fetch(d.coverUrl)).status, 404);
  await db('listings').where('id', l.id).update({ draft: false });

  const views = Number((await db('listings').where('id', l.id).first('views')).views) || 0;
  assert.equal((await post(`/listings/${l.id}/look`, { kind: 'view', via: 'web' })).status, 200);
  await post(`/listings/${l.id}/look`, { kind: 'click', via: 'web' });
  await post(`/listings/${l.id}/look`, { kind: 'click', via: 'web' });
  const day = await db('listing_daily').where('listing_id', l.id).first();
  assert.deepEqual([day.views_web, day.clicks_web, day.views_app], [1, 2, 0], 'one row a day, never one per look');
  assert.equal(Number((await db('listings').where('id', l.id).first('views')).views), views + 1);
});

test('an owner\'s enquiry becomes an Owner request with a ticket', async () => {
  const r = await post('/owner-requests', { name: 'Mdm Tan', email: 'tan@example.com', phone: '012-888 7777', propertyName: 'Vista Kepong', subCategoryId: 8, price: 550000 });
  assert.equal(r.status, 200);
  assert.match(r.body.ticket, /^[A-Z0-9]{10}$/);
  const v = await db('vendor_requests').where('ticket', r.body.ticket).first();
  assert.deepEqual([v.name, v.category, v.for_type, Number(v.price), v.status], ['Mdm Tan', 'Condominium', 'Sale', 550000, 0]);
  assert.equal((await post('/owner-requests', { name: 'x', phone: '12' })).status, 400);
});

test('the Co-Agent form becomes a Co-Agent request with a ticket: a name and a phone we can call; the BOVAEA tick kept', async () => {
  assert.match((await post('/agent-requests', { phone: '0123456789' })).body.error, /name/);
  assert.match((await post('/agent-requests', { name: 'X', phone: '12' })).body.error, /phone/);
  assert.match((await post('/agent-requests', { name: 'X', phone: '0123456789', email: 'nope' })).body.error, /e-mail/);
  const r = await post('/agent-requests', { name: '  Nadia Lee  ', phone: '012-345 6789', email: 'nadia@example.com', registered: true });
  assert.equal(r.status, 200);
  assert.match(r.body.ticket, /^[A-Z0-9]{10}$/);
  const row = await db('agent_requests').where('ticket', r.body.ticket).first();
  assert.deepEqual([row.name, row.phone, row.email, !!row.registered, row.status, row.handled_by], ['Nadia Lee', '012-345 6789', 'nadia@example.com', true, 0, null]);
  const unticked = await post('/agent-requests', { name: 'Raj', phone: '0198765432' });
  assert.equal((await db('agent_requests').where('ticket', unticked.body.ticket).first()).registered, 0);
});

test('agents\' profiles only when switched on, with public parts only', async () => {
  const on = data.staff.find(s => s.status === 'active' && s.type === 'staff' && s.username);
  const off = data.staff.find(s => s.status === 'active' && s.type === 'staff' && s.username && s.id !== on.id);
  await db('staff').where('id', on.id).update({ access: JSON.stringify({ ...(on.access || {}), profilePage: true }) });
  await db('staff').where('id', off.id).update({ access: JSON.stringify({ ...(off.access || {}), profilePage: false }) });
  const p = await get(`/agents/${encodeURIComponent(on.username)}`);
  assert.equal(p.status, 200);
  assert.equal(p.body.id, on.id);
  const text = JSON.stringify(p.body);
  for (const secret of [on.ic, on.account, on.address, on.birthday].filter(Boolean)) assert.ok(!text.includes(secret), 'no IC, bank account, address or birthday');
  assert.equal((await get(`/agents/${encodeURIComponent(off.username)}`)).status, 404);
  assert.equal((await get('/agents/nobody-here')).status, 404);
});

test('saved listings need the ERP\'s sign-in, and toggle', async () => {
  const agent = data.staff.find(s => s.status === 'active' && s.type === 'staff');
  await db('users').insert({ username: 'saver', name: 'Saver', role: 'staff', staff_id: agent.id, password_hash: await bcrypt.hash('correct horse battery', 4) });
  const token = (await post('/../auth/login', { username: 'saver', password: 'correct horse battery' })).body?.token
    || (await (await fetch(`${api.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'saver', password: 'correct horse battery' }) })).json()).token;
  const l = data.listings.find(x => x.status === 'active' && isPublic(x));
  assert.equal((await post(`/saved/${l.id}`)).status, 401);
  assert.deepEqual((await post(`/saved/${l.id}`, {}, token)).body, { saved: true });
  const list = await (await fetch(`${base}/saved`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.deepEqual(list.rows.map(x => x.id), [l.id]);
  assert.deepEqual((await post(`/saved/${l.id}`, {}, token)).body, { saved: false });
  assert.ok(L.KEY_FLAG);
});

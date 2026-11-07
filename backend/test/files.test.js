// Uploads: the shared file check on the server, storage, photo previews, who
// may open a file, and uploads nobody used going after a day.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.AUTH_DISABLED = 'false';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ssk-uploads-'));
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const { db, migrate, startApi } = require('./helpers');
const { seedDemo } = require('../src/db/demoSeed');
const AC = require('../../shared/access.js');
const { pruneFiles } = require('../src/files/files');

let api, data;
const PASSWORD = 'correct horse battery';
const json = async r => ({ status: r.status, body: await r.json().catch(() => null) });
const as = token => ({
  token,
  call: (method, p, body) => fetch(`${api.base}${p}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body && JSON.stringify(body),
  }).then(json),
  upload: (kind, name, bytes, type = 'application/octet-stream') => fetch(`${api.base}/files?kind=${kind}`, {
    method: 'POST', headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(name), Authorization: `Bearer ${token}` }, body: bytes,
  }).then(json),
});
async function signInAs(username, staffId, role = 'staff') {
  await db('users').insert({ username, name: username, role, branch_id: null, staff_id: staffId, password_hash: await bcrypt.hash(PASSWORD, 4) });
  const r = await api.call('POST', '/auth/login', { username, password: PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return as(r.body.token);
}
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const open = url => fetch(api.base.replace(/\/api$/, '') + url);

before(async () => {
  await migrate();
  data = (await seedDemo({ asOf: '2026-10-28' })).data;
  api = await startApi();
});
after(async () => {
  await api.close();
  await db.destroy();
  fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

test('a file is checked as the page checks it: type by its first bytes, size, name', async () => {
  const boss = await signInAs('boss', null, 'superadmin');
  const ok = await boss.upload('document', 'Sale & Purchase.pdf', pdf, 'application/pdf');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.match(ok.body.ref, /^files\/\d+\/Sale%20%26%20Purchase\.pdf$/);
  const row = await db('files').where({ id: ok.body.id }).first();
  assert.equal(row.kind, 'document');
  assert.equal(Number(row.size), pdf.length);
  assert.ok(fs.existsSync(path.join(process.env.UPLOAD_DIR, row.storage_key)), 'kept in storage');

  const fake = await boss.upload('document', 'slip.pdf', Buffer.from('MZ this is a program'), 'application/pdf');
  assert.equal(fake.status, 400);
  assert.match(fake.body.error, /not a real PDF/);
  assert.match((await boss.upload('document', 'run.exe', pdf)).body.error, /only PDF, JPG or PNG/);
  const big = await boss.upload('avatar', 'me.png', Buffer.alloc(3 * 1024 * 1024, 1), 'image/png');
  assert.equal(big.status, 413);
  assert.match(big.body.error, /the limit is 2 MB/);
  // Sent without saying its size: stopped once it passes the limit.
  const chunk = Buffer.alloc(256 * 1024, 7);
  let sent = 0;
  const stream = new ReadableStream({ pull(c) { if (sent === 0) c.enqueue(new Uint8Array(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))); sent += chunk.length; if (sent > 4 * 1024 * 1024) c.close(); else c.enqueue(new Uint8Array(chunk)); } });
  const streamed = await fetch(`${api.base}/files?kind=avatar`, { method: 'POST', duplex: 'half', body: stream,
    headers: { 'Content-Type': 'image/png', 'X-File-Name': 'me.png', Authorization: `Bearer ${boss.token}` } }).then(json).catch(e => ({ status: 'error', body: String(e) }));
  assert.equal(streamed.status, 413, JSON.stringify(streamed.body));
  assert.match((await boss.upload('nothing', 'a.pdf', pdf)).body.error, /Unknown upload kind/);
  assert.equal((await db('files').count({ n: '*' }))[0].n, 1, 'nothing kept from the refused ones');
  assert.deepEqual(fs.readdirSync(path.join(process.env.UPLOAD_DIR, '.incoming')), [], 'no half-written files left');
});

test('a photo gets a small preview made on the server', async () => {
  const boss = await signInAs('boss2', null, 'superadmin');
  const photo = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 200, g: 30, b: 60 } } }).jpeg().toBuffer();
  const up = await boss.upload('photo', 'living room.jpg', photo, 'image/jpeg');
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const link = await boss.call('GET', `/files/${up.body.id}/link`);
  assert.equal(link.status, 200);
  const small = Buffer.from(await (await open(link.body.preview)).arrayBuffer());
  const meta = await sharp(small).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['webp', 480, 320]);
  assert.ok(small.length < photo.length / 2);
  const full = await open(link.body.url);
  assert.equal(full.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await full.arrayBuffer()).length, photo.length);
  // A link only works as it was signed, and not for long.
  assert.equal((await open(link.body.url.replace(/sig=./, 'sig=x'))).status, 403);
  assert.equal((await open(link.body.url.replace(/exp=\d+/, 'exp=1'))).status, 403);
});

test('an upload belongs to who sent it, then to the record that uses it, and opens for who sees that record', async () => {
  const agent = data.staff.find(s => s.type === 'staff' && s.status === 'active' && data.deals.some(d => d.agentId === s.id && d.status === 'submitted'));
  const deal = data.deals.find(d => d.agentId === agent.id && d.status === 'submitted');
  const team = AC.teamOf(agent.id, data.staff);
  const outsider = data.staff.find(s => s.type === 'staff' && s.status === 'active' && !team.has(s.id) && !AC.teamOf(s.id, data.staff).has(agent.id));
  const mine = await signInAs('agentA', agent.id);
  const other = await signInAs('agentB', outsider.id);
  const boss = await signInAs('boss3', null, 'superadmin');

  const up = await mine.upload('document', 'spa.pdf', pdf, 'application/pdf');
  assert.equal((await mine.call('GET', `/files/${up.body.id}/link`)).status, 200, 'its sender opens it');
  assert.equal((await other.call('GET', `/files/${up.body.id}/link`)).status, 404, 'nobody else, while it is in no record');
  const stolen = await other.call('POST', '/erp/actions/setDealDoc', { args: [deal.id, 'SPA', up.body.ref] });
  assert.equal(stolen.status, 403, 'someone else cannot put it on a record');

  const saved = await mine.call('POST', '/erp/actions/setDealDoc', { args: [deal.id, 'SPA', up.body.ref], small: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const row = await db('files').where({ id: up.body.id }).first();
  assert.deepEqual([row.entity, row.entity_id], ['deals', String(deal.id)]);
  assert.equal((await mine.call('GET', `/files/${up.body.id}/link`)).status, 200);
  assert.equal((await boss.call('GET', `/files/${up.body.id}/link`)).status, 200);
  assert.equal((await other.call('GET', `/files/${up.body.id}/link`)).status, 404, 'an E-Form outside their team');
  assert.equal((await mine.call('POST', '/erp/actions/setDealDoc', { args: [deal.id, 'SPA', 'files/999999/x.pdf'] })).status, 400, 'a file that is not there');
});

test('uploads no record took are removed after a day, from storage too', async () => {
  const boss = await signInAs('boss4', null, 'superadmin');
  const up = await boss.upload('document', 'left.pdf', pdf, 'application/pdf');
  const row = await db('files').where({ id: up.body.id }).first();
  assert.equal(await pruneFiles(db), 0, 'not yet');
  await db('files').where({ id: up.body.id }).update({ created_at: new Date(Date.now() - 25 * 3600000) });
  assert.equal(await pruneFiles(db), 1);
  assert.equal(await db('files').where({ id: up.body.id }).first(), undefined);
  assert.ok(!fs.existsSync(path.join(process.env.UPLOAD_DIR, row.storage_key)));
  assert.ok(await db('files').whereNotNull('entity').first(), 'files in records stay');
});

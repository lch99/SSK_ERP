// Pushes to phones: new notices go to the phones of the people they are for, one
// for everyone to the app's topic, nothing old or already read, and a phone whose
// token stopped working is forgotten. Google's sign-in and Firebase are played by a
// small local server that checks the signed request with the key's public half.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { once } = require('node:events');
const { db, migrate } = require('./helpers');
const { seedDemo } = require('../src/db/demoSeed');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
let google, base, data;
const sent = [];
let signIns = 0;

before(async () => {
  google = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    if (req.url === '/token') {
      const assertion = new URLSearchParams(body).get('assertion') || '';
      const [h, c, s] = assertion.split('.');
      const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s || '', 'base64url'));
      const claims = JSON.parse(Buffer.from(c || '', 'base64url').toString() || '{}');
      if (!ok || claims.iss !== 'push@test-proj.iam.gserviceaccount.com' || claims.scope !== 'https://www.googleapis.com/auth/firebase.messaging') {
        res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      signIns++;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }));
      return;
    }
    if (req.url === '/v1/projects/test-proj/messages:send' && req.headers.authorization === 'Bearer at-1') {
      const { message } = JSON.parse(body);
      if (message.token === 'dead-token') {
        res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }));
        return;
      }
      sent.push(message);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"name":"projects/test-proj/messages/1"}');
      return;
    }
    res.writeHead(403).end('{}');
  }).listen(0, '127.0.0.1');
  await once(google, 'listening');
  base = `http://127.0.0.1:${google.address().port}`;
  process.env.FCM_BASE_URL = base;
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ type: 'service_account', project_id: 'test-proj', client_email: 'push@test-proj.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: `${base}/token` });
  await migrate();
  data = (await seedDemo({ asOf: '2026-10-28' })).data;
});
after(async () => { google.close(); await db.destroy(); delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON; });

const { pushNewNotices } = require('../src/push/outbox');
// Local 'YYYY-MM-DD HH:MM', as notices keep their time.
const stamp = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

test('new notices reach the right phones; old, read and earlier ones do not; a dead token is forgotten', async () => {
  const now = new Date();
  assert.deepEqual(await pushNewNotices(db, { now }), { sent: 0, gone: 0, skipped: 0 }, 'the first run only marks where it starts');
  const agent = data.staff.find(s => s.type === 'staff' && s.status === 'active');
  const mate = data.staff.find(s => s.type === 'staff' && s.status === 'active' && s.branchId === agent.branchId && s.id !== agent.id);
  const other = data.staff.find(s => s.type === 'staff' && s.status === 'active' && s.branchId !== agent.branchId);
  const user = async (username, staffId, token) => {
    const [id] = await db('users').insert({ username, name: username, role: staffId ? 'staff' : 'superadmin', staff_id: staffId, password_hash: 'x' });
    await db('app_devices').insert({ user_id: id, platform: 'android', fcm_token: token });
    return id;
  };
  await user('agent', agent.id, 'agent-token');
  await user('mate', mate.id, 'dead-token');
  await user('other', other.id, 'other-token');
  await user('boss', null, 'boss-token');
  const at = stamp(now);
  const listing = data.listings[0];
  const add = n => db('notices').insert({ at, read_by: '[]', link: null, ...n });
  await add({ to_whom: String(agent.id), cat: 'good', text: `${listing.code} dropped in price.`, link: `listings/${listing.id}` });
  await add({ to_whom: `branch:${agent.branchId}`, cat: 'notice', text: 'Branch meeting at 3 pm.' });
  await add({ to_whom: 'all', cat: 'system', text: 'Planned maintenance on Sunday night.' });
  await add({ to_whom: '0', cat: 'office', text: 'Someone forgot their password.', link: 'staff/1' });
  await add({ to_whom: String(other.id), cat: 'bad', text: 'Read already.', read_by: JSON.stringify([other.id]) });
  await add({ to_whom: String(other.id), cat: 'bad', text: 'From before the server was off.', at: stamp(new Date(now - 3 * 86400000)) });

  const r = await pushNewNotices(db, { now });
  assert.deepEqual(r, { sent: 4, gone: 1, skipped: 1 });
  assert.equal(signIns, 1, 'one access token for the lot');
  const to = token => sent.filter(m => m.token === token);
  const mine = to('agent-token');
  assert.equal(mine.length, 2, 'their own and their branch\'s');
  assert.deepEqual(mine[0].notification, { title: 'Good news', body: `${listing.code} dropped in price.` });
  assert.equal(mine[0].data['ssk.notification_type'], 'property.listing_tracking_updated');
  assert.equal(mine[0].data['ssk.params.property_id'], String(listing.id));
  assert.match(mine[0].data['ssk.notification_id'], /^\d+$/);
  assert.equal(mine[0].data.click_action, 'FLUTTER_NOTIFICATION_CLICK');
  assert.equal(mine[1].data['ssk.notification_type'], 'other');
  assert.equal(sent.filter(m => m.topic === 'system').length, 1, 'everyone: the app\'s topic');
  assert.equal(to('boss-token').length, 1, 'the office accounts get notice 0');
  assert.equal(to('other-token').length, 0, 'nothing read already or from days ago');
  assert.equal(await db('app_devices').where('fcm_token', 'dead-token').first(), undefined, 'a phone that left is forgotten');

  sent.length = 0;
  assert.deepEqual(await pushNewNotices(db, { now }), { sent: 0, gone: 0, skipped: 0 }, 'nothing twice');
});

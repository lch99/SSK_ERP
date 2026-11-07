// Planned downtime on the server: while a window that closes the ERP runs, the
// API answers "back soon" (503) to everyone but the technical team and the
// Superadmin; the page's start-up read still answers, with the window.
process.env.AUTH_DISABLED = 'false';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { db, migrate, startApi } = require('./helpers');
const { seedDemo } = require('../src/db/demoSeed');
const { forget, stampNow } = require('../src/middleware/downtime');

let api, data;
const PASSWORD = 'correct horse battery';
const as = token => (method, path, body) => fetch(`${api.base}${path}`, {
  method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body && JSON.stringify(body),
}).then(async r => ({ status: r.status, body: await r.json() }));

async function signInAs(username, staffId, role = 'staff') {
  await db('users').insert({ username, name: username, role, branch_id: null, staff_id: staffId, password_hash: await bcrypt.hash(PASSWORD, 4) });
  const r = await api.call('POST', '/auth/login', { username, password: PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return as(r.body.token);
}

// A window from `from` to `to` minutes from now.
const minutes = n => stampNow(new Date(Date.now() + n * 60000));
async function plan(from, to, more = {}) {
  const [id] = await db('downtime').insert({ starts_at: minutes(from), ends_at: minutes(to), message: 'Moving to a bigger server.', closes: true, cancelled: false, ...more });
  forget();
  return id;
}

before(async () => {
  await migrate();
  data = (await seedDemo({ asOf: '2026-10-28' })).data;
  api = await startApi();
});
after(async () => { await api.close(); await db.destroy(); });

test('while a window closes the ERP, an agent gets "back soon"; the start-up read still answers with the window', async () => {
  const agent = data.staff.find(s => s.type === 'staff' && s.status === 'active');
  const call = await signInAs('agent1', agent.id);
  assert.equal((await call('GET', '/erp/deals')).status, 200, 'open before any window');

  const id = await plan(-10, 50);
  const r = await call('GET', '/erp/deals');
  assert.equal(r.status, 503);
  assert.match(r.body.error, /closed for planned maintenance until .*Moving to a bigger server/);
  assert.equal(r.body.downtime.message, 'Moving to a bigger server.');
  assert.equal((await call('POST', '/erp/actions/readNotices', { args: [[]] })).status, 503, 'no saves either');
  const start = await call('GET', '/erp/start');
  assert.equal(start.status, 200);
  assert.ok(start.body.data.downtime.some(w => w.id === id && w.closes), 'the page learns of the window');
  assert.equal((await call('GET', '/auth/me')).status, 200, 'still signed in');

  // The Superadmin and the technical team keep working; the technical team ends it, and everyone is back.
  const boss = await signInAs('boss1', null, 'superadmin');
  assert.equal((await boss('GET', '/erp/deals')).status, 200);
  const tech = await signInAs('tech1', null, 'tech');
  assert.equal((await tech('GET', '/erp/meta')).body.viewer.role, 'tech');
  assert.equal((await tech('GET', '/erp/deals')).status, 403, 'the technical team sees no client records');
  const end = await tech('POST', '/erp/actions/endDowntime', { args: [id] });
  assert.equal(end.status, 200, JSON.stringify(end.body));
  assert.equal((await call('GET', '/erp/deals')).status, 200, 'open again at once on End now');
});

test('a window that keeps the ERP open, or one not started yet, closes nothing', async () => {
  const agent = data.staff.filter(s => s.type === 'staff' && s.status === 'active')[1];
  const call = await signInAs('agent2', agent.id);
  await plan(-5, 30, { closes: false });
  assert.equal((await call('GET', '/erp/deals')).status, 200);
  await plan(60, 120);
  assert.equal((await call('GET', '/erp/deals')).status, 200);
  await plan(-120, -60);
  assert.equal((await call('GET', '/erp/deals')).status, 200, 'one that is over');
});

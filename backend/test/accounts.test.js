// Agents' own sign-in: an account per person with their username, a one-time
// link to set the password, Forgot password, and only Active people signing in.
process.env.AUTH_DISABLED = 'false';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { db, migrate, startApi } = require('./helpers');
const { seedDemo } = require('../src/db/demoSeed');

let api, data, boss;
const PASSWORD = 'correct horse battery';
const as = token => (method, path, body) => fetch(`${api.base}${path}`, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body),
}).then(async r => ({ status: r.status, headers: r.headers, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) }));
async function signInAs(username, staffId, role = 'staff') {
  await db('users').insert({ username, name: username, role, branch_id: null, staff_id: staffId, password_hash: await bcrypt.hash(PASSWORD, 4) });
  const r = await api.call('POST', '/auth/login', { username, password: PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return as(r.body.token);
}
const anon = (method, path, body) => as(null)(method, path, body);

before(async () => {
  await migrate();
  data = (await seedDemo({ asOf: '2026-10-28' })).data;
  api = await startApi();
  boss = await signInAs('boss', null, 'superadmin');
});
after(async () => { await api.close(); await db.destroy(); });

test('the office makes a link; the agent sets a password with it, once, and signs in', async () => {
  const agent = data.staff.find(s => s.type === 'staff' && s.status === 'active' && s.username);
  const r = await boss('POST', `/accounts/${agent.id}/link`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.username, agent.username.toLowerCase());
  assert.equal(r.body.purpose, 'set');
  assert.equal(r.body.made, true);
  const t = r.body.token;
  assert.equal((await db('password_links').where('token_hash', t).first()), undefined, 'only a hash is kept');

  const early = await anon('POST', '/auth/login', { username: r.body.username, password: 'whatever-it-is' });
  assert.equal(early.status, 403);
  assert.match(early.body.error, /not set a password yet/);

  const peek = await anon('GET', `/auth/link/${t}`);
  assert.deepEqual(peek.body, { username: r.body.username, name: agent.name, purpose: 'set' });
  assert.equal((await anon('POST', `/auth/link/${t}`, { password: 'short' })).status, 400);
  const set = await anon('POST', `/auth/link/${t}`, { password: 'my own long password' });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.user.staffId, agent.id);
  assert.equal((await as(set.body.token)('GET', '/erp/meta')).body.viewer.role, 'staff');
  assert.equal((await anon('POST', `/auth/link/${t}`, { password: 'another long password' })).status, 410, 'a link works once');
  assert.equal((await anon('POST', '/auth/login', { username: r.body.username, password: 'my own long password' })).status, 200);

  const acc = await boss('GET', `/accounts/${agent.id}`);
  assert.deepEqual([acc.body.hasPassword, acc.body.linkOpen], [true, null]);
});

test('Forgot password tells the branch office; a new link is a reset that lasts a day, and an old one stops working', async () => {
  const agent = data.staff.filter(s => s.type === 'staff' && s.status === 'active' && s.username)[1];
  const first = (await boss('POST', `/accounts/${agent.id}/link`)).body;
  await anon('POST', `/auth/link/${first.token}`, { password: 'first long password' });
  const before = (await db('notices').count({ n: '*' }).first()).n;
  const r = await anon('POST', '/auth/forgot', { username: first.username });
  assert.equal(r.status, 200);
  const nobody = await anon('POST', '/auth/forgot', { username: 'no-such-person' });
  assert.deepEqual(nobody.body, r.body, 'the same reply either way');
  const told = await db('notices').orderBy('id', 'desc').limit(Number((await db('notices').count({ n: '*' }).first()).n) - Number(before));
  assert.ok(told.some(n => n.to_whom === '0') && told.every(n => n.link === `staff/${agent.id}` && n.text.includes('forgot their password')));

  const a = (await boss('POST', `/accounts/${agent.id}/link`)).body;
  const b = (await boss('POST', `/accounts/${agent.id}/link`)).body;
  assert.equal(b.purpose, 'reset');
  assert.ok(new Date(b.expiresAt) - Date.now() <= 24 * 3600000 + 5000);
  assert.equal((await anon('GET', `/auth/link/${a.token}`)).status, 404, 'a newer link replaces it');
  await db('password_links').update({ expires_at: new Date(Date.now() - 1000) });
  assert.equal((await anon('GET', `/auth/link/${b.token}`)).status, 410);
});

test('only Active people sign in: a locked agent is refused, and their open session ends', async () => {
  const agent = data.staff.filter(s => s.type === 'staff' && s.status === 'active' && s.username)[2];
  const link = (await boss('POST', `/accounts/${agent.id}/link`)).body;
  const set = await anon('POST', `/auth/link/${link.token}`, { password: 'third long password' });
  const call = as(set.body.token);
  assert.equal((await call('GET', '/erp/meta')).status, 200);
  await db('staff').where('id', agent.id).update({ status: 'locked' });
  assert.equal((await call('GET', '/erp/meta')).status, 401);
  const r = await anon('POST', '/auth/login', { username: link.username, password: 'third long password' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /locked/);
  assert.equal((await boss('POST', `/accounts/${agent.id}/link`)).status, 400, 'no link for someone not Active');
});

test('a branch admin makes links for their own branch only; an agent makes none', async () => {
  const admin = data.staff.find(s => s.type === 'admin-staff2' && s.status === 'active');
  const call = await signInAs('admin1', admin.id, 'admin');
  const mine = data.staff.find(s => s.type === 'staff' && s.status === 'active' && s.branchId === admin.branchId && s.id !== admin.id);
  const other = data.staff.find(s => s.type === 'staff' && s.status === 'active' && s.branchId !== admin.branchId);
  assert.equal((await call('POST', `/accounts/${mine.id}/link`)).status, 200);
  assert.equal((await call('POST', `/accounts/${other.id}/link`)).status, 404);
  const agent = data.staff.filter(s => s.type === 'staff' && s.status === 'active')[5];
  const agentCall = await signInAs('agent5', agent.id);
  assert.equal((await agentCall('POST', `/accounts/${mine.id}/link`)).status, 403);
  assert.equal((await call('POST', '/accounts/links', { base: 'https://erp.example.com/' })).status, 403, 'everyone at once is the Superadmin\'s');
});

test('the Superadmin makes everyone\'s accounts and links as one Excel file', async () => {
  const active = data.staff.filter(s => s.status === 'active').length;
  const r = await boss('POST', '/accounts/links', { base: 'https://erp.example.com/' });
  assert.equal(r.status, 200);
  assert.equal(r.body.subarray(0, 2).toString(), 'PK');
  const withPassword = await db('users').whereNotNull('staff_id').whereNotNull('password_hash').count({ n: '*' }).first();
  assert.equal((await db('users').whereNotNull('staff_id').count({ n: '*' }).first()).n, active, 'an account for every active person');
  assert.equal(Number(r.headers.get('x-links')), active - Number(withPassword.n), 'a link for each without a password');
  assert.equal((await boss('POST', '/accounts/links', { base: 'javascript:alert(1)' })).status, 400);
});

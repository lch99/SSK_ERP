// With sign-in on: each account sees and does only what its role allows.
process.env.AUTH_DISABLED = 'false';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { db, migrate, startApi } = require('./helpers');
const AC = require('../../shared/access.js');
const { seedDemo } = require('../src/db/demoSeed');

let api, data;
const PASSWORD = 'correct horse battery';
// fetch with a token
const as = token => (method, path, body) => fetch(`${api.base}${path}`, {
  method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body && JSON.stringify(body),
}).then(async r => ({ status: r.status, body: await r.json() }));

async function signInAs(username, staffId, role = 'staff') {
  await db('users').insert({ username, name: username, role, branch_id: null, staff_id: staffId, password_hash: await bcrypt.hash(PASSWORD, 4) });
  const r = await api.call('POST', '/auth/login', { username, password: PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return as(r.body.token);
}

before(async () => {
  await migrate();
  data = (await seedDemo({ asOf: '2026-10-28' })).data;
  api = await startApi();
});
after(async () => { await api.close(); await db.destroy(); });

test('nothing is open without signing in', async () => {
  assert.equal((await api.call('GET', '/erp/deals')).status, 401);
  assert.equal((await api.call('GET', '/setup')).status, 401);
});

test('an agent sees their own and their downline\'s E-Forms, and cannot change Setup or Roles & access', async () => {
  const leader = data.staff.find(s => s.type === 'staff' && s.role && data.deals.some(d => d.agentId === s.id));
  const call = await signInAs('leader1', leader.id);
  const team = AC.teamOf(leader.id, data.staff);
  const r = await call('GET', '/erp/deals?size=200');
  assert.equal(r.status, 200);
  assert.equal(r.body.total, data.deals.filter(d => team.has(d.agentId) || team.has(d.holderId)).length);
  assert.ok(r.body.rows.every(d => team.has(d.agentId) || team.has(d.holderId)));
  const meta = await call('GET', '/erp/meta');
  assert.deepEqual(meta.body.viewer, { role: 'staff', scope: 'team', staffId: leader.id, branchId: leader.branchId });
  assert.equal((await call('GET', '/setup')).status, 403);
  assert.equal((await call('PUT', '/access', { policy: AC.defaultPolicy() })).status, 403);
  const other = data.deals.find(d => !team.has(d.agentId) && !team.has(d.holderId));
  assert.equal((await call('GET', `/erp/deals/${other.id}`)).status, 404);
});

test('marketing has no access to E-Forms, and sees its own branch\'s customers', async () => {
  const mk = data.staff.find(s => s.type === 'sale-marketing');
  const call = await signInAs('marketing1', mk.id, 'admin');
  const deals = await call('GET', '/erp/deals');
  assert.equal(deals.status, 403);
  assert.match(deals.body.error, /Marketing has no view access/);
  const customers = await call('GET', '/erp/customers?size=200');
  assert.equal(customers.status, 200);
  assert.equal(customers.body.total, data.customers.filter(c => c.branchId === mk.branchId).length);
});

test('a changed policy applies on the next request', async () => {
  const boss = await signInAs('boss', null, 'superadmin');
  const policy = AC.defaultPolicy();
  policy['sale-marketing'].levels.deals = 'view';
  assert.equal((await boss('PUT', '/access', { policy })).status, 200);
  const r = await api.call('POST', '/auth/login', { username: 'marketing1', password: PASSWORD });
  assert.equal((await as(r.body.token)('GET', '/erp/deals')).status, 200);
});

test('my profile is kept with my account, checked as the page checks it', async () => {
  const call = await signInAs('profile1', null, 'admin');
  const blank = await call('GET', '/auth/profile');
  assert.equal(blank.status, 200);
  assert.equal(blank.body.name, 'profile1');
  assert.equal(blank.body.hasPassword, true);
  const bad = await call('PUT', '/auth/profile', { name: 'Ann Lee', email: 'not-an-email' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /e-mail/);
  const saved = await call('PUT', '/auth/profile', { name: 'Ann Lee', email: 'ann@example.com', phone: '012-345 6789', bank: 'Maybank', bankHolder: 'Ann Lee', bankAccount: '1234 5678 9012' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.name, 'Ann Lee');
  assert.equal(saved.body.bankAccount, '1234 5678 9012');
  assert.ok(saved.body.updatedAt);
  assert.equal((await db('users').where('username', 'profile1').first()).name, 'Ann Lee');
  assert.equal((await call('GET', '/auth/me')).body.user.name, 'Ann Lee');
});

test('projects: an agent may not change them; the office may', async () => {
  // Someone with no sign-in account yet (each staff record has at most one).
  const linked = new Set((await db('users').whereNotNull('staff_id').pluck('staff_id')).map(Number));
  const free = type => data.staff.find(s => s.type === type && s.status === 'active' && !linked.has(s.id));
  const call = await signInAs('agentproj', free('staff').id);
  const r = await call('POST', '/erp/actions/saveProject', { args: [{ id: null, name: 'Agent Launch', developer: 'X', devCommissionPct: 2, payout: { mode: 'setup' } }] });
  assert.equal(r.status, 403);
  const office = await signInAs('adminproj', free('admin-staff').id, 'admin');
  const ok = await office('POST', '/erp/actions/saveProject', { args: [{ id: null, name: 'Office Launch', developer: 'X', devCommissionPct: 2, payout: { mode: 'setup' } }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body.error));
  assert.equal(ok.body.result.name, 'Office Launch');
  assert.ok(ok.body.data.projects.some(p => p.id === ok.body.result.id));
});

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

// Someone with no sign-in account yet (each staff record has at most one).
async function free(test) {
  const linked = new Set((await db('users').whereNotNull('staff_id').pluck('staff_id')).map(Number));
  return data.staff.find(s => !linked.has(s.id) && test(s));
}

test('an agent receives only their reach: no one else\'s E-Forms, colleagues without private details, other owners hidden', async () => {
  const leader = await free(s => s.type === 'staff' && s.role && data.staff.some(x => x.uplineId === s.id) && data.deals.some(d => d.agentId === s.id));
  const call = await signInAs('reach1', leader.id);
  const team = AC.teamOf(leader.id, data.staff);
  const { status, body } = await call('GET', '/erp/state');
  assert.equal(status, 200);
  const d = body.data;
  assert.ok(d.deals.length > 0 && d.deals.every(x => team.has(x.agentId) || team.has(x.holderId)));
  assert.ok(d.payouts.every(p => team.has(p.staffId)));
  const outsider = d.staff.find(s => !team.has(s.id));
  assert.ok(outsider, 'colleagues outside the team are listed by name');
  assert.equal(outsider.ic, undefined);
  assert.equal(outsider.account, undefined);
  const theirs = d.listings.find(l => l.status === 'active' && !team.has(l.holderId) && !team.has(l.creatorId)
    && !(l.share?.coPh || []).some(c => c.staffId === leader.id) && l.share?.pmId !== leader.id);
  if (theirs) assert.deepEqual([theirs.owner.phone, theirs.address], ['', `${theirs.title}, ${theirs.area} (unit hidden)`]);
  assert.ok(d.notices.every(n => n.to === 'all' || n.to === leader.id || n.to === `branch:${leader.branchId}`));
});

test('an agent cannot change an E-Form outside their team, but can change their own', async () => {
  const agent = await free(s => s.type === 'staff' && s.status === 'active' && data.deals.some(d => d.agentId === s.id && d.status === 'submitted'));
  const call = await signInAs('reach2', agent.id);
  const team = AC.teamOf(agent.id, data.staff);
  const other = data.deals.find(d => !team.has(d.agentId) && !team.has(d.holderId) && d.status === 'submitted');
  const no = await call('POST', '/erp/actions/setDealDoc', { args: [other.id, 'SPA', 'spa.pdf'] });
  assert.equal(no.status, 403);
  assert.match(no.body.error, /not yours to change/);
  const own = data.deals.find(d => d.agentId === agent.id && d.status === 'submitted');
  const yes = await call('POST', '/erp/actions/setDealDoc', { args: [own.id, 'SPA', 'spa.pdf'] });
  assert.equal(yes.status, 200, yes.body.error);
});

test('nobody changes their own account type; changing someone else\'s needs Full on staff', async () => {
  const branchAdmin = await free(s => s.type === 'admin-staff2');
  const call = await signInAs('reach3', branchAdmin.id, 'admin');
  const self = await call('POST', '/erp/actions/updateStaff', { args: [branchAdmin.id, { type: 'admin-staff' }] });
  assert.equal(self.status, 403);
  assert.match(self.body.error, /your own account type/);
  const agent = data.staff.find(s => s.type === 'staff' && s.branchId === branchAdmin.branchId);
  const other = await call('POST', '/erp/actions/updateStaff', { args: [agent.id, { type: 'admin-staff2' }] });
  assert.equal(other.status, 403);
  assert.match(other.body.error, /needs Full/);
});

test('whoever the page says is acting, it is the signed-in person', async () => {
  const agent = await free(s => s.type === 'staff' && s.status === 'active');
  const someone = data.staff.find(s => s.id !== agent.id && s.type === 'staff');
  const listing = data.listings.find(l => l.status === 'active');
  const call = await signInAs('actor1', agent.id);
  const r = await call('POST', '/erp/actions/toggleFavourite', { args: ['listings', listing.id, someone.id] });
  assert.equal(r.status, 200, r.body.error);
  const row = await db('favourites').where('viewer_id', agent.id).first();
  assert.ok(JSON.parse(row.listings).includes(listing.id));
  assert.equal(await db('favourites').where('viewer_id', someone.id).first(), undefined);
});

test('"View the ERP as" narrows a list for the Superadmin, and widens nothing for anyone else', async () => {
  const boss = await signInAs('boss1', null, 'superadmin');
  const leader = data.staff.find(s => s.type === 'staff' && s.role && data.staff.some(x => x.uplineId === s.id));
  const team = AC.teamOf(leader.id, data.staff);
  const as = await boss('GET', `/erp/deals?as=staff&asStaff=${leader.id}&size=200`);
  assert.equal(as.body.total, data.deals.filter(d => team.has(d.agentId) || team.has(d.holderId)).length);
  const agent = await free(s => s.type === 'staff' && s.status === 'active');
  const call = await signInAs('peek1', agent.id);
  const mineOnly = AC.teamOf(agent.id, data.staff);
  const peek = await call('GET', '/erp/deals?as=superadmin&size=200');
  assert.equal(peek.body.total, data.deals.filter(d => mineOnly.has(d.agentId) || mineOnly.has(d.holderId)).length);
});

test('a staff member\'s account carries their account type and branch, so the page gives them their role', async () => {
  const salesAgent = await free(s => s.type === 'sale-staff') || await free(s => s.type === 'staff');
  const call = await signInAs('typed1', salesAgent.id, 'admin');
  const me = (await call('GET', '/auth/me')).body.user;
  assert.equal(me.type, salesAgent.type);
  assert.equal(me.branchId, salesAgent.branchId);
  assert.equal(AC.roleForUser(me), AC.roleForType(salesAgent.type));
});

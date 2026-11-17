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

// Someone with no sign-in account yet (each staff record has at most one), still Active in the
// database (the time rules may have locked people since the sample was made), as only they sign in.
async function free(test) {
  const linked = new Set((await db('users').whereNotNull('staff_id').pluck('staff_id')).map(Number));
  const active = new Set((await db('staff').where('status', 'active').pluck('id')).map(Number));
  return data.staff.find(s => !linked.has(s.id) && active.has(s.id) && test(s));
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

test('a role with payments but no E-Form access reads E-Forms to record payments on, without the parties', async () => {
  const boss = await signInAs('boss2', null, 'superadmin');
  const policy = AC.defaultPolicy();
  policy['sale-marketing'].levels.moneyIn = 'edit';
  assert.equal(policy['sale-marketing'].levels.deals, 'none');
  assert.equal((await boss('PUT', '/access', { policy })).status, 200);
  const mk = data.staff.find(s => s.type === 'sale-marketing');
  const call = as((await api.call('POST', '/auth/login', { username: 'marketing1', password: PASSWORD })).body.token);
  const list = await call('GET', '/erp/deals?size=200');
  assert.equal(list.status, 200);
  assert.equal(list.body.total, data.deals.filter(d => d.branchId === mk.branchId).length);
  assert.ok(list.body.rows.length > 0);
  for (const d of list.body.rows) {
    assert.equal(d.buyer.name, '');
    assert.equal(d.owner.ic, '');
    assert.ok(d.$ && typeof d.$.cleared === 'number', 'the cash still comes with it');
  }
  const one = await call('GET', `/erp/deals/${list.body.rows[0].id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.owner.phone, '');
  // The E-Form's own history stays with E-Form access.
  assert.equal((await call('GET', `/erp/deals/${list.body.rows[0].id}/history`)).status, 403);
  assert.equal((await boss('PUT', '/access', { policy: AC.defaultPolicy() })).status, 200);
});

test('an agent pages through only their team\'s pay: people with Ready pay (with only what the page needs), requests and payout lines', async () => {
  const leader = await free(s => s.type === 'staff' && s.status === 'active' && s.role && data.staff.some(x => x.uplineId === s.id) && data.payouts.some(p => p.staffId === s.id));
  const call = await signInAs('pay1', leader.id);
  const team = AC.teamOf(leader.id, data.staff);
  for (const kind of ['salary', 'incentives']) {
    const people = await call('GET', `/erp/payees?ready=${kind}&size=200`);
    assert.equal(people.status, 200);
    const due = new Set(data.payouts.filter(p => team.has(p.staffId) && p.status === 'approved' && !p.requestId && !p.archiveId && !p.stacked && !!p.role === (kind === 'incentives')).map(p => p.staffId));
    assert.deepEqual(people.body.rows.map(p => p.id).sort((a, b) => a - b), [...due].sort((a, b) => a - b), kind);
    for (const p of people.body.rows) {
      assert.ok(team.has(p.id), `${p.code} is in the team`);
      assert.equal(p.ic, undefined, 'no IC on the list');
      assert.ok(p.$[kind] > 0 && p.$[`${kind}Lines`] > 0);
    }
  }
  const requests = await call('GET', '/erp/requests?size=200');
  assert.equal(requests.status, 200);
  assert.ok(requests.body.rows.every(r => team.has(r.staffId)));
  assert.equal(requests.body.counts.unpaid.n, data.requests.filter(r => team.has(r.staffId) && ['new', 'ready'].includes(r.status)).length);
  const lines = await call('GET', '/erp/payouts?size=200&counts=salaryReady');
  assert.ok(lines.body.rows.length > 0 && lines.body.rows.every(p => team.has(p.staffId)));
  assert.deepEqual(Object.keys(lines.body.counts), ['salaryReady'], 'only the counts asked for');
});

test('a Sales Agent (Salary but no Payouts access) reads their own payout lines for My commission, and no one else\'s', async () => {
  const policy = AC.defaultPolicy();
  assert.equal(policy['sale-staff'].levels.payouts, 'none');
  assert.equal(policy['sale-staff'].levels.salary, 'edit');
  // An agent with commission, made a Sales Agent (the sample may have none).
  const seller = await free(s => s.status === 'active' && s.type === 'staff' && data.payouts.some(p => p.staffId === s.id));
  await db('staff').where('id', seller.id).update({ type: 'sale-staff' });
  const call = await signInAs('seller1', seller.id, 'admin');
  const team = AC.teamOf(seller.id, data.staff);
  const lines = await call('GET', `/erp/payouts?staffId=${seller.id}&size=200&counts=lines`);
  assert.equal(lines.status, 200);
  assert.equal(lines.body.total, data.payouts.filter(p => p.staffId === seller.id).length);
  const all = await call('GET', '/erp/payouts?size=200');
  assert.ok(all.body.rows.every(p => team.has(p.staffId)));
});

test('an agent sees every active listing in the agency, with the owner and unit hidden where they are not tied to it', async () => {
  const agent = await free(s => s.type === 'staff' && s.status === 'active' && data.listings.some(l => l.holderId === s.id));
  const call = await signInAs('market1', agent.id);
  const team = AC.teamOf(agent.id, data.staff);
  const own = await call('GET', '/erp/listings?size=200');
  assert.ok(own.body.rows.every(l => team.has(l.holderId) || team.has(l.creatorId)), 'Listings: their reach only');
  const all = await call('GET', '/erp/agency?size=200&status=active');
  assert.equal(all.status, 200);
  assert.equal(all.body.total, data.listings.filter(l => l.status === 'active').length);
  const theirs = all.body.rows.filter(l => !team.has(l.holderId) && !team.has(l.creatorId) && !(l.share?.coPh || []).some(c => c.staffId === agent.id) && l.share?.pmId !== agent.id);
  assert.ok(theirs.length > 0, 'some listings are another team\'s');
  for (const l of theirs) assert.deepEqual([l.owner.phone, l.address], ['', `${l.title}, ${l.area} (unit hidden)`], l.code);
  // Their own still show the owner; a search never finds another team's unit by its address.
  assert.ok(all.body.rows.some(l => l.holderId === agent.id && l.owner.phone));
  const unit = data.listings.find(l => l.status === 'active' && !team.has(l.holderId) && !team.has(l.creatorId));
  const byAddress = await call('GET', `/erp/agency?q=${encodeURIComponent(unit.address.split(',')[0])}&size=200`);
  assert.ok(!byAddress.body.rows.some(l => l.id === unit.id && l.title !== unit.address.split(',')[0]) || unit.title.includes(unit.address.split(',')[0]));
  // Favourites are their own, whatever key the page sends.
  await db('favourites').insert({ viewer_id: 999999, listings: JSON.stringify([unit.id]), titles: '[]' });
  const fav = await call('GET', '/erp/agency?fav=999999&size=200');
  assert.ok(!fav.body.rows.some(l => l.id === unit.id), 'someone else\'s favourites are not read');
});

test('using the ERP counts as activity: an agent\'s last activity moves to today, once a day', async () => {
  const agent = await free(s => s.type === 'staff');
  await db('staff').where({ id: agent.id }).update({ last_active_on: '2026-01-05' });
  const call = await signInAs('active1', agent.id);
  assert.equal((await call('GET', '/erp/meta')).status, 200);
  await new Promise(r => setTimeout(r, 200));
  const { localToday } = require('../src/db/days');
  assert.equal((await db('staff').where({ id: agent.id }).first()).last_active_on, localToday());
});

// ── Review fixes (2026-11-13) ──────────────────────────────────────────────────
const moneyInAgent = t => data.deals.find(d => d.id === t.dealId)?.agentId;

test('Edit cannot change a payment Accounts cleared, nor an approved request form; a payment moves only to an E-Form in reach', async () => {
  const agent = await free(s => s.type === 'staff' && data.moneyIn.some(t => t.status === 'cleared' && moneyInAgent(t) === s.id)
    && data.moneyOut.some(x => (x.status === 'ready' || x.status === 'paid') && x.staffId === s.id));
  assert.ok(agent, 'the sample has an agent with a cleared payment and an approved request form');
  const call = await signInAs('review1', agent.id);
  const cleared = data.moneyIn.find(t => t.status === 'cleared' && moneyInAgent(t) === agent.id);
  const r1 = await call('POST', '/erp/actions/updateTransaction', { args: [cleared.id, { amount: 100000 }] });
  assert.equal(r1.status, 403);
  assert.match(r1.body.error, /cleared this payment/);
  const approved = data.moneyOut.find(x => (x.status === 'ready' || x.status === 'paid') && x.staffId === agent.id);
  const r2 = await call('POST', '/erp/actions/updateMoneyOut', { args: [approved.id, { account: '9999 0000 1111' }] });
  assert.equal(r2.status, 403);
  assert.match(r2.body.error, /approved/);
  const team = AC.teamOf(agent.id, data.staff);
  const open = data.moneyIn.find(t => (t.status === 'draft' || t.status === 'pending') && team.has(moneyInAgent(t)));
  const elsewhere = data.deals.find(d => d.status === 'submitted' && !team.has(d.agentId) && !team.has(d.holderId));
  if (open && elsewhere) {
    const r3 = await call('POST', '/erp/actions/updateTransaction', { args: [open.id, { dealId: elsewhere.id }] });
    assert.equal(r3.status, 403);
    assert.match(r3.body.error, /not yours to change/);
  }
});

test('a role with no listings access gets no owners or units, and the phone app\'s listings are closed to it', async () => {
  const person = await free(s => s.status === 'active' && s.type === 'staff');
  await db('staff').where('id', person.id).update({ type: 'account' });
  await db('users').insert({ username: 'acct1', name: 'acct1', role: 'accountant', staff_id: person.id, password_hash: await bcrypt.hash(PASSWORD, 4) });
  const { body: login } = await api.call('POST', '/auth/login', { username: 'acct1', password: PASSWORD });
  const call = as(login.token);
  const { status, body } = await call('GET', '/erp/state');
  assert.equal(status, 200);
  assert.ok(body.data.listings.length > 0);
  assert.ok(body.data.listings.every(l => !l.owner?.phone && !l.owner?.name && /unit hidden/.test(l.address)), 'no owner or unit');
  const app = await fetch(`${api.base.replace(/\/api$/, '/v1')}/property/search`, { method: 'POST', headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(app.status, 403);
  assert.equal((await app.json()).error.type, 'INSUFFICIENT_PRIVILEGES');
});

test('"View the ERP as" never changes who a save is done as', async () => {
  const boss = await signInAs('boss9', null, 'superadmin');
  const agent = await free(s => s.type === 'staff' && s.status === 'active');
  const listing = data.listings.find(l => l.status === 'active');
  const r = await boss('POST', `/erp/actions/toggleFavourite?as=staff&asStaff=${agent.id}`, { args: ['listings', listing.id, agent.id] });
  assert.equal(r.status, 200, r.body.error);
  assert.equal(await db('favourites').where('viewer_id', agent.id).first(), undefined, 'not saved as the agent');
});

test('an agent sees owner requests only with Vendor Requests switched on, as in the current ERP', async () => {
  const agent = await free(s => s.type === 'staff' && s.status === 'active');
  await db('staff').where('id', agent.id).update({ access: JSON.stringify({ agent: true, vendorRequests: false }) });
  const call = await signInAs('vendor1', agent.id);
  const off = await call('GET', '/erp/vendorRequests');
  assert.equal(off.status, 403);
  assert.match(off.body.error, /Vendor Requests is switched off/);
  const request = data.vendorRequests[0];
  assert.equal((await call('POST', '/erp/actions/setVendorRequest', { args: [request.id, 1] })).status, 403);
  await db('staff').where('id', agent.id).update({ access: JSON.stringify({ agent: true, vendorRequests: true }) });
  assert.equal((await call('GET', '/erp/vendorRequests')).status, 200);
});

test('an agent deletes their own draft listing, but no one else\'s and nothing published', async () => {
  const agent = await free(s => s.type === 'staff' && s.status === 'active');
  const [mine, other] = data.listings.filter(l => !l.dealId && !data.deals.some(d => d.listingId === l.id)).slice(-2);
  // Both theirs (holder and creator); one a draft.
  await db('listings').whereIn('id', [mine.id, other.id]).update({ creator_id: agent.id, holder_id: agent.id, deal_id: null });
  await db('listings').where('id', mine.id).update({ draft: true });
  await db('listings').where('id', other.id).update({ draft: false });
  const call = await signInAs('draft1', agent.id);
  const published = await call('POST', '/erp/actions/deleteListing', { args: [other.id] });
  assert.equal(published.status, 403);
  assert.match(published.body.error, /Only your own drafts/);
  const own = await call('POST', '/erp/actions/deleteListing', { args: [mine.id] });
  assert.equal(own.status, 200, own.body.error);
  assert.equal(await db('listings').where('id', mine.id).first(), undefined);
});

test('no ERP reply carries Setup\'s list of every agent (their IC and bank account numbers)', async () => {
  const taken = new Set(await db('users').whereNotNull('staff_id').pluck('staff_id'));
  const me = data.staff.find(s => s.type === 'staff' && s.status === 'active' && !taken.has(s.id));
  // Active today, so the idle-account clock doesn't lock them (the sample is dated 2026-10-28).
  await db('staff').where('id', me.id).update({ status: 'active', last_active_on: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }) });
  const call = await signInAs('plainagent1', me.id);
  for (const p of ['/erp/start', '/erp/meta', '/erp/state']) {
    const r = await call('GET', p);
    assert.equal(r.status, 200, p);
    assert.ok(r.body.setup.tiers?.length, `${p}: the rest of Setup is there`);
    assert.equal(r.body.setup.agents, undefined, p);
  }
  const r = await call('POST', '/erp/actions/toggleFavourite', { args: ['listings', data.listings[0].id, me.id], small: true });
  assert.equal(r.status, 200, r.body?.error);
  assert.equal(r.body.setup.agents, undefined, 'a save\'s reply');
  // Setup itself (with the list) stays closed to an agent.
  assert.equal((await call('GET', '/setup')).status, 403);
});

test('Edit on staff cannot change someone with more access (an e-mail, then Forgot password), nor add one', async () => {
  const senior = data.staff.find(s => s.type === 'account' || s.type === 'admin-staff');
  assert.ok(senior, 'the sample has an Accounting or Admin (Level 2) person');
  const admin1 = data.staff.find(s => s.type === 'admin-staff2' && s.status === 'active');
  assert.ok(admin1, 'the sample has an Admin (Level 1)');
  // (An earlier test may have given them an account already: sign in with it.)
  const had = await db('users').where('staff_id', admin1.id).first('username');
  const call = had ? as((await api.call('POST', '/auth/login', { username: had.username, password: PASSWORD })).body.token) : await signInAs('branchadmin9', admin1.id);
  const r = await call('POST', '/erp/actions/updateStaff', { args: [senior.id, { email: 'me@evil.example' }] });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.match(r.body.error, /more access than your role/);
  assert.notEqual((await db('staff').where('id', senior.id).first('email')).email, 'me@evil.example');
  const add = await call('POST', '/erp/actions/addStaff', { args: [{ name: 'Made Admin', type: 'admin-staff', branchId: senior.branchId }] });
  assert.equal(add.status, 403, JSON.stringify(add.body));
  assert.match(add.body.error, /cannot add someone as Admin \(Level 2\)/);
});

test('a listing someone adds names them as its creator, whoever its product handler is', async () => {
  const leader = data.staff.find(s => s.type === 'staff' && s.status === 'active' && data.staff.some(d => d.uplineId === s.id && d.type === 'staff' && d.status === 'active'));
  const downline = data.staff.find(d => d.uplineId === leader.id && d.type === 'staff' && d.status === 'active');
  const had = await db('users').where('staff_id', leader.id).first('username');
  const call = had ? as((await api.call('POST', '/auth/login', { username: had.username, password: PASSWORD })).body.token) : await signInAs('leader9', leader.id);
  const r = await call('POST', '/erp/actions/addListing', { args: [{ type: 'sale', title: 'Creator Court', area: 'Kepong', askPrice: 500000, unit: 'C-1-9',
    ownerName: 'Owner C', ownerPhone: '012-3456789', holderId: downline.id, createdBy: downline.id }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = await db('listings').where('title', 'Creator Court').first('creator_id', 'holder_id');
  assert.deepEqual([row.creator_id, row.holder_id], [leader.id, downline.id], 'the server names the creator; a createdBy sent along is ignored');
});

test('in production, only the Superadmin may read every record at once', async () => {
  const taken = new Set(await db('users').whereNotNull('staff_id').pluck('staff_id'));
  const me = data.staff.find(s => s.type === 'staff' && s.status === 'active' && !taken.has(s.id));
  await db('staff').where('id', me.id).update({ last_active_on: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }) });
  const agent = await signInAs('stateagent', me.id);
  const boss = await signInAs('stateboss', null, 'superadmin');
  process.env.NODE_ENV = 'production';
  try {
    assert.equal((await agent('GET', '/erp/state')).status, 403);
    assert.equal((await agent('GET', '/erp/start')).status, 200, 'the start-up read is for everyone');
    assert.equal((await boss('GET', '/erp/state')).status, 200);
  } finally {
    process.env.NODE_ENV = 'test';
  }
});

test('a list with a "date" that is none is a 400 the person can read, and the server stays up', async () => {
  const boss = await signInAs('dateboss', null, 'superadmin');
  for (const [path, v] of [['/erp/listings', 'createdFrom=abc'], ['/erp/deals', 'from=2026-02-30'], ['/erp/staff', 'joinedFrom=5'], ['/erp/viewings', 'from=null']]) {
    const r = await boss('GET', `${path}?${v}&counts=0&size=5`);
    assert.equal(r.status, 400, `${path}?${v}`);
    assert.match(r.body.error, /is not a date/);
  }
  assert.equal((await boss('GET', '/erp/deals?from=2026-11-01&to=2026-11-30&counts=0&size=5')).status, 200);
  assert.equal((await boss('GET', '/erp/staff/download?joinedFrom=abc')).status, 400);
  assert.equal((await api.call('GET', '/health')).status, 200, 'still up');
});

test('text or numbers too big for the database are refused as the person\'s mistake, not a server error', async () => {
  const boss = await signInAs('bigboss', null, 'superadmin');
  const long = await boss('POST', '/erp/actions/addPropertyType', { args: ['x'.repeat(500)], small: true });
  assert.equal(long.status, 400, JSON.stringify(long.body));
  assert.match(long.body.error, /too long for name/);
  const listing = data.listings.find(l => l.status === 'active');
  const huge = await boss('POST', '/erp/actions/updateListing', { args: [listing.id, { askPrice: 1e30 }], small: true });
  assert.equal(huge.status, 400, JSON.stringify(huge.body));
  assert.equal((await api.call('GET', '/health')).status, 200);
});

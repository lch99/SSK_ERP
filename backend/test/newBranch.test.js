// A new branch and its Branch Partner (Users → New branch and partner), then the partner setting the
// branch up alone on My branch: details, agents from Excel, sign-in links. Signed in for real, so each
// call runs as the Superadmin or the partner.
process.env.AUTH_DISABLED = 'false';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { db, migrate, startApi } = require('./helpers');

let api, boss, partner, desaId;
const PASSWORD = 'correct horse battery';
const as = token => async (method, path, body) => {
  const r = await fetch(`${api.base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
  const type = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, body: type.includes('json') ? await r.json() : null };
};
const signIn = async (username, password = PASSWORD) => {
  const r = await api.call('POST', '/auth/login', { username, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return as(r.body.token);
};

before(async () => {
  await migrate();
  api = await startApi();
  await db('users').insert({ username: 'boss', name: 'Boss', role: 'superadmin', password_hash: await bcrypt.hash(PASSWORD, 4) });
  boss = await signIn('boss');
  const tiers = [{ name: 'T1', title: 'Associate', basis: 'lifetime', threshold: 0, agentRate: 60, totals: { sale: 85, rental: 85 } }];
  const r = await boss('POST', '/setup/steps', { steps: [
    ['branches', { branches: [{ name: 'Taman Desa', code: 'TD' }] }],
    ['deal-types', { sale: { enabled: true, defaultRate: 3 }, rental: { enabled: true, defaultRate: 100 }, project: { enabled: false },
      sstPct: 8, sstMode: 'on_top', whtPct: 2, coaSharePct: 50, referralPct: 10 }],
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  desaId = r.body.branches[0].id;
  const p = await boss('PUT', '/setup/plans', { plans: [{ name: 'Standard', tiers }, { name: 'Desa plan', branchIds: [desaId], tiers }] });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  await boss('PUT', '/setup/agents', { mode: 'add', rows: [{ line: 2, cells: { name: 'Desa Agent', branch: 'TD' } }] });
});
after(async () => { await api.close(); await db.destroy(); });

const newPartner = { name: 'Lim Mei Ling', username: 'meiling', password: 'starting-pw-1' };
let kepong;

test('the payout plans to pick from, Standard first', async () => {
  const r = await boss('GET', '/users/branch-options');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.plans.map(p => [p.name, p.standard]), [['Standard', true], ['Desa plan', false]]);
});

test('a new branch and its partner are saved together, on the plan picked', async () => {
  const { body: { plans } } = await boss('GET', '/users/branch-options');
  const r = await boss('POST', '/users/branch', { branch: { name: 'Kepong', code: 'kp', phone: '03-1' }, planId: plans[1].id, manager: newPartner });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  kepong = r.body.branch;
  assert.deepEqual([kepong.code, kepong.manager], ['KP', 'Lim Mei Ling']);
  assert.deepEqual([r.body.user.role, r.body.user.branchId, r.body.user.username], ['manager', kepong.id, 'meiling']);
  assert.ok(await bcrypt.compare(newPartner.password, (await db('users').where('username', 'meiling').first()).password_hash));
  const setup = (await boss('GET', '/setup')).body;
  assert.deepEqual(setup.plans.find(p => p.name === 'Desa plan').branchIds.sort(), [desaId, kepong.id].sort());
  const logged = await db('audit_log').whereIn('entity', ['user', 'setup.branches']).whereIn('action', ['create', 'update']).count({ n: '*' }).first();
  assert.ok(Number(logged.n) >= 2);
});

test('nothing is saved when either half is wrong, and only the Superadmin adds a branch', async () => {
  const count = async () => Number((await db('branches').count({ n: '*' }).first()).n);
  const n = await count();
  const other = { ...newPartner, username: 'other' };
  const taken = await boss('POST', '/users/branch', { branch: { name: 'Puchong', code: 'PC' }, manager: newPartner });
  assert.equal(taken.status, 400);
  assert.match(taken.body.error, /taken/);
  const sameCode = await boss('POST', '/users/branch', { branch: { name: 'Puchong', code: 'TD' }, manager: other });
  assert.equal(sameCode.status, 400);
  assert.match(sameCode.body.error, /code "TD"/);
  assert.equal((await boss('POST', '/users/branch', { branch: { name: 'Puchong', code: 'PC' }, manager: { ...other, password: 'x' } })).status, 400);
  assert.equal((await boss('POST', '/users/branch', { branch: { name: 'Puchong', code: 'PC' }, planId: 999999, manager: other })).status, 400);
  assert.equal(await count(), n);
  assert.equal(await db('users').where('username', 'other').first(), undefined);

  partner = await signIn('meiling', newPartner.password);
  assert.equal((await partner('POST', '/users/branch', { branch: { name: 'Puchong', code: 'PC' }, manager: other })).status, 403);
});

test('the partner sees only their own branch', async () => {
  const meta = await partner('GET', '/erp/meta');
  assert.equal(meta.status, 200);
  assert.deepEqual([meta.body.viewer.role, meta.body.viewer.scope, meta.body.viewer.branchId], ['branch-partner', 'branch', kepong.id]);
  const staff = await partner('GET', '/erp/staff?size=50');
  assert.equal(staff.status, 200, JSON.stringify(staff.body));
  assert.equal(JSON.stringify(staff.body).includes('Desa Agent'), false);
  assert.equal((await partner('GET', '/setup')).status, 403);
  // Sign-in accounts: theirs only, and only Admin / Office Staff for their branch.
  const users = await partner('GET', '/users');
  assert.equal(users.status, 200);
  assert.deepEqual(users.body.users.map(u => u.username), ['meiling']);
  const admin = await partner('POST', '/users', { username: 'kpadmin', name: 'KP Admin', role: 'admin', branchId: kepong.id, password: 'starting-pw-2' });
  assert.equal(admin.status, 201, JSON.stringify(admin.body));
  assert.equal((await partner('POST', '/users', { username: 'tdadmin', name: 'TD Admin', role: 'admin', branchId: desaId, password: 'starting-pw-2' })).status, 403);
});

test('My branch: only the partner, only their branch', async () => {
  assert.equal((await boss('GET', '/my-branch')).status, 403);
  const r = await partner('GET', '/my-branch');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.branches.map(b => b.code), ['KP']);
  assert.deepEqual(r.body.agents, []);
});

test('the partner edits their branch details; the name and code stay', async () => {
  const r = await partner('PUT', '/my-branch/details', { name: 'Renamed', code: 'ZZ', address: '1 Jalan Kepong', phone: '03-2', manager: 'Mei Ling' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = await db('branches').where('id', kepong.id).first();
  assert.deepEqual([row.name, row.code, row.address, row.phone, row.manager], ['Kepong', 'KP', '1 Jalan Kepong', '03-2', 'Mei Ling']);
  assert.equal((await db('branches').where('id', desaId).first()).address, '');
});

test('the partner brings in their agents from Excel, into their branch only', async () => {
  const bad = await partner('POST', '/my-branch/agents', { rows: [{ line: 2, cells: { name: 'Wrong Branch', branch: 'TD' } }] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /isn't one of yours \(Kepong\)/);
  const crossUpline = await partner('POST', '/my-branch/agents', { rows: [{ line: 2, cells: { name: 'New One', upline: 'Desa Agent' } }] });
  assert.equal(crossUpline.status, 400);
  const r = await partner('POST', '/my-branch/agents', { rows: [
    { line: 2, cells: { name: 'KP Leader', ic: '800101-14-1111' } },
    { line: 3, cells: { name: 'KP Agent', upline: 'KP Leader', branch: 'Kepong' } },
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.agents.map(a => a.name), ['KP Leader', 'KP Agent']);
  const rows = await db('staff').whereIn('name', ['KP Leader', 'KP Agent', 'Desa Agent']).orderBy('id').select('name', 'branch_id', 'upline_id', 'id');
  assert.deepEqual(rows.map(s => [s.name, s.branch_id]), [['Desa Agent', desaId], ['KP Leader', kepong.id], ['KP Agent', kepong.id]]);
  assert.equal(rows[2].upline_id, rows[1].id);
  // A second upload adds; the first two stay.
  const more = await partner('POST', '/my-branch/agents', { rows: [{ line: 2, cells: { name: 'KP Third', upline: 'KP Leader' } }] });
  assert.equal(more.status, 200, JSON.stringify(more.body));
  assert.equal(more.body.agents.length, 3);
});

test('sign-in links for the whole branch: the partner gets only their own people', async () => {
  await db('staff').where('branch_id', kepong.id).update({ status: 'active' });
  await db('staff').where('branch_id', desaId).update({ status: 'active' });
  const r = await partner('POST', '/accounts/links', { base: 'https://erp.example/', branchId: desaId });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-links'), '3');
  const made = await db('users').join('staff', 'staff.id', 'users.staff_id').select('staff.name', 'staff.branch_id');
  assert.deepEqual(made.map(u => u.branch_id).sort(), [kepong.id, kepong.id, kepong.id]);
});

test('BM profit: the partner names an agent of their own branch only', async () => {
  const ST = require('../../shared/standard.js');
  const cms = await partner('PUT', '/my-branch/bm-account', { staffId: null });
  assert.equal(cms.status, 400);
  assert.match(cms.body.error, /no BM profit/);
  const desaAgent = await db('staff').where('name', 'Desa Agent').first('id');
  const std = await boss('PUT', '/setup/standard', { ...ST.existingDefault(), kind: 'existing', branchManagers: { [desaId]: desaAgent.id } });
  assert.equal(std.status, 200, JSON.stringify(std.body));
  const leader = await db('staff').where('name', 'KP Leader').first('id');
  assert.equal((await partner('PUT', '/my-branch/bm-account', { staffId: desaAgent.id })).status, 400);
  const r = await partner('PUT', '/my-branch/bm-account', { staffId: leader.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // Their view shows only their own branch's choice; Desa's stays as the Superadmin set it.
  assert.deepEqual(r.body.standard.branchManagers, { [kepong.id]: leader.id });
  const all = (await boss('GET', '/setup')).body.standard.branchManagers;
  assert.deepEqual([all[desaId], all[kepong.id]], [desaAgent.id, leader.id]);
  const none = await partner('PUT', '/my-branch/bm-account', { staffId: null });
  assert.equal(none.status, 200);
  assert.equal((await boss('GET', '/setup')).body.standard.branchManagers[kepong.id], undefined);
  assert.equal((await boss('GET', '/setup')).body.standard.branchManagers[desaId], desaAgent.id);
});

test('review fixes: no wider roles, no moving people out, no same IC across branches, no other branches in the view', async () => {
  const leader = await db('staff').where('name', 'KP Leader').first('id');
  const act = (name, args) => partner('POST', `/erp/actions/${name}`, { args });
  // An agent can't be made a role that sees every branch.
  const wider = await act('updateStaff', [leader.id, { type: 'admin-staff' }]);
  assert.equal(wider.status, 403, JSON.stringify(wider.body));
  assert.match(wider.body.error, /more access than yours/);
  assert.equal((await db('staff').where('id', leader.id).first('type')).type, 'staff');
  // Nor moved into another branch.
  const moved = await act('updateStaff', [leader.id, { branchId: desaId }]);
  assert.equal(moved.status, 403, JSON.stringify(moved.body));
  assert.match(moved.body.error, /your own branch/);
  assert.equal((await db('staff').where('id', leader.id).first('branch_id')).branch_id, kepong.id);
  // The same person (IC no.) already in another branch is refused; a namesake with another IC is fine.
  await db('staff').where('name', 'Desa Agent').update({ ic_no: '900202-10-2222' });
  const twin = await partner('POST', '/my-branch/agents', { rows: [{ line: 2, cells: { name: 'Someone', ic: '900202-10-2222' } }] });
  assert.equal(twin.status, 400);
  assert.match(twin.body.error, /same IC no\. as Desa Agent \(already saved, in another branch\)/);
  const namesake = await partner('POST', '/my-branch/agents', { rows: [{ line: 2, cells: { name: 'Desa Agent', ic: '910303-10-3333' } }] });
  assert.equal(namesake.status, 200, JSON.stringify(namesake.body));
  // The partner's view: their branch and plan only, no bank accounts or other branches' settings.
  const view = (await partner('GET', '/my-branch')).body;
  assert.deepEqual(view.plans.map(p => [p.name, p.branchIds]), [['Standard', []], ['Desa plan', [kepong.id]]]);
  assert.deepEqual(Object.keys(view.branchTiers || {}).map(Number), [kepong.id]);
  assert.deepEqual(view.bankAccounts, []);
  assert.equal(JSON.stringify(view).includes('Taman Desa'), false);
});

test('a branch added from Users leaves Setup\'s checklist as it was', async () => {
  const before = (await db('settings').where('key', 'setup').first()).value;
  const confirmed = JSON.parse(before).confirmed;
  const r = await boss('POST', '/users/branch', { branch: { name: 'Puchong', code: 'PC' }, manager: { name: 'P', username: 'puchong', password: 'starting-pw-1' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(JSON.parse((await db('settings').where('key', 'setup').first()).value).confirmed, confirmed);
});

test('commission, existing standard: the partner sets their branch\'s own rates from a date; earlier E-Forms keep theirs', async () => {
  const { localToday, addDays } = require('../src/db/days');
  const today = localToday();
  const ST = require('../../shared/standard.js');
  // The Superadmin's other branch has its own numbers too: the partner never sees them.
  const std = (await boss('GET', '/setup')).body.standard;
  assert.equal((await boss('PUT', '/setup/standard', { ...std, branchRules: { [desaId]: { cap: 91 } } })).status, 200);

  const rules = { cap: 92, positions: [{ code: 'AG', rate: 75 }], bands: [{ code: 'AM', upTo: 92 }] };
  const noDate = await partner('PUT', '/my-branch/commission', { own: true, rules });
  assert.equal(noDate.status, 400);
  assert.match(noDate.body.error, /date the new rates start/);
  const past = await partner('PUT', '/my-branch/commission', { own: true, rules, from: addDays(today, -1) });
  assert.equal(past.status, 400);
  assert.match(past.body.error, /today at the earliest/);
  const bad = await partner('PUT', '/my-branch/commission', { own: true, rules: { ...rules, cap: 150 }, from: today });
  assert.equal(bad.status, 400);

  const r = await partner('PUT', '/my-branch/commission', { own: true, rules, from: today });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body.standard.branchRules).map(Number), [kepong.id]);
  assert.equal(r.body.rulesSince, today);
  const st = ST.standardFor(r.body, kepong.id);
  assert.deepEqual([st.cap, st.positions.find(p => p.code === 'AG').rate, st.positions.find(p => p.code === 'TL').rate], [92, 75, 85]);
  // Setup: the rules until today kept for earlier E-Forms (Kepong on the company's then), Taman Desa's untouched.
  const setup = (await boss('GET', '/setup')).body;
  assert.equal(setup.ruleHistory.at(-1).until, today);
  assert.equal(ST.branchRulesOf(setup.ruleHistory.at(-1).standard, kepong.id), null);
  assert.equal(ST.branchRulesOf(setup.standard, desaId).cap, 91);
  // The Superadmin saving the standard keeps the branches' numbers.
  assert.equal((await boss('PUT', '/setup/standard', { ...setup.standard, branchRules: undefined })).status, 200);
  assert.equal(ST.branchRulesOf((await boss('GET', '/setup')).body.standard, kepong.id).cap, 92);

  // Back to the company's, correcting today's change (it starts today): no second start date.
  const back = await partner('PUT', '/my-branch/commission', { own: false, from: today });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  const after = (await boss('GET', '/setup')).body;
  assert.equal(ST.branchRulesOf(after.standard, kepong.id), null);
  assert.equal(after.ruleHistory.length, setup.ruleHistory.length);
});

test('commission, CMS: the partner makes their branch\'s own tier plan, or goes back to the company\'s', async () => {
  const { localToday, addDays } = require('../src/db/days');
  const later = addDays(localToday(), 1);
  assert.equal((await boss('PUT', '/setup/standard', { kind: 'cms' })).status, 200);
  const view = (await partner('GET', '/my-branch')).body;
  assert.deepEqual([view.plans.map(p => p.name), view.planShared], [['Standard', 'Desa plan'], true]);

  const tiers = [{ name: 'K1', title: 'Kepong Associate', basis: 'lifetime', threshold: 0, agentRate: 65, totals: { sale: 90, rental: 90 } }];
  const clash = await partner('PUT', '/my-branch/commission', { own: true, name: 'Desa plan', tiers, from: later });
  assert.equal(clash.status, 400);
  assert.match(clash.body.error, /already called "Desa plan"/);
  const wrong = await partner('PUT', '/my-branch/commission', { own: true, name: 'Kepong plan', tiers: [{ ...tiers[0], agentRate: 95 }], from: later });
  assert.equal(wrong.status, 400);

  const r = await partner('PUT', '/my-branch/commission', { own: true, name: 'Kepong plan', tiers, from: later });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.plans.map(p => p.name), r.body.planShared], [['Standard', 'Kepong plan'], false]);
  let plans = (await boss('GET', '/setup')).body.plans;
  assert.deepEqual(plans.map(p => [p.name, p.branchIds]), [['Standard', []], ['Desa plan', [desaId]], ['Kepong plan', [kepong.id]]]);
  assert.equal((await boss('GET', '/setup')).body.ruleHistory.at(-1).until, later);

  // A rename alone moves no money: no date needed.
  assert.equal((await partner('PUT', '/my-branch/commission', { own: true, name: 'Kepong tiers', tiers: r.body.plans[1].tiers })).status, 200);
  // Back to the company's Standard plan (correcting the change that starts tomorrow); Taman Desa's plan untouched.
  const back = await partner('PUT', '/my-branch/commission', { own: false, from: later });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  plans = (await boss('GET', '/setup')).body.plans;
  assert.deepEqual(plans.map(p => [p.name, p.branchIds]), [['Standard', []], ['Desa plan', [desaId]]]);
});

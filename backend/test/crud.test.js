// Every save action the other files don't send through the API, with sign-in on:
// a Superadmin account and an agent run them through POST /api/erp/actions/<name>,
// and a fresh read of the tables must match the same action run in memory
// (shared/erpActions.js, as the demo runs it). Refusals save nothing.
process.env.AUTH_DISABLED = 'false';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { db, migrate, startApi, pick, tidy } = require('./helpers');
const A = require('../../shared/erpActions.js');
const L = require('../../shared/listings.js');
const { seedDemo } = require('../src/db/demoSeed');
const { KINDS } = require('../src/db/erpState');
const { actorArgs } = require('../src/db/erpGuard');
const { localToday } = require('../src/db/days');

let api, boss, state;
const today = localToday();
const PASSWORD = 'correct horse battery';

async function signInAs(username, staffId, role) {
  await db('users').insert({ username, name: username, role, branch_id: null, staff_id: staffId, password_hash: await bcrypt.hash(PASSWORD, 4) });
  const r = await api.call('POST', '/auth/login', { username, password: PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const call = (method, path, body) => fetch(`${api.base}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r.body.token}` }, body: body && JSON.stringify(body),
  }).then(async res => ({ status: res.status, body: await res.json().catch(() => null) }));
  return { username, call, v: { staffId } };
}

before(async () => {
  await migrate();
  await seedDemo({ asOf: today });
  api = await startApi();
  boss = await signInAs('boss', null, 'superadmin');
  const r = await boss.call('GET', '/erp/state');
  assert.equal(r.status, 200, r.body?.error);
  state = r.body;
});
after(async () => { await api.close(); await db.destroy(); });

// As state.test.js: every kind matched by id, each record with every field the demo gives it.
const parts = d => ({ ...Object.fromEntries(KINDS.map(k => [k, d[k] || []])), audit: d.audit, favourites: d.favourites || {}, runs: d.runs || {} });
const byId = (a, b) => a - b;
const byTime = list => [...(list || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.dealId - b.dealId || String(a.field).localeCompare(String(b.field)));
function sameData(have, want, what) {
  const h = parts(have);
  for (const [k, w] of Object.entries(parts(want))) {
    if (k === 'audit') { assert.deepEqual(tidy(byTime(h[k])), tidy(byTime(w)), `${what}: ${k}`); continue; }
    if (!Array.isArray(w)) { assert.deepEqual(tidy(h[k]), tidy(w), `${what}: ${k}`); continue; }
    const found = new Map(h[k].map(r => [r.id, r]));
    assert.deepEqual([...found.keys()].sort(byId), w.map(r => r.id).sort(byId), `${what}: ${k} (which records)`);
    for (const { depth, ...r } of w) assert.deepEqual(tidy(pick(found.get(r.id), r)), tidy(r), `${what}: ${k} ${r.id}`); // eslint-disable-line no-unused-vars
  }
}

// `who` runs `name` through the API; the same runs in memory on the last read. Both must agree.
async function both(who, name, ...args) {
  const mem = structuredClone(state);
  A.runClock(mem.data, mem.setup);
  const why = A[name](...actorArgs(name, args, who.v))(mem.data, mem.setup, today);
  assert.ok(!why, `${name} in memory: ${why}`);
  for (const a of mem.data.audit.slice(0, mem.data.audit.length - state.data.audit.length)) a.by = who.username;
  const r = await who.call('POST', `/erp/actions/${name}`, { args });
  assert.equal(r.status, 200, `${name}: ${r.body?.error}`);
  const saved = await boss.call('GET', '/erp/state');
  sameData(saved.body.data, mem.data, `${name} (saved)`);
  state = saved.body;
  return state.data;
}

// A refused action: the status and reason, and the tables unchanged.
async function refused(who, name, args, status, reason) {
  const r = await who.call('POST', `/erp/actions/${name}`, { args });
  assert.ok([].concat(status).includes(r.status), `${name}: ${r.status} ${r.body?.error}`);
  if (reason) assert.match(r.body.error, reason);
  sameData((await boss.call('GET', '/erp/state')).body.data, state.data, `${name} refused`);
}

const activeAgent = d => d.staff.find(s => s.type === 'staff' && s.status === 'active' && s.role);

test('customers, buildings, areas, videos, staff details and listings: edit, status and delete', async () => {
  let d = state.data;
  const c = d.customers[0];
  d = await both(boss, 'updateCustomer', c.id, { remarks: 'Edited in the CRUD test', budgetMax: 999000, track: 1, name: `${c.name} Jr` });
  d = await both(boss, 'saveTitle', { name: 'Crud Tower', area: d.areas[0].name, category: 2, remark: 'Test block' });
  const t = d.titles.at(-1);
  d = await both(boss, 'setTitleStatus', [t.id], 3);
  d = await both(boss, 'setTitleStatus', [t.id], 0);
  d = await both(boss, 'deleteTitle', t.id);
  d = await both(boss, 'saveArea', { name: 'Crud Area', state: 'Selangor' });
  const a = d.areas.at(-1);
  d = await both(boss, 'setAreaStatus', a.id, 1);
  d = await both(boss, 'setAreaStatus', a.id, 0);
  d = await both(boss, 'deleteArea', a.id);
  const busy = d.areas.find(x => d.listings.some(l => l.area === x.name && l.status === 'active'));
  await refused(boss, 'deleteArea', [busy.id], 400, /active listing/);
  d = await both(boss, 'saveVideo', { title: 'Crud video', date: today, file: 'v.mp4', cate: 'training' });
  d = await both(boss, 'deleteVideo', d.videos.at(-1).id);
  const agent = activeAgent(d);
  d = await both(boss, 'updateStaff', agent.id, { phone2: '012-111 2222', bio: 'Edited in the CRUD test' });
  d = await both(boss, 'addListing', { type: 'sale', title: 'Crud Residences', area: d.areas[0].name, askPrice: 650000, unit: 'C-9-9', ownerName: 'Owner Crud',
    ownerPhone: '0123456780', holderId: agent.id, desc: 'To delete', remarks: 'Private' });
  d = await both(boss, 'deleteListing', d.listings.at(-1).id);
  const sold = d.listings.find(l => d.deals.some(x => x.listingId === l.id));
  await refused(boss, 'deleteListing', [sold.id], 400, /has an E-Form/);
});

test('payments in and out, closes re-run and deleted, salary requests and archives', async () => {
  let d = state.data;
  // A payment recorded by mistake, then deleted.
  const open = d.deals.find(x => x.status === 'submitted');
  d = await both(boss, 'addTransaction', { dealId: open.id, amount: 100, bankOn: today, method: 'online', reference: 'CRUD1', purpose: 'other', remark: 'To delete', file: 'slip.pdf' });
  d = await both(boss, 'deleteTransaction', d.moneyIn.at(-1).id);

  // A close, re-run on today's tiers, then deleted: the E-Form is open again.
  const paid = id => d.moneyIn.filter(t => t.dealId === id && !['returned', 'invalid'].includes(t.status)).reduce((s, t) => s + t.amount, 0);
  const ready = d.deals.find(x => x.status === 'submitted' && x.money.billed > 0 && paid(x.id) >= x.money.billed);
  for (const t of d.moneyIn.filter(t => t.dealId === ready.id && t.status !== 'cleared')) d = await both(boss, 'setMoneyInStatus', t.id, 'cleared');
  d = await both(boss, 'closeDeal', ready.id);
  const close = d.closes.at(-1);
  await refused(boss, 'deleteTransaction', [d.moneyIn.find(t => t.dealId === ready.id && t.status === 'cleared').id], 400, /paid out on a close/);
  d = await both(boss, 'rerunClose', close.id);
  d = await both(boss, 'deleteClose', close.id);
  assert.equal(d.deals.find(x => x.id === ready.id).status, 'submitted');

  // Request forms: queried, approved, paid; another deleted; an approved one can't be.
  const forms = d.moneyOut.filter(m => m.status === 'new');
  assert.ok(forms.length >= 2, 'the sample has new request forms');
  d = await both(boss, 'setMoneyOutStatus', forms[0].id, 'queried', 'Check the letter');
  d = await both(boss, 'setMoneyOutStatus', forms[0].id, 'ready');
  await refused(boss, 'deleteMoneyOut', [forms[0].id], 400, /Approved requests/);
  d = await both(boss, 'setMoneyOutStatus', forms[0].id, 'paid');
  d = await both(boss, 'deleteMoneyOut', forms[1].id);

  // Salary requests: ready, then paid (its lines are paid); another not valid, then deleted.
  const reqs = d.requests.filter(r => r.status === 'new');
  assert.ok(reqs.length >= 2, 'the sample has new salary requests');
  d = await both(boss, 'setRequestStatus', reqs[0].id, 'ready');
  d = await both(boss, 'setRequestStatus', reqs[0].id, 'clear');
  assert.ok(d.payouts.filter(p => p.requestId === reqs[0].id).every(p => p.status === 'paid'));
  await refused(boss, 'deleteSalaryRequest', [reqs[0].id], 400, /already been paid/);
  d = await both(boss, 'setRequestStatus', reqs[1].id, 'invalid', 'IC copy unclear');
  d = await both(boss, 'deleteSalaryRequest', reqs[1].id);

  // The newest weekly archive undone.
  const arc = d.archives.at(-1);
  d = await both(boss, 'unarchive', arc.id);
  assert.ok(!d.payouts.some(p => p.archiveId === arc.id));
});

test('viewings moved, remarked, cancelled and reviewed; the listing checks; a suspended agent and their listings back', async () => {
  let d = state.data;
  const agent = activeAgent(d);
  const listing = d.listings.find(l => l.status === 'active' && l.holderId && l.holderId !== agent.id);
  d = await both(boss, 'bookViewing', { listingIds: [listing.id], requestedBy: agent.id, customerName: 'Crud Viewer', customerPhone: '012-777 8888',
    date: '2099-03-05', time: '11:00', minutes: 60 });
  const v = d.viewings.at(-1);
  d = await both(boss, 'rescheduleViewing', v.id, { date: '2099-03-06', time: '15:00', minutes: 60, reason: 'The customer asked' });
  d = await both(boss, 'addViewingRemark', v.id, 'Bring the key', 0);
  d = await both(boss, 'cancelViewing', v.id, 'The customer found another unit', 0);
  await refused(boss, 'cancelViewing', [v.id, 'Again', 0], 400, /Only an upcoming viewing/);

  // A viewing that is over waits for the agent's review.
  let past = d.viewings.find(x => x.status === 'review');
  if (!past) {
    await db('viewings').where('id', d.viewings[0].id).update({ status: 'review' });
    state = (await boss.call('GET', '/erp/state')).body;
    d = state.data;
    past = d.viewings.find(x => x.status === 'review');
  }
  d = await both(boss, 'reviewViewing', past.id, { outcome: Object.keys(L.VIEWING_OUTCOME)[0], text: 'Liked the layout' });

  d = await both(boss, 'recheckHandlers');
  d = await both(boss, 'recheckBuildingLeads');
  d = await both(boss, 'markOutdated');

  // Suspended: their listings go to a stand-in; active again: they come back.
  const holder = d.staff.find(s => s.status === 'active' && s.type === 'staff' && d.listings.filter(l => l.holderId === s.id && l.status === 'active').length >= 2);
  const theirs = d.listings.filter(l => l.holderId === holder.id && l.status === 'active').map(l => l.id);
  d = await both(boss, 'setStaffStatus', holder.id, 'suspended');
  assert.ok(theirs.some(id => d.listings.find(l => l.id === id).holderId !== holder.id), 'listings handed on');
  await refused(boss, 'returnListings', [holder.id], 400, /Switch the account back on/);
  d = await both(boss, 'setStaffStatus', holder.id, 'active');
  d = await both(boss, 'returnListings', holder.id);
  assert.ok(theirs.every(id => d.listings.find(l => l.id === id).holderId === holder.id), 'listings back');
});

test('an agent stacks or claims their own Ready commission, and nobody else\'s; office actions are refused', async () => {
  let d = state.data;
  const readyOf = id => d.payouts.filter(p => p.staffId === id && p.status === 'approved' && !p.requestId && !p.stacked);
  const earner = d.staff.find(s => s.status === 'active' && s.type === 'staff' && readyOf(s.id).length >= 2);
  assert.ok(earner, 'an agent with Ready lines');
  const agent = await signInAs('earner1', earner.id, 'staff');
  // Their first request marks them active for the day (db/activity.js).
  assert.equal((await agent.call('GET', '/erp/start')).status, 200);
  state = (await boss.call('GET', '/erp/state')).body;
  d = state.data;
  const [one, two] = readyOf(earner.id);
  d = await both(agent, 'stackPay', earner.id, [one.id]);
  assert.equal(d.payouts.find(p => p.id === one.id).stacked, true);
  d = await both(agent, 'claimPay', earner.id, [one.id, two.id]);
  assert.ok([one.id, two.id].every(id => d.payouts.find(p => p.id === id).requestId), 'both requested');
  const someoneElses = d.payouts.find(p => p.staffId !== earner.id && p.status === 'approved' && !p.requestId);
  await refused(agent, 'claimPay', [earner.id, [someoneElses.id]], [400, 403]);
  await refused(agent, 'setMoneyOutStatus', [d.moneyOut[0].id, 'paid'], 403);
  await refused(agent, 'markOutdated', [], 403);
});

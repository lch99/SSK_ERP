// Stage one of the ERP on the server (db/erpState.js, /api/erp/state and
// /api/erp/actions): the pages get the records as the demo store gives them,
// and each action (shared/erpActions.js), run by the server on what it read
// from the tables, saves exactly what the same action does in the browser.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, migrate, startApi, pick, tidy } = require('./helpers');
const A = require('../../shared/erpActions.js');
const J = require('../../shared/projects.js');
const { seedDemo } = require('../src/db/demoSeed');
const { KINDS, saveChanges } = require('../src/db/erpState');
const { actorArgs } = require('../src/db/erpGuard');
const { localToday } = require('../src/db/days');

let api, sample, state;
const today = localToday();
// Sign-in is off in these tests: the server acts as an office account (actor 0).
const office = { staffId: null };

before(async () => {
  await migrate();
  sample = (await seedDemo({ asOf: today })).data;
  api = await startApi();
});
after(async () => { await api.close(); await db.destroy(); });

// Every kind of record, the E-Form history, favourites and last checks.
const parts = d => ({ ...Object.fromEntries(KINDS.map(k => [k, d[k] || []])), audit: d.audit, favourites: d.favourites || {}, runs: d.runs || {},
  v1Eforms: d.v1?.eforms || [], v1Overrides: d.v1?.overrides || [] });
const byId = (a, b) => a - b;
// The same records, matched by id, each with every field `want` gives it (the
// tables may add blank ones a new record did not have, e.g. stacked: false).
function sameData(have, want, what) {
  const h = parts(have);
  for (const [k, w] of Object.entries(parts(want))) {
    if (!Array.isArray(w) || k === 'audit') { assert.deepEqual(tidy(h[k]), tidy(w), `${what}: ${k}`); continue; }
    const found = new Map(h[k].map(r => [r.id, r]));
    assert.deepEqual([...found.keys()].sort(byId), w.map(r => r.id).sort(byId), `${what}: ${k} (which records)`);
    // depth only shapes the made-up chart; nothing reads it, so it is not stored.
    for (const { depth, ...r } of w) assert.deepEqual(tidy(pick(found.get(r.id), r)), tidy(r), `${what}: ${k} ${r.id}`); // eslint-disable-line no-unused-vars
  }
}

test('the whole ERP reads back as the demo made it', async () => {
  const r = await api.call('GET', '/erp/state');
  state = r.body;
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.blockers, []);
  // Reading runs the time rules first (viewings expire…), as the demo store does.
  const want = structuredClone(sample);
  A.runClock(want, r.body.setup);
  sameData(r.body.data, want, 'state');
  // Lists come back in the demo's order too (a few pages show them as they come);
  // notices of the same minute put the later one first, as a new one goes on top.
  for (const k of ['enquiries', 'moneyIn', 'payouts']) assert.deepEqual(r.body.data[k].map(x => x.id), sample[k].map(x => x.id), `${k} order`);
});

// Runs `name` in memory on the last state (after the time rules, acting as the
// server's signed-in account) and through the API, then reads the tables back:
// both must agree.
async function both(name, ...args) {
  const mem = structuredClone(state);
  A.runClock(mem.data, mem.setup);
  const why = A[name](...actorArgs(name, args, office))(mem.data, mem.setup, today);
  assert.ok(!why, `${name} in memory: ${why}`);
  // New E-Form history is credited to whoever is signed in ('demo' with sign-in off).
  for (const a of mem.data.audit.slice(0, mem.data.audit.length - state.data.audit.length)) a.by = 'demo';
  const r = await api.call('POST', `/erp/actions/${name}`, { args });
  assert.equal(r.status, 200, `${name}: ${r.body?.error}`);
  sameData(r.body.data, mem.data, `${name} (reply)`);
  const saved = await api.call('GET', '/erp/state');
  sameData(saved.body.data, mem.data, `${name} (saved)`);
  state = saved.body;
  return state.data;
}

test('every kind of action saves what the demo saves', async () => {
  let d = state.data;
  const agent = d.staff.find(s => s.type === 'staff' && s.status === 'active');
  const listing = d.listings.find(l => l.type === 'sale' && l.status === 'active' && !l.dealId && l.holderId && l.holderId !== agent.id);
  const party = n => ({ name: `${n} Test`, ic: '800101-14-5555', phone: '012-345 6789', address: '1, Jalan Ujian', email: `${n.toLowerCase()}@example.com` });

  // An E-Form: submitted, edited, a document, an invoice; money in and out.
  d = await both('addDeal', { type: 'sale', agentId: agent.id, listingId: listing.id, price: 500000, fee: 15000, date: today, submit: true,
    buyer: party('Buyer'), owner: party('Owner'), remark: 'Test deal', files: { SPA: 'spa.pdf' } });
  const deal = d.deals.at(-1);
  d = await both('updateDeal', deal.id, { ...deal, remark: 'Edited' });
  d = await both('setDealDoc', deal.id, 'Buyer IC', 'ic.pdf');
  d = await both('requestInvoice', deal.id);
  d = await both('addTransaction', { dealId: deal.id, amount: 30000, bankOn: today, method: 'online', reference: 'IBG1', purpose: 'deposit', remark: 'Deposit', file: 'slip.pdf' });
  const tx = d.moneyIn.at(-1);
  d = await both('updateTransaction', tx.id, { remark: 'Deposit, edited' });
  d = await both('setMoneyInStatus', tx.id, 'cleared');
  d = await both('raiseRequest', deal.id, 'balance', { bank: 'Maybank', account: '5555', amount: 1000, letter: 'letter.pdf' });
  d = await both('updateMoneyOut', d.moneyOut.at(-1).id, { method: 'cheque', chequeNo: '123456', receipt: 'r.pdf' });

  // A close through to approved, requested and archived payout lines.
  const paid = id => d.moneyIn.filter(t => t.dealId === id && !['returned', 'invalid'].includes(t.status)).reduce((s, t) => s + t.amount, 0);
  const ready = d.deals.find(x => x.status === 'submitted' && paid(x.id) >= x.money.billed);
  for (const t of d.moneyIn.filter(t => t.dealId === ready.id && t.status !== 'cleared')) d = await both('setMoneyInStatus', t.id, 'cleared');
  d = await both('closeDeal', ready.id);
  const lines = d.payouts.filter(p => p.dealId === ready.id);
  d = await both('approvePayouts', lines.map(l => l.id));
  d = await both('createRequests', [...new Set(lines.map(l => l.staffId))], 'salary');
  d = await both('archiveCases');

  // Listings, customers, staff, titles, areas, videos, owner requests, enquiries.
  d = await both('addListing', { type: 'rental', title: 'Test Residences', area: listing.area, askPrice: 2000, unit: 'A-1-1', ownerName: 'Owner Two', ownerPhone: '0123456789',
    holderId: agent.id, desc: 'Nice', remarks: 'Private' });
  const l2 = d.listings.at(-1);
  d = await both('updateListing', l2.id, { trackingPrice: 1900, status: 'active' });
  d = await both('addListingFollowUp', l2.id, { action: 1, remark: 'Viewing', appointmentDate: today, appointmentTime: '10:00' });
  d = await both('addCustomer', { name: 'Cust Test', phone: '012-999 0000', type: 'Rent', area: 'Cheras', budgetMin: 1000, budgetMax: 2000, remarks: 'Looking' });
  d = await both('addCustomerFollowUp', d.customers.at(-1).id, { action: 'Viewing', remark: 'Saw it', listingId: l2.code, price: 1950 });
  d = await both('addStaff', { username: 'newagent', name: 'New Agent', branchId: agent.branchId, phone: '012-000 1111', accountName: 'New Agent' });
  d = await both('setMarketingStaffs', d.staff.at(-1).id, [{ staffId: agent.id, customers: true, listings: false, shared: true }]);
  d = await both('saveTitle', { name: 'Test Tower', area: listing.area, category: 2, remark: 'New block' });
  d = await both('saveArea', { name: 'Test Area', state: 'Selangor' });
  d = await both('saveVideo', { title: 'Test video', date: today, file: 'v.mp4', cate: 'meeting' });
  d = await both('addPropertyType', 'Test Type');
  d = await both('setVendorRequest', d.vendorRequests[0].id, 1);
  d = await both('updateEnquiry', d.enquiries[0].id, { starred: true });

  // Listing life: a viewing, favourites, notifications, owner details; downtime.
  d = await both('bookViewing', { listingIds: [listing.id], requestedBy: agent.id, customerName: 'Viewer Test', customerPhone: '012-777 8888',
    date: today < '2099-01-01' ? '2099-01-05' : today, time: '11:00', minutes: 60 });
  d = await both('confirmViewing', d.viewings.at(-1).id, listing.holderId);
  d = await both('toggleFavourite', 'listings', listing.id, agent.id);
  d = await both('sendNotice', { to: agent.id, text: 'Hello from the test' });
  d = await both('readNotices', 'all', agent.id);
  d = await both('revealOwner', listing.id, agent.id);
  d = await both('scheduleDowntime', { start: '2099-02-01 01:00', end: '2099-02-01 03:00', message: 'Upgrade', closes: true, by: 0 });
  d = await both('cancelDowntime', d.downtime.at(-1).id);

  // Deletes: the draft E-Form and a property type.
  d = await both('addDeal', { type: 'rental', agentId: agent.id, price: 2000, fee: 2000, date: today, submit: false, buyer: party('Tenant'), owner: party('Landlord') });
  d = await both('deleteDeal', d.deals.at(-1).id);
  await both('deletePropertyType', d.propertyTypes.at(-1).id);
});

// Projects: the changes shared with the demo's project store (shared/projects.js), on the server's records.
async function bothProjects(name, change, ...args) {
  const mem = structuredClone(state.data);
  A.runClock(mem, state.setup);
  const s = { projects: mem.projects, nextId: Math.max(0, ...mem.projects.flatMap(p => [p.id, ...p.incentives.map(i => i.id)])) + 1 };
  const want = change(s);
  mem.projects = s.projects;
  const r = await api.call('POST', `/erp/actions/${name}`, { args });
  assert.equal(r.status, 200, `${name}: ${r.body?.error}`);
  const saved = await api.call('GET', '/erp/state');
  sameData(saved.body.data, mem, name);
  if (want !== undefined) assert.deepEqual(tidy(pick(r.body.result, want)), tidy(want), `${name}: result`);
  state = saved.body;
  return r.body.result;
}

test('projects and their incentives save as the demo saves them', async () => {
  const tiers = state.setup.tiers;
  assert.ok(state.data.projects.length > 0, 'the sample has projects');
  const draft = { id: null, name: 'Test Launch', developer: 'Dev Co', location: 'Cheras', category: 'Condominium', units: '', priceFrom: '',
    devCommissionPct: 3, payout: { mode: 'boost', boostPct: 2 } };
  const p = await bothProjects('saveProject', s => J.saveProjectIn(s, draft, tiers), draft);
  await bothProjects('saveProject', s => J.saveProjectIn(s, { ...p, units: 200 }, tiers), { ...p, units: 200 });
  const inc = { name: 'Launch bonus', from: today, to: today, kind: 'perUnit', counts: 'company', perUnit: 300, paidTo: 'agents', agentPct: '' };
  const i = await bothProjects('saveIncentive', s => J.saveIncentiveIn(s, p.id, inc), p.id, inc);
  await bothProjects('deleteIncentive', s => J.deleteIncentiveIn(s, p.id, i.id), p.id, i.id);
  // The same name twice is refused, and nothing is saved.
  const r = await api.call('POST', '/erp/actions/saveProject', { args: [{ ...draft }] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /already a project called/);
});

test('a refused action changes nothing and says why', async () => {
  const r = await api.call('POST', '/erp/actions/queryPayouts', { args: [[1], '   '] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Say what needs checking/);
  const now = await api.call('GET', '/erp/state');
  sameData(now.body.data, state.data, 'after a refusal');
});

test('an unknown action is not found', async () => {
  assert.equal((await api.call('POST', '/erp/actions/getErp', { args: [] })).status, 404);
  assert.equal((await api.call('POST', '/erp/actions/nope', { args: [] })).status, 404);
});

test('notices are never deleted by a save, and each action is in the audit log with who ran it', async () => {
  const before = structuredClone(state.data);
  const after = structuredClone(state.data);
  after.notices = after.notices.slice(1);
  await db.transaction(trx => saveChanges(trx, before, after));
  assert.equal(Number((await db('notices').count({ n: '*' }).first()).n), before.notices.length);
  const r = await api.call('POST', '/erp/actions/sendNotice', { args: [{ to: 'all', text: 'Audit me' }] });
  assert.equal(r.status, 200, r.body?.error);
  const row = await db('audit_log').where({ entity: 'erp', action: 'sendNotice' }).orderBy('id', 'desc').first();
  assert.equal(row.username, 'demo');
  assert.ok(JSON.parse(row.detail).changed.notices.length === 1);
});

test('someone with pay records or created listings cannot be deleted: a reason, not a server error', async () => {
  const creator = state.data.staff.find(s => state.data.listings.some(l => l.creatorId === s.id) && !state.data.listings.some(l => l.holderId === s.id)
    && !state.data.deals.some(d => d.agentId === s.id || d.holderId === s.id)) || state.data.staff.find(s => state.data.requests.some(q => q.staffId === s.id));
  const r = await api.call('POST', '/erp/actions/deleteStaff', { args: [creator.id] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Set them Inactive instead/);
});

test('the start-up read sends the small kinds only; an action asked for a small reply gives the same, with the ids it made', async () => {
  const start = await api.call('GET', '/erp/start');
  assert.equal(start.status, 200, start.body?.error);
  for (const k of ['staff', 'titles', 'areas', 'propertyTypes']) assert.ok(start.body.data[k].length > 0, k);
  for (const k of ['deals', 'listings', 'payouts', 'moneyIn', 'notices', 'customers', 'audit']) assert.deepEqual(start.body.data[k], [], k);
  assert.deepEqual(start.body.data.v1, { eforms: [], overrides: [] });
  const r = await api.call('POST', '/erp/actions/addCustomer', { args: [{ name: 'Start Read', phone: '012-000 1111', type: 'Sale', ownerId: sample.staff[0].id }], small: true });
  assert.equal(r.status, 200, r.body?.error);
  assert.deepEqual(r.body.data.customers, []);
  assert.equal((await db('customers').where({ id: r.body.added.customers[0] }).first()).name, 'Start Read');
});

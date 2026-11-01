// Stage one of the ERP on the server (db/erpState.js, /api/erp/state and
// /api/erp/actions): the pages get every record as the demo store gives them,
// and each action, run by the server on what it read from the tables, saves
// exactly what the same action does in the browser.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, migrate, startApi, pick, tidy } = require('./helpers');
const erp = require('../../src/demo/erpApi.js');
const projects = require('../../src/demo/projectsApi.js');
const { seedDemo } = require('../src/db/demoSeed');
const { KINDS } = require('../src/db/erpState');

let api, sample, state;
const today = new Date().toISOString().slice(0, 10);

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
  erp.clockOn({ data: want, setup: r.body.setup });
  sameData(r.body.data, want, 'state');
  // Lists come back in the demo's order too (a few pages show them as they come).
  for (const k of ['enquiries', 'notices', 'moneyIn', 'payouts']) assert.deepEqual(r.body.data[k].map(x => x.id), sample[k].map(x => x.id), `${k} order`);
});

// Runs `name` in memory on the last state and through the API; both must agree.
async function both(name, ...args) {
  const mem = structuredClone(state);
  await erp.runOn(mem, () => erp[name](...args));
  const r = await api.call('POST', `/erp/actions/${name}`, { args });
  assert.equal(r.status, 200, `${name}: ${r.body?.error}`);
  sameData(r.body.data, mem.data, name);
  state = r.body;
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

// Projects: the demo's own store's changes (src/demo/projectsApi.js), on the server's records.
async function bothProjects(name, change, ...args) {
  const mem = structuredClone(state.data);
  const s = { projects: mem.projects, nextId: Math.max(0, ...mem.projects.flatMap(p => [p.id, ...p.incentives.map(i => i.id)])) + 1 };
  const want = change(s);
  mem.projects = s.projects;
  const r = await api.call('POST', `/erp/actions/${name}`, { args });
  assert.equal(r.status, 200, `${name}: ${r.body?.error}`);
  sameData(r.body.data, mem, name);
  if (want !== undefined) assert.deepEqual(tidy(pick(r.body.result, want)), tidy(want), `${name}: result`);
  state = r.body;
  return r.body.result;
}

test('projects and their incentives save as the demo saves them', async () => {
  const tiers = state.setup.tiers;
  assert.ok(state.data.projects.length > 0, 'the sample has projects');
  const draft = { id: null, name: 'Test Launch', developer: 'Dev Co', location: 'Cheras', category: 'Condominium', units: '', priceFrom: '',
    devCommissionPct: 3, payout: { mode: 'boost', boostPct: 2 } };
  const p = await bothProjects('saveProject', s => projects.saveProjectIn(s, draft, tiers), draft);
  await bothProjects('saveProject', s => projects.saveProjectIn(s, { ...p, units: 200 }, tiers), { ...p, units: 200 });
  const inc = { name: 'Launch bonus', from: today, to: today, kind: 'perUnit', counts: 'company', perUnit: 300, paidTo: 'agents', agentPct: '' };
  const i = await bothProjects('saveIncentive', s => projects.saveIncentiveIn(s, p.id, inc), p.id, inc);
  await bothProjects('deleteIncentive', s => projects.deleteIncentiveIn(s, p.id, i.id), p.id, i.id);
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

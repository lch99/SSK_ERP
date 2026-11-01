// Everything the demo's write actions save (src/demo/erpApi.js) has a place in
// the tables: run them, write every record, read it back the same. Fields with
// no column of their own land in `more`; the list below makes new ones visible.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, migrate, pick, tidy } = require('./helpers');
const { loadSample } = require('../../src/demo/localApi.js');
const erp = require('../../src/demo/erpApi.js');
const { MODELS, toRecords, childRows } = require('../src/db/records');
const { replaceState } = require('../src/db/setupStore');
const S = require('../../shared/setupState.js');
const { ORDER } = require('../src/db/demoSeed');

// Fields kept in `more` today. Give one a column (and take it off this list)
// once a list filters or sorts on it.
const IN_MORE = {
  // phLog: the product handler history (shared/listings.js), kept here until the listing roles get their own table.
  listings: ['trackingPrice', 'commission', 'phLog'],
  titles: ['managerId', 'remark'],
};

let data;
const today = new Date().toISOString().slice(0, 10);
const ok = async p => { const r = await p; data = r.data; return r; };

before(async () => {
  await migrate();
  await loadSample();
  ({ data } = await erp.getErp());
  const agent = data.staff.find(s => s.type === 'staff' && s.status === 'active');
  const listing = data.listings.find(l => l.type === 'sale' && l.status === 'active' && !l.dealId && l.holderId);
  const party = n => ({ name: `${n} Test`, ic: '800101-14-5555', phone: '012-345 6789', address: '1, Jalan Ujian', email: `${n.toLowerCase()}@example.com` });

  // An E-Form with every part filled, submitted, edited, with a document and an invoice.
  await ok(erp.addDeal({ type: 'sale', agentId: agent.id, listingId: listing.id, price: 500000, fee: 15000, date: today, submit: true,
    buyer: party('Buyer'), owner: party('Owner'), otherBuyers: [{ ...party('Second'), ic: '800101145556' }],
    coBroke: { agency: 'Bayu Prime Realty', licence: 'E (1) 1532', agent: 'Yap', phone: '012-111 2222', address: 'KL' },
    referral: { name: 'Intro Person', ic: '800101-14-5557', phone: '012-333 4444', bank: 'Maybank', account: '1234' }, remark: 'Test deal', files: { SPA: 'spa.pdf' } }));
  const deal = data.deals.at(-1);
  await ok(erp.updateDeal(deal.id, { ...deal, agentId: deal.agentId, listingId: deal.listingId, remark: 'Edited' }));
  await ok(erp.setDealDoc(deal.id, 'Buyer IC', 'ic.pdf'));
  await ok(erp.requestInvoice(deal.id));
  // Money in, edited and cleared; money out of each kind.
  await ok(erp.addTransaction({ dealId: deal.id, amount: 30000, bankOn: today, method: 'online', reference: 'IBG1', purpose: 'deposit', remark: 'Deposit', file: 'slip.pdf' }));
  const tx = data.moneyIn.at(-1);
  await ok(erp.updateTransaction(tx.id, { remark: 'Deposit, edited' }));
  await ok(erp.setMoneyInStatus(tx.id, 'cleared'));
  await ok(erp.raiseRequest(deal.id, 'balance', { bank: 'Maybank', account: '5555', amount: 1000, letter: 'letter.pdf' }));
  await ok(erp.raiseRequest(deal.id, 'transfer', { bank: 'CIMB Bank', account: '6666', amount: 500, letter: 't.pdf', payee: 'Someone', ic: '800101-14-1111' }));
  const out = data.moneyOut.at(-1);
  await ok(erp.updateMoneyOut(out.id, { method: 'cheque', chequeNo: '123456', receipt: 'r.pdf' }));
  // A close through to a paid, archived case.
  const ready = data.deals.find(d => d.status === 'submitted' && data.moneyIn.filter(t => t.dealId === d.id && !['returned', 'invalid'].includes(t.status)).reduce((s, t) => s + t.amount, 0) >= d.money.billed);
  for (const t of data.moneyIn.filter(t => t.dealId === ready.id && t.status !== 'cleared')) await ok(erp.setMoneyInStatus(t.id, 'cleared'));
  await ok(erp.closeDeal(ready.id));
  const lines = data.payouts.filter(p => p.dealId === ready.id);
  await ok(erp.approvePayouts(lines.map(l => l.id)));
  await ok(erp.createRequests([...new Set(lines.map(l => l.staffId))], 'salary'));
  await ok(erp.archiveCases());
  // Listings, customers, staff, titles, areas, videos, vendor requests, enquiries.
  await ok(erp.addListing({ type: 'rental', title: 'Test Residences', area: listing.area, askPrice: 2000, unit: 'A-1-1', ownerName: 'Owner Two', ownerPhone: '0123456789',
    holderId: agent.id, desc: 'Nice', remarks: 'Private', photoSet: [{ id: 1, name: 'a.jpg', published: true, cover: true, preview: 'k1' }] }));
  const l2 = data.listings.at(-1);
  await ok(erp.updateListing(l2.id, { trackingPrice: 1900, commission: 1, videoSet: [{ id: 1, name: 'v.mp4' }], status: 'active' }));
  await ok(erp.addListingFollowUp(l2.id, { action: 1, remark: 'Viewing', appointmentDate: today, appointmentTime: '10:00' }));
  await ok(erp.addCustomer({ name: 'Cust Test', phone: '012-999 0000', type: 'Rent', area: 'Cheras', budgetMin: 1000, budgetMax: 2000, remarks: 'Looking' }));
  const c = data.customers.at(-1);
  await ok(erp.addCustomerFollowUp(c.id, { action: 'Viewing', remark: 'Saw it', listingId: l2.code, price: 1950 }));
  await ok(erp.addStaff({ username: 'newagent', name: 'New Agent', branchId: agent.branchId, phone: '012-000 1111', phone2: '012-000 2222', accountName: 'New Agent',
    regType: 'REN', regNo: '12345', socials: { facebook: 'x' }, awards: ['Top'], docs: { 'NRIC Copy': true }, extra: { shirt: 'M' } }));
  const s = data.staff.at(-1);
  await ok(erp.setMarketingStaffs(s.id, [{ staffId: agent.id, customers: true, listings: false, shared: true }]));
  await ok(erp.saveTitle({ name: 'Test Tower', area: listing.area, category: 2, remark: 'New block' }));
  await ok(erp.saveArea({ name: 'Test Area', state: 'Selangor' }));
  await ok(erp.saveVideo({ title: 'Test video', date: today, file: 'v.mp4', cate: 'meeting' }));
  await ok(erp.addPropertyType('Test Type'));
  const vr = data.vendorRequests[0];
  await ok(erp.setVendorRequest(vr.id, 1));
  await ok(erp.updateEnquiry(data.enquiries[0].id, { starred: true }));
  const closed = data.deals.find(d => d.status === 'closed' && d.landlordCheck);
  if (closed) await ok(erp.verifyLandlord(closed.id, 1, 'Phoned'));
});
after(() => db.destroy());

test('every record the actions saved goes into the tables and reads back the same', async () => {
  // The sample's Setup, then every record (as the seed does), straight from the demo store.
  await replaceState(S.sampleState());
  await db.transaction(async trx => {
    for (const key of ORDER) {
      const m = MODELS[key];
      const records = key === 'v1Eforms' ? data.v1.eforms : key === 'v1Overrides' ? data.v1.overrides : data[key] || [];
      for (const r of records) await trx(m.table).insert(m.toRow({ ...r, ...(key === 'staff' ? { uplineId: null } : {}) }, { strict: true, full: true }));
      if (key === 'staff') for (const r of records.filter(x => x.uplineId != null)) await trx('staff').where('id', r.id).update({ upline_id: r.uplineId });
      for (const k of records.flatMap(r => childRows(m, r, { strict: true }))) await trx(k.table).insert(k.row);
    }
  });
  for (const key of ORDER) {
    const m = MODELS[key];
    const want = key === 'v1Eforms' ? data.v1.eforms : key === 'v1Overrides' ? data.v1.overrides : data[key] || [];
    const byId = new Map((await toRecords(db, m, await db(m.table))).map(r => [r.id, r]));
    for (const w of want) {
      const { depth, ...rest } = w; // eslint-disable-line no-unused-vars
      assert.deepEqual(tidy(pick(byId.get(w.id), rest)), tidy(rest), `${key} ${w.id}`);
    }
  }
});

test('the fields kept in `more` are the known ones', () => {
  const found = {};
  for (const key of ORDER) {
    const keys = new Set((data[key] || []).flatMap(r => MODELS[key].overflow(r)));
    if (keys.size) found[key] = [...keys].sort();
  }
  assert.deepEqual(found, Object.fromEntries(Object.entries(IN_MORE).map(([k, v]) => [k, [...v].sort()])));
});

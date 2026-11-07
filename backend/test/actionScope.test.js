// A save loads only the listings its action works on, and the rest of their buildings
// (db/actionScope.js); an action that scans every listing loads them all.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, migrate } = require('./helpers');
const { seedDemo } = require('../src/db/demoSeed');
const { listingsFor, codeFloor } = require('../src/db/actionScope');

before(async () => { await migrate(); await seedDemo({ asOf: '2026-10-28' }); });
after(() => db.destroy());

test("a listing's action loads its building, nothing else; one that scans them all loads all", async () => {
  const { title_id: building } = await db('listings').whereNotNull('title_id').groupBy('title_id').havingRaw('count(*) > 1').first('title_id');
  const mates = (await db('listings').where('title_id', building).orderBy('id').pluck('id'));
  assert.deepEqual((await listingsFor(db, 'updateListing', [mates[0], {}])).sort((a, b) => a - b), mates);
  const deal = await db('deals').whereIn('listing_id', mates).first('id');
  // Through its E-Form: the E-Form's listing and the rest of its building.
  if (deal) assert.deepEqual((await listingsFor(db, 'closeDeal', [deal.id])).sort((a, b) => a - b), mates);
  assert.equal(await listingsFor(db, 'deleteTitle', [building]), null);
  assert.deepEqual(await listingsFor(db, 'addDeal', [{ type: 'project' }]), []);
});

test('the next listing code comes from the highest one, without reading every listing', async () => {
  const codes = await db('listings').where('code', 'like', 'LIST-%').pluck('code');
  assert.equal((await codeFloor(db)).listing, Math.max(...codes.map(c => Number(c.slice(5)))));
});

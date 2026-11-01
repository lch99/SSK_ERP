// The demo's sample goes into the tables and comes back as the same records.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, migrate, pick, tidy } = require('./helpers');
const { seedDemo, ORDER } = require('../src/db/demoSeed');
const { MODELS, toRecords } = require('../src/db/records');

let sample;
before(async () => { await migrate(); sample = (await seedDemo({ asOf: '2026-10-28' })).data; });
after(() => db.destroy());

for (const key of ORDER) {
  test(`${key}: every record reads back as the demo made it`, async () => {
    const m = MODELS[key];
    const want = sample[key] || [];
    const got = await toRecords(db, m, await db(m.table).orderBy('id'));
    assert.equal(got.length, want.length);
    const byId = new Map(got.map(r => [r.id, r]));
    for (const w of want) {
      const { depth, ...rest } = w; // eslint-disable-line no-unused-vars
      assert.deepEqual(tidy(pick(byId.get(w.id), rest)), tidy(rest), `${key} ${w.id}`);
    }
  });
}

test('the E-Form update tracker is kept in the audit log', async () => {
  const n = await db('audit_log').where('entity', 'deal').count({ n: '*' }).first();
  assert.equal(Number(n.n), sample.audit.length);
});

test('seeding again replaces the records instead of adding to them', async () => {
  await seedDemo({ asOf: '2026-10-28' });
  const n = await db('deals').count({ n: '*' }).first();
  assert.equal(Number(n.n), sample.deals.length);
});

// The /panel's people (its own PostgreSQL) onto the new staff records by their shared ids: bio, socials,
// registration, feature switches and awards; a blank in the panel leaves the record as it is.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, migrate } = require('./helpers');
const { seedDemo } = require('../src/db/demoSeed');
const { readPanel, applyPanel } = require('../src/legacy/panel');
const { parseJson } = require('../src/db/records');

let data;
before(async () => { await migrate(); data = (await seedDemo({ asOf: '2026-10-28' })).data; });
after(() => db.destroy());

test('panel details land on the same people; blanks keep what is there', async () => {
  const [a, b] = data.staff.filter(s => s.type === 'staff');
  await db('staff').where('id', b.id).update({ bio: 'Kept as it was.', access: JSON.stringify({ agent: true, addListing: true, tripIncentive: false }) });
  // The panel's rows as PostgreSQL gives them (json columns as objects; a jsonb could also come as text).
  const panel = {
    staff: [
      { ID: a.id, Bio: 'Ten years in Kepong condos.', SocialLinks: { Facebook: 'https://facebook.com/a', TikTok: '', Lemon8: 'https://lemon8.com/a' },
        AgentCertification: 'REN', AgentCertificationNumber: '31234', FeatureFlags: { AgentProfilePage: true, TripIncentiveListings: true, EnlistSinlandBOP: true }, AvatarMediaUID: 'abc123' },
      { ID: b.id, Bio: '', SocialLinks: '{}', AgentCertification: null, AgentCertificationNumber: null, FeatureFlags: '{"AgentProfilePage":false}', AvatarMediaUID: null },
      { ID: 999999, Bio: 'Not one of ours.' },
    ],
    awards: [{ StaffID: a.id, AwardName: 'Top Negotiator 2025', AwardingOrganization: 'SubSaleKing', DateReceived: new Date('2025-12-20T00:00:00Z'), AwardDescription: null, SortOrder: 1 }],
  };
  const r = await applyPanel(db, panel);
  assert.deepEqual(r, { panel: 3, matched: 2, notFound: 1, bios: 1, socials: 1, registrations: 1, switches: 2, awards: 1, photosLeft: 1 });
  const A = await db('staff').where('id', a.id).first();
  assert.equal(A.bio, 'Ten years in Kepong condos.');
  assert.deepEqual(parseJson(A.socials), { ...(a.socials || {}), facebook: 'https://facebook.com/a', lemon8: 'https://lemon8.com/a' });
  assert.deepEqual([A.reg_type, A.reg_no], ['REN', '31234']);
  assert.equal(parseJson(A.access).profilePage, true);
  assert.equal(parseJson(A.access).tripIncentive, true);
  assert.deepEqual(parseJson(A.awards), [{ name: 'Top Negotiator 2025', org: 'SubSaleKing', date: '2025-12-20' }]);
  const B = await db('staff').where('id', b.id).first();
  assert.equal(B.bio, 'Kept as it was.');
  assert.deepEqual(parseJson(B.access), { agent: true, addListing: true, tripIncentive: false, profilePage: false });
});

test('the panel is read with its own (quoted) table and column names, deleted rows left out', async () => {
  const asked = [];
  await readPanel({ query: async sql => { asked.push(sql); return { rows: [] }; } });
  assert.match(asked[0], /from "Staff" where "DeletedAt" is null/);
  assert.match(asked[1], /from "StaffAward" where "DeletedAt" is null/);
});

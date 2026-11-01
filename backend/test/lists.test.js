// Lists are paged, searched, filtered and counted by the database, and each
// viewer sees exactly what the demo shows them (visibleData in shared/access.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, migrate, startApi } = require('./helpers');
const AC = require('../../shared/access.js');
const { seedDemo } = require('../src/db/demoSeed');
const { LISTS, scopeFor } = require('../src/db/lists');
const { listPage } = require('../src/db/list');
const { teamIds } = require('../src/middleware/access');

let api, data;
before(async () => { await migrate(); data = (await seedDemo({ asOf: '2026-10-28' })).data; api = await startApi(); });
after(async () => { await api.close(); await db.destroy(); });

async function allIds(spec, viewer, params = {}) {
  const ids = [];
  for (let page = 1; ; page++) {
    const r = await listPage(db, spec, { ...params, page, size: 200 }, scopeFor(spec, viewer));
    ids.push(...r.rows.map(x => x.id));
    if (page * 200 >= r.total) return ids.sort((a, b) => a - b);
  }
}
const demoKey = key => ({ v1Eforms: d => d.v1.eforms, v1Overrides: d => d.v1.overrides })[key] || (d => d[key]);

test('a branch viewer and a team viewer see what the demo shows them, in every list', async () => {
  const leader = data.staff.find(s => s.role && s.uplineId == null && data.staff.some(x => x.uplineId === s.id));
  const viewers = [
    { scope: 'branch', branchId: leader.branchId, staffId: null },
    { scope: 'team', branchId: leader.branchId, staffId: leader.id, team: await teamIds(db, leader.id) },
  ];
  for (const v of viewers) {
    const shown = AC.visibleData(data, { staffId: v.staffId, branchId: v.branchId }, v.scope);
    for (const [key, spec] of Object.entries(LISTS)) {
      const want = (demoKey(key)(shown) || []).map(x => x.id).sort((a, b) => a - b);
      assert.deepEqual(await allIds(spec, v), want, `${key}, ${v.scope}`);
    }
  }
});

test('a team is the person and everyone under them', async () => {
  const leader = data.staff.find(s => s.role && s.uplineId == null);
  assert.deepEqual((await teamIds(db, leader.id)).sort((a, b) => a - b), [...AC.teamOf(leader.id, data.staff)].sort((a, b) => a - b));
});

test('a list comes a page at a time, newest first, with the total', async () => {
  const r = await api.call('GET', '/erp/deals?size=10');
  assert.equal(r.status, 200);
  assert.equal(r.body.total, data.deals.length);
  assert.equal(r.body.rows.length, 10);
  const dates = r.body.rows.map(d => d.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
  const p2 = await api.call('GET', '/erp/deals?size=10&page=2');
  assert.equal(new Set([...r.body.rows, ...p2.body.rows].map(d => d.id)).size, 20);
  assert.equal((await api.call('GET', '/erp/deals?size=100000')).body.size, 200);
});

test('filters and counts: each count leaves out its own filter', async () => {
  const r = await api.call('GET', '/erp/deals?status=closed&size=200');
  const closed = data.deals.filter(d => d.status === 'closed');
  assert.equal(r.body.total, closed.length);
  assert.ok(r.body.rows.every(d => d.status === 'closed'));
  const byStatus = data.deals.reduce((t, d) => ({ ...t, [d.status]: (t[d.status] || 0) + 1 }), {});
  assert.deepEqual(r.body.counts.status, byStatus);
  const types = closed.reduce((t, d) => ({ ...t, [d.type]: (t[d.type] || 0) + 1 }), {});
  assert.deepEqual(r.body.counts.type, types);
  const two = await api.call('GET', '/erp/deals?status=closed,draft');
  assert.equal(two.body.total, closed.length + (byStatus.draft || 0));
});

test('search: every word must match, and % or _ are plain characters', async () => {
  const deal = data.deals.find(d => d.buyer.name.includes(' '));
  const [first, last] = [deal.buyer.name.split(' ')[0], deal.buyer.name.split(' ').at(-1)];
  const r = await api.call('GET', `/erp/deals?q=${encodeURIComponent(`${first.toLowerCase()} ${last}`)}&size=200`);
  assert.ok(r.body.rows.some(d => d.id === deal.id));
  assert.ok(r.body.rows.every(d => [d.code, d.buyer.name, d.owner.name, d.property.title, d.property.address].some(t => t.toLowerCase().includes(first.toLowerCase()))));
  assert.equal((await api.call('GET', '/erp/deals?q=%25')).body.total, 0);
  assert.equal((await api.call('GET', '/erp/staff?q=_')).body.total, 0);
});

test('agents and office staff: counts that act as filters', async () => {
  const r = await api.call('GET', '/erp/staff?kind=agent&size=5');
  const agents = data.staff.filter(s => ['staff', 'sale-staff'].includes(s.type));
  assert.equal(r.body.total, agents.length);
  assert.equal(r.body.counts.leaders, agents.filter(s => s.role).length);
  const office = await api.call('GET', '/erp/staff?kind=office');
  assert.equal(office.body.total, data.staff.length - agents.length);
  const leader = agents.find(s => s.role && data.staff.some(x => x.uplineId === s.id));
  const team = await api.call(`GET`, `/erp/staff?teamOf=${leader.id}&size=200`);
  assert.equal(team.body.total, AC.teamOf(leader.id, data.staff).size - 1);
});

test('one record, and a list or record that does not exist', async () => {
  const listing = data.listings.find(l => l.followUps.length);
  const r = await api.call('GET', `/erp/listings/${listing.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.code, listing.code);
  assert.equal(r.body.followUps.length, listing.followUps.length);
  assert.equal((await api.call('GET', '/erp/listings/999999')).status, 404);
  assert.equal((await api.call('GET', '/erp/nothing')).status, 404);
  assert.equal((await api.call('GET', '/erp/toString')).status, 404);
});

test('org chart: one level at a time, with team sizes, and the trail up', async () => {
  const agents = data.staff.filter(s => ['staff', 'sale-staff'].includes(s.type));
  const branchId = agents[0].branchId;
  const tops = await api.call('GET', `/erp/org/children?branchId=${branchId}`);
  const wantTops = agents.filter(s => s.branchId === branchId && s.uplineId == null);
  assert.equal(tops.body.total, wantTops.length);
  for (const p of tops.body.rows) {
    assert.equal(p.team, AC.teamOf(p.id, data.staff).size - 1, p.name);
    assert.equal(p.direct, data.staff.filter(s => s.uplineId === p.id).length);
  }
  const leader = tops.body.rows.find(p => p.direct > 0);
  const kids = await api.call('GET', `/erp/org/children?of=${leader.id}&size=1`);
  assert.equal(kids.body.total, leader.direct);
  assert.equal(kids.body.rows.length, 1);
  const deepest = agents.filter(s => s.uplineId != null).sort((a, b) => b.depth - a.depth)[0];
  const trail = await api.call('GET', `/erp/org/trail/${deepest.id}`);
  const want = [];
  for (let up = data.staff.find(s => s.id === deepest.uplineId); up; up = data.staff.find(s => s.id === up.uplineId)) want.unshift(up.id);
  assert.deepEqual(trail.body.rows.map(p => p.id), want);
});

test("an E-Form's history comes from the audit log, newest first", async () => {
  const dealId = data.audit[0].dealId;
  const r = await api.call('GET', `/erp/deals/${dealId}/history`);
  assert.equal(r.status, 200);
  assert.equal(r.body.rows.length, data.audit.filter(a => a.dealId === dealId).length);
  assert.ok(r.body.rows.every(x => x.dealId === dealId && 'field' in x && 'before' in x && 'after' in x));
});

test('the access policy is read and saved by the Superadmin', async () => {
  const r = await api.call('GET', '/access');
  assert.deepEqual(r.body.policy, AC.defaultPolicy());
  const policy = AC.defaultPolicy();
  policy.staff.levels.customers = 'view';
  const saved = await api.call('PUT', '/access', { policy });
  assert.equal(saved.status, 200);
  assert.equal((await api.call('GET', '/access')).body.policy.staff.levels.customers, 'view');
});

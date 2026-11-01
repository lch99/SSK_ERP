// The server's Setup runs the browser demo's steps (shared/setupState.js): the
// same steps give the same Setup, saved in the database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, migrate, startApi } = require('./helpers');
const S = require('../../shared/setupState.js');
const P = require('../../shared/payout.js');
const A = require('../../shared/agents.js');

let api;
before(async () => { await migrate(); api = await startApi(); });
after(async () => { await api.close(); await db.destroy(); });

// The demo's answer for the same steps, from an empty Setup.
let demo = S.emptyState();
const both = async (steps) => {
  demo = S.applySteps(demo, structuredClone(steps));
  const r = steps.length === 1
    ? await api.call('PUT', `/setup/${steps[0][0]}`, steps[0][1])
    : await api.call('POST', '/setup/steps', { steps });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { server: r.body, demo: S.view(demo) };
};
// Imported agents start with A.openingLifetime(); the rest must match exactly.
const sameSetup = ({ server, demo: d }) => {
  const strip = v => ({ ...v, agents: v.agents.map(({ lifetime, ...a }) => a) }); // eslint-disable-line no-unused-vars
  assert.deepEqual(strip(server), strip(d));
  for (const a of d.agents) {
    assert.equal(server.agents.find(x => x.id === a.id).lifetime, A.openingLifetime(a, P.tiersFor(d, a.branchId)), a.name);
  }
};

test('an empty database reads as an empty Setup', async () => {
  const r = await api.call('GET', '/setup');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, S.view(S.emptyState()));
});

test('each step gives what the demo gives', async () => {
  sameSetup(await both([['company', { name: 'SSK Ventures Sdn Bhd', regNo: '202401000001 (1234567-X)', licenceNo: 'E (1) 0000', reaName: 'Tan Ah Kow',
    reaNo: 'E 0000', sstNo: 'W10-1234-56789012', address: '12, Jalan Contoh', phone: '03-1234 5678', email: 'admin@ssk.example',
    bankAccounts: [{ bank: 'Maybank', accountName: 'SSK Ventures Sdn Bhd', accountNo: '5140 0000 0001', purpose: 'operating' }] }]]));
  sameSetup(await both([['branches', { branches: [
    { name: 'Taman Desa', code: 'TD', address: 'Jalan Desa', phone: '03-0000 1111', manager: 'Lim Mei Ling' },
    { name: 'Cheras', code: 'CH', address: 'Jalan Cheras', phone: '03-0000 2222', manager: 'Raj Kumar' },
  ] }]]));
  sameSetup(await both([['deal-types', { sale: { enabled: true, defaultRate: 3 }, rental: { enabled: true, defaultRate: 100 }, project: { enabled: false },
    sstPct: 8, sstMode: 'on_top', whtPct: 2, coaSharePct: 50, referralPct: 10 }]]));
  const tiers = [['T1', 'Associate', 'lifetime', 0, 60], ['T2', 'Negotiator', 'lifetime', 30000, 65], ['T3', 'Star', 'yearly', 120000, 85]]
    .map(([name, title, basis, threshold, agentRate]) => ({ name, title, basis, threshold, agentRate, totals: { sale: Math.min(95, agentRate + 25), rental: Math.min(95, agentRate + 25) } }));
  sameSetup(await both([
    ['plans', { plans: [{ name: 'Standard', tiers }], sideSharePct: 50 }],
    ['uplines', { roles: [{ code: 'AGA', name: 'Agent Leader' }, { code: 'GSM', name: 'Group Sales Manager' }], splits: { AGA: 30, GSM: 70 } }],
  ]));
  const rows = A.exampleAgents(S.view(demo), 6).map((cells, i) => ({ line: i + 2, cells }));
  const saved = await both([['agents', { mode: 'replace', rows }]]);
  sameSetup(saved);
  assert.equal(saved.server.agents.length, rows.length);
  sameSetup(await both([['approvals', { dealApprover: 'manager', bossAbove: 20000, refundApprover: 'boss', payWhen: 'full', payRun: 'weekly', payDay: 5 }]]));
  sameSetup(await both([['numbering', { letters: { sale: 'S', rental: 'R', project: 'P' }, caseDigits: 4, voucherPrefix: 'PV', voucherDigits: 4 }]]));
  assert.ok(saved.server.checklist);
});

test('imported agents are staff rows with their own codes', async () => {
  const staff = await db('staff').orderBy('id');
  assert.equal(staff.length, S.view(demo).agents.length);
  assert.deepEqual(staff.map(s => s.code), staff.map((_, i) => `STAFF-${String(i + 1).padStart(5, '0')}`));
  assert.ok(staff.every(s => s.type === 'staff' && s.status === 'active'));
  const withUpline = staff.filter(s => s.upline_id != null);
  assert.ok(withUpline.length > 0);
});

test('a page of steps is saved all or nothing', async () => {
  const beforeIt = (await api.call('GET', '/setup')).body;
  const r = await api.call('POST', '/setup/steps', { steps: [
    ['approvals', { dealApprover: 'boss', refundApprover: 'boss', payWhen: 'full', payRun: 'monthly', payDay: 25 }],
    ['numbering', { letters: { sale: '', rental: 'R', project: 'P' }, caseDigits: 4, voucherPrefix: 'PV', voucherDigits: 4 }],
  ] });
  assert.equal(r.status, 400);
  assert.ok(r.body.errors.length > 0);
  assert.deepEqual((await api.call('GET', '/setup')).body, beforeIt);
});

test('an unknown step is refused', async () => {
  const r = await api.call('PUT', '/setup/nonsense', {});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Unknown setup step/);
});

test('agents with records cannot be replaced, and their branch cannot be removed', async () => {
  const agent = await db('staff').first();
  await db('deals').insert({ code: 'TEST-1', type: 'sale', branch_id: agent.branch_id, date: '2026-10-01', agent_id: agent.id });
  const r = await api.call('PUT', '/setup/agents', { mode: 'replace', rows: [] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /already have E-Forms/);
  const { branches } = (await api.call('GET', '/setup')).body;
  const r2 = await api.call('PUT', '/setup/branches', { branches: branches.filter(b => b.id !== agent.branch_id) });
  assert.equal(r2.status, 400);
  assert.equal((await db('staff').count({ n: '*' }).first()).n, S.view(demo).agents.length);
  await db('deals').where('code', 'TEST-1').del();
});

test('removing a branch takes its agents with it when they have no records', async () => {
  const { branches, agents } = (await api.call('GET', '/setup')).body;
  const gone = branches[1];
  const r = await api.call('PUT', '/setup/branches', { branches: branches.filter(b => b.id !== gone.id) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.agents.length, agents.filter(a => a.branchId !== gone.id).length);
  assert.equal(await db('branches').where('id', gone.id).first(), undefined);
});

test('every step is in the audit log, and big agent lists are logged as a count', async () => {
  const rows = await db('audit_log').where('entity', 'like', 'setup.%');
  assert.ok(rows.length >= 8);
  const agents = rows.find(r => r.entity === 'setup.agents');
  assert.deepEqual(JSON.parse(agents.detail), { mode: 'replace', rows: 12 });
});

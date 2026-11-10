// Error alerts: one short line to the webhook, the same error not again within 10 minutes, nothing when unset.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { alert, whereOf } = require('../src/ops/alerts');

test('an error is told once to the webhook, without the request\'s data', async () => {
  const got = [];
  const hook = http.createServer(async (req, res) => { let b = ''; for await (const c of req) b += c; got.push(JSON.parse(b)); res.end('ok'); }).listen(0, '127.0.0.1');
  await once(hook, 'listening');
  try {
    delete process.env.ALERT_WEBHOOK;
    assert.equal(await alert(new Error('nothing set'), 'GET /api/x'), false);
    process.env.ALERT_WEBHOOK = `http://127.0.0.1:${hook.address().port}/hook`;
    assert.equal(await alert(new Error('Database unreachable'), 'GET /api/erp/deals/:id'), true);
    assert.equal(await alert(new Error('Database unreachable'), 'GET /api/erp/deals/:id'), false, 'the same one is quiet for a while');
    assert.equal(await alert(new Error('Something else'), 'POST /api/erp/actions/:name'), true);
    assert.equal(got.length, 2);
    assert.match(got[0].text, /^SubSaleKing ERP \(.+\): Error: Database unreachable at GET \/api\/erp\/deals\/:id$/);
  } finally { hook.close(); delete process.env.ALERT_WEBHOOK; }
});

test('a database error or a JSON error is told without the values it quotes; a refused send is tried again', async () => {
  const got = [];
  let answer = 200;
  const hook = http.createServer(async (req, res) => { let b = ''; for await (const c of req) b += c; got.push(JSON.parse(b)); res.statusCode = answer; res.end('ok'); }).listen(0, '127.0.0.1');
  await once(hook, 'listening');
  try {
    process.env.ALERT_WEBHOOK = `http://127.0.0.1:${hook.address().port}/hook`;
    // knex puts the SQL with its values in the message; MySQL's own text quotes the duplicate value.
    const dup = Object.assign(new Error("insert into `staff` (`ic`, `name`, `phone`) values ('900101-14-5678', 'Ali bin Abu', '+60123456789') - Duplicate entry '900101-14-5678' for key 'staff.ic'"),
      { code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000', sqlMessage: "Duplicate entry '900101-14-5678' for key 'staff.ic'" });
    assert.equal(await alert(dup, 'POST /api/erp/actions/saveStaff'), true);
    const json = new SyntaxError('Unexpected token \'s\', "{"password": secret123}" is not valid JSON');
    assert.equal(await alert(json, 'GET /api/erp/start'), true);
    const sent = got.map(g => g.text).join('\n');
    for (const secret of ['900101', 'Ali bin Abu', '0123456789', 'secret123', 'password']) assert.ok(!sent.includes(secret), `${secret} is not sent`);
    assert.match(got[0].text, /Error: ER_DUP_ENTRY \(Duplicate entry '…' for key '…'\) at POST/);

    // The same error with other values is the same kind: told once.
    const dup2 = Object.assign(new Error('insert … other values'), { code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000', sqlMessage: "Duplicate entry '880202-10-1234' for key 'staff.ic'" });
    assert.equal(await alert(dup2, 'POST /api/erp/actions/saveStaff'), false);

    // A webhook that refuses (revoked, rate-limited) is not counted as told.
    answer = 404;
    assert.equal(await alert(new Error('Webhook gone'), 'background'), false);
    answer = 200;
    assert.equal(await alert(new Error('Webhook gone'), 'background'), false, 'not straight away');
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 61000;
      assert.equal(await alert(new Error('Webhook gone'), 'background'), true, 'a minute later it is tried again');
      Date.now = () => realNow() + 5 * 60000;
      assert.equal(await alert(new Error('Webhook gone'), 'background'), false, 'then quiet for ten minutes');
    } finally { Date.now = realNow; }
  } finally { hook.close(); delete process.env.ALERT_WEBHOOK; }
});

test('where an error happened is the address\'s shape: no ids, codes, tokens or names', () => {
  assert.equal(whereOf({ method: 'GET', originalUrl: '/api/erp/deals/42?q=Ali' }), 'GET /api/erp/deals/:x');
  assert.equal(whereOf({ method: 'POST', originalUrl: '/api/auth/link/f3a9c0d1e2b3a4c5d6e7f8091a2b3c4d' }), 'POST /api/auth/link/:x');
  assert.equal(whereOf({ method: 'GET', originalUrl: '/api/public/agents/Ali.Abu' }), 'GET /api/public/agents/:x');
  assert.equal(whereOf({ method: 'GET', originalUrl: '/v1/property/LIST-123456' }), 'GET /v1/property/:x');
  assert.equal(whereOf({ method: 'GET', originalUrl: '/api/public/agents/jasonlee/photo' }), 'GET /api/public/agents/:x/photo');
  assert.equal(whereOf({ method: 'GET', originalUrl: '/v1/property/search' }), 'GET /v1/property/search');
});

test('a body that is not JSON is the sender\'s mistake: 400, and not told', async () => {
  const { startApi } = require('./helpers');
  const api = await startApi();
  let told = 0;
  const hook = http.createServer((req, res) => { told++; res.end('ok'); }).listen(0, '127.0.0.1');
  await once(hook, 'listening');
  try {
    process.env.ALERT_WEBHOOK = `http://127.0.0.1:${hook.address().port}/hook`;
    const send = url => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password": secret123}' });
    const res = await send(`${api.base}/auth/login`);
    assert.equal(res.status, 400);
    assert.ok(!(await res.text()).includes('secret123'));
    const v1 = await send(`${api.base.replace(/\/api$/, '/v1')}/login`);
    assert.equal(v1.status, 400);
    await new Promise(r => setTimeout(r, 50));
    assert.equal(told, 0);
  } finally { hook.close(); await api.close(); delete process.env.ALERT_WEBHOOK; }
});

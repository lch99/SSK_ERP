// Error alerts: one short line to the webhook, the same error not again within 10 minutes, nothing when unset.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { alert } = require('../src/ops/alerts');

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

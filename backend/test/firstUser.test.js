// The first account on a new server: with ADMIN_TOKEN set, only someone who knows it can make the
// superadmin (a stranger who opens a fresh staging site first cannot), and production needs one.
process.env.AUTH_DISABLED = 'false';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, migrate, startApi } = require('./helpers');

const KEY = 'setup-key-for-tests';
const body = { name: 'First Admin', username: 'firstadmin', password: 'correct horse battery' };
let api;

before(async () => {
  process.env.ADMIN_TOKEN = KEY;
  await migrate();
  api = await startApi();
});
after(async () => { delete process.env.ADMIN_TOKEN; await api.close(); await db.destroy(); });

test('the first account needs the setup key, and only once', async () => {
  assert.deepEqual((await api.call('GET', '/auth/status')).body, { needsFirstUser: true, needsSetupKey: true });
  assert.equal((await api.call('POST', '/auth/first-user', body)).status, 403);
  assert.equal((await api.call('POST', '/auth/first-user', { ...body, setupKey: 'not-it' })).status, 403);
  assert.equal(Number((await db('users').count({ n: '*' }).first()).n), 0);

  const made = await api.call('POST', '/auth/first-user', { ...body, setupKey: KEY });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.ok(made.body.token);
  assert.equal((await db('users').where('username', 'firstadmin').first()).role, 'superadmin');
  assert.deepEqual((await api.call('GET', '/auth/status')).body, { needsFirstUser: false });
  assert.equal((await api.call('POST', '/auth/first-user', { ...body, username: 'second', setupKey: KEY })).status, 409);
});

test('in production there is no first account without a setup key', async () => {
  delete process.env.ADMIN_TOKEN;
  process.env.NODE_ENV = 'production';
  try {
    const r = await api.call('POST', '/auth/first-user', { ...body, username: 'third' });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /ADMIN_TOKEN/);
  } finally {
    process.env.NODE_ENV = 'test';
  }
});

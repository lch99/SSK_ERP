// Every backend test runs on a fresh in-memory SQLite database (node --test runs
// each file in its own process), signed in as the demo superadmin.
process.env.DB_CLIENT = 'sqlite';
process.env.SQLITE_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.AUTH_DISABLED ??= 'true';  // auth.test.js signs in for real
process.env.NODE_ENV = 'test';

const { once } = require('node:events');
const db = require('../src/db/connection');

const migrate = () => db.migrate.latest();

// The API on a spare port. call('GET', '/erp/deals?size=5') → { status, body }.
async function startApi() {
  const app = require('../src/app');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { base, call, close: () => new Promise(r => server.close(r)) };
}

// `want` with every key of `have` that `want` has (records may carry more fields than the demo's).
const pick = (have, want) => Object.fromEntries(Object.keys(want).map(k => [k, have?.[k] === undefined ? null : have[k]]));
// The demo leaves some fields out or blank where the database keeps null: count those as the same.
const tidy = v => JSON.parse(JSON.stringify(v, (k, x) => (x === undefined || x === '' || x === null ? undefined : x)));

module.exports = { db, migrate, startApi, pick, tidy };

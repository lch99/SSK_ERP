// Every backend test runs on a fresh database, signed in as the demo superadmin:
// in-memory SQLite by default (node --test runs each file in its own process),
// or MySQL with `npm run test:mysql`: DB_HOST / DB_USER / DB_PASSWORD from
// backend/.env, database DB_TEST_NAME (default ssk_erp_test), emptied at the
// start of each file, so the files run one at a time.
const MYSQL = process.env.TEST_DB === 'mysql';
if (MYSQL) {
  require('dotenv').config({ path: require('node:path').join(__dirname, '../.env') });
  process.env.DB_CLIENT = 'mysql';
  process.env.DB_NAME = process.env.DB_TEST_NAME || 'ssk_erp_test';
  if (!process.env.DB_NAME.endsWith('_test')) throw new Error('DB_TEST_NAME must end in _test: the tests empty that database.');
} else {
  process.env.DB_CLIENT = 'sqlite';
  process.env.SQLITE_FILE = ':memory:';
}
process.env.JWT_SECRET = 'test-secret';
process.env.AUTH_DISABLED ??= 'true';  // auth.test.js signs in for real
process.env.NODE_ENV = 'test';

const { once } = require('node:events');
const db = require('../src/db/connection');

// On MySQL, drops whatever an earlier file or run left first.
async function migrate() {
  if (MYSQL) {
    await db.transaction(async trx => {
      await trx.raw('set foreign_key_checks = 0');
      const [tables] = await trx.raw('select table_name as t from information_schema.tables where table_schema = database()');
      for (const { t } of tables) await trx.raw('drop table ??', [t]);
      await trx.raw('set foreign_key_checks = 1');
    });
  }
  return db.migrate.latest();
}

// The API on a spare port. call('GET', '/erp/deals?size=5') → { status, body };
// raw(method, path) → the fetch Response itself (a file download).
async function startApi() {
  const app = require('../src/app');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const raw = (method, path) => fetch(base + path, { method });
  return { base, call, raw, close: () => new Promise(r => server.close(r)) };
}

// `want` with every key of `have` that `want` has (records may carry more fields than the demo's).
const pick = (have, want) => Object.fromEntries(Object.keys(want).map(k => [k, have?.[k] === undefined ? null : have[k]]));
// The demo leaves some fields out or blank where the database keeps null: count those as the same.
const tidy = v => JSON.parse(JSON.stringify(v, (k, x) => (x === undefined || x === '' || x === null ? undefined : x)));

module.exports = { db, migrate, startApi, pick, tidy };

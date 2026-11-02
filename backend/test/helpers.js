// Every backend test runs on MySQL, signed in as the demo superadmin: DB_HOST /
// DB_USER / DB_PASSWORD from backend/.env, database DB_TEST_NAME (default
// ssk_erp_test), emptied at the start of each file, so the files run one at a
// time (`npm test`). The legacy import's made-up copy of the old ERP sits in a
// database of its own, DB_LEGACY_TEST_NAME (default ssk_legacy_test), as the
// real copy does: it has tables named like ours (staff).
require('dotenv').config({ path: require('node:path').join(__dirname, '../.env') });
process.env.DB_NAME = process.env.DB_TEST_NAME || 'ssk_erp_test';
const LEGACY_TEST = process.env.DB_LEGACY_TEST_NAME || 'ssk_legacy_test';
for (const name of [process.env.DB_NAME, LEGACY_TEST]) {
  if (!name.endsWith('_test')) throw new Error(`${name}: a test database's name must end in _test, since the tests empty it.`);
}
process.env.JWT_SECRET = 'test-secret';
process.env.AUTH_DISABLED ??= 'true';  // auth.test.js signs in for real
process.env.NODE_ENV = 'test';

const { once } = require('node:events');
const knex = require('knex');
const db = require('../src/db/connection');

// Drops every table in `q`'s database (whatever an earlier file or run left).
async function empty(q) {
  await q.transaction(async trx => {
    await trx.raw('set foreign_key_checks = 0');
    const [tables] = await trx.raw('select table_name as t from information_schema.tables where table_schema = database()');
    for (const { t } of tables) await trx.raw('drop table ??', [t]);
    await trx.raw('set foreign_key_checks = 1');
  });
}

// The test database, emptied and migrated.
async function migrate() {
  await empty(db);
  return db.migrate.latest();
}

// The made-up copy of the old ERP for the legacy import tests: its own database, made if missing and emptied.
async function legacyTestDb() {
  const { host, port, user, password } = db.client.config.connection;
  const server = knex({ client: 'mysql2', connection: { host, port, user, password } });
  await server.raw('create database if not exists ?? character set utf8mb4', [LEGACY_TEST]);
  await server.destroy();
  const legacy = knex({ client: 'mysql2', connection: { host, port, user, password, database: LEGACY_TEST, dateStrings: true, decimalNumbers: true, charset: 'utf8mb4' }, pool: { min: 0, max: 2 } });
  await empty(legacy);
  return legacy;
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

module.exports = { db, migrate, legacyTestDb, startApi, pick, tidy };

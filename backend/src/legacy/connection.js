// The copy of the current ERP's database (a restored dump of production, never
// the live server). LEGACY_DB_* in backend/.env; use a read-only MySQL account.
// (The tests use a made-up copy in a test database of their own: test/helpers.js legacyTestDb.)
const knex = require('knex');

function legacyDb() {
  if (!process.env.LEGACY_DB_NAME) throw new Error('Set LEGACY_DB_NAME (and LEGACY_DB_HOST, LEGACY_DB_USER, LEGACY_DB_PASSWORD) in backend/.env to the restored copy.');
  return knex({
    client: 'mysql2',
    connection: {
      host: process.env.LEGACY_DB_HOST || 'localhost', port: Number(process.env.LEGACY_DB_PORT) || 3306,
      user: process.env.LEGACY_DB_USER || 'root', password: process.env.LEGACY_DB_PASSWORD || '', database: process.env.LEGACY_DB_NAME,
      dateStrings: true, decimalNumbers: true, charset: 'utf8mb4',
      // JSON columns as their text, kept in legacy_rows as they were.
      typeCast: (field, next) => (field.type === 'JSON' ? field.string('utf8') : next()),
    },
    pool: { min: 0, max: 2 },
  });
}

module.exports = { legacyDb };

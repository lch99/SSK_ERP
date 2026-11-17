require('dotenv').config();
const path = require('path');

const migrations = { directory: path.join(__dirname, 'src/db/migrations'), tableName: 'knex_migrations' };

// Every connection speaks the business's time zone (APP_TZ, Malaysia's by default, as app.js), so NOW()
// and TIMESTAMP columns read the same clock as the app on any host: a database server set to UTC would
// otherwise put sign-in times and link uses 8 hours off. An offset, so the server needs no zone tables.
function zoneOffset(tz = process.env.APP_TZ || 'Asia/Kuala_Lumpur') {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || 'GMT';
  return name === 'GMT' ? '+00:00' : name.replace('GMT', '');
}

// MySQL only (8.0 or newer): the app, the tests (DB_NAME = the test database) and production.
const mysql = {
  client: 'mysql2',
  connection: {
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'ssk_erp',
    charset: 'utf8mb4',
    // DATE and DATETIME come back as the text stored ('2026-10-28'), never
    // shifted by the server's time zone; DECIMAL money comes back as numbers.
    dateStrings: true,
    decimalNumbers: true,
    // JSON columns come back as their text (db/records.js parses them), so a
    // JSON string value is never taken for the JSON itself.
    typeCast: (field, next) => (field.type === 'JSON' ? field.string('utf8') : next()),
  },
  pool: { min: 0, max: 10, afterCreate: (conn, done) => conn.query(`SET time_zone = '${zoneOffset()}'`, err => done(err, conn)) },
  migrations,
};

module.exports = { development: mysql, production: mysql };

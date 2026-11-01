require('dotenv').config();
const path = require('path');

const migrations = { directory: path.join(__dirname, 'src/db/migrations'), tableName: 'knex_migrations' };

// DB_CLIENT=sqlite runs on a local file with no MySQL server — for trying the
// app on a laptop only. Everything real runs on MySQL.
const sqlite = {
  client: 'better-sqlite3',
  // SQLITE_FILE=:memory: gives a throwaway database (the backend tests use it).
  connection: { filename: process.env.SQLITE_FILE === ':memory:' ? ':memory:' : path.join(__dirname, process.env.SQLITE_FILE || 'dev.sqlite3') },
  useNullAsDefault: true,
  pool: { afterCreate: (conn, done) => { conn.pragma('foreign_keys = ON'); done(); } },
  migrations,
};

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
    // JSON columns come back as their text, as on SQLite (db/records.js parses
    // them), so a JSON string value is never taken for the JSON itself.
    typeCast: (field, next) => (field.type === 'JSON' ? field.string('utf8') : next()),
  },
  pool: { min: 0, max: 10 },
  migrations,
};

const config = process.env.DB_CLIENT === 'sqlite' ? sqlite : mysql;
module.exports = { development: config, production: mysql };

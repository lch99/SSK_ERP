require('dotenv').config();
const path = require('path');

const migrations = { directory: './src/db/migrations', tableName: 'knex_migrations' };

// DB_CLIENT=sqlite runs on a local file with no MySQL server — for trying the
// app on a laptop only. Everything real runs on MySQL.
const sqlite = {
  client: 'better-sqlite3',
  connection: { filename: path.join(__dirname, process.env.SQLITE_FILE || 'dev.sqlite3') },
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
  },
  pool: { min: 0, max: 10 },
  migrations,
};

const config = process.env.DB_CLIENT === 'sqlite' ? sqlite : mysql;
module.exports = { development: config, production: mysql };

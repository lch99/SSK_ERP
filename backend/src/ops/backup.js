// A copy of the database, kept off the server: `npm run backup` (daily, from cron or the host's scheduler).
// mysqldump (one consistent snapshot: --single-transaction) compressed to ssk-erp-<date>-<time>.sql.gz, kept
// in BACKUP_DIR (a folder, ideally another disk) and, with STORAGE=s3, in the bucket under backups/.
// Copies older than BACKUP_KEEP_DAYS (30) are removed from both. The import's history (legacy_rows,
// legacy_activity: 3 GB that never change after the import) keeps its tables but not its rows, unless
// --all; archive one full copy of it once.
//   Restore: gunzip -c ssk-erp-….sql.gz | mysql -u <user> -p <database>
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');

const HISTORY = ['legacy_rows', 'legacy_activity'];
const NAME = /^ssk-erp-(\d{4}-\d{2}-\d{2})-\d{4}\.sql\.gz$/;
const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
const day = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function backup({ all = false, now = new Date(), dir = process.env.BACKUP_DIR || path.join(__dirname, '../../backups'), keepDays = Number(process.env.BACKUP_KEEP_DAYS || 30), log = () => {} } = {}) {
  const db = process.env.DB_NAME;
  if (!db) throw new Error('DB_NAME is not set.');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `ssk-erp-${stamp(now)}.sql.gz`);
  const common = ['--single-transaction', '--quick', '--no-tablespaces', '--set-gtid-purged=OFF',
    `--host=${process.env.DB_HOST || '127.0.0.1'}`, `--port=${process.env.DB_PORT || 3306}`, `--user=${process.env.DB_USER || 'root'}`];
  // Two passes into one file (mysqldump 8.0 can't leave out only a table's rows): every table but the history
  // with its rows, then the history tables' structure alone.
  const passes = all ? [[...common, '--routines', '--triggers', db]]
    : [[...common, '--routines', '--triggers', ...HISTORY.map(t => `--ignore-table=${db}.${t}`), db], [...common, '--no-data', db, ...HISTORY]];
  const gzip = zlib.createGzip({ level: 6 });
  const written = pipeline(gzip, fs.createWriteStream(file));
  // The password goes in the environment, never on the command line (where `ps` would show it).
  const run = args => new Promise((ok, fail) => {
    const dump = spawn(process.env.MYSQLDUMP || 'mysqldump', args, { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '';
    dump.stderr.on('data', c => { errors += c; });
    dump.on('error', fail);
    dump.stdout.pipe(gzip, { end: false });
    dump.on('close', code => (code === 0 ? ok() : fail(new Error(`mysqldump stopped (${code}): ${errors.trim().slice(0, 300)}`))));
  });
  try {
    for (const args of passes) await run(args);
    gzip.end();
    await written;
  } catch (err) {
    gzip.destroy();
    await fsp.rm(file, { force: true });
    throw err;
  }
  const { size } = await fsp.stat(file);
  log(`${path.basename(file)}: ${(size / 1048576).toFixed(1)} MB`);

  // Off the server too, and old copies out of both places.
  const cutoff = day(new Date(now.getTime() - keepDays * 86400000));
  const old = name => NAME.exec(name)?.[1] < cutoff;
  let removed = 0;
  for (const f of await fsp.readdir(dir)) if (old(f)) { await fsp.rm(path.join(dir, f), { force: true }); removed++; }
  let uploaded = false;
  if (process.env.STORAGE === 's3') {
    const S3 = require('../files/s3');
    await S3.putObject(`backups/${path.basename(file)}`, file);
    uploaded = true;
    for (const key of await S3.listKeys('backups/')) if (old(key.slice('backups/'.length))) { await S3.deleteKey(key); removed++; }
  }
  return { file, size, uploaded, removed };
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
  backup({ all: process.argv.includes('--all'), log: m => console.log(m) })
    .then(r => console.log(`Backup done${r.uploaded ? ', copied to storage' : ''}; ${r.removed} old cop${r.removed === 1 ? 'y' : 'ies'} removed.`))
    .catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { backup };

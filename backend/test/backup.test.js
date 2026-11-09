// The daily backup: a compressed mysqldump with every table (the import's history without its rows), copied
// to object storage, and copies older than the keep window removed from the folder and the bucket.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const http = require('node:http');
const { once } = require('node:events');
const { db, migrate } = require('./helpers');
const { seedDemo } = require('../src/db/demoSeed');

const MYSQLDUMP = process.env.MYSQLDUMP || ['/usr/local/mysql/bin/mysqldump', '/opt/homebrew/bin/mysqldump', '/usr/bin/mysqldump'].find(p => fs.existsSync(p));
const objects = new Map();
let s3, dir;
before(async () => {
  s3 = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'GET' && u.searchParams.get('list-type') === '2') {
      const keys = [...objects.keys()].map(k => k.replace(/^\/bk\//, '')).filter(k => k.startsWith(u.searchParams.get('prefix')));
      return res.writeHead(200).end(`<ListBucketResult>${keys.map(k => `<Contents><Key>${k}</Key></Contents>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`);
    }
    if (req.method === 'PUT') { const c = []; for await (const x of req) c.push(x); objects.set(decodeURIComponent(u.pathname), Buffer.concat(c)); return res.writeHead(200).end(); }
    if (req.method === 'DELETE') { objects.delete(decodeURIComponent(u.pathname)); return res.writeHead(204).end(); }
    res.writeHead(404).end();
  }).listen(0, '127.0.0.1');
  await once(s3, 'listening');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssk-backup-'));
  Object.assign(process.env, { STORAGE: 's3', S3_BUCKET: 'bk', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_ENDPOINT: `http://127.0.0.1:${s3.address().port}`, S3_PREFIX: '' });
  if (MYSQLDUMP) process.env.MYSQLDUMP = MYSQLDUMP;
  await migrate();
  await seedDemo({ asOf: '2026-10-28' });
  await db('legacy_rows').insert({ source_table: 'db_x', source_id: '1', data: JSON.stringify({ secret: 'history-row-text' }) });
});
after(async () => { s3.close(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.STORAGE; await db.destroy(); });

test('a compressed copy of every table, kept off the server, old copies removed', { skip: !MYSQLDUMP && 'mysqldump is not installed here' }, async () => {
  const { backup } = require('../src/ops/backup');
  fs.writeFileSync(path.join(dir, 'ssk-erp-2020-01-01-0300.sql.gz'), '');
  objects.set('/bk/backups/ssk-erp-2020-01-01-0300.sql.gz', Buffer.alloc(1));
  const r = await backup({ dir, now: new Date('2026-11-10T03:00:00'), keepDays: 30 });
  assert.equal(r.uploaded, true);
  assert.equal(r.removed, 2, 'the year-old copy goes from the folder and the bucket');
  const sql = zlib.gunzipSync(fs.readFileSync(r.file)).toString();
  assert.match(sql, /CREATE TABLE `staff`/);
  assert.match(sql, /INSERT INTO `staff`/);
  assert.match(sql, /CREATE TABLE `legacy_rows`/);
  assert.ok(!sql.includes('history-row-text'), 'the import\'s history keeps its table, not its rows');
  assert.ok(objects.has(`/bk/backups/${path.basename(r.file)}`));
  assert.deepEqual(fs.readdirSync(dir), [path.basename(r.file)]);
});

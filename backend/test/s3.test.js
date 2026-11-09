// Object storage (STORAGE=s3): the request signing matches AWS's published examples, and an upload goes to
// the bucket, opens from it (photo preview too) and leaves it when pruned, through a stand-in S3 service.
process.env.STORAGE = 's3';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const sharp = require('sharp');
const { sign } = require('../src/files/s3');

const objects = new Map();
let s3, seen = [];
before(async () => {
  s3 = http.createServer(async (req, res) => {
    const auth = req.headers.authorization || '';
    seen.push(`${req.method} ${req.url}`);
    if (!auth.startsWith('AWS4-HMAC-SHA256 Credential=AKIATEST/') || !auth.includes('/ap-southeast-1/s3/aws4_request')) return res.writeHead(403).end('bad signature');
    const key = decodeURIComponent(req.url);
    if (req.method === 'PUT') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      objects.set(key, Buffer.concat(chunks));
      return res.writeHead(200).end();
    }
    if (req.method === 'GET') return objects.has(key) ? res.writeHead(200).end(objects.get(key)) : res.writeHead(404).end();
    if (req.method === 'DELETE') { objects.delete(key); return res.writeHead(204).end(); }
    res.writeHead(405).end();
  }).listen(0, '127.0.0.1');
  await once(s3, 'listening');
  Object.assign(process.env, { S3_BUCKET: 'ssk-files', S3_ACCESS_KEY_ID: 'AKIATEST', S3_SECRET_ACCESS_KEY: 'secret', S3_REGION: 'ap-southeast-1',
    S3_ENDPOINT: `http://127.0.0.1:${s3.address().port}`, S3_PREFIX: 'erp/' });
});
after(() => { s3.close(); delete process.env.STORAGE; });

test('the signature matches AWS Signature Version 4\'s published examples', () => {
  const base = { region: 'us-east-1', service: 'service', accessKey: 'AKIDEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    date: new Date('2015-08-30T12:36:00Z'), payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' };
  assert.match(sign({ ...base, method: 'GET', url: 'https://example.amazonaws.com/' }).authorization, /Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31$/);
  assert.match(sign({ ...base, method: 'GET', url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1' }).authorization, /Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500$/);
});

test('an upload is kept in the bucket, opens from it, and goes when pruned', async () => {
  const { db, migrate } = require('./helpers');
  const FILES = require('../src/files/files');
  const { storage } = require('../src/files/storage');
  await migrate();
  try {
    const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#ec003f' } }).png().toBuffer();
    const f = await FILES.saveBuffer(db, { id: null }, { kind: 'photo', name: 'front.png', buffer: png });
    const row = await db('files').where('id', f.id).first();
    assert.ok(objects.has(`/ssk-files/erp/${row.storage_key}`) && objects.has(`/ssk-files/erp/${row.preview_key}`), 'the photo and its preview are in the bucket');
    const read = [];
    for await (const c of storage.open(row.storage_key)) read.push(c);
    assert.ok(Buffer.concat(read).equals(png));
    await assert.rejects(async () => { for await (const c of storage.open('photo/2026/11/00000000000000000000000000000000.png')) void c; }, err => err.code === 'ENOENT');
    await db('files').where('id', f.id).update({ created_at: new Date(Date.now() - 25 * 3600000) });
    assert.equal(await FILES.pruneFiles(db), 1);
    assert.equal(objects.size, 0, 'an upload nobody used leaves the bucket');
  } finally { await db.destroy(); }
});

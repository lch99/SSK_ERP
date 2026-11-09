// Copying the old ERP's listing photos into the new storage: each becomes an upload with its preview, linked
// to its listing; a photo gone from the old server is marked and skipped until asked again; only the old
// server's addresses are fetched; running it again does nothing new.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const sharp = require('sharp');
const { db, migrate } = require('./helpers');
const { seedDemo } = require('../src/db/demoSeed');
const { copyPhotos } = require('../src/legacy/copyPhotos');
const { parseJson } = require('../src/db/records');

let server, base, png, listing;
before(async () => {
  png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#22aa66' } }).png().toBuffer();
  server = http.createServer((req, res) => {
    if (req.url.endsWith('.png')) return res.writeHead(200, { 'Content-Type': 'image/png' }).end(png);
    if (req.url.endsWith('.txt')) return res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end('not a picture');
    res.writeHead(404).end();
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.OLD_FILES_HOSTS = '127.0.0.1';
  await migrate();
  const { data } = await seedDemo({ asOf: '2026-10-28' });
  listing = data.listings[0];
  await db('listings').where('id', listing.id).update({ photo_set: JSON.stringify([
    { id: 1, name: 'front.png', published: true, cover: true, url: `${base}/property-images/1/front.png`, on: '2026-01-01' },
    { id: 2, name: 'gone.jpg', published: true, cover: false, url: `${base}/property-images/1/gone.jpg` },
    { id: 3, name: 'odd.txt', published: true, cover: false, url: `${base}/property-images/1/odd.txt` },
    { id: 4, name: 'elsewhere.png', published: true, cover: false, url: 'https://example.com/x.png' },
  ]) });
});
after(async () => { server.close(); await db.destroy(); delete process.env.OLD_FILES_HOSTS; });

test('old photos become uploads with previews; failures are marked; nothing twice', async () => {
  const r = await copyPhotos(db, { listing: listing.id });
  assert.deepEqual(r, { listings: 1, copied: 1, failed: 3, left: 0 });
  const set = parseJson((await db('listings').where('id', listing.id).first('photo_set')).photo_set);
  assert.match(set[0].preview, /^files\/\d+\/front\.png$/);
  assert.equal(set[0].url, `${base}/property-images/1/front.png`, 'the old address stays, for the record');
  assert.match(set[1].copyFailed, /404/);
  assert.match(set[2].copyFailed, /JPG|PNG|picture|type/i);
  assert.match(set[3].copyFailed, /not on the old file server/);
  const f = await db('files').where('id', Number(/^files\/(\d+)\//.exec(set[0].preview)[1])).first();
  assert.deepEqual([f.entity, f.entity_id, !!f.preview_key], ['listings', String(listing.id), true]);
  assert.deepEqual(await copyPhotos(db, { listing: listing.id }), { listings: 0, copied: 0, failed: 0, left: 0 }, 'done ones and failed ones are skipped');
  assert.equal((await copyPhotos(db, { listing: listing.id, retryFailed: true })).failed, 3, 'asked again, it tries the failed ones');
});

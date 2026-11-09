// Copying the old ERP's files into the new storage: listing photos become uploads with previews (a photo gone
// from the old server is marked and skipped until asked again); E-Form documents, slips, letters, training
// videos and staff papers replace their old addresses with uploads linked to their records. Only the old
// server's addresses are fetched; running it again does nothing new.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const sharp = require('sharp');
const { db, migrate } = require('./helpers');
const { seedDemo } = require('../src/db/demoSeed');
const { copyPhotos, copyDocuments } = require('../src/legacy/copyFiles');
const { parseJson } = require('../src/db/records');

let server, base, png, listing, data;
before(async () => {
  png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#22aa66' } }).png().toBuffer();
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(2000)]);
  server = http.createServer((req, res) => {
    if (req.url.endsWith('.pdf') && !req.url.includes('gone')) return res.writeHead(200).end(pdf);
    if (req.url.endsWith('.mp4')) return res.writeHead(200).end(mp4);
    if (req.url.endsWith('.png')) return res.writeHead(200, { 'Content-Type': 'image/png' }).end(png);
    if (req.url.endsWith('.txt')) return res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end('not a picture');
    res.writeHead(404).end();
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.OLD_FILES_HOSTS = '127.0.0.1';
  await migrate();
  const seeded = await seedDemo({ asOf: '2026-10-28' });
  data = seeded.data;
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

test('documents, slips, letters, training videos and staff papers take their copies; a missing one keeps its old address', async () => {
  const deal = data.deals[0], pay = data.moneyIn[0], out = data.moneyOut[0], video = data.videos[0];
  const person = data.staff.find(x => x.type === 'staff');
  await db('deals').where('id', deal.id).update({ files: JSON.stringify({ SPA: `${base}/eform/spa.pdf`, 'Letter of offer': `${base}/eform/gone.pdf` }) });
  await db('money_in').where('id', pay.id).update({ file: `${base}/slips/slip.png` });
  await db('money_out').where('id', out.id).update({ letter: `${base}/letters/letter.pdf` });
  await db('videos').where('id', video.id).update({ file: `${base}/training/intro.mp4` });
  await db('staff').where('id', person.id).update({ docs: JSON.stringify({ 'NRIC Copy': true, 'Application Form': false }) });
  await db('legacy_rows').insert({ source_table: 'new_staff', source_id: String(person.id), target_table: 'staff', target_id: String(person.id),
    data: JSON.stringify({ user_id: person.id, application_IC: `${base}/hr/ic.pdf` }) });

  const r = await copyDocuments(db, {});
  assert.equal(r.copied, 5);
  assert.equal(r.failed, 1);
  const files = parseJson((await db('deals').where('id', deal.id).first('files')).files);
  assert.match(files.SPA, /^files\/\d+\/spa\.pdf$/);
  assert.equal(files['Letter of offer'], `${base}/eform/gone.pdf`, 'a missing file keeps its old address');
  assert.match((await db('money_in').where('id', pay.id).first('file')).file, /^files\/\d+\/slip\.png$/);
  assert.match((await db('money_out').where('id', out.id).first('letter')).letter, /^files\/\d+\/letter\.pdf$/);
  assert.match((await db('videos').where('id', video.id).first('file')).file, /^files\/\d+\/intro\.mp4$/);
  const docs = parseJson((await db('staff').where('id', person.id).first('docs')).docs);
  assert.match(docs['NRIC Copy'], /^files\/\d+\/ic\.pdf$/);
  assert.equal(docs['Application Form'], false);
  const linked = Object.fromEntries((await db('files').whereNotNull('entity').select('entity').count({ n: '*' }).groupBy('entity')).map(x => [x.entity, Number(x.n)]));
  assert.deepEqual(linked, { listings: 1, deals: 1, moneyIn: 1, moneyOut: 1, videos: 1, staff: 1 }, 'each copy belongs to its record');
  const again = await copyDocuments(db, {});
  assert.deepEqual([again.copied, again.failed], [0, 1], 'only the missing one is tried again');
});

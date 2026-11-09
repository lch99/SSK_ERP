// Copies the listing photos brought over from the old ERP (album entries with only `url`, an address on
// storage.subsaleking.com) into the new system's storage, each checked like an upload and given its small
// preview, so the ERP's pages can show them and nothing depends on the old file server any more.
//
//   npm run legacy:copy-photos -- [--limit 1000] [--listing 120000] [--concurrency 4] [--retry-failed] [--dry-run]
//
// It can stop and start: an entry that has its preview is done; one that failed (gone from the old server,
// not a picture) is marked `copyFailed` with the reason and skipped until --retry-failed. A photo over the
// upload limit (10 MB) is shrunk to 2,560 px first. Only the old file server's addresses are fetched
// (OLD_FILES_HOSTS, default storage.subsaleking.com). Each listing's album is saved in its own transaction,
// merging with whatever changed meanwhile.
const crypto = require('node:crypto');
const sharp = require('sharp');
const { UPLOADS } = require('../../../shared/files.js');
const FILES = require('../files/files');
const { parseJson } = require('../db/records');

const MAX_BYTES = UPLOADS.photo.maxMB * 1024 * 1024;
const FETCH_LIMIT = 40 * 1024 * 1024;
const hosts = () => (process.env.OLD_FILES_HOSTS || 'storage.subsaleking.com').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const todo = (p, retry) => p.url && !p.preview && (retry || !p.copyFailed);

async function download(url) {
  const u = new URL(url);
  if (!hosts().includes(u.hostname.toLowerCase())) throw new Error('not on the old file server');
  const r = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`the old server answered ${r.status}`);
  const chunks = [];
  let size = 0;
  for await (const c of r.body) {
    size += c.length;
    if (size > FETCH_LIMIT) throw new Error('larger than 40 MB');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

// One photo: fetched, shrunk if over the limit, kept as an upload. Returns { ref } or { failed }.
async function copyOne(q, p) {
  try {
    let buffer = await download(p.url);
    let name = p.name || p.url.split('/').pop() || 'photo.jpg';
    if (buffer.length > MAX_BYTES) {
      buffer = await sharp(buffer).rotate().resize(2560, 2560, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      name = `${name.replace(/\.[^.]+$/, '')}.jpg`;
    }
    if (!/\.(jpe?g|png)$/i.test(name)) name = `${name}.jpg`;
    const saved = await FILES.saveBuffer(q, { id: null }, { kind: 'photo', name, buffer });
    return { ref: saved.ref, id: saved.id };
  } catch (err) {
    return { failed: String(err.message || err).slice(0, 120) };
  }
}

async function copyPhotos(q, { limit = Infinity, listing = null, concurrency = 4, retryFailed = false, dryRun = false, log = () => {} } = {}) {
  const out = { listings: 0, copied: 0, failed: 0, left: 0 };
  let after = 0;
  for (;;) {
    const b = q('listings').whereNotNull('photo_set').where('id', '>', after).orderBy('id').limit(200).select('id', 'photo_set');
    if (listing != null) b.where('id', listing);
    const rows = await b;
    if (!rows.length) break;
    after = rows.at(-1).id;
    for (const row of rows) {
      const want = (parseJson(row.photo_set) || []).filter(p => todo(p, retryFailed));
      if (!want.length) continue;
      if (out.copied + out.failed >= limit) { out.left += want.length; continue; }
      out.listings++;
      if (dryRun) { out.left += want.length; continue; }
      const done = new Map();
      for (let i = 0; i < want.length; i += concurrency) {
        const part = want.slice(i, i + concurrency);
        const got = await Promise.all(part.map(p => copyOne(q, p)));
        part.forEach((p, k) => done.set(p.id, got[k]));
      }
      // Merge into the album as it is now (someone may have changed it meanwhile).
      await q.transaction(async trx => {
        const now = await trx('listings').where('id', row.id).forUpdate().first('photo_set');
        const set = (parseJson(now?.photo_set) || []).map(p => {
          const d = done.get(p.id);
          if (!d || p.url !== want.find(w => w.id === p.id)?.url) return p;
          if (d.ref) { const { copyFailed, ...rest } = p; return { ...rest, preview: d.ref }; } // eslint-disable-line no-unused-vars
          return { ...p, copyFailed: d.failed };
        });
        await trx('listings').where('id', row.id).update({ photo_set: JSON.stringify(set) });
        const used = [...done.values()].filter(d => d.id && set.some(p => p.preview === d.ref)).map(d => d.id);
        if (used.length) await trx('files').whereIn('id', used).update({ entity: 'listings', entity_id: String(row.id) });
      });
      for (const d of done.values()) if (d.ref) out.copied++; else out.failed++;
      if (out.listings % 100 === 0) log(`${out.listings} listings, ${out.copied} photos copied, ${out.failed} failed`);
    }
    if (listing != null) break;
  }
  return out;
}

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
  const db = require('../db/connection');
  const args = process.argv.slice(2);
  const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
  const run = crypto.randomBytes(3).toString('hex');
  copyPhotos(db, {
    limit: Number(opt('--limit', Infinity)), listing: opt('--listing') ? Number(opt('--listing')) : null, concurrency: Number(opt('--concurrency', 4)),
    retryFailed: args.includes('--retry-failed'), dryRun: args.includes('--dry-run'), log: m => console.log(`[${run}] ${m}`),
  }).then(r => { console.log(`[${run}] done:`, r); return db.destroy(); }).catch(err => { console.error(err); process.exit(1); });
}

module.exports = { copyPhotos };

// Copies the old ERP's files (on storage.subsaleking.com) into the new system's storage, so nothing depends on
// the old file server any more. Each file is checked like an upload (type by its first bytes, size), kept,
// and linked to its record, which then points at it ('files/<id>/<name>', opened only by who may see the record):
//   photos     listing albums' entries with only `url` → each gets its small preview (`preview`); a photo over
//              10 MB is shrunk to 2,560 px first; one that fails is marked `copyFailed` and skipped until --retry-failed
//   documents  E-Form documents (deals.files), payment slips (money_in.file), payment-out letters and receipts
//              (money_out.letter / .receipt), training videos (videos.file), and staff papers (staff.docs, whose
//              addresses the import kept in history: legacy_rows); a document that fails keeps its old address
//              (and is tried again on the next run)
//
//   npm run legacy:copy-files -- [--only photos|documents] [--limit 1000] [--concurrency 4] [--retry-failed] [--dry-run]
//
// It can stop and start (what is copied no longer points at the old server). Only the old file server's
// addresses are fetched (OLD_FILES_HOSTS, default storage.subsaleking.com). Each record is saved in its own
// transaction and only if the address is still the one copied (an edit meanwhile wins).
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const F = require('../../../shared/files.js');
const FILES = require('../files/files');
const { storage } = require('../files/storage');
const { parseJson } = require('../db/records');

const SYSTEM = { id: null };
const hosts = () => (process.env.OLD_FILES_HOSTS || 'storage.subsaleking.com').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const isOld = v => { try { return /^https?:$/.test(new URL(v).protocol) && hosts().includes(new URL(v).hostname.toLowerCase()); } catch { return false; } };
const nameOf = url => { const last = String(url).split('?')[0].split('/').pop() || 'file'; try { return decodeURIComponent(last); } catch { return last; } };

// Fetches an old file into a temporary file (never more than its kind allows, plus room to shrink a photo).
async function download(url, kind) {
  if (!isOld(url)) throw new Error('not on the old file server');
  const max = F.UPLOADS[kind].maxMB * 1024 * 1024 * (kind === 'photo' ? 4 : 1);
  const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(kind === 'video' ? 600000 : 60000) });
  if (!r.ok) throw new Error(`the old server answered ${r.status}`);
  const dir = storage.temp();
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, crypto.randomBytes(16).toString('hex'));
  const out = fs.createWriteStream(tmp);
  let size = 0;
  const head = [];
  try {
    for await (const c of r.body) {
      size += c.length;
      if (size > max) throw new Error(`larger than ${Math.round(max / 1048576)} MB`);
      if (head.length < 1) head.push(Buffer.from(c.subarray(0, 512)));
      if (!out.write(c)) await new Promise(ok => out.once('drain', ok));
    }
    await new Promise((ok, fail) => out.end(err => (err ? fail(err) : ok())));
  } catch (err) {
    out.destroy();
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  return { tmp, size, head: new Uint8Array(Buffer.concat(head).subarray(0, 512)) };
}

// One old file kept as an upload of `kind`. Returns { ref, id } or { failed }.
async function copyOne(q, url, kind, name = nameOf(url)) {
  try {
    const got = await download(url, kind);
    let file = got;
    let fileName = name;
    // A photo over the limit is shrunk (the old system took them as they came).
    if (kind === 'photo' && got.size > F.UPLOADS.photo.maxMB * 1048576) {
      const buffer = await sharp(got.tmp).rotate().resize(2560, 2560, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      await fsp.rm(got.tmp, { force: true });
      const saved = await FILES.saveBuffer(q, SYSTEM, { kind, name: `${fileName.replace(/\.[^.]+$/, '')}.jpg`, buffer });
      return { ref: saved.ref, id: saved.id };
    }
    if (kind === 'photo' && !/\.(jpe?g|png)$/i.test(fileName)) fileName = `${fileName}.jpg`;
    const saved = await FILES.saveTemp(q, SYSTEM, { kind, name: FILES.cleanName(fileName), ...file });
    return { ref: saved.ref, id: saved.id };
  } catch (err) {
    return { failed: String(err.message || err).slice(0, 120) };
  }
}

const link = (q, ids, entity, id) => (ids.length ? q('files').whereIn('id', ids).update({ entity, entity_id: String(id) }) : null);
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  return out;
}

// ── Listing photos ──────────────────────────────────────────────────────────
async function copyPhotos(q, { limit = Infinity, listing = null, concurrency = 4, retryFailed = false, dryRun = false, log = () => {} } = {}) {
  const out = { listings: 0, copied: 0, failed: 0, left: 0 };
  const todo = p => p.url && !p.preview && (retryFailed || !p.copyFailed);
  let after = 0;
  for (;;) {
    const b = q('listings').whereNotNull('photo_set').where('id', '>', after).orderBy('id').limit(200).select('id', 'photo_set');
    if (listing != null) b.where('id', listing);
    const rows = await b;
    if (!rows.length) break;
    after = rows.at(-1).id;
    for (const row of rows) {
      const want = (parseJson(row.photo_set) || []).filter(todo);
      if (!want.length) continue;
      if (dryRun || out.copied + out.failed >= limit) { out.left += want.length; if (dryRun) out.listings++; continue; }
      out.listings++;
      const got = await inBatches(want, concurrency, p => copyOne(q, p.url, 'photo', p.name || nameOf(p.url)));
      const done = new Map(want.map((p, i) => [p.id, { url: p.url, ...got[i] }]));
      // Merged into the album as it is now (someone may have changed it meanwhile).
      await q.transaction(async trx => {
        const now = await trx('listings').where('id', row.id).forUpdate().first('photo_set');
        const set = (parseJson(now?.photo_set) || []).map(p => {
          const d = done.get(p.id);
          if (!d || p.url !== d.url) return p;
          if (d.ref) { const { copyFailed, ...rest } = p; return { ...rest, preview: d.ref }; } // eslint-disable-line no-unused-vars
          return { ...p, copyFailed: d.failed };
        });
        await trx('listings').where('id', row.id).update({ photo_set: JSON.stringify(set) });
        await link(trx, [...done.values()].filter(d => d.id && set.some(p => p.preview === d.ref)).map(d => d.id), 'listings', row.id);
      });
      for (const d of done.values()) if (d.ref) out.copied++; else out.failed++;
      if (out.listings % 100 === 0) log(`photos: ${out.listings} listings, ${out.copied} copied, ${out.failed} failed`);
    }
    if (listing != null) break;
  }
  return out;
}

// ── Documents, slips, letters, receipts, videos, staff papers ───────────────
// Each: where the address is, what kind of upload it becomes, and the record kind it belongs to (files.entity).
const TEXT = [
  { table: 'money_in', column: 'file', kind: 'document', entity: 'moneyIn' },
  { table: 'money_out', column: 'letter', kind: 'document', entity: 'moneyOut' },
  { table: 'money_out', column: 'receipt', kind: 'document', entity: 'moneyOut' },
  { table: 'videos', column: 'file', kind: 'video', entity: 'videos' },
];
const STAFF_PAPERS = { application_IC: 'NRIC Copy', application_document: 'Application Form', application_POP: 'Joining Fee Receipt' };

async function copyDocuments(q, { limit = Infinity, concurrency = 4, dryRun = false, log = () => {} } = {}) {
  const out = { records: 0, copied: 0, failed: 0, left: 0, reasons: {} };
  const full = () => out.copied + out.failed >= limit;
  const tally = d => { if (d.ref) out.copied++; else { out.failed++; out.reasons[d.failed] = (out.reasons[d.failed] || 0) + 1; } };

  // One address in a text column: the record takes the copy if it still has that address.
  for (const t of TEXT) {
    let after = 0;
    for (;;) {
      const rows = await q(t.table).where('id', '>', after).where(t.column, 'like', 'http%').orderBy('id').limit(200).select('id', t.column);
      if (!rows.length) break;
      after = rows.at(-1).id;
      const want = rows.filter(r => isOld(r[t.column]));
      if (dryRun || full()) { out.left += want.length; continue; }
      const got = await inBatches(want, concurrency, r => copyOne(q, r[t.column], t.kind));
      for (const [i, r] of want.entries()) {
        const d = got[i];
        tally(d);
        if (!d.ref) continue;
        await q.transaction(async trx => {
          const n = await trx(t.table).where({ id: r.id, [t.column]: r[t.column] }).update({ [t.column]: d.ref });
          if (n) await link(trx, [d.id], t.entity, r.id);
        });
        out.records++;
      }
      log(`${t.table}.${t.column}: ${out.copied} copied, ${out.failed} failed`);
    }
  }

  // E-Form documents: a { name: address } map on each E-Form.
  let after = 0;
  for (;;) {
    const rows = await q('deals').where('id', '>', after).whereRaw("cast(files as char) like '%http%'").orderBy('id').limit(200).select('id', 'files');
    if (!rows.length) break;
    after = rows.at(-1).id;
    for (const row of rows) {
      const want = Object.entries(parseJson(row.files) || {}).filter(([, v]) => typeof v === 'string' && isOld(v));
      if (!want.length) continue;
      if (dryRun || full()) { out.left += want.length; continue; }
      const got = await inBatches(want, concurrency, ([, url]) => copyOne(q, url, 'document'));
      got.forEach(tally);
      await q.transaction(async trx => {
        const now = parseJson((await trx('deals').where('id', row.id).forUpdate().first('files'))?.files) || {};
        const used = [];
        want.forEach(([name, url], i) => { if (got[i].ref && now[name] === url) { now[name] = got[i].ref; used.push(got[i].id); } });
        await trx('deals').where('id', row.id).update({ files: JSON.stringify(now) });
        await link(trx, used, 'deals', row.id);
      });
      out.records++;
    }
    log(`E-Form documents: ${out.copied} copied, ${out.failed} failed`);
  }

  // Staff papers: the import kept only "on file"; the addresses are in its history (legacy_rows of new_staff).
  {
    // A few thousand people: read at once.
    const rows = await q('legacy_rows').where({ source_table: 'new_staff', target_table: 'staff' }).select('target_id', 'data');
    for (const row of rows) {
      const old = parseJson(row.data) || {};
      const staffId = Number(row.target_id);
      const staff = await q('staff').where('id', staffId).first('docs');
      if (!staff) continue;
      const docs = parseJson(staff.docs) || {};
      const want = Object.entries(STAFF_PAPERS).filter(([col, name]) => isOld(old[col]) && (docs[name] === true || docs[name] == null));
      if (!want.length) continue;
      if (dryRun || full()) { out.left += want.length; continue; }
      const got = await inBatches(want, concurrency, ([col]) => copyOne(q, old[col], 'document'));
      got.forEach(tally);
      await q.transaction(async trx => {
        const now = parseJson((await trx('staff').where('id', staffId).forUpdate().first('docs'))?.docs) || {};
        const used = [];
        want.forEach(([, name], i) => { if (got[i].ref && (now[name] === true || now[name] == null)) { now[name] = got[i].ref; used.push(got[i].id); } });
        await trx('staff').where('id', staffId).update({ docs: JSON.stringify(now) });
        await link(trx, used, 'staff', staffId);
      });
      out.records++;
    }
    log(`staff papers: ${out.copied} copied, ${out.failed} failed`);
  }
  return out;
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
  const db = require('../db/connection');
  const args = process.argv.slice(2);
  const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
  const only = opt('--only');
  const o = { limit: Number(opt('--limit', Infinity)), concurrency: Number(opt('--concurrency', 4)), retryFailed: args.includes('--retry-failed'),
    dryRun: args.includes('--dry-run'), log: m => console.log(m) };
  (async () => {
    if (!only || only === 'photos') console.log('photos:', await copyPhotos(db, o));
    if (!only || only === 'documents') console.log('documents:', await copyDocuments(db, o));
    await db.destroy();
  })().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { copyPhotos, copyDocuments };

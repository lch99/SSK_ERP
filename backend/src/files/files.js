// Uploads on the server. Every file is checked by the same rule the page uses
// (shared/files.js checkFile: type by its first bytes, size, how many), kept in
// storage (./storage.js) under a key the server makes, and recorded in `files`.
// A photo also gets a small preview made here (480px on its long side, WebP at
// 60%), which lists show instead of the photo itself.
//
// A record points at a file by its reference, 'files/<id>/<name>' (the name is
// for the page to show). An upload belongs to whoever sent it until an action
// saves a record that uses it; then it belongs to that record (entity, id), and
// only people who may see that record can open it. Uploads nobody used are
// removed after a day (pruneFiles), so nothing piles up.
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const F = require('../../../shared/files.js');
const AC = require('../../../shared/access.js');
const { storage } = require('./storage');
const { LISTS } = require('../db/lists');
const { inReach } = require('../db/erpGuard');
const { viewerOf } = require('../middleware/access');

const PREVIEW_PX = 480;
const HAS_PREVIEW = new Set(['photo', 'avatar']);
const KEEP_UNUSED_HOURS = 24;
const LINK_MINUTES = 10;
const SECRET = process.env.JWT_SECRET;

const refused = (status, error) => Object.assign(new Error(error), { status, errors: [error] });

// A reference to a saved upload, and the ids in any value (an action's arguments, a record).
const refOf = (id, name) => `files/${id}/${encodeURIComponent(name)}`;
const REF = /files\/(\d+)\//g;
const refsIn = value => new Set([...JSON.stringify(value ?? null).matchAll(REF)].map(m => Number(m[1])));

// A file's own name, without folders or control characters, at most 200 characters.
const cleanName = raw => {
  let name = '';
  try { name = decodeURIComponent(String(raw || '')); } catch { name = String(raw || ''); }
  return name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(-200);
};

const month = () => { const d = new Date(); return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`; };

// Reads the request body into a temporary file, stopping as soon as it is over `max` bytes.
// Returns { tmp, size, head } (head: the first 512 bytes).
async function receive(req, max) {
  const dir = storage.temp();
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, crypto.randomBytes(16).toString('hex'));
  const out = fs.createWriteStream(tmp);
  let size = 0;
  const chunks = [];
  let headLen = 0;
  try {
    await new Promise((resolve, reject) => {
      req.on('data', chunk => {
        size += chunk.length;
        if (size > max) { req.unpipe(out); reject(refused(413, 'too big')); return; }  // the rest is read and dropped
        if (headLen < 512) { chunks.push(chunk); headLen += chunk.length; }
      });
      req.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      req.pipe(out);
    });
  } catch (err) {
    out.destroy();
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  return { tmp, size, head: new Uint8Array(Buffer.concat(chunks).subarray(0, 512)) };
}

// POST /api/files?kind=<UPLOADS kind>, the file itself as the body, its name in X-File-Name.
async function upload(req, user, q) {
  const kind = String(req.query.kind || '');
  if (!Object.hasOwn(F.UPLOADS, kind)) throw refused(400, `Unknown upload kind: ${kind || '(none)'}.`);
  const name = cleanName(req.get('x-file-name'));
  if (!name) throw refused(400, 'Send the file\'s name in X-File-Name.');
  const max = F.UPLOADS[kind].maxMB * 1024 * 1024;
  const declared = Number(req.get('content-length'));
  // The name and the size it says it has, before reading anything.
  const early = F.checkFile({ name, size: declared || 1 }, kind);
  if (early) throw refused(declared > max ? 413 : 400, early);
  let got;
  try { got = await receive(req, max); } catch (err) {
    if (err.status === 413) throw refused(413, F.checkFile({ name, size: max + 1 }, kind));
    throw err;
  }
  return keep(q, user, { kind, name, ...got });
}

// A file already in hand (the old phone app sends photos inside its request, as text): checked and kept the same way.
async function saveBuffer(q, user, { kind, name: raw, buffer }) {
  if (!Object.hasOwn(F.UPLOADS, kind)) throw refused(400, `Unknown upload kind: ${kind || '(none)'}.`);
  const name = cleanName(raw);
  if (!name) throw refused(400, 'The file has no name.');
  const dir = storage.temp();
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, crypto.randomBytes(16).toString('hex'));
  await fsp.writeFile(tmp, buffer);
  return keep(q, user, { kind, name, tmp, size: buffer.length, head: new Uint8Array(buffer.subarray(0, 512)) });
}

// Checks a received file (tmp) by its first bytes and size, keeps it (and a photo's preview) in storage, and
// records it in `files`. The temporary file is removed either way.
async function keep(q, user, { kind, name, tmp, size, head }) {
  const made = [];
  try {
    const why = F.checkFile({ name, size }, kind, head);
    if (why) throw refused(400, why);
    const type = F.typeOf(name, kind);
    const ext = F.FILE_TYPES[type].ext[0];
    const base = `${kind.toLowerCase()}/${month()}/${crypto.randomBytes(16).toString('hex')}`;
    const key = `${base}${ext}`;
    let previewKey = null;
    if (HAS_PREVIEW.has(kind)) {
      const small = `${tmp}.preview`;
      made.push(small);
      try {
        await sharp(tmp).rotate().resize(PREVIEW_PX, PREVIEW_PX, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 60 }).toFile(small);
      } catch {
        throw refused(400, `${name} could not be read as a picture.`);
      }
      previewKey = `${base}.preview.webp`;
      await storage.put(previewKey, small);
    }
    await storage.put(key, tmp);
    const [id] = await q('files').insert({
      kind, name, mime: F.FILE_TYPES[type].mime[0], size, storage_key: key, preview_key: previewKey, uploaded_by: user.id ?? null,
    });
    return { id, ref: refOf(id, name), name, size, kind, preview: previewKey ? `files/${id}/preview` : null };
  } finally {
    await fsp.rm(tmp, { force: true });
    for (const m of made) await fsp.rm(m, { force: true });
  }
}

// Files an action's arguments point at: each must exist, and one not yet in a record must be the signed-in person's own.
async function checkRefs(q, args, user) {
  const ids = [...refsIn(args)];
  if (!ids.length) return;
  const rows = new Map((await q('files').whereIn('id', ids).select('id', 'entity', 'uploaded_by')).map(r => [r.id, r]));
  for (const id of ids) {
    const f = rows.get(id);
    if (!f) throw refused(400, 'One of the files is no longer there. Upload it again.');
    if (f.entity == null && (f.uploaded_by ?? null) !== (user.id ?? null)) throw refused(403, 'One of the files was uploaded by someone else.');
  }
}

// After an action: every new or changed record that points at an upload not yet in a record takes it.
async function linkFiles(q, before, after, user) {
  const claims = new Map();
  for (const [kind, rows] of Object.entries(after)) {
    if (!Array.isArray(rows) || !LISTS[kind]) continue;
    const was = new Map((before[kind] || []).map(r => [r.id, JSON.stringify(r)]));
    for (const r of rows) {
      const text = JSON.stringify(r);
      if (was.get(r.id) === text || !text.includes('files/')) continue;
      for (const id of refsIn(r)) if (!claims.has(id)) claims.set(id, [kind, r.id]);
    }
  }
  if (!claims.size) return 0;
  const free = await q('files').whereIn('id', [...claims.keys()]).whereNull('entity').select('id', 'uploaded_by');
  let n = 0;
  for (const f of free) {
    if ((f.uploaded_by ?? null) !== (user.id ?? null)) continue;
    const [entity, entityId] = claims.get(f.id);
    n += await q('files').where({ id: f.id }).whereNull('entity').update({ entity, entity_id: String(entityId) });
  }
  return n;
}

// May this person open the file? The Superadmin always; an upload not in a record yet, only who sent it;
// a profile picture, anyone signed in; listing photos and videos and training videos, anyone who sees that
// area; a person's documents, themselves or someone who edits staff in their reach; anything else,
// whoever sees that record (its area, in their reach).
const OPEN_TO_AREA = new Set(['listings', 'videos', 'titles', 'projects']);
async function mayRead(q, f, req) {
  const v = await viewerOf(req);
  if (AC.managesAccess(v.role)) return true;
  if (f.entity == null) return f.uploaded_by != null && f.uploaded_by === req.user.id;
  if (f.entity === 'profile') return true;
  const spec = LISTS[f.entity];
  if (!spec || spec.area == null) return false;
  const id = Number(f.entity_id);
  if (f.entity === 'staff' && id === v.staffId) return true;
  if (!AC.allows(v.policy, v.role, spec.area, f.entity === 'staff' ? 'edit' : 'view')) return false;
  if (OPEN_TO_AREA.has(f.entity) || v.scope === 'all') return true;
  return (await inReach(q, f.entity, [id], v)).has(id);
}

// The ids among `files` (rows) the viewer may open, with one reach check per kind of record
// (a list page asks for its photos' links in one go).
async function mayReadMany(q, files, req) {
  const v = await viewerOf(req);
  const ok = new Set();
  if (AC.managesAccess(v.role)) return new Set(files.map(f => f.id));
  const check = new Map();
  for (const f of files) {
    if (f.entity == null) { if (f.uploaded_by != null && f.uploaded_by === req.user.id) ok.add(f.id); continue; }
    if (f.entity === 'profile') { ok.add(f.id); continue; }
    const spec = LISTS[f.entity];
    if (!spec || spec.area == null) continue;
    const id = Number(f.entity_id);
    if (f.entity === 'staff' && id === v.staffId) { ok.add(f.id); continue; }
    if (!AC.allows(v.policy, v.role, spec.area, f.entity === 'staff' ? 'edit' : 'view')) continue;
    if (OPEN_TO_AREA.has(f.entity) || v.scope === 'all') { ok.add(f.id); continue; }
    if (!check.has(f.entity)) check.set(f.entity, []);
    check.get(f.entity).push(f);
  }
  for (const [kind, list] of check) {
    const seen = await inReach(q, kind, [...new Set(list.map(f => Number(f.entity_id)))], v);
    for (const f of list) if (seen.has(Number(f.entity_id))) ok.add(f.id);
  }
  return ok;
}

// A link to open the file (or its preview) for LINK_MINUTES, for an <a> or <img> that can't send the sign-in.
const sign = (id, part, exp) => crypto.createHmac('sha256', SECRET).update(`file:${id}:${part}:${exp}`).digest('base64url');
function signedUrl(id, part = 'file') {
  const exp = Math.floor(Date.now() / 1000) + LINK_MINUTES * 60;
  return `/api/files/${id}${part === 'preview' ? '/preview' : ''}?exp=${exp}&sig=${sign(id, part, exp)}`;
}
function signedOk(id, part, { exp, sig } = {}) {
  if (!/^\d+$/.test(String(exp || '')) || Number(exp) < Date.now() / 1000 || typeof sig !== 'string') return false;
  const want = Buffer.from(sign(id, part, Number(exp)));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// Uploads that no record took within a day go, from storage too. Returns how many.
async function pruneFiles(q) {
  const old = await q('files').whereNull('entity').where('created_at', '<', new Date(Date.now() - KEEP_UNUSED_HOURS * 3600000)).select('id', 'storage_key', 'preview_key');
  for (const f of old) {
    await storage.remove(f.storage_key);
    if (f.preview_key) await storage.remove(f.preview_key);
  }
  if (old.length) await q('files').whereIn('id', old.map(f => f.id)).del();
  return old.length;
}

module.exports = { upload, saveBuffer, checkRefs, linkFiles, mayRead, mayReadMany, LINKS_AT_ONCE: 200, signedUrl, signedOk, pruneFiles, refsIn, refOf, cleanName };

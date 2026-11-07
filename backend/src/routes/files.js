// /api/files — uploads (files/files.js). Mounted before the JSON body parser:
// the body of an upload is the file itself.
//   POST /api/files?kind=document   X-File-Name: <name>   → { id, ref, name, size, kind, preview }
//   GET  /api/files/<id>/link        → { url, preview, name } (signed links, a few minutes)
//   GET  /api/files/<id>?exp=&sig=   the file;  /api/files/<id>/preview?exp=&sig=  its preview
const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { downtimeGate } = require('../middleware/downtime');
const { storage } = require('../files/storage');
const FILES = require('../files/files');

const router = express.Router();
const idOf = v => (/^\d+$/.test(String(v)) ? Number(v) : null);
// A refusal before the whole file arrived: Node reads and drops the rest, so the sender gets the reason.
const fail = (res, err) => res.status(err.status).json({ error: err.message, errors: err.errors || [err.message] });

router.post('/', requireAuth, downtimeGate(), async (req, res, next) => {
  try {
    res.json(await FILES.upload(req, req.user, db));
  } catch (err) {
    if (err.status) return fail(res, err);
    next(err);
  }
});

router.get('/:id/link', requireAuth, downtimeGate(), async (req, res, next) => {
  try {
    const id = idOf(req.params.id);
    const f = id && await db('files').where({ id }).first();
    if (!f || !(await FILES.mayRead(db, f, req))) return res.status(404).json({ error: 'Not found, or not yours to see.' });
    res.json({ name: f.name, size: Number(f.size), url: FILES.signedUrl(id), preview: f.preview_key ? FILES.signedUrl(id, 'preview') : null });
  } catch (err) { next(err); }
});

// The file or its preview, for a signed link only.
const serve = part => async (req, res, next) => {
  try {
    const id = idOf(req.params.id);
    if (!id || !FILES.signedOk(id, part, req.query)) return res.status(403).json({ error: 'This link has expired. Open the file again from its page.' });
    const f = await db('files').where({ id }).first();
    const key = f && (part === 'preview' ? f.preview_key : f.storage_key);
    if (!key) return res.status(404).json({ error: 'Not found.' });
    const shown = /^(image\/|application\/pdf$|video\/)/.test(f.mime);
    res.set({
      'Content-Type': part === 'preview' ? 'image/webp' : f.mime,
      'Content-Disposition': `${shown ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'Cache-Control': 'private, max-age=600',
      'X-Content-Type-Options': 'nosniff',
    });
    if (part !== 'preview') res.set('Content-Length', String(f.size));
    const stream = storage.open(key);
    stream.on('error', err => (res.headersSent ? res.destroy(err) : next(err)));
    stream.pipe(res);
  } catch (err) { next(err); }
};
router.get('/:id/preview', serve('preview'));
router.get('/:id', serve('file'));

module.exports = router;

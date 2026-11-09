// Where uploaded files live: a folder on the API's server (UPLOAD_DIR, default backend/uploads, never in
// git), or object storage (STORAGE=s3, files/s3.js: S3, R2, Spaces…) behind the same three calls, so
// nothing else changes: put(key, fromPath), open(key) → a readable stream, remove(key).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));

// A key is made by the server ('document/2026/11/<random>.pdf'); refuse anything that could leave the folder.
function full(key) {
  if (!/^[a-z]+\/\d{4}\/\d{2}\/[a-f0-9]{32}(\.preview)?\.[a-z0-9]{2,5}$/.test(key)) throw new Error(`Bad storage key: ${key}`);
  return path.join(ROOT, key);
}

const local = {
  // Moves (or copies, across disks) the finished upload into place.
  async put(key, fromPath) {
    const to = full(key);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    try { await fsp.rename(fromPath, to); } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      await fsp.copyFile(fromPath, to);
      await fsp.rm(fromPath, { force: true });
    }
  },
  open: key => fs.createReadStream(full(key)),
  remove: key => fsp.rm(full(key), { force: true }),
  // The folder unfinished uploads are written to first (same disk, so put() is a rename).
  temp: () => path.join(ROOT, '.incoming'),
};

// STORAGE=s3: object storage (files/s3.js); unfinished uploads still land in the local folder first.
const { s3Storage } = require('./s3');
const storage = process.env.STORAGE === 's3' ? s3Storage({ temp: local.temp }) : local;

module.exports = { storage, ROOT };

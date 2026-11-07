// Where uploaded files live. One driver today: a folder on the API's server
// (UPLOAD_DIR, default backend/uploads, never in git). Going live it becomes
// object storage (S3 or alike) behind the same three calls, so nothing else
// changes: put(key, fromPath), open(key) → a readable stream, remove(key).
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

module.exports = { storage: local, ROOT };

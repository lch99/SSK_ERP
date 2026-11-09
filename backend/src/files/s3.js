// Object storage for uploads (STORAGE=s3): any S3-compatible service (Amazon S3, Cloudflare R2,
// DigitalOcean Spaces, Wasabi, MinIO…), behind the same three calls as the folder driver
// (files/storage.js): put(key, fromPath), open(key) → a readable stream, remove(key). Requests are
// signed with AWS Signature Version 4 (no SDK needed). Settings:
//   S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY      required
//   S3_REGION      e.g. ap-southeast-1 (Amazon), auto (Cloudflare R2); default us-east-1
//   S3_ENDPOINT    the service's address for anything but Amazon, e.g. https://<account>.r2.cloudflarestorage.com
//                  (the bucket then goes in the path); blank = Amazon, https://<bucket>.s3.<region>.amazonaws.com
//   S3_PREFIX      a folder inside the bucket, e.g. erp/ (optional)
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { PassThrough, Readable } = require('node:stream');

const sha256 = v => crypto.createHash('sha256').update(v).digest('hex');
const hmac = (key, v) => crypto.createHmac('sha256', key).update(v).digest();
// RFC 3986, as SigV4 wants (S3 paths keep their slashes).
const encode = s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// Signs a request: returns the headers to send (with Authorization). `payloadHash` 'UNSIGNED-PAYLOAD' for
// S3 uploads streamed from a file (allowed over HTTPS).
function sign({ method, url, headers = {}, region, service = 's3', accessKey, secretKey, date = new Date(), payloadHash }) {
  const u = new URL(url);
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const all = { ...headers, host: u.host, 'x-amz-date': amzDate, ...(service === 's3' && { 'x-amz-content-sha256': payloadHash }) };
  const names = Object.keys(all).map(k => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const path = u.pathname.split('/').map(seg => encode(decodeURIComponent(seg))).join('/') || '/';
  const query = [...u.searchParams].map(([k, v]) => [encode(k), encode(v)]).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [method, path, query, names.map(n => `${n}:${lower[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

function settings() {
  const bucket = process.env.S3_BUCKET, accessKey = process.env.S3_ACCESS_KEY_ID, secretKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKey || !secretKey) throw new Error('STORAGE=s3 needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.');
  const region = process.env.S3_REGION || 'us-east-1';
  const endpoint = (process.env.S3_ENDPOINT || '').replace(/\/+$/, '');
  const prefix = (process.env.S3_PREFIX || '').replace(/^\/+/, '');
  const bucketUrl = endpoint ? `${endpoint}/${bucket}` : `https://${bucket}.s3.${region}.amazonaws.com`;
  const urlOf = key => `${bucketUrl}/${prefix}${key}`;
  return { region, accessKey, secretKey, urlOf, bucketUrl, prefix };
}

async function call(method, key, { body, headers = {}, payloadHash = sha256('') } = {}) {
  const s = settings();
  const url = s.urlOf(key);
  const signed = sign({ method, url, headers, region: s.region, accessKey: s.accessKey, secretKey: s.secretKey, payloadHash });
  return fetch(url, { method, headers: signed, body, ...(body && { duplex: 'half' }) });
}

function s3Storage({ temp }) {
  return {
    async put(key, fromPath) {
      const { size } = await fsp.stat(fromPath);
      const r = await call('PUT', key, { body: Readable.toWeb(fs.createReadStream(fromPath)), headers: { 'content-length': String(size) }, payloadHash: 'UNSIGNED-PAYLOAD' });
      if (!r.ok) throw new Error(`Storage refused ${key}: ${r.status} ${(await r.text()).slice(0, 200)}`);
      await fsp.rm(fromPath, { force: true });
    },
    // A stream at once (as the folder driver gives); the object's bytes follow as they arrive.
    open(key) {
      const out = new PassThrough();
      call('GET', key).then(r => {
        if (!r.ok) { out.destroy(Object.assign(new Error(`Storage: ${key} ${r.status}`), { code: r.status === 404 ? 'ENOENT' : 'ESTORAGE' })); return; }
        Readable.fromWeb(r.body).on('error', err => out.destroy(err)).pipe(out);
      }, err => out.destroy(err));
      return out;
    },
    async remove(key) {
      const r = await call('DELETE', key);
      if (!r.ok && r.status !== 404) throw new Error(`Storage could not remove ${key}: ${r.status}`);
    },
    temp,
  };
}

// Plain object calls for other jobs (backups): put a file, list keys under a prefix, delete one.
async function putObject(key, fromPath) {
  const { size } = await fsp.stat(fromPath);
  const r = await call('PUT', key, { body: Readable.toWeb(fs.createReadStream(fromPath)), headers: { 'content-length': String(size) }, payloadHash: 'UNSIGNED-PAYLOAD' });
  if (!r.ok) throw new Error(`Storage refused ${key}: ${r.status}`);
}
async function listKeys(prefix) {
  const s = settings();
  const keys = [];
  let token = null;
  do {
    const url = new URL(`${s.bucketUrl}/`);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', `${s.prefix}${prefix}`);
    if (token) url.searchParams.set('continuation-token', token);
    const r = await fetch(url, { headers: sign({ method: 'GET', url: url.toString(), region: s.region, accessKey: s.accessKey, secretKey: s.secretKey, payloadHash: sha256('') }) });
    if (!r.ok) throw new Error(`Storage could not list ${prefix}: ${r.status}`);
    const xml = await r.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, '&').slice(s.prefix.length));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] || null : null;
  } while (token);
  return keys;
}
async function deleteKey(key) {
  const r = await call('DELETE', key);
  if (!r.ok && r.status !== 404) throw new Error(`Storage could not remove ${key}: ${r.status}`);
}

module.exports = { s3Storage, sign, putObject, listKeys, deleteKey };

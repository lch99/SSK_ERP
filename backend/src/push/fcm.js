// Firebase Cloud Messaging (HTTP v1): sends a push to one phone (its token) or to
// everyone on a topic (the old app joins 'system'). Needs the Firebase project's
// service account key: FIREBASE_SERVICE_ACCOUNT (the JSON file's path, kept out of
// git like backend/.env) or FIREBASE_SERVICE_ACCOUNT_JSON (its text). Without
// one, pushes are off and nothing else changes. The key signs a short request for
// an access token (RS256, Google's OAuth), kept until a minute before it ends.
const crypto = require('node:crypto');
const fs = require('node:fs');

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const base = () => process.env.FCM_BASE_URL || 'https://fcm.googleapis.com';

let cached = { raw: null, account: null };
function account() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    || (process.env.FIREBASE_SERVICE_ACCOUNT ? fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT, 'utf8') : null);
  if (!raw) return null;
  if (cached.raw !== raw) {
    const a = JSON.parse(raw);
    if (!a.project_id || !a.client_email || !a.private_key) throw new Error('The Firebase service account needs project_id, client_email and private_key.');
    cached = { raw, account: { ...a, token_uri: a.token_uri || 'https://oauth2.googleapis.com/token' } };
  }
  return cached.account;
}
const enabled = () => { try { return !!account(); } catch { return false; } };

const b64 = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
let token = { value: null, until: 0, for: null };
async function accessToken(a) {
  if (token.for === a.client_email && token.until > Date.now() + 60000) return token.value;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: a.client_email, scope: SCOPE, aud: a.token_uri, iat: now, exp: now + 3600 })}`;
  const assertion = `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), a.private_key).toString('base64url')}`;
  const r = await fetch(a.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token) throw new Error(`Firebase sign-in failed (${r.status}): ${body.error_description || body.error || 'no access token'}`);
  token = { value: body.access_token, until: Date.now() + (Number(body.expires_in) || 3600) * 1000, for: a.client_email };
  return token.value;
}

// One message: { token } or { topic }, a title and text, and the data the app reads (strings only).
// Returns { ok: true } | { ok: false, gone: true } (the phone's token no longer works) | { ok: false, error }.
async function send({ to, topic, title, body, data = {} }) {
  const a = account();
  if (!a) return { ok: false, error: 'off' };
  const message = {
    ...(topic ? { topic } : { token: to }),
    notification: { title, body },
    data: Object.fromEntries(Object.entries({ ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' }).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])),
    android: { priority: 'high', notification: { click_action: 'FLUTTER_NOTIFICATION_CLICK' } },
    apns: { payload: { aps: { sound: 'default' } } },
  };
  const r = await fetch(`${base()}/v1/projects/${a.project_id}/messages:send`, {
    method: 'POST', headers: { Authorization: `Bearer ${await accessToken(a)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
  });
  if (r.ok) return { ok: true };
  const err = (await r.json().catch(() => ({}))).error || {};
  const code = (err.details || []).map(d => d.errorCode).find(Boolean) || err.status;
  // A phone that uninstalled the app or moved to another token.
  if (!topic && (code === 'UNREGISTERED' || r.status === 404 || (r.status === 400 && code === 'INVALID_ARGUMENT'))) return { ok: false, gone: true };
  return { ok: false, error: `${r.status} ${code || ''} ${err.message || ''}`.trim() };
}

module.exports = { send, enabled };

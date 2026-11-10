// Error alerts: an unexpected server error posts a short line to ALERT_WEBHOOK (a Slack or Discord incoming
// webhook, a Teams workflow, or anything that takes { text } as JSON): what went wrong and where, never the
// request's data. The same error is told once every 10 minutes at most; nothing is sent while the setting is blank.
const os = require('node:os');

const QUIET_MS = 10 * 60000;
const RETRY_MS = 60000; // a send that failed is tried again on the next error after a minute
const MAX_KINDS = 500;
const told = new Map();

// Quoted text, numbers and e-mail addresses are masked: a message may carry a value someone typed (a JSON
// error quotes the text it read). The server's log keeps the whole error.
const mask = text => String(text)
  .replace(/\S+@\S+/g, '<email>')
  .replace(/".*"/gs, '"…"') // first to last: the quoted text may hold quotes itself
  .replace(/`.*`/gs, '`…`')
  .replace(/'[^']*'/g, "'…'")
  .replace(/\d+/g, 'N');
// Addresses whose next part is a person or a secret, whatever it looks like.
const NAMED = new Set(['agents', 'link']);

// What went wrong, without the request's data. A database error by its code and MySQL's own text with every
// quoted value masked (knex puts the whole SQL, values included, in err.message; a duplicate entry quotes the value).
function whatOf(err) {
  const name = err?.name || 'Error';
  if (err && (err.sqlState || err.errno || err.sqlMessage)) {
    return `${name}: ${err.code || 'database error'}${err.sqlMessage ? ` (${String(err.sqlMessage).replace(/'[^']*'/g, "'…'").slice(0, 160)})` : ''}`;
  }
  return `${name}: ${mask(err?.message ?? err).slice(0, 200)}`;
}

// Where: the method and the address's shape, words kept and anything else (ids, codes, tokens, names) as :x.
function whereOf(req) {
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  const parts = path.split('/');
  const shape = parts.map((s, i) => (s === '' || (/^([a-z][a-z-]{0,23}|v\d)$/.test(s) && !NAMED.has(parts[i - 1])) ? s : ':x')).join('/');
  return `${req.method} ${shape}`;
}

async function alert(err, where = '') {
  const url = process.env.ALERT_WEBHOOK;
  if (!url) return false;
  const what = whatOf(err);
  const key = `${where}|${what}`;
  const now = Date.now();
  const last = told.get(key);
  if (last && now - last < QUIET_MS) return false;
  told.delete(key);
  if (told.size >= MAX_KINDS) for (const [k, t] of told) if (now - t >= QUIET_MS) told.delete(k);
  while (told.size >= MAX_KINDS) told.delete(told.keys().next().value); // the oldest first
  told.set(key, now);
  const text = `SubSaleKing ERP (${process.env.NODE_ENV || 'dev'}, ${os.hostname()}): ${what}${where ? ` at ${where}` : ''}`;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`the webhook answered ${res.status}`);
    return true;
  } catch (e) {
    console.error('Alert not sent:', e.message);
    told.set(key, now - QUIET_MS + RETRY_MS);
    return false;
  }
}

module.exports = { alert, whereOf, whatOf };

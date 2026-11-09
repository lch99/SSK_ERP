// Error alerts: an unexpected server error posts a short line to ALERT_WEBHOOK (a Slack or Discord incoming
// webhook, a Teams workflow, or anything that takes { text } as JSON): what went wrong and where, never the
// request's data. The same error is told once every 10 minutes at most; nothing is sent while the setting is blank.
const os = require('node:os');

const QUIET_MS = 10 * 60000;
const told = new Map();

async function alert(err, where = '') {
  const url = process.env.ALERT_WEBHOOK;
  if (!url) return false;
  const what = `${err?.name || 'Error'}: ${String(err?.message || err).slice(0, 200)}`;
  const key = `${where}|${what}`;
  const last = told.get(key);
  if (last && Date.now() - last < QUIET_MS) return false;
  told.set(key, Date.now());
  if (told.size > 500) for (const [k, t] of told) if (Date.now() - t > QUIET_MS) told.delete(k);
  const text = `SubSaleKing ERP (${process.env.NODE_ENV || 'dev'}, ${os.hostname()}): ${what}${where ? ` at ${where}` : ''}`;
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(5000) });
    return true;
  } catch (e) {
    console.error('Alert not sent:', e.message);
    return false;
  }
}

module.exports = { alert };

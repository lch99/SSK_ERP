// Planned downtime (shared/maintenance.js, System → Technical): while a window
// that closes the ERP runs, the API answers "back soon" (503) to everyone but
// the technical team and the Superadmin, as the page shows them. The page's
// start-up read (GET /api/erp/start) still answers, so it can show the window
// and open again by itself when it ends; sign-in and Roles & access are not
// behind this gate.
const db = require('../db/connection');
const M = require('../../../shared/maintenance.js');
const AC = require('../../../shared/access.js');
const { MODELS } = require('../db/records');
const { loadPolicy } = require('./access');

// The open windows, read again at most every few seconds (several servers each keep their own).
const TTL_MS = 10000;
let cache = { at: 0, windows: [] };
const forget = () => { cache = { at: 0, windows: [] }; };

// Local 'YYYY-MM-DD HH:MM' (the server's clock is the business time zone: app.js sets TZ).
const pad = n => String(n).padStart(2, '0');
const stampNow = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

async function openWindows(q = db) {
  if (Date.now() - cache.at < TTL_MS) return cache.windows;
  const rows = await q('downtime').where({ cancelled: false }).whereNull('ended_at').where('ends_at', '>', stampNow()).orderBy('starts_at');
  cache = { at: Date.now(), windows: rows.map(MODELS.downtime.toRecord) };
  return cache.windows;
}

// The window closing the ERP now, or null.
async function closedNow(q = db, now = stampNow()) {
  const { live } = M.downtimeAt(await openWindows(q), now);
  return live && live.closes ? live : null;
}

// The signed-in account's own role ("View the ERP as" doesn't count here): the Superadmin and
// anyone with Full on Technical keep working.
async function keepsWorking(user) {
  const role = AC.roleForUser(user);
  return AC.managesAccess(role) || AC.allows(await loadPolicy(), role, 'technical', 'full');
}

// After requireAuth. `open`: paths that answer anyway (the page's start-up read).
const downtimeGate = ({ open = [] } = {}) => async (req, res, next) => {
  try {
    if (open.includes(req.path)) return next();
    const w = await closedNow();
    if (!w || await keepsWorking(req.user)) return next();
    const error = `The ERP is closed for planned maintenance until ${M.whenText(w).split('–').pop().trim()}. ${w.message}`.trim();
    res.set('Retry-After', '60').status(503).json({ error, errors: [error], downtime: { start: w.start, end: w.end, message: w.message } });
  } catch (err) { next(err); }
};

module.exports = { downtimeGate, closedNow, forget, stampNow };

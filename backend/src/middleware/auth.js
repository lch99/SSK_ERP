// The token proves who you are; what you may do comes from the users row as it
// stands now, so a deactivated, demoted or moved account changes on its next
// request rather than when the token expires.
const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const { can } = require('../../../shared/roles.js');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET must be set in backend/.env');

// AUTH_DISABLED=true: no sign-in at all; every request acts as a superadmin.
// For demos on a laptop only — refused in production.
const AUTH_DISABLED = process.env.AUTH_DISABLED === 'true';
if (AUTH_DISABLED && process.env.NODE_ENV === 'production') {
  throw new Error('AUTH_DISABLED cannot be used with NODE_ENV=production');
}
const DEMO_USER = { id: null, username: 'demo', name: 'Demo', role: 'superadmin', branchId: null };

const toReqUser = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, branchId: u.branch_id });

async function requireAuth(req, res, next) {
  if (AUTH_DISABLED) { req.user = DEMO_USER; return next(); }
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please sign in.' });
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
  try {
    const u = await db('users').where('id', payload.id).first();
    if (!u || !u.is_active || Number(u.token_version) !== Number(payload.v)) {
      return res.status(401).json({ error: 'Please sign in again.' });
    }
    req.user = toReqUser(u);
    next();
  } catch (err) {
    next(err);
  }
}

const requirePerm = perm => (req, res, next) =>
  (can(req.user, perm) ? next() : res.status(403).json({ error: "Your account doesn't have access to this." }));

module.exports = { requireAuth, requirePerm, toReqUser, SECRET, AUTH_DISABLED };

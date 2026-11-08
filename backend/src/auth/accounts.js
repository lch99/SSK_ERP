// Everyone on the staff list signs in with their own account (the user's call,
// 2026-11-08): their username from the old ERP, and a password they set
// themselves from a one-time link. The office makes the link (the person's
// page, or everyone's at once as an Excel file) and sends it, by WhatsApp or
// otherwise; "Forgot password" asks the person's branch office for a new one.
// Only a hash of each link's secret is kept, and a link works once.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { validatePassword } = require('../../../shared/roles.js');
const { localToday } = require('../db/days');

const HOURS = { set: 7 * 24, reset: 24 };
const hash = token => crypto.createHash('sha256').update(token).digest('hex');
const refused = (status, error) => Object.assign(new Error(error), { status, errors: [error] });

// Why someone on the staff list may not sign in (their record is not Active), or null.
const STATUS_WHY = {
  locked: 'Your account is locked after a long time without activity. Ask your branch office to open it again.',
  suspended: 'Your account is suspended until the office checks your details. Ask your branch office.',
  pending: 'Your account is waiting for the office to check your details. Ask your branch office.',
  inactive: 'Your account is no longer active. Ask your branch office if this is a mistake.',
};
const staffRefusal = status => (status == null || status === 'active' ? null : STATUS_WHY[status] || STATUS_WHY.inactive);

// A username free for this person: their old ERP username (or staff code), lower case; if another account
// already has it, with their staff number added.
async function freeUsername(q, staff) {
  const base = String(staff.username || staff.code || `staff${staff.id}`).trim().toLowerCase().replace(/\s+/g, '').slice(0, 32) || `staff${staff.id}`;
  const taken = await q('users').where('username', base).first('id', 'staff_id');
  if (!taken || taken.staff_id === staff.id) return base;
  return `${base.slice(0, 32 - String(staff.id).length - 1)}-${staff.id}`;
}

// The person's account, made (with no password yet) when they have none.
async function accountFor(q, staff) {
  const had = await q('users').where('staff_id', staff.id).first();
  if (had) return { user: had, made: false };
  const username = await freeUsername(q, staff);
  const [id] = await q('users').insert({ username, name: String(staff.name || username).slice(0, 100), role: 'staff', branch_id: staff.branch_id ?? null,
    staff_id: staff.id, password_hash: null });
  return { user: await q('users').where('id', typeof id === 'object' ? id.id : id).first(), made: true };
}

// A new one-time link for the account (older unused ones stop working). Returns { token, purpose, expiresAt }.
async function makeLink(q, user, { by = null, purpose = null } = {}) {
  const kind = purpose || (user.password_hash ? 'reset' : 'set');
  const token = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + HOURS[kind] * 3600000);
  await q('password_links').where('user_id', user.id).whereNull('used_at').del();
  await q('password_links').insert({ user_id: user.id, token_hash: hash(token), purpose: kind, expires_at: expires, created_by: by });
  return { token, purpose: kind, expiresAt: expires.toISOString() };
}

// The link's account, or why it can't be used.
async function readLink(q, token) {
  const row = token && await q('password_links').where('token_hash', hash(String(token))).first();
  if (!row) throw refused(404, 'This link is not valid. Ask your branch office for a new one.');
  if (row.used_at) throw refused(410, 'This link was already used. Sign in with your password, or ask for a new link.');
  if (new Date(row.expires_at) < new Date()) throw refused(410, 'This link has expired. Ask your branch office for a new one.');
  const user = await q('users').where('id', row.user_id).first();
  if (!user || !user.is_active) throw refused(403, 'This account is deactivated.');
  return { row, user };
}

// Sets the password from a link: the link is spent, the account unlocked, other sessions signed out.
async function useLink(q, token, password) {
  const { row, user } = await readLink(q, token);
  const why = validatePassword(password);
  if (why) throw refused(400, why);
  await q('users').where('id', user.id).update({ password_hash: await bcrypt.hash(password, 12), token_version: Number(user.token_version) + 1,
    login_attempts: 0, locked: false, password_changed_at: q.fn.now() });
  await q('password_links').where('id', row.id).update({ used_at: q.fn.now() });
  return q('users').where('id', user.id).first();
}

// Who in the office hears that someone asked for a new link: the admins of their branch, and the
// Superadmin accounts (notice key 0).
async function officeFor(q, staff) {
  const admins = staff?.branch_id == null ? [] : await q('staff').where({ branch_id: staff.branch_id, status: 'active' })
    .whereIn('type', ['admin-staff', 'admin-staff2']).pluck('id');
  return [0, ...admins.map(Number)];
}

async function askForLink(q, user) {
  const staff = user.staff_id ? await q('staff').where('id', user.staff_id).first('id', 'name', 'code', 'branch_id', 'status') : null;
  if (staffRefusal(staff?.status)) return;
  const who = staff ? `${staff.name} (${staff.code})` : user.name;
  const at = `${localToday()} ${new Date().toTimeString().slice(0, 5)}`;
  for (const to of await officeFor(q, staff)) {
    await q('notices').insert({ to_whom: String(to), at, cat: 'office', text: `${who} forgot their password and asked for a new link. Open their page and send one.`,
      link: staff ? `staff/${staff.id}` : 'users', read_by: JSON.stringify([]) });
  }
}

module.exports = { accountFor, makeLink, readLink, useLink, askForLink, staffRefusal, freeUsername };

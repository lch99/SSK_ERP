// Signing in with a username and password, the same for the ERP's page
// (/api/auth/login) and the old phone app (/v1/login, appV1/): 5 wrong
// passwords lock the account, an account without a password set (a one-time
// link) is refused, and only Active people on the staff list get in.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { audit } = require('../db/audit');
const { toReqUser, staffOf, SECRET } = require('../middleware/auth');
const ACC = require('./accounts');

const EXPIRES = process.env.JWT_EXPIRES_IN || '8h';
const MAX_ATTEMPTS = 5;
// Compared against when the username doesn't exist, so a wrong username takes
// as long as a wrong password and doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

// code: what the old phone app is told (its own words for these cases).
const refused = (status, error, code) => Object.assign(new Error(error), { status, code });

// The account, or a refusal { status, message, code }.
async function checkSignIn(q, rawUsername, rawPassword) {
  const username = String(rawUsername || '').trim().toLowerCase();
  const password = String(rawPassword || '');
  if (!username || !password) throw refused(400, 'Enter your username and password.', 'LOGIN_INVALID_CREDENTIALS');
  const u = await q('users').where('username', username).first();
  if (!u) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw refused(401, 'Wrong username or password.', 'LOGIN_INVALID_CREDENTIALS');
  }
  if (u.locked) throw refused(403, 'This account is locked after too many wrong passwords. Ask a superadmin or your branch manager to unlock it.', 'LOGIN_ACCOUNT_DISABLED');
  if (!u.is_active) throw refused(403, 'This account is deactivated.', 'LOGIN_ACCOUNT_DISABLED');
  if (!u.password_hash) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw refused(403, 'You have not set a password yet. Open the link your branch office sent you, or tap "Forgot password" to ask for a new one.', 'LOGIN_INVALID_CREDENTIALS');
  }
  const staff = u.staff_id ? await q('staff').where('id', u.staff_id).first('status') : null;
  const why = ACC.staffRefusal(staff?.status);
  if (why) throw refused(403, why, 'LOGIN_ACCOUNT_DISABLED');
  if (!(await bcrypt.compare(password, u.password_hash))) {
    const attempts = Number(u.login_attempts) + 1;
    const locked = attempts >= MAX_ATTEMPTS;
    await q('users').where('id', u.id).update({ login_attempts: attempts, locked });
    if (locked) {
      await audit({ user: null }, { action: 'lock', entity: 'user', entityId: u.id, detail: { username: u.username } });
      throw refused(403, 'Too many wrong passwords — this account is now locked. Ask a superadmin or your branch manager to unlock it.', 'LOGIN_ACCOUNT_DISABLED');
    }
    const left = MAX_ATTEMPTS - attempts;
    throw refused(401, `Wrong username or password. ${left} attempt${left === 1 ? '' : 's'} left before the account locks.`, 'LOGIN_INVALID_CREDENTIALS');
  }
  await q('users').where('id', u.id).update({ login_attempts: 0, last_login_at: q.fn.now() });
  return u;
}

// A token for the account (the version signs out older ones when the password changes or the account locks).
const tokenFor = (u, expiresIn = EXPIRES) => jwt.sign({ id: u.id, v: u.token_version }, SECRET, { expiresIn });
const issue = async u => ({ token: tokenFor(u), user: toReqUser(u, await staffOf(u)) });

module.exports = { checkSignIn, tokenFor, issue, refused };

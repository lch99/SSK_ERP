// /api/auth — sign in, first-run account, own profile and password.
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { audit } = require('../db/audit');
const { requireAuth, toReqUser, AUTH_DISABLED } = require('../middleware/auth');
const { checkSignIn, issue } = require('../auth/signIn');
const { validateUser, validatePassword } = require('../../../shared/roles.js');
const { tidyProfile, checkProfile } = require('../../../shared/profile.js');
const { parseJson } = require('../db/records');
const ACC = require('../auth/accounts');

const router = express.Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in a few minutes.' } });

// Whether the very first account still has to be created.
router.get('/status', async (req, res, next) => {
  try {
    if (AUTH_DISABLED) return res.json({ authDisabled: true, needsFirstUser: false });
    const { n } = await db('users').count({ n: '*' }).first();
    res.json({ needsFirstUser: Number(n) === 0 });
  } catch (err) { next(err); }
});

// First run only: create the first superadmin. Refused once any account exists.
router.post('/first-user', loginLimiter, async (req, res, next) => {
  const body = { username: String(req.body?.username || '').trim().toLowerCase(), name: String(req.body?.name || '').trim(),
    role: 'superadmin', branchId: null, password: req.body?.password };
  const errors = validateUser(body, { isNew: true });
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  try {
    const user = await db.transaction(async trx => {
      const { n } = await trx('users').count({ n: '*' }).first();
      if (Number(n) > 0) return null;
      const [id] = await trx('users').insert({ username: body.username, name: body.name, role: 'superadmin',
        branch_id: null, password_hash: await bcrypt.hash(body.password, 12) });
      const u = await trx('users').where('id', typeof id === 'object' ? id.id : id).first();
      await audit({ user: toReqUser(u) }, { action: 'create', entity: 'user', entityId: u.id, detail: { username: u.username, role: u.role, firstUser: true } }, trx);
      return u;
    });
    if (!user) return res.status(409).json({ error: 'An account already exists. Please sign in.' });
    res.json(await issue(user));
  } catch (err) { next(err); }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const u = await checkSignIn(db, req.body?.username, req.body?.password);
    res.json(await issue(u));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// ── Set a password from a one-time link (auth/accounts.js) ──
const linkError = (res, err, next) => (err.status ? res.status(err.status).json({ error: err.message, errors: err.errors }) : next(err));

// Whose account a link is for, before they choose a password.
router.get('/link/:token', loginLimiter, async (req, res, next) => {
  try {
    const { row, user } = await ACC.readLink(db, req.params.token);
    res.json({ username: user.username, name: user.name, purpose: row.purpose });
  } catch (err) { linkError(res, err, next); }
});

// Sets the password and signs in.
router.post('/link/:token', loginLimiter, async (req, res, next) => {
  try {
    const u = await ACC.useLink(db, req.params.token, req.body?.password);
    await audit({ user: toReqUser(u) }, { action: 'set_password', entity: 'user', entityId: u.id, detail: { username: u.username, byLink: true } });
    const staff = u.staff_id ? await db('staff').where('id', u.staff_id).first('status') : null;
    const why = ACC.staffRefusal(staff?.status);
    if (why) return res.status(403).json({ error: `Your password is set. ${why}` });
    res.json(await issue(u));
  } catch (err) { linkError(res, err, next); }
});

// Forgot password: the person's branch office is asked to send a new link. The reply is the
// same whether or not the username exists.
router.post('/forgot', loginLimiter, async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    if (!username) return res.status(400).json({ error: 'Enter your username.' });
    const u = await db('users').where({ username, is_active: true }).first();
    if (u) {
      await ACC.askForLink(db, u);
      await audit({ user: null }, { action: 'forgot_password', entity: 'user', entityId: u.id, detail: { username: u.username } });
    }
    res.json({ ok: true, message: 'Your branch office has been asked to send you a new link. It works once, for 24 hours.' });
  } catch (err) { next(err); }
});

// My profile (shared/profile.js): kept with the account (users.profile, and the
// name in users.name); with sign-in off there is no account, so one settings entry.
const SIGN_IN_OFF_PROFILE = 'profile:sign-in-off';
const when = v => (v == null ? null : String(v));

async function readProfile(user) {
  if (user.id == null) {
    const row = await db('settings').where('key', SIGN_IN_OFF_PROFILE).first();
    const saved = row ? parseJson(row.value) : {};
    return { ...tidyProfile({ name: user.name, ...saved }), hasPassword: false, passwordChangedAt: null, updatedAt: saved.updatedAt || null };
  }
  const u = await db('users').where('id', user.id).first();
  return { ...tidyProfile({ ...parseJson(u.profile), name: u.name }), hasPassword: true, passwordChangedAt: when(u.password_changed_at), updatedAt: when(u.profile_saved_at) };
}

router.get('/profile', requireAuth, async (req, res, next) => {
  try { res.json(await readProfile(req.user)); } catch (err) { next(err); }
});

router.put('/profile', requireAuth, async (req, res, next) => {
  try {
    const problems = Object.values(checkProfile(req.body || {}));
    if (problems.length) return res.status(400).json({ error: problems[0], errors: problems });
    const p = tidyProfile(req.body);
    if (req.user.id == null) {
      await db('settings').insert({ key: SIGN_IN_OFF_PROFILE, value: JSON.stringify({ ...p, updatedAt: new Date().toISOString() }), updated_at: db.fn.now() })
        .onConflict('key').merge();
    } else {
      const { name, ...rest } = p;
      await db('users').where('id', req.user.id).update({ name, profile: JSON.stringify(rest), profile_saved_at: db.fn.now() });
      // Which details were filled in, never the details themselves (or the photo).
      await audit(req, { action: 'update_profile', entity: 'user', entityId: req.user.id, detail: { filled: Object.keys(rest).filter(k => rest[k]) } });
    }
    res.json(await readProfile(req.user));
  } catch (err) { next(err); }
});

// Change own password. Signs out other sessions; returns a fresh token for this one.
router.post('/password', requireAuth, async (req, res, next) => {
  try {
    if (req.user.id == null) return res.status(400).json({ error: 'Sign-in is off on this server, so there is no password to change.' });
    const u = await db('users').where('id', req.user.id).first();
    if (!(await bcrypt.compare(String(req.body?.current || ''), u.password_hash))) {
      return res.status(400).json({ error: 'Your current password is wrong.' });
    }
    const err = validatePassword(req.body?.password);
    if (err) return res.status(400).json({ error: err });
    await db('users').where('id', u.id).update({ password_hash: await bcrypt.hash(req.body.password, 12), token_version: Number(u.token_version) + 1, password_changed_at: db.fn.now() });
    await audit(req, { action: 'change_password', entity: 'user', entityId: u.id });
    res.json(await issue(await db('users').where('id', u.id).first()));
  } catch (err) { next(err); }
});

module.exports = router;

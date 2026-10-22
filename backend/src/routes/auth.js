// /api/auth — sign in, first-run account, own profile and password.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { audit } = require('../db/audit');
const { requireAuth, toReqUser, SECRET, AUTH_DISABLED } = require('../middleware/auth');
const { validateUser, validatePassword } = require('../../../shared/roles.js');

const router = express.Router();
const EXPIRES = process.env.JWT_EXPIRES_IN || '8h';
const MAX_ATTEMPTS = 5;
// Compared against when the username doesn't exist, so a wrong username takes
// as long as a wrong password and doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in a few minutes.' } });

const issue = u => ({
  token: jwt.sign({ id: u.id, v: u.token_version }, SECRET, { expiresIn: EXPIRES }),
  user: toReqUser(u),
});

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
    res.json(issue(user));
  } catch (err) { next(err); }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Enter your username and password.' });
  try {
    const u = await db('users').where('username', username).first();
    if (!u) {
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    if (u.locked) return res.status(403).json({ error: 'This account is locked after too many wrong passwords. Ask a superadmin or your branch manager to unlock it.' });
    if (!u.is_active) return res.status(403).json({ error: 'This account is deactivated.' });
    if (!(await bcrypt.compare(password, u.password_hash))) {
      const attempts = Number(u.login_attempts) + 1;
      const locked = attempts >= MAX_ATTEMPTS;
      await db('users').where('id', u.id).update({ login_attempts: attempts, locked });
      if (locked) {
        await audit({ user: null }, { action: 'lock', entity: 'user', entityId: u.id, detail: { username: u.username } });
        return res.status(403).json({ error: 'Too many wrong passwords — this account is now locked. Ask a superadmin or your branch manager to unlock it.' });
      }
      const left = MAX_ATTEMPTS - attempts;
      return res.status(401).json({ error: `Wrong username or password. ${left} attempt${left === 1 ? '' : 's'} left before the account locks.` });
    }
    await db('users').where('id', u.id).update({ login_attempts: 0, last_login_at: db.fn.now() });
    res.json(issue(u));
  } catch (err) { next(err); }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// Change own password. Signs out other sessions; returns a fresh token for this one.
router.post('/password', requireAuth, async (req, res, next) => {
  try {
    const u = await db('users').where('id', req.user.id).first();
    if (!(await bcrypt.compare(String(req.body?.current || ''), u.password_hash))) {
      return res.status(400).json({ error: 'Your current password is wrong.' });
    }
    const err = validatePassword(req.body?.password);
    if (err) return res.status(400).json({ error: err });
    await db('users').where('id', u.id).update({ password_hash: await bcrypt.hash(req.body.password, 12), token_version: Number(u.token_version) + 1 });
    await audit(req, { action: 'change_password', entity: 'user', entityId: u.id });
    res.json(issue(await db('users').where('id', u.id).first()));
  } catch (err) { next(err); }
});

module.exports = router;

// /api/users — login accounts. Superadmins manage everyone; branch managers
// manage Admin and Staff accounts in their own branch (shared/roles.js).
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { audit } = require('../db/audit');
const { requireAuth, requirePerm } = require('../middleware/auth');
const R = require('../../../shared/roles.js');

const router = express.Router();
router.use(requireAuth, requirePerm('users.manage'));

const out = u => ({
  id: u.id, username: u.username, name: u.name, role: u.role, branchId: u.branch_id,
  isActive: !!u.is_active, locked: !!u.locked, lastLoginAt: u.last_login_at, createdAt: u.created_at,
});
const fail = (res, status, error) => res.status(status).json({ error, errors: [error] });
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

async function cleanInput(body, { isNew }) {
  const role = body?.role;
  const scoped = R.roleMeta(role).branchScoped;
  const u = {
    username: String(body?.username || '').trim().toLowerCase(),
    name: String(body?.name || '').trim(),
    role,
    branchId: scoped && body?.branchId !== '' && body?.branchId != null ? Number(body.branchId) : null,
    password: body?.password || undefined,
  };
  const errors = R.validateUser(u, { isNew });
  if (!errors.length && u.branchId != null && !(await db('branches').where('id', u.branchId).first())) {
    errors.push('That branch no longer exists.');
  }
  return { u, errors };
}

// Keeps at least one active superadmin, whatever else changes.
async function wouldLeaveNoSuperadmin(trx, target, next) {
  if (target.role !== 'superadmin' || !target.is_active) return false;
  if (next.role === 'superadmin' && next.isActive) return false;
  const { n } = await trx('users').where({ role: 'superadmin', is_active: true }).whereNot('id', target.id).count({ n: '*' }).first();
  return Number(n) === 0;
}

router.get('/', wrap(async (req, res) => {
  const q = db('users').orderBy('name');
  if (req.user.role !== 'superadmin') q.where('branch_id', req.user.branchId);
  res.json({ users: (await q).map(out), assignableRoles: R.assignableRoles(req.user) });
}));

router.post('/', wrap(async (req, res) => {
  const { u, errors } = await cleanInput(req.body, { isNew: true });
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  if (!R.canManage(req.user, u)) return fail(res, 403, "You can't create an account with that role or branch.");
  if (await db('users').where('username', u.username).first()) return fail(res, 400, `The username "${u.username}" is taken.`);
  const id = await db.transaction(async trx => {
    const [newId] = await trx('users').insert({ username: u.username, name: u.name, role: u.role, branch_id: u.branchId,
      password_hash: await bcrypt.hash(u.password, 12) });
    const realId = typeof newId === 'object' ? newId.id : newId;
    await audit(req, { action: 'create', entity: 'user', entityId: realId, detail: { username: u.username, role: u.role, branchId: u.branchId } }, trx);
    return realId;
  });
  res.status(201).json({ user: out(await db('users').where('id', id).first()) });
}));

async function loadManaged(req, res) {
  const target = await db('users').where('id', Number(req.params.id)).first();
  if (!target) { fail(res, 404, 'Account not found.'); return null; }
  if (!R.canManage(req.user, { role: target.role, branchId: target.branch_id })) {
    fail(res, 403, "You can't change this account."); return null;
  }
  return target;
}

// Edit name, role, branch, active. Username never changes; passwords have their own route.
router.put('/:id', wrap(async (req, res) => {
  const target = await loadManaged(req, res);
  if (!target) return;
  const { u, errors } = await cleanInput({ ...req.body, username: target.username, password: undefined }, { isNew: false });
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  const isActive = req.body?.isActive === undefined ? !!target.is_active : !!req.body.isActive;
  if (!R.canManage(req.user, u)) return fail(res, 403, "You can't give that role or branch.");
  if (target.id === req.user.id && (u.role !== target.role || !isActive)) {
    return fail(res, 400, "You can't change your own role or deactivate yourself. Ask another superadmin.");
  }
  await db.transaction(async trx => {
    if (await wouldLeaveNoSuperadmin(trx, target, { role: u.role, isActive })) {
      throw Object.assign(new Error('There must always be at least one active superadmin.'), { status: 400 });
    }
    const signOut = !isActive && target.is_active;
    await trx('users').where('id', target.id).update({ name: u.name, role: u.role, branch_id: u.branchId, is_active: isActive,
      ...(signOut ? { token_version: Number(target.token_version) + 1 } : {}) });
    await audit(req, { action: 'update', entity: 'user', entityId: target.id, detail: {
      before: { name: target.name, role: target.role, branchId: target.branch_id, isActive: !!target.is_active },
      after: { name: u.name, role: u.role, branchId: u.branchId, isActive },
    } }, trx);
  }).catch(err => { if (err.status) return fail(res, err.status, err.message); throw err; });
  if (!res.headersSent) res.json({ user: out(await db('users').where('id', target.id).first()) });
}));

// Set a new password for someone (also unlocks it and signs out their sessions).
router.post('/:id/password', wrap(async (req, res) => {
  const target = await loadManaged(req, res);
  if (!target) return;
  const err = R.validatePassword(req.body?.password);
  if (err) return fail(res, 400, err);
  await db('users').where('id', target.id).update({ password_hash: await bcrypt.hash(req.body.password, 12),
    token_version: Number(target.token_version) + 1, locked: false, login_attempts: 0 });
  await audit(req, { action: 'reset_password', entity: 'user', entityId: target.id });
  res.json({ user: out(await db('users').where('id', target.id).first()) });
}));

router.post('/:id/unlock', wrap(async (req, res) => {
  const target = await loadManaged(req, res);
  if (!target) return;
  await db('users').where('id', target.id).update({ locked: false, login_attempts: 0 });
  await audit(req, { action: 'unlock', entity: 'user', entityId: target.id });
  res.json({ user: out(await db('users').where('id', target.id).first()) });
}));

module.exports = router;

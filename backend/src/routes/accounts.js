// /api/accounts — sign-in accounts for the people on the staff list (auth/accounts.js).
//   GET  /api/accounts/<staffId>          their account: username, password set or not, locked, last sign-in
//   POST /api/accounts/<staffId>/link     makes the account if needed and a one-time link → { username, token, purpose, expiresAt }
//   POST /api/accounts/links { base, branchId? }   Superadmin: accounts for every active person who has none, and a
//                                          link for each who has no password yet, as an Excel file to send them
const express = require('express');
const db = require('../db/connection');
const AC = require('../../../shared/access.js');
const { makeXlsx, XLSX_TYPE } = require('../../../shared/xlsx.js');
const { requireAuth } = require('../middleware/auth');
const { downtimeGate } = require('../middleware/downtime');
const { viewerOf } = require('../middleware/access');
const { inReach } = require('../db/erpGuard');
const { audit } = require('../db/audit');
const { localToday } = require('../db/days');
const ACC = require('../auth/accounts');

const router = express.Router();
router.use(requireAuth, downtimeGate());
const wrap = fn => (req, res, next) => fn(req, res).catch(next);
const idOf = v => (/^\d+$/.test(String(v)) ? Number(v) : null);

// The person, if the viewer may see (view) or change (edit) people in their reach.
async function personFor(req, res, level) {
  const v = await viewerOf(req);
  const id = idOf(req.params.staffId);
  if (!AC.allows(v.policy, v.role, 'staff', level)) { res.status(403).json({ error: 'Your role cannot manage sign-in accounts.' }); return null; }
  const staff = id && await db('staff').where('id', id).first('id', 'name', 'code', 'username', 'branch_id', 'status', 'phone');
  if (!staff || (v.scope !== 'all' && !(await inReach(db, 'staff', [id], v)).has(id))) { res.status(404).json({ error: 'Not found, or not yours to see.' }); return null; }
  return staff;
}

const describe = (u, link) => ({
  username: u?.username ?? null, hasAccount: !!u, hasPassword: !!u?.password_hash, active: u ? !!u.is_active : null, locked: !!u?.locked,
  lastSignIn: u?.last_login_at ? String(u.last_login_at) : null,
  linkOpen: link ? { purpose: link.purpose, expiresAt: String(link.expires_at) } : null,
});

router.get('/:staffId', wrap(async (req, res) => {
  const staff = await personFor(req, res, 'view');
  if (!staff) return;
  const u = await db('users').where('staff_id', staff.id).first();
  const link = u && await db('password_links').where('user_id', u.id).whereNull('used_at').where('expires_at', '>', new Date()).orderBy('id', 'desc').first();
  res.json({ ...describe(u, link), staffActive: staff.status === 'active' });
}));

router.post('/:staffId/link', wrap(async (req, res) => {
  const staff = await personFor(req, res, 'edit');
  if (!staff) return;
  if (ACC.staffRefusal(staff.status)) return res.status(400).json({ error: `${staff.name} is not Active, so they cannot sign in. Set them Active first.` });
  const out = await db.transaction(async trx => {
    const { user, made } = await ACC.accountFor(trx, staff);
    const link = await ACC.makeLink(trx, user, { by: req.user.id ?? null });
    await audit(req, { action: 'send_password_link', entity: 'staff', entityId: staff.id, detail: { username: user.username, purpose: link.purpose, newAccount: made } }, trx);
    return { username: user.username, ...link, made };
  });
  res.json(out);
}));

// Everyone at once (Superadmin): the file holds working links, so only the Superadmin makes it.
router.post('/links', wrap(async (req, res) => {
  const v = await viewerOf(req);
  if (!AC.managesAccess(v.role)) return res.status(403).json({ error: 'Only the Superadmin makes everyone\'s links at once.' });
  const base = String(req.body?.base || '');
  if (!/^https?:\/\/[^\s#]{1,200}$/.test(base)) return res.status(400).json({ error: 'Send the ERP\'s address (base) for the links.' });
  const branchId = idOf(req.body?.branchId);
  const people = await db('staff').where('status', 'active').modify(b => { if (branchId) b.where('branch_id', branchId); })
    .orderBy('id').select('id', 'name', 'code', 'username', 'branch_id', 'status', 'phone');
  const branches = new Map((await db('branches').select('id', 'name')).map(b => [b.id, b.name]));
  const rows = [['Code', 'Name', 'Branch', 'Phone', 'Username', 'Link to set the password', 'Link works until']];
  let made = 0, links = 0;
  await db.transaction(async trx => {
    for (const s of people) {
      const { user, made: isNew } = await ACC.accountFor(trx, s);
      if (isNew) made++;
      if (user.password_hash) continue;
      const link = await ACC.makeLink(trx, user, { by: req.user.id ?? null, purpose: 'set' });
      links++;
      rows.push([s.code, s.name, branches.get(s.branch_id) || '', s.phone || '', user.username, `${base}#/password?t=${link.token}`, link.expiresAt.slice(0, 10)]);
    }
    await audit(req, { action: 'make_password_links', entity: 'staff', detail: { branchId, accountsMade: made, links } }, trx);
  });
  res.set({ 'Content-Type': XLSX_TYPE, 'Content-Disposition': `attachment; filename="sign-in-links-${localToday()}.xlsx"`, 'X-Accounts-Made': String(made), 'X-Links': String(links),
    'Access-Control-Expose-Headers': 'Content-Disposition, X-Accounts-Made, X-Links' });
  res.send(Buffer.from(makeXlsx([{ name: 'Sign-in links', rows, widths: [14, 28, 22, 16, 18, 70, 16] }])));
}));

module.exports = router;

// Who is asking, in the ERP's terms (shared/access.js): their role (staff
// account type, or the sign-in role mapped to one), the staff record they are,
// their branch, and how far they see (own + downline, branch, all). The same
// policy the page uses decides what the API lets them read and do.
const db = require('../db/connection');
const AC = require('../../../shared/access.js');
const { parseJson } = require('../db/records');
const { teamIds } = require('../db/list');

const POLICY_KEY = 'access';

async function loadPolicy(q = db) {
  const row = await q('settings').where('key', POLICY_KEY).first();
  return AC.tidyPolicy(row ? parseJson(row.value) : null);
}

async function viewerOf(req) {
  if (req.viewer) return req.viewer;
  const u = req.user;
  const staff = u.staffId ? await db('staff').where('id', u.staffId).first('id', 'type', 'branch_id') : null;
  let role = staff ? AC.roleForType(staff.type) : AC.roleForUser(u);
  const policy = await loadPolicy();
  let me = { staffId: staff?.id ?? null, branchId: staff?.branch_id ?? u.branchId ?? null };
  // "View the ERP as" (?as=<role>&asStaff=<id>): someone who manages access sees
  // what that role and person would, on this request only. It only ever narrows.
  const as = req.query?.as;
  if (as && AC.roleOf(as) && AC.managesAccess(role)) {
    const other = /^\d+$/.test(String(req.query.asStaff || '')) ? await db('staff').where('id', Number(req.query.asStaff)).first('id', 'branch_id') : null;
    role = as;
    me = { staffId: other?.id ?? null, branchId: other?.branch_id ?? null };
  }
  const scope = AC.scopeOf(policy, role);
  req.viewer = { role, policy, scope, ...me, team: scope === 'team' ? await teamIds(db, me.staffId) : null };
  return req.viewer;
}

const refuse = (res, error) => res.status(403).json({ error, errors: [error] });

// Needs `level` in `area` (e.g. view on deals) to go on; with several areas, in any of them.
const needs = (area, level = 'view') => async (req, res, next) => {
  try {
    const v = await viewerOf(req);
    const areas = [].concat(area);
    if (areas.some(a => AC.allows(v.policy, v.role, a, level))) return next();
    refuse(res, `${AC.roleOf(v.role)?.label || v.role} has no ${AC.LEVEL_LABEL[level].toLowerCase()} access to ${AC.AREAS.find(a => a.key === areas[0])?.label || areas[0]}.`);
  } catch (err) { next(err); }
};

// Runs only when the role may do `action` (every action is in AC.ACTIONS).
const allowAction = action => async (req, res, next) => {
  try {
    const v = await viewerOf(req);
    const why = AC.refusal(v.policy, v.role, action);
    return why ? refuse(res, why) : next();
  } catch (err) { next(err); }
};

module.exports = { viewerOf, needs, allowAction, loadPolicy, teamIds, POLICY_KEY };

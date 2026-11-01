// Who is asking, in the ERP's terms (shared/access.js): their role (staff
// account type, or the sign-in role mapped to one), the staff record they are,
// their branch, and how far they see (own + downline, branch, all). The same
// policy the page uses decides what the API lets them read and do.
const db = require('../db/connection');
const AC = require('../../../shared/access.js');
const { parseJson } = require('../db/records');
const { rawRows } = require('../db/list');

const POLICY_KEY = 'access';

async function loadPolicy(q = db) {
  const row = await q('settings').where('key', POLICY_KEY).first();
  return AC.tidyPolicy(row ? parseJson(row.value) : null);
}

// Everyone at or under `staffId` in the upline chart (themselves included).
async function teamIds(q, staffId) {
  if (staffId == null) return [];
  const rows = await q.raw(
    'with recursive team(id) as (select id from staff where id = ? union select s.id from staff s join team t on s.upline_id = t.id) select id from team',
    [staffId]);
  return rawRows(rows).map(r => r.id);
}

async function viewerOf(req) {
  if (req.viewer) return req.viewer;
  const u = req.user;
  const staff = u.staffId ? await db('staff').where('id', u.staffId).first('id', 'type', 'branch_id') : null;
  const role = staff ? AC.roleForType(staff.type) : AC.roleForUser(u);
  const policy = await loadPolicy();
  const scope = AC.scopeOf(policy, role);
  req.viewer = {
    role, policy, scope, staffId: staff?.id ?? null, branchId: staff?.branch_id ?? u.branchId ?? null,
    team: scope === 'team' ? await teamIds(db, staff?.id ?? null) : null,
  };
  return req.viewer;
}

const refuse = (res, error) => res.status(403).json({ error, errors: [error] });

// Needs `level` in `area` (e.g. view on deals) to go on.
const needs = (area, level = 'view') => async (req, res, next) => {
  try {
    const v = await viewerOf(req);
    if (AC.allows(v.policy, v.role, area, level)) return next();
    refuse(res, `${AC.roleOf(v.role)?.label || v.role} has no ${AC.LEVEL_LABEL[level].toLowerCase()} access to ${AC.AREAS.find(a => a.key === area)?.label || area}.`);
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

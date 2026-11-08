// One of the ERP's shared actions for the signed-in person (shared/erpActions.js, its rule in
// shared/access.js ACTIONS), as POST /api/erp/actions/:name and the old phone app's addresses
// (appV1/) run them: whoever the page says is acting, it is the signed-in person; the records it
// works on must be in their reach, and the new ones too; uploads it uses must be theirs; it is
// saved in one transaction with an audit line (the ids changed, never the values).
// Returns { added, result, forProjects }; a refusal throws an error with status 400, 403 or 404.
const db = require('./connection');
const AC = require('../../../shared/access.js');
const A = require('../../../shared/erpActions.js');
const J = require('../../../shared/projects.js');
const FILES = require('../files/files');
const G = require('./erpGuard');
const { viewerOf } = require('../middleware/access');
const { forget: forgetDowntime } = require('../middleware/downtime');
const { act } = require('./erpRun');
const { audit } = require('./audit');
const { isInUse } = require('./errors');
const { localToday } = require('./days');

// Projects: the demo keeps them in a store of their own (src/demo/projectsApi.js);
// here they are records like the rest, and the same changes run on them.
function onProjects(state, change) {
  const all = state.data.projects;
  const s = { projects: all, nextId: Math.max(0, ...all.flatMap(p => [p.id, ...(p.incentives || []).map(i => i.id)])) + 1 };
  const result = change(s);
  state.data.projects = s.projects;
  return result;
}
const PROJECT_ACTIONS = {
  saveProject: (state, project) => onProjects(state, s => J.saveProjectIn(s, project, state.setup.tiers)),
  saveIncentive: (state, projectId, incentive) => onProjects(state, s => J.saveIncentiveIn(s, projectId, incentive)),
  deleteIncentive: (state, projectId, incentiveId) => onProjects(state, s => J.deleteIncentiveIn(s, projectId, incentiveId)),
};
const refusal = (status, message) => Object.assign(new Error(message), { status, errors: [message] });

async function runAction(req, name, rawArgs) {
  const forProjects = Object.hasOwn(PROJECT_ACTIONS, name);
  if (!Object.hasOwn(AC.ACTIONS, name) || (!forProjects && typeof A[name] !== 'function')) throw refusal(404, 'Not found, or not yours to see.');
  const v = await viewerOf(req);
  const why = AC.refusal(v.policy, v.role, name);
  if (why) throw refusal(403, why);
  const args = G.actorArgs(name, Array.isArray(rawArgs) ? rawArgs : [], v);
  let result, added = {};
  try {
    // Only the kinds the action reads are loaded (db/erpRun.js act); the checks and the log come after its last run.
    const done = await act(async (s, trx) => {
      await G.checkBefore(trx, name, args, s.data, v);
      await FILES.checkRefs(trx, args, req.user);
      if (forProjects) result = PROJECT_ACTIONS[name](s, ...args);
      else {
        const no = A[name](...args)(s.data, s.setup, localToday());
        if (no) throw refusal(400, no);
      }
    }, async (s, before, trx) => {
      added = G.addedIds(before, s.data);
      await G.checkAfter(trx, added, v);
      // Uploads the saved records now use belong to them (files/files.js).
      await FILES.linkFiles(trx, before, s.data, req.user);
      await audit(req, { action: name, entity: 'erp', detail: { changed: G.changedIds(before, s.data) } }, trx);
    }, { by: req.user.username, name, args });
    // ERP_TRACE_READS=1: which kinds each action read (to see which still read a big one).
    if (process.env.ERP_TRACE_READS) console.log(`action ${name} read: ${done.read.join(', ')}`);
    // A planned window changed: the gate reads them again on the next request.
    if (name.endsWith('Downtime')) forgetDowntime();
  } catch (err) {
    if (err.status === 400 || err.status === 403) throw Object.assign(err, { errors: err.errors || [err.message] });
    if (isInUse(err)) throw refusal(400, 'Other records still use this, so it cannot be removed. Set it Inactive instead.');
    throw err;
  }
  return { added, result, forProjects };
}

module.exports = { runAction };

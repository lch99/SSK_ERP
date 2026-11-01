// /api/setup — the Setup page (superadmin only). GET returns everything plus
// the go-live checklist. PUT /:step saves one step; POST /steps saves one
// wizard page ({ steps: [[step, body], …] }) all or nothing, as the demo does.
// Every step is logged in the audit trail and the full, fresh view comes back.
const express = require('express');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { audit } = require('../db/audit');
const store = require('../db/setupStore');
const { ValidationError } = require('../db/errors');

const router = express.Router();
router.use(requireAuth, requirePerm('setup.edit'));

// The agent list can be 5,000 rows: log how many, not every cell.
const logged = (step, body) => (step === 'agents' ? { mode: body?.mode, rows: Array.isArray(body?.rows) ? body.rows.length : 0 } : body);

const send = fn => async (req, res, next) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message, errors: err.errors });
    next(err);
  }
};

const save = (req, steps) => store.saveSteps(steps, {
  onSaved: (trx, step, body) => audit(req, { action: 'update', entity: `setup.${step}`, detail: logged(step, body) }, trx),
});

router.get('/', send(() => store.loadSetup()));
router.post('/steps', send(req => {
  const steps = req.body?.steps;
  if (!Array.isArray(steps) || !steps.length || !steps.every(s => Array.isArray(s) && typeof s[0] === 'string')) {
    throw new ValidationError(['Send { steps: [[step, body], …] }.']);
  }
  return save(req, steps);
}));
router.put('/:step', send(req => save(req, [[req.params.step, req.body]])));

// Branch names for pickers elsewhere (e.g. the Users page), for anyone signed in.
const branchesRouter = express.Router();
branchesRouter.get('/', requireAuth, send(async () => ({ branches: (await store.loadState()).branches })));

module.exports = { setupRouter: router, branchesRouter };

// /api/setup — the Setup page (superadmin only). GET returns everything plus
// the go-live checklist; each PUT saves one step, is logged in the audit
// trail, and returns the same full shape.
const express = require('express');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { audit } = require('../db/audit');
const store = require('../db/setupStore');

const router = express.Router();
router.use(requireAuth, requirePerm('setup.edit'));

const handle = (step, fn) => async (req, res, next) => {
  try {
    const result = await fn(req.body);
    if (step) await audit(req, { action: 'update', entity: `setup.${step}`, detail: req.body });
    res.json(result);
  } catch (err) {
    if (err instanceof store.ValidationError) return res.status(400).json({ error: err.message, errors: err.errors });
    next(err);
  }
};

router.get('/', handle(null, () => store.loadSetup()));
router.put('/company', handle('company', store.saveCompany));
router.put('/branches', handle('branches', store.saveBranches));
router.put('/deal-types', handle('dealTypes', store.saveDealTypes));
router.put('/tiers', handle('tiers', store.saveTiers));
router.put('/uplines', handle('uplines', store.saveUplines));
router.put('/payouts', handle('payouts', store.savePayouts));
router.put('/numbering', handle('numbering', store.saveNumbering));

// Branch names for pickers elsewhere (e.g. the Users page), for anyone signed in.
const branchesRouter = express.Router();
branchesRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { branches } = await store.loadSetup();
    res.json({ branches });
  } catch (err) { next(err); }
});

module.exports = { setupRouter: router, branchesRouter };

// /api/my-branch — a Branch Partner sets up their own branch, with no help from the office or IT:
//   GET  /          their branch as Setup has it (only that branch and its agents; the company's
//                   plans and upline levels, read only, for the agent template)
//   PUT  /details   { address, phone, manager }: the branch's details (name and code stay the Superadmin's)
//   POST /agents    { rows }: their agent list from Excel, added to their branch
//   PUT  /bm-account { staffId }: who receives their branch's BM profit (an agent of the branch, or nobody)
// Sign-in links for the whole branch are POST /api/accounts/links (routes/accounts.js).
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { downtimeGate } = require('../middleware/downtime');
const { viewerOf } = require('../middleware/access');
const { audit } = require('../db/audit');
const store = require('../db/setupStore');
const { ValidationError } = require('../db/errors');
const AC = require('../../../shared/access.js');

const router = express.Router();
router.use(requireAuth, downtimeGate());

const wrap = fn => (req, res, next) => fn(req, res, next).catch(err => {
  if (err instanceof ValidationError) return res.status(400).json({ error: err.errors[0], errors: err.errors });
  next(err);
});

// Only a Branch Partner, and only the branch their account is in.
router.use(wrap(async (req, res, next) => {
  const v = await viewerOf(req);
  if (v.role !== AC.BRANCH_PARTNER || v.branchId == null) {
    return res.status(403).json({ error: 'My branch is for Branch Partners.', errors: ['My branch is for Branch Partners.'] });
  }
  req.branchId = Number(v.branchId);
  next();
}));

router.get('/', wrap(async (req, res) => res.json(await store.loadBranchSetup(req.branchId))));

router.put('/details', wrap(async (req, res) => {
  res.json(await store.updateBranchDetails(req.branchId, req.body, {
    then: trx => audit(req, { action: 'update', entity: 'setup.branches', entityId: req.branchId, detail: { fields: ['address', 'manager', 'phone'] } }, trx),
  }));
}));

router.post('/agents', wrap(async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  res.json(await store.importBranchAgents(req.branchId, rows, {
    then: (trx, n) => audit(req, { action: 'update', entity: 'setup.agents', entityId: req.branchId, detail: { mode: 'add', rows: n } }, trx),
  }));
}));

// { staffId }: who receives this branch's BM profit (an agent of the branch; null: the company keeps it).
router.put('/bm-account', wrap(async (req, res) => {
  res.json(await store.setBranchManager(req.branchId, req.body?.staffId ?? null, {
    then: (trx, staffId) => audit(req, { action: 'update', entity: 'setup.standard', entityId: req.branchId, detail: { branchManager: staffId } }, trx),
  }));
}));

module.exports = router;

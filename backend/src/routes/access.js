// /api/access — Roles & access: what each role may do in each area and how far
// it sees. Anyone signed in reads it (the menu needs it); only the Superadmin changes it.
const express = require('express');
const AC = require('../../../shared/access.js');
const db = require('../db/connection');
const { audit } = require('../db/audit');
const { requireAuth } = require('../middleware/auth');
const { viewerOf, loadPolicy, POLICY_KEY } = require('../middleware/access');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try { res.json({ policy: await loadPolicy() }); } catch (err) { next(err); }
});

router.put('/', async (req, res, next) => {
  try {
    const v = await viewerOf(req);
    if (!AC.managesAccess(v.role)) return res.status(403).json({ error: 'Only the Superadmin changes Roles & access.' });
    const policy = AC.tidyPolicy(req.body?.policy);
    await db.transaction(async trx => {
      await trx('settings').insert({ key: POLICY_KEY, value: JSON.stringify(policy), updated_at: trx.fn.now() }).onConflict('key').merge();
      await audit(req, { action: 'update', entity: 'access', detail: policy }, trx);
    });
    res.json({ policy });
  } catch (err) { next(err); }
});

module.exports = router;

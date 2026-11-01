// Fills the database with the browser demo's sample (`npm run demo-data`):
// the sample Setup and the ERP records made from it. Replaces every Setup
// setting and ERP record, so never run it on real data.
require('dotenv').config();
const db = require('../db/connection');
const { seedDemo } = require('../db/demoSeed');

(async () => {
  const { data } = await seedDemo();
  const n = k => (data[k] || []).length;
  console.log(`Demo data loaded: ${n('staff')} people, ${n('listings')} listings, ${n('deals')} E-Forms, ${n('moneyIn')} payments, ${n('payouts')} payout lines. Refresh the page.`);
  await db.destroy();
})().catch(async err => { console.error(err.errors || err); await db.destroy(); process.exit(1); });

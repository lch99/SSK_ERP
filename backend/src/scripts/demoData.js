// Fills Setup with example data for demos: `npm run demo-data`.
// Overwrites the current Setup settings, so never run it on real data.
require('dotenv').config();
const db = require('../db/connection');
const store = require('../db/setupStore');

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to load demo data with NODE_ENV=production.');
  process.exit(1);
}

(async () => {
  await store.saveCompany({ name: 'SSK Ventures Sdn Bhd', regNo: '202401000001 (1234567-X)', sstNo: 'W10-1234-56789012',
    address: '12, Jalan Contoh 1/2, Taman Contoh, 58100 Kuala Lumpur', phone: '03-1234 5678', email: 'admin@ssk-ventures.example' });
  await store.saveBranches({ branches: [{ name: 'Taman Desa', code: 'TD' }, { name: 'Cheras', code: 'CH' }, { name: 'Puchong', code: 'PC' }] });
  await store.saveDealTypes({ sale: { enabled: true, defaultRate: 3 }, rental: { enabled: true, defaultRate: 100 }, project: { enabled: true, defaultRate: 2 }, sstPct: 8 });
  const tiers = [
    ['T1', 'Associate', 'lifetime', 0, 60], ['T2', 'Negotiator', 'lifetime', 30000, 65], ['T3', 'Senior Negotiator', 'lifetime', 60000, 70],
    ['T4', 'Executive', 'lifetime', 90000, 75], ['T5', 'Senior Executive', 'lifetime', 120000, 80],
    ['T6', 'Achiever', 'yearly', 100000, 83], ['T7', 'Star', 'yearly', 120000, 85], ['T8', 'Elite', 'yearly', 150000, 88], ['T9', 'Platinum', 'yearly', 200000, 90],
  ].map(([name, title, basis, threshold, agentRate]) => ({ name, title, basis, threshold, agentRate }));
  const { tiers: saved } = await store.saveTiers({ tiers });
  await store.saveUplines({
    roles: [{ code: 'AGA', name: 'Agent Leader' }, { code: 'TSM', name: 'Team Sales Manager' }, { code: 'GSM', name: 'Group Sales Manager' }],
    splits: { 'AGA+TSM': { AGA: 20, TSM: 80 }, 'AGA+GSM': { AGA: 20, GSM: 80 }, 'TSM+GSM': { TSM: 40, GSM: 60 }, 'AGA+TSM+GSM': { AGA: 20, TSM: 20, GSM: 60 } },
  });
  // Company default: agent rate + 25 points, capped at 95%.
  const totals = Object.fromEntries(saved.map(t => [t.id, Math.min(95, t.agentRate + 25)]));
  for (const dealType of ['sale', 'rental', 'project']) await store.savePayouts({ branchId: 0, dealType, totals });
  // One branch with its own higher totals, to show overrides.
  const td = (await store.loadSetup()).branches.find(b => b.code === 'TD');
  await store.savePayouts({ branchId: td.id, dealType: 'sale', totals: Object.fromEntries(saved.slice(0, 5).map(t => [t.id, Math.min(95, t.agentRate + 28)])) });
  await store.saveNumbering({ letters: { sale: 'S', rental: 'R', project: 'P' }, caseDigits: 4, voucherPrefix: 'PV', voucherDigits: 4 });
  console.log('Demo data loaded. Refresh the Setup page.');
  await db.destroy();
})().catch(async err => { console.error(err.errors || err); await db.destroy(); process.exit(1); });

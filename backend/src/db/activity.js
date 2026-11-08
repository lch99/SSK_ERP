// Someone on the staff list who uses the ERP is active today. Their last
// activity moves to today (one write per person per day), so the 60-day idle
// lock (shared/listings.js staffDue) only reaches people who really stopped.
const { localToday } = require('./days');

const seen = new Map();   // staff id → the day last written, in this server

async function markActive(db, staffId) {
  if (staffId == null) return;
  const today = localToday();
  if (seen.get(staffId) === today) return;
  seen.set(staffId, today);
  await db('staff').where({ id: staffId, status: 'active' })
    .where(q => q.whereNull('last_active_on').orWhere('last_active_on', '<', today))
    .update({ last_active_on: today });
}

module.exports = { markActive };

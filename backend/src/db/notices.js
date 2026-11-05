// Notifications are not kept for ever (noticeExpired in shared/listings.js: one
// person's goes once read and 90 days old, any at a year). The current ERP kept
// every one it sent (763,000 by 2026-11, more than half never read). Run once a
// day, on the first ERP read of the day, until the nightly job does it.
const LR = require('../../../shared/listings.js');
const { MODELS } = require('./records');
const { addDays } = require('./days');

const KEY = 'notices:pruned';
const CHUNK = 1000;

// Deletes the expired notifications; returns how many (0 when it already ran today).
async function pruneNotices(db, today) {
  const last = await db('settings').where('key', KEY).first();
  if (last && JSON.parse(last.value).on === today) return 0;
  const { read, any } = LR.LISTING_RULES.noticeDays;
  let removed = await db('notices').where('at', '<', addDays(today, -any)).del();
  // Older than the read limit: the shared rule decides (read by its one person).
  const old = await db('notices').where('at', '<', addDays(today, -read)).select('id', 'to_whom', 'at', 'read_by');
  const gone = old.map(MODELS.notices.toRecord).filter(n => LR.noticeExpired(n, today)).map(n => n.id);
  for (let i = 0; i < gone.length; i += CHUNK) removed += await db('notices').whereIn('id', gone.slice(i, i + CHUNK)).del();
  await db('settings').insert({ key: KEY, value: JSON.stringify({ on: today, removed }), updated_at: db.fn.now() }).onConflict('key').merge();
  return removed;
}

module.exports = { pruneNotices };

// Expired notifications are deleted once a day by the shared rule (noticeExpired
// in shared/listings.js), and nothing else is.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, migrate } = require('./helpers');
const { pruneNotices } = require('../src/db/notices');

before(migrate);
after(() => db.destroy());

test('read ones go at 90 days, any at a year, once a day', async () => {
  const n = (id, at, to, readBy = []) => ({ id, to_whom: String(to), at: `${at} 09:00:00`, cat: 'listing', text: `n${id}`, read_by: JSON.stringify(readBy) });
  await db('notices').insert([
    n(1, '2026-08-07', 12, [12]),        // read, 90 days old: kept
    n(2, '2026-08-06', 12, [12]),        // read, 91 days: gone
    n(3, '2026-08-06', 12, [7]),         // read by someone else only: kept
    n(4, '2026-08-06', 0, [0]),          // the office's, read: gone
    n(5, '2026-08-06', 'all', [12]),     // everyone's: kept until a year
    n(6, '2025-11-05', 12),              // unread, a year old: kept
    n(7, '2025-11-04', 'branch:3'),      // older than a year: gone
    n(8, '2026-11-05', 12, [12]),        // today's: kept
  ]);
  assert.equal(await pruneNotices(db, '2026-11-05'), 3);
  assert.deepEqual((await db('notices').orderBy('id').pluck('id')), [1, 3, 5, 6, 8]);
  await db('notices').where('id', 1).update({ at: '2020-01-01 00:00:00' });
  assert.equal(await pruneNotices(db, '2026-11-05'), 0, 'already ran today');
  assert.equal(await pruneNotices(db, '2026-11-06'), 2);          // 1 (moved back) and 6 (now a year and a day)
  assert.deepEqual((await db('notices').orderBy('id').pluck('id')), [3, 5, 8]);
  assert.equal(JSON.parse((await db('settings').where('key', 'notices:pruned').first()).value).on, '2026-11-06');
});

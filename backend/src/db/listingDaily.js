// How often a listing is looked at, as one row per listing and day (listing_daily): opened (view) or
// tapped in a list (click), on the website (web) or in the phone app (app). An opening also adds to the
// listing's own running totals (views, views_app), which its page shows. Rows go after two years.
const { localToday, addDays } = require('./days');

const KEEP_DAYS = 730;
const COLUMN = { web: { view: 'views_web', click: 'clicks_web' }, app: { view: 'views_app', click: 'clicks_app' } };

async function countLook(q, listingId, { via, kind }) {
  const col = COLUMN[via]?.[kind];
  if (!col) throw Object.assign(new Error('Say whether it was a view or a click, on the web or in the app.'), { status: 400 });
  await q.raw(`insert into listing_daily (listing_id, day, ${col}) values (?, ?, 1) on duplicate key update ${col} = ${col} + 1`, [listingId, localToday()]);
  if (kind === 'view') await q('listings').where('id', listingId).increment(via === 'web' ? 'views' : 'views_app', 1);
}

const pruneDaily = (q, today = localToday()) => q('listing_daily').where('day', '<', addDays(today, -KEEP_DAYS)).del();

module.exports = { countLook, pruneDaily };

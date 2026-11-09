// New notifications go to phones as pushes (push/fcm.js): every notice saved after
// the last one sent, whatever made it (an action, the time rules, "Forgot
// password"), to the phones of the people it is for (app_devices, saved by the old
// app's POST /v1/user/device); one for everyone goes to the app's 'system' topic.
// The place reached is kept in settings ('push:last', the last notice id), moved
// on with a compare-and-set so two servers never send the same notice twice. On
// the first run it starts at the newest notice: nothing old is sent. A tap opens
// the listing a notice links to (the old app reads ssk.* data keys) and marks the
// notice read through /v1/user/notification/:id/read.
const L = require('../../../shared/listings.js');
const FCM = require('./fcm');
const { parseJson } = require('../db/records');

const KEY = 'push:last';
const BATCH = 200;
// A notice older than this when its turn comes (the server was off) is not pushed: the list in the app has it.
const STALE_HOURS = 24;

// The accounts a notice is for: one person (their staff id; 0 = the office accounts with no staff record),
// a branch's Active people, or everyone (null: the topic).
async function accountsFor(q, to) {
  if (to === 'all') return null;
  const branch = /^branch:(\d+)$/.exec(to);
  if (branch) return q('users').join('staff', 'staff.id', 'users.staff_id').where('staff.branch_id', Number(branch[1])).where('staff.status', 'active').pluck('users.id');
  if (to === '0') return q('users').whereNull('staff_id').pluck('id');
  return /^\d+$/.test(to) ? q('users').where('staff_id', Number(to)).pluck('id') : [];
}

const message = n => {
  const listing = /^listings\/(\d+)$/.exec(n.link || '');
  return {
    title: L.NOTICE_CAT[n.cat]?.label || 'SubSaleKing', body: n.text,
    data: { 'ssk.notification_type': listing ? 'property.listing_tracking_updated' : 'other', 'ssk.notification_id': n.id, 'ssk.params.property_id': listing ? listing[1] : null },
  };
};

// Sends what is new. Returns { sent, gone, skipped } (gone: phones whose token stopped working, now forgotten).
async function pushNewNotices(q, { now = new Date() } = {}) {
  const out = { sent: 0, gone: 0, skipped: 0 };
  if (!FCM.enabled()) return out;
  const row = await q('settings').where('key', KEY).first();
  if (!row) {
    const { top } = await q('notices').max({ top: 'id' }).first();
    await q('settings').insert({ key: KEY, value: JSON.stringify(Number(top) || 0) }).onConflict('key').ignore();
    return out;
  }
  const last = Number(parseJson(row.value)) || 0;
  const notices = await q('notices').where('id', '>', last).orderBy('id').limit(BATCH);
  if (!notices.length) return out;
  const upTo = notices.at(-1).id;
  // Claim them; another server that got there first has them.
  const moved = await q('settings').where('key', KEY).whereRaw('json_unquote(value) = ?', [String(last)]).update({ value: JSON.stringify(upTo), updated_at: q.fn.now() });
  if (!moved) return out;
  for (const n of notices) {
    const at = new Date(String(n.at).replace(' ', 'T'));
    if (Number.isFinite(at.getTime()) && now - at > STALE_HOURS * 3600000) { out.skipped++; continue; }
    const m = message(n);
    const accounts = await accountsFor(q, String(n.to_whom));
    if (accounts === null) {
      const r = await FCM.send({ topic: 'system', ...m });
      if (r.ok) out.sent++; else console.error(`Push to everyone (notice ${n.id}):`, r.error);
      continue;
    }
    if (!accounts.length) continue;
    const already = new Set(parseJson(n.read_by) || []);
    if (already.has(Number(n.to_whom))) continue;
    for (const d of await q('app_devices').whereIn('user_id', accounts).select('id', 'fcm_token')) {
      const r = await FCM.send({ to: d.fcm_token, ...m });
      if (r.ok) out.sent++;
      else if (r.gone) { out.gone++; await q('app_devices').where('id', d.id).del(); }
      else console.error(`Push (notice ${n.id}):`, r.error);
    }
  }
  return out;
}

module.exports = { pushNewNotices, accountsFor };

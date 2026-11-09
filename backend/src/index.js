const app = require('./app');
const { alert } = require('./ops/alerts');

// Anything that escapes a request (a scheduled job, a stray promise) is logged and told too.
process.on('unhandledRejection', err => { console.error('Unhandled:', err); alert(err, 'background'); });

const { runTimeRules } = require('./db/erpRun');

const PORT = Number(process.env.PORT) || 3002;
app.listen(PORT, () => console.log(`SSK ERP API on :${PORT}`));

// The time rules (viewings expire, accounts suspend or lock…) and the notification clean-up, on a
// schedule: once at start, then every TIME_RULES_MINUTES (15; 0 = off, e.g. on a copy of real data
// whose idle accounts must not be locked yet). Reading the ERP never runs them.
const every = Number(process.env.TIME_RULES_MINUTES ?? 15);
if (every > 0) {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    runTimeRules().catch(e => { console.error('Time rules:', e.message); alert(e, 'time rules'); }).finally(() => { running = false; });
  };
  setTimeout(run, 5000).unref();
  setInterval(run, every * 60000).unref();
}

// New notifications go to phones as pushes (push/outbox.js), every PUSH_SECONDS (20; 0 = off), once the
// Firebase service account is set (FIREBASE_SERVICE_ACCOUNT).
const { pushNewNotices } = require('./push/outbox');
const FCM = require('./push/fcm');
const pushEvery = Number(process.env.PUSH_SECONDS ?? 20);
if (pushEvery > 0 && FCM.enabled()) {
  const db = require('./db/connection');
  let pushing = false;
  setInterval(() => {
    if (pushing) return;
    pushing = true;
    pushNewNotices(db).catch(e => { console.error('Push:', e.message); alert(e, 'push'); }).finally(() => { pushing = false; });
  }, pushEvery * 1000).unref();
  console.log('Push notifications on');
}

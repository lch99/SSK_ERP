const app = require('./app');

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
    runTimeRules().catch(e => console.error('Time rules:', e.message)).finally(() => { running = false; });
  };
  setTimeout(run, 5000).unref();
  setInterval(run, every * 60000).unref();
}

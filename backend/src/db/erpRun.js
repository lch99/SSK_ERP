// Running a change on the ERP's records (stage one): read them in one
// transaction, run the time rules (as the demo does before every action), let
// the change alter them and save the difference; one change at a time, so two
// saves never hand out the same new id or code. Also the time rules on their
// own, on a schedule (src/index.js), so reading the ERP never has to run them.
const db = require('./connection');
const A = require('../../../shared/erpActions.js');
const { loadState, saveChanges } = require('./erpState');
const { pruneNotices } = require('./notices');
const { localToday } = require('./days');

let queue = Promise.resolve();
const oneAtATime = fn => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

// `change(state, before, trx)` alters state.data; a refusal it throws saves nothing.
const changeState = (change, { by } = {}) => oneAtATime(() => db.transaction(async trx => {
  const state = await loadState(trx);
  if (!state.data) throw Object.assign(new Error(state.blockers[0]), { status: 400, errors: [state.blockers[0]] });
  const before = structuredClone(state.data);
  A.runClock(state.data, state.setup);
  await change(state, before, trx);
  await saveChanges(trx, before, state.data, { by });
  return state;
}));

// The time rules (viewings expire or wait for review, co-PH slots end, accounts suspend or lock and
// hand their listings on) and the notification clean-up: what the ERP does by itself, saved if it
// changed anything. Returns whether it ran (not before Setup is done).
async function runTimeRules() {
  await pruneNotices(db, localToday());
  const setup = await loadState(db, { only: [] });
  if (!setup.data) return false;
  await changeState(() => {});
  return true;
}

module.exports = { changeState, runTimeRules };

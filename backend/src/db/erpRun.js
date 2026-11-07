// Running a change on the ERP's records (stage one): read them in one
// transaction, run the time rules (as the demo does before every action), let
// the change alter them and save the difference; one change at a time, so two
// saves never hand out the same new id or code. Also the time rules on their
// own, on a schedule (src/index.js), so reading the ERP never has to run them.
const db = require('./connection');
const A = require('../../../shared/erpActions.js');
const { loadState, saveChanges, KINDS } = require('./erpState');
const { MODELS } = require('./records');
const { listingsFor, codeFloor } = require('./actionScope');
const { pruneNotices } = require('./notices');
const { pruneFiles } = require('../files/files');
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

// ── An action on only the records it reads ──────────────────────────────────
// The kinds an action may ask for (the staff directory always comes: who is acting, and reach).
const WATCHED = new Set([...KINDS, 'v1', 'audit']);
const ALWAYS = ['staff'];

// The highest id in every table of the one id space (shared/erpActions.js newId).
async function topId(q) {
  const [rows] = await q.raw(`select max(m) as m from (${A.ID_KINDS.map(k => `select max(id) as m from \`${MODELS[k].table}\``).join(' union all ')}) t`);
  return Number(rows[0]?.m) || 0;
}

// The records as the action sees them: a kind not loaded yet is noted (and reads as empty this time);
// RAW hands over the records themselves (newId reads its floor and the ids there).
const watch = (data, loaded, asked) => new Proxy(data, {
  get(t, k, r) {
    if (k === A.RAW) return t;
    if (typeof k === 'string' && WATCHED.has(k) && !loaded.has(k)) asked.add(k);
    return Reflect.get(t, k, r);
  },
});

// Runs an action on the kinds it reads, not every record (a save on the real data read 600 MB): run it
// on what is loaded, note any other kind it asked for, load that and run again from the tables; the last
// run is saved. run({ setup, data }, trx) changes only `data` (a refusal it throws saves nothing, unless it
// asked for more); finish(state, before, trx) then checks what was saved and logs it (a refusal undoes it). After five rounds
// every record is loaded. The time rules are not run here: src/index.js runs them on a schedule.
// name, args: the action's, so it loads only its own listings (db/actionScope.js).
const act = (run, finish, { by, name, args = [] } = {}) => oneAtATime(() => db.transaction(async trx => {
  let loaded = new Set(ALWAYS);
  const listings = name ? await listingsFor(trx, name, args) : null;
  for (let round = 1; ; round++) {
    const state = await loadState(trx, { only: [...loaded], listings: loaded.size === WATCHED.size ? null : listings });
    if (!state.data) throw Object.assign(new Error(state.blockers[0]), { status: 400, errors: [state.blockers[0]] });
    state.data.idFloor = await topId(trx);
    if (listings) state.data.codeFloor = await codeFloor(trx);
    const before = structuredClone(state.data);
    const asked = new Set();
    let refused = null;
    try { await run({ ...state, data: watch(state.data, loaded, asked) }, trx); } catch (err) { refused = err; }
    if (asked.size) {
      loaded = round >= 5 ? new Set(WATCHED) : new Set([...loaded, ...asked]);
      continue;
    }
    if (refused) throw refused;
    for (const k of ['idFloor', 'codeFloor']) { delete state.data[k]; delete before[k]; }
    await saveChanges(trx, before, state.data, { by });
    // Checks on what is saved, and the log: a refusal here rolls the whole save back.
    await finish(state, before, trx);
    return { ...state, read: [...loaded].map(k => (k === 'listings' && listings ? `listings (${state.data.listings.length} of them)` : k)) };
  }
}));

// The time rules (viewings expire or wait for review, co-PH slots end, accounts suspend or lock and
// hand their listings on) and the notification clean-up: what the ERP does by itself, saved if it
// changed anything. Returns whether it ran (not before Setup is done).
async function runTimeRules() {
  await pruneNotices(db, localToday());
  await pruneFiles(db);
  const setup = await loadState(db, { only: [] });
  if (!setup.data) return false;
  await changeState(() => {});
  return true;
}

module.exports = { changeState, runTimeRules, act };

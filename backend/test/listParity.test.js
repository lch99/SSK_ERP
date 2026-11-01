// Every list in shared/lists.js pages the same in the demo (its listPage, on the
// records in the browser) and on the server (SQL from the same description):
// the same rows in the same order, the same total, counts and extras, for a
// search, each filter, each sort and later pages.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, migrate, startApi, tidy } = require('./helpers');
const L = require('../../shared/lists.js');
const { seedDemo } = require('../src/db/demoSeed');
const { localToday } = require('../src/db/days');

let api, state;
before(async () => {
  await migrate();
  await seedDemo({ asOf: localToday() });
  api = await startApi();
  state = (await api.call('GET', '/erp/state')).body;
});
after(async () => { await api.close(); await db.destroy(); });

const get = (r, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), r);
const query = params => new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();

// A few values each filter can take, from the records themselves.
function valuesFor(rule, records) {
  const seen = f => [...new Set(records.map(r => get(r, f)).filter(v => v != null && v !== ''))];
  if (rule.eq) { const vals = seen([].concat(rule.eq)[0]); return [vals[0], vals.slice(0, 2).join(','), 'none'].filter(v => v !== undefined && v !== ''); }
  if (rule.from || rule.to) { const vals = seen(rule.from || rule.to).sort(); return vals.length ? [vals[Math.floor(vals.length / 2)]] : []; }
  if (rule.yes || rule.notNull || rule.custom) return ['true', 'false'];
  if (rule.oneOf) return Object.keys(rule.sets);
  if (rule.team) return state.data.staff.filter(s => state.data.staff.some(x => x.uplineId === s.id)).slice(0, 2).map(s => s.id);
  return [];
}

function cases(key, spec, records) {
  const out = [{}, { size: 7, page: 2 }];
  const first = records.find(r => (spec.search || []).some(f => String(get(r, f) ?? '').length > 3));
  if (first) {
    const word = String(spec.search.map(f => get(first, f)).find(v => String(v ?? '').length > 3)).toLowerCase().split(/\s+/)[0].slice(0, 4);
    out.push({ q: word }, { q: `${word} zzzz` });
  }
  for (const [k, rule] of Object.entries(spec.filters || {})) for (const v of valuesFor(rule, records)) out.push({ [k]: v, size: 200 });
  for (const s of Object.keys(spec.sorts || {})) out.push({ sort: s, size: 9 }, { sort: `-${s}`, size: 9, page: 2 });
  return out;
}

test('every list gives the same page in the demo and on the server', async () => {
  const ctx = { data: state.data, today: localToday(), setup: state.setup };
  let checked = 0;
  for (const [key, spec] of Object.entries(L.LISTS)) {
    const records = L.recordsOf(state.data, key);
    for (const params of cases(key, spec, records)) {
      const want = L.listPage(records, spec, params, ctx);
      const r = await api.call('GET', `/erp/${key}?${query(params)}`);
      const what = `${key}?${query(params)}`;
      assert.equal(r.status, 200, `${what}: ${r.body?.error}`);
      assert.equal(r.body.total, want.total, `${what}: total`);
      assert.deepEqual(r.body.rows.map(x => x.id), want.rows.map(x => x.id), `${what}: rows`);
      assert.deepEqual(r.body.counts, want.counts, `${what}: counts`);
      if (spec.extras) assert.deepEqual(tidy(r.body.rows.map(x => x.$)), tidy(want.rows.map(x => x.$)), `${what}: extras`);
      checked++;
    }
  }
  assert.ok(checked > 200, `only ${checked} cases`);
});

test('ready to close: open E-Forms whose cleared cash can be closed now', async () => {
  const ctx = { data: state.data, today: localToday(), setup: state.setup };
  const want = L.listPage(state.data.deals, L.LISTS.deals, { ready: 'true', size: 200 }, ctx);
  assert.ok(want.total > 0, 'the sample has E-Forms ready to close');
  for (const d of want.rows) assert.ok(L.readyLeft(d, d.$, state.setup) > 0, d.code);
});

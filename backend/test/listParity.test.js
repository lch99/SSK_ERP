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
// A search field's text on a record, through the record it points at for { via, of, fields }.
const searchText = (r, f) => (typeof f === 'string' ? get(r, f)
  : get(L.recordsOf(state.data, f.of).find(x => x.id === get(r, f.via)), f.fields[0]));
const query = params => new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();

// A few values each filter can take, from the records themselves.
function valuesFor(rule, records) {
  const seen = f => [...new Set(records.map(r => get(r, f)).filter(v => v != null && v !== ''))];
  if (rule.eq) { const vals = seen([].concat(rule.eq)[0]); return [vals[0], vals.slice(0, 2).join(','), 'none'].filter(v => v !== undefined && v !== ''); }
  if (rule.from || rule.to) { const vals = seen(rule.from || rule.to).sort(); return vals.length ? [vals[Math.floor(vals.length / 2)]] : []; }
  if (rule.custom) return rule.values || ['true', 'false'];
  if (rule.yes || rule.notNull) return ['true', 'false'];
  // The same text in another case still matches.
  if (rule.is) { const vals = seen(rule.is).map(String); return vals.length ? [vals[0], vals[0].toUpperCase()] : []; }
  if (rule.via) return valuesFor(rule.rule, L.recordsOf(state.data, rule.of));
  if (rule.oneOf) return Object.keys(rule.sets);
  // A leader or two, and something that is not a person's id (nobody).
  if (rule.team) return [...state.data.staff.filter(s => state.data.staff.some(x => x.uplineId === s.id)).slice(0, 2).map(s => s.id), 'abc'];
  return [];
}

function cases(key, spec, records) {
  // counts=0: a later page, without the counts; counts=a,b: only those.
  const out = [{}, { size: 7, page: 2 }, { size: 7, page: 2, counts: '0' }];
  const asked = Object.keys(spec.counts || {}).slice(-2);
  if (asked.length) out.push({ counts: asked.join(',') });
  // A word from each search field (own or through another record).
  for (const f of spec.search || []) {
    const first = records.find(r => String(searchText(r, f) ?? '').length > 3);
    if (!first) continue;
    const word = String(searchText(first, f)).toLowerCase().split(/\s+/)[0].slice(0, 4);
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

test('one record carries the same extras as its row in the list', async () => {
  const ctx = { data: state.data, today: localToday(), setup: state.setup };
  for (const [key, spec] of Object.entries(L.LISTS)) {
    if (!spec.extras) continue;
    const records = L.recordsOf(state.data, key);
    for (const rec of records.slice(0, 3)) {
      const want = L.listPage([rec], spec, { counts: '0' }, ctx).rows[0];
      const r = await api.call('GET', `/erp/${key}/${rec.id}`);
      assert.equal(r.status, 200, `${key}/${rec.id}`);
      assert.deepEqual(tidy(r.body.$), tidy(want.$), `${key}/${rec.id}: extras`);
    }
  }
});

test('an Excel download has the rows the demo would write, for the same filters', async () => {
  const { readXlsx } = await import('../../src/setup/sheet.js');
  const ctx = { data: state.data, today: localToday(), setup: state.setup };
  const cell = v => (v === '' || v == null ? '' : String(v));
  let checked = 0;
  for (const [key, spec] of Object.entries(L.LISTS)) {
    if (!spec.download) continue;
    const records = L.recordsOf(state.data, key);
    const status = records[0]?.status;
    for (const params of [{}, { sort: 'amount' }, ...(status ? [{ status }] : [])]) {
      const want = L.downloadRows(spec, L.listAll(records, spec, params, ctx).rows).map(row => row.map(cell));
      const r = await api.raw('GET', `/erp/${key}/download?${query(params)}`);
      assert.equal(r.status, 200, `${key}/download?${query(params)}`);
      assert.match(r.headers.get('content-disposition'), new RegExp(`${spec.download.file}-\\d{4}-\\d{2}-\\d{2}\\.xlsx`));
      // Empty cells at the end of a row aren't written, so compare without them.
      const trim = row => { const x = [...row]; while (x.length && x[x.length - 1] === '') x.pop(); return x; };
      const got = await readXlsx(new Uint8Array(await r.arrayBuffer()));
      assert.deepEqual(got.map(trim), want.map(trim), `${key}/download?${query(params)}`);
      checked++;
    }
  }
  assert.ok(checked >= 3);
  // A list with no download, and a viewer's reach, are the server's to keep.
  assert.equal((await api.raw('GET', '/erp/archives/download')).status, 404);
});

test('ready to close: open E-Forms whose cleared cash can be closed now', async () => {
  // The sample is made up afresh for each day, and some days have none: then the rest of one open bill clears.
  const ready = data => L.listPage(data.deals, L.LISTS.deals, { ready: 'true', size: 200 }, { data, today: localToday(), setup: state.setup });
  let data = state.data;
  if (!ready(data).total) {
    const open = L.listPage(data.deals, L.LISTS.deals, { status: 'submitted', size: 200 }, { data, today: localToday(), setup: state.setup }).rows
      .find(d => d.$.closed === 0);
    const id = Math.max(...data.moneyIn.map(t => t.id)) + 1;
    await db('money_in').insert({ id, code: `TRAN#${id}`, deal_id: open.id, date: localToday(), bank_on: localToday(), clears_on: localToday(),
      amount: Math.round((open.money.billed - open.$.cleared) * 100) / 100 + 1, method: 'online', purpose: 'commission', status: 'cleared' });
    data = (await api.call('GET', '/erp/state')).body.data;
  }
  const want = ready(data);
  assert.ok(want.total > 0, 'an E-Form is ready to close');
  for (const d of want.rows) assert.ok(L.readyLeft(d, d.$, state.setup) > 0, d.code);
  const got = await api.call('GET', '/erp/deals?ready=true&size=200');
  assert.deepEqual(got.body.rows.map(x => x.id), want.rows.map(x => x.id));
});

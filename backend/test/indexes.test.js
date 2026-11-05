// Every column a list finds its rows by starts an index, so no list reads a
// whole table to answer a filter (the current ERP's slow reports did: one index
// per table, starting with the row's own id). A new filter or default sort on a
// column with no index fails here until a migration adds one, or the column is
// named below with the reason it needs none.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, migrate } = require('./helpers');
const { LISTS, columnsRead } = require('../src/db/lists');

// Tables that stay small (hundreds or a few thousand rows): read whole, they are still quick.
const SMALL = {
  areas: 'about a thousand areas', titles: 'about ten thousand buildings', projects: 'developer launches, a few hundred',
  staff: 'a few thousand people', v1_eforms: 'the first system\'s E-Forms, never added to', v1_overrides: 'yearly totals of the first system, never added to',
};
// Columns with a handful of values: an index of their own would narrow nothing, and
// the list narrows by its indexed filters first (person, E-Form, status, dates).
const FEW_VALUES = {
  'money_in.method': 'cash, cheque or online', 'money_in.purpose': 'four purposes', 'payout_lines.side': 'sales or listing',
  'payout_lines.role': 'a dozen payout roles', 'customers.type': 'sale or rent', 'notices.cat': 'five kinds, read with the person\'s own (to_whom)',
};

let starts;
before(async () => {
  await migrate();
  const [rows] = await db.raw('select table_name as t, column_name as c from information_schema.statistics where table_schema = database() and seq_in_index = 1');
  starts = new Set(rows.map(r => `${r.t ?? r.TABLE_NAME}.${r.c ?? r.COLUMN_NAME}`));
});
after(() => db.destroy());

test('every column a list filters by, or sorts by by default, starts an index', () => {
  const missing = Object.keys(LISTS).flatMap(k => columnsRead(k)
    .filter(c => !starts.has(c) && !SMALL[c.split('.')[0]] && !FEW_VALUES[c])
    .map(c => `${c} (list ${k})`));
  assert.deepEqual(missing, []);
});

test('the reasons above still name real columns', () => {
  const read = new Set(Object.keys(LISTS).flatMap(k => columnsRead(k)));
  for (const c of Object.keys(FEW_VALUES)) assert.ok(read.has(c), `${c} is no longer read by any list: take it out of FEW_VALUES`);
});

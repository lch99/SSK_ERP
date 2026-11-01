// The inspect report on a made-up copy of the current ERP: it shows codes,
// ranges and broken links, and never anyone's personal details.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');
const { inspect } = require('../src/legacy/inspect');

const db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
let report;

before(async () => {
  await db.schema.createTable('staff', t => {
    t.increments('id'); t.string('user_name'); t.string('ic_name'); t.string('ic_no'); t.string('phone_number1'); t.string('type');
    t.integer('status'); t.integer('staff_id'); t.string('bank_account'); t.integer('frontend_access'); t.date('birthday'); t.bigInteger('hp');
  });
  // A real table name with only some of the columns the import reads.
  await db.schema.createTable('db_trans', t => { t.increments('tran_id'); t.integer('form_id'); t.decimal('tran_amount', 14, 2); });
  await db.schema.createTable('eform', t => {
    t.increments('id'); t.string('form_code'); t.integer('form_status'); t.date('form_date'); t.integer('staff_id');
    t.string('tenant_name'); t.decimal('rent_price', 14, 2); t.text('remark');
  });
  const people = Array.from({ length: 30 }, (_, i) => ({
    user_name: `user${i}`, ic_name: `Secret Person ${i}`, ic_no: `800101-14-${1000 + i}`, phone_number1: `012-555 ${1000 + i}`,
    type: i % 5 ? 'staff' : 'admin-staff', status: i % 7 ? 1 : 0, staff_id: i ? 1 : null, bank_account: `5140${i}`, frontend_access: i % 2,
    birthday: `1985-03-${String(1 + i).padStart(2, '0')}`, hp: 60123450000 + i,
  }));
  await db('staff').insert(people);
  await db('eform').insert(Array.from({ length: 40 }, (_, i) => ({
    form_code: `2026-01-SALE-${String(i).padStart(5, '0')}`, form_status: i % 5, form_date: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`,
    staff_id: i === 39 ? 999 : 1 + (i % 30), tenant_name: `Hidden Buyer ${i}`, rent_price: 1000 + i, remark: 'call the buyer at home',
  })));
  report = await inspect(db, { when: '2026-10-28' });
});
after(() => db.destroy());

test('codes are shown with their counts', () => {
  assert.match(report, /`form_status` \| integer.*`0` ×8/);
  assert.match(report, /`type` .*`staff` ×24 · `admin-staff` ×6/);
  assert.match(report, /`frontend_access` .*`0` ×15/);
});

test('dates and numbers show their range', () => {
  assert.match(report, /`form_date` .*2026-01-01 → 2026-01-28/);
  assert.match(report, /`rent_price` .*1000 → 1039/);
});

test('an _id column says where it points and how many values are missing', () => {
  assert.match(report, /eform[\s\S]*`staff_id` .*→ `staff.id`, 1 value\(s\) not found/);
});

test('no personal details or free text in the report', () => {
  for (const secret of ['Secret Person', '800101-14', '012-555', 'Hidden Buyer', '5140', 'call the buyer', 'user1', '1985-03', '6012345']) {
    assert.ok(!report.includes(secret), secret);
  }
  assert.match(report, /`ic_name` .*personal or free text: not shown/);
});

test('the tables and columns the import reads are checked', () => {
  assert.match(report, /\| `db_trans` \| 0 rows \| `tran_date`, `tran_add_date`, `tran_bank_date`, `tran_method`, `tran_purpose`/);
  assert.match(report, /\| `db_eforms` \| \*\*not found\*\*/);
});

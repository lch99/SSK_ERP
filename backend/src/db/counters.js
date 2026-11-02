// The next number for each kind of code (STAFF-NNNNN, LIST-NNNNNN, an E-Form
// number per branch and type…). Taken inside the transaction that uses it,
// with the row locked on MySQL, so two people saving at once never get the
// same number and a rolled-back save gives its number back.

// SELECT … FOR UPDATE: the row stays locked until the saving transaction ends.
const forUpdate = (q, query) => query.forUpdate();

// Reserves `n` numbers for `key` and returns the first. `atLeast`: numbers
// already used outside the counter (imported records), so it starts above them.
async function take(trx, key, { n = 1, atLeast = 0 } = {}) {
  await trx('counters').insert({ key, value: 0 }).onConflict('key').ignore();
  const row = await forUpdate(trx, trx('counters').where({ key })).first();
  const first = Math.max(Number(row.value), Number(atLeast) || 0) + 1;
  await trx('counters').where({ key }).update({ value: first + n - 1 });
  return first;
}

// The highest number in `column` codes that start with `prefix` (e.g. 'STAFF-').
async function highestCode(q, table, column, prefix) {
  const row = await q(table).where(column, 'like', `${prefix}%`).max({ code: column }).first();
  return Number(String(row?.code || '').slice(prefix.length)) || 0;
}

module.exports = { take, highestCode, forUpdate };

// Indexes for the columns the lists filter or sort by on tables that grow every
// year (test/indexes.test.js names them from shared/lists.js). The current ERP
// had one index per table that started with the row's own id, so every "this
// agent's…" or "this E-Form's…" question read the whole table; here each column
// a list looks rows up by starts an index of its own.

const INDEXES = {
  deals: ['price', 'property_title'],
  listings: ['beds', 'category', 'photo_count', 'price_before', 'updated_on'],
  money_in: ['amount', 'clears_on', 'ref'],
  pay_requests: ['paid_on'],
  closes: ['sst'],
  customers: ['source'],
};

// An index that starts with the column (up), or the one this file made, by knex's name for it (down).
const found = async (knex, table, column, name) => {
  const [rows] = await knex.raw(
    `select 1 from information_schema.statistics where table_schema = database() and table_name = ? and ${name ? 'index_name = ?' : 'column_name = ? and seq_in_index = 1'} limit 1`,
    [table, name ? `${table}_${column}_index` : column]);
  return rows.length > 0;
};

exports.up = async knex => {
  for (const [table, columns] of Object.entries(INDEXES)) {
    const missing = [];
    for (const c of columns) if (!(await found(knex, table, c))) missing.push(c);
    if (missing.length) await knex.schema.alterTable(table, t => { for (const c of missing) t.index(c); });
  }
};

exports.down = async knex => {
  for (const [table, columns] of Object.entries(INDEXES)) {
    const made = [];
    for (const c of columns) if (await found(knex, table, c, true)) made.push(c);
    if (made.length) await knex.schema.alterTable(table, t => { for (const c of made) t.dropIndex(c); });
  }
};

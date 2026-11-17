// Adding a listing looks up the listings already in that building by its name (the duplicate check,
// db/actionScope.js): on the real data, 120,000 listings read one by one for every new one. An index on
// the building name makes that one lookup.

const found = async knex => {
  const [rows] = await knex.raw("select 1 from information_schema.statistics where table_schema = database() and table_name = 'listings' and column_name = 'title' and seq_in_index = 1 limit 1");
  return rows.length > 0;
};

exports.up = async knex => {
  if (!(await knex.schema.hasTable('listings')) || await found(knex)) return;
  await knex.schema.alterTable('listings', t => { t.index('title'); });
};

exports.down = async knex => {
  const [rows] = await knex.raw("select 1 from information_schema.statistics where table_schema = database() and table_name = 'listings' and index_name = 'listings_title_index' limit 1");
  if (rows.length) await knex.schema.alterTable('listings', t => { t.dropIndex('title'); });
};

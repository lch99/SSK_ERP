// Reports → Landlord checks filters E-Forms by the archive their check belongs to
// (test/indexes.test.js: every column a list filters by starts an index).

const indexed = async knex => {
  const [rows] = await knex.raw("select 1 from information_schema.statistics where table_schema = database() and table_name = 'deals' and column_name = 'lv_archive_id' and seq_in_index = 1 limit 1");
  return rows.length > 0;
};
const made = async knex => {
  const [rows] = await knex.raw("select 1 from information_schema.statistics where table_schema = database() and table_name = 'deals' and index_name = 'deals_lv_archive_id_index' limit 1");
  return rows.length > 0;
};

exports.up = async knex => {
  if (!(await indexed(knex))) await knex.schema.alterTable('deals', t => { t.index('lv_archive_id'); });
};

exports.down = async knex => {
  if (await made(knex)) await knex.schema.alterTable('deals', t => { t.dropIndex('lv_archive_id'); });
};

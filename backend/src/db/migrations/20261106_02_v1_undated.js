// First-system (V1) E-Forms may have no date: 321 in the current ERP are dated
// 0000-00-00 (Mujur Harta codes like MJR/2203…, no date in them either). They are
// old records like the rest, so Old records lists them without a date.

const dateNullable = async knex => {
  const [rows] = await knex.raw("select is_nullable as n from information_schema.columns where table_schema = database() and table_name = 'v1_eforms' and column_name = 'date'");
  return (rows[0]?.n ?? rows[0]?.IS_NULLABLE) === 'YES';
};

exports.up = async knex => {
  if ((await knex.schema.hasTable('v1_eforms')) && !(await dateNullable(knex))) {
    await knex.schema.alterTable('v1_eforms', t => { t.date('date').nullable().alter(); });
  }
};

exports.down = async knex => {
  if ((await knex.schema.hasTable('v1_eforms')) && (await dateNullable(knex))) {
    await knex('v1_eforms').whereNull('date').del();
    await knex.schema.alterTable('v1_eforms', t => { t.date('date').notNullable().alter(); });
  }
};

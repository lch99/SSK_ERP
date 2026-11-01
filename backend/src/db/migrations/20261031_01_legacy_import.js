// The current ERP's records, as they were on the day they were imported
// (npm run legacy:import). Every row of every table in the copy is kept here
// once, as it was (passwords and sign-in tokens left out), with the record it
// became in the new tables, or why it did not become one. So nothing is lost
// when the old database is switched off, a mapping mistake found later can be
// put right from here, and a record can always be traced back to the old one.
//   source_table, source_id — the old table and the row's key ("a:b" for two-column keys)
//   target_table, target_id — the new record it became (blank: kept here only)
//   note                    — why it is kept here only, or what was changed on the way in
//   data                    — the old row, column by column

exports.up = async knex => {
  if (!(await knex.schema.hasTable('legacy_rows'))) {
    await knex.schema.createTable('legacy_rows', t => {
      t.string('source_table', 64).notNullable();
      t.string('source_id', 64).notNullable();
      t.string('target_table', 40).nullable();
      t.string('target_id', 40).nullable();
      t.string('note', 200).nullable();
      t.json('data').notNullable();
      t.primary(['source_table', 'source_id']);
      t.index(['target_table', 'target_id']);
    });
  }
};

exports.down = async knex => {
  await knex.schema.dropTableIfExists('legacy_rows');
};

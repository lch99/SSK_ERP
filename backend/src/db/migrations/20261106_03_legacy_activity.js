// The current ERP's data log (z_form_data_capture): every form anyone sent, who
// and when, with what they typed (passwords removed by the import). Kept for
// good, read only, in a table of its own (not legacy_rows, which goes after the
// switch-over), found by person and date. The user's call, 2026-11-06: keep the
// data log, not the search logs.
//   staff_id, at — who sent it and when
//   form         — the form's name in the old ERP (save_property_new, listing_followup…)
//   record_id    — the record it was about (the old data_id), when it says
//   data, route  — the form's fields and the page it came from, as the old ERP kept them

exports.up = async knex => {
  if (!(await knex.schema.hasTable('legacy_activity'))) {
    await knex.schema.createTable('legacy_activity', t => {
      t.integer('id').unsigned().primary();                    // the old row's id
      t.datetime('at').nullable();
      t.integer('staff_id').unsigned().nullable();
      t.integer('admin_id').unsigned().nullable();
      t.string('form', 60).notNullable().defaultTo('');
      t.integer('record_id').unsigned().nullable();
      t.string('route', 100).nullable();
      t.text('data', 'mediumtext').nullable();
      t.index(['staff_id', 'at']);
      t.index('at');
      t.index('form');
    });
  }
};

exports.down = async knex => {
  await knex.schema.dropTableIfExists('legacy_activity');
};

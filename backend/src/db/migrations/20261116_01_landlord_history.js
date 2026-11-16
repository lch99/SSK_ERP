// A landlord check can be tried again (after "Unable to verify"), as the current ERP's
// Archived Case Landlord report allows; each earlier try is kept, newest last, in
// lv_history ({ status, on, remarks, by }), with the latest still in lv_status / lv_on / lv_remarks.

exports.up = async knex => {
  if (!(await knex.schema.hasTable('deals')) || await knex.schema.hasColumn('deals', 'lv_history')) return;
  await knex.schema.alterTable('deals', t => { t.json('lv_history').nullable(); });
};

exports.down = async knex => {
  if (!(await knex.schema.hasTable('deals')) || !(await knex.schema.hasColumn('deals', 'lv_history'))) return;
  await knex.schema.alterTable('deals', t => { t.dropColumn('lv_history'); });
};

// Setup is now one checked document (settings key 'setup'), saved through
// shared/setupState.js like the browser demo: tier plans with their totals,
// upline chain and split, rules by date, approvals, numbering, bank accounts.
// Branches stay a table (records point at them) and imported agents become
// staff rows. The old per-tier tables are no longer read.

exports.up = async knex => {
  await knex.schema.dropTableIfExists('payout_totals');
  await knex.schema.dropTableIfExists('tiers');
};

// Puts the old tables back, empty (the setup document keeps the tiers).
exports.down = async knex => {
  if (!(await knex.schema.hasTable('tiers'))) {
    await knex.schema.createTable('tiers', t => {
      t.increments('id');
      t.string('name', 50).notNullable();
      t.string('title', 60).notNullable().defaultTo('');
      t.enu('basis', ['lifetime', 'yearly']).notNullable();
      t.decimal('threshold', 14, 2).notNullable();
      t.decimal('agent_rate', 5, 2).notNullable();
      t.integer('sort_order').notNullable();
    });
  }
  if (!(await knex.schema.hasTable('payout_totals'))) {
    await knex.schema.createTable('payout_totals', t => {
      t.integer('branch_id').unsigned().notNullable();
      t.enu('deal_type', ['sale', 'rental', 'project']).notNullable();
      t.integer('tier_id').unsigned().notNullable().references('id').inTable('tiers').onDelete('CASCADE');
      t.decimal('total_pct', 5, 2).notNullable();
      t.primary(['branch_id', 'deal_type', 'tier_id']);
    });
  }
};

// Everything the Setup page configures before go-live.
//   settings       — one JSON value per key: company, dealTypes, numbering, uplines
//   branches       — offices; `code` goes into case and voucher numbers
//   tiers          — the agent ladder (rates are % of the commission)
//   payout_totals  — total payout per deal type + tier. branch_id 0 is the
//                    company default; any other branch_id overrides it.

exports.up = async knex => {
  if (!(await knex.schema.hasTable('settings'))) {
    await knex.schema.createTable('settings', t => {
      t.string('key', 64).primary();
      t.json('value').notNullable();
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }
  if (!(await knex.schema.hasTable('branches'))) {
    await knex.schema.createTable('branches', t => {
      t.increments('id');
      t.string('name', 100).notNullable();
      t.string('code', 4).notNullable();
      t.integer('sort_order').notNullable().defaultTo(0);
    });
  }
  if (!(await knex.schema.hasTable('tiers'))) {
    await knex.schema.createTable('tiers', t => {
      t.increments('id');
      t.string('name', 50).notNullable();
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
      t.integer('tier_id').unsigned().notNullable()
        .references('id').inTable('tiers').onDelete('CASCADE');
      t.decimal('total_pct', 5, 2).notNullable();
      t.primary(['branch_id', 'deal_type', 'tier_id']);
    });
  }
};

exports.down = async knex => {
  await knex.schema.dropTableIfExists('payout_totals');
  await knex.schema.dropTableIfExists('tiers');
  await knex.schema.dropTableIfExists('branches');
  await knex.schema.dropTableIfExists('settings');
};

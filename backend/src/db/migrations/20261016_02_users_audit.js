// Login accounts and the audit log.
//   users      — branch_id is null for roles that see every branch
//   audit_log  — who changed what; detail holds before/after as JSON

exports.up = async knex => {
  if (!(await knex.schema.hasTable('users'))) {
    await knex.schema.createTable('users', t => {
      t.increments('id');
      t.string('username', 32).notNullable().unique();
      t.string('name', 100).notNullable();
      t.string('password_hash', 100).notNullable();
      t.string('role', 20).notNullable();
      t.integer('branch_id').unsigned().nullable().references('id').inTable('branches').onDelete('RESTRICT');
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('login_attempts').notNullable().defaultTo(0);
      t.boolean('locked').notNullable().defaultTo(false);
      // Bumped on password change / deactivation so older tokens stop working.
      t.integer('token_version').notNullable().defaultTo(0);
      t.timestamp('last_login_at').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
  }
  if (!(await knex.schema.hasTable('audit_log'))) {
    await knex.schema.createTable('audit_log', t => {
      t.increments('id');
      t.integer('user_id').unsigned().nullable();
      t.string('username', 32).nullable();
      t.string('action', 40).notNullable();
      t.string('entity', 40).notNullable();
      t.string('entity_id', 40).nullable();
      t.json('detail').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['entity', 'entity_id']);
      t.index('created_at');
    });
  }
};

exports.down = async knex => {
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.dropTableIfExists('users');
};

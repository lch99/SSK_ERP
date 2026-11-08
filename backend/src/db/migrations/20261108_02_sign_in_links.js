// Agents' own sign-in (the user's call, 2026-11-08): every person on the staff
// list can have an account with their username, made before they have a
// password; they set it from a one-time link the office sends them (or, after
// "Forgot password", a new one). Only a hash of each link's secret is kept.

exports.up = async knex => {
  const [rows] = await knex.raw("select is_nullable n from information_schema.columns where table_schema = database() and table_name = 'users' and column_name = 'password_hash'");
  if (rows[0]?.n === 'NO') await knex.schema.alterTable('users', t => { t.string('password_hash', 100).nullable().alter(); });
  if (!(await knex.schema.hasTable('password_links'))) {
    await knex.schema.createTable('password_links', t => {
      t.increments('id');
      t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('token_hash', 64).notNullable().unique();
      t.string('purpose', 10).notNullable();                 // set (first time) · reset (forgot)
      t.datetime('expires_at').notNullable();
      t.datetime('used_at').nullable();
      t.integer('created_by').unsigned().nullable();          // users.id of who made it; null: asked for by the person
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index('user_id');
      t.index('expires_at');
    });
  }
};

exports.down = async knex => {
  await knex.schema.dropTableIfExists('password_links');
};

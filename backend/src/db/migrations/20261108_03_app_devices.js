// The phone app's devices (appV1/: POST /v1/user/device): each signed-in phone's
// push-notification token, one row per account (a new phone replaces the old
// one, as the old API did), so notices can reach phones once push is set up.
// A token moving to another account leaves the first one (a shared phone).

exports.up = async knex => {
  if (!(await knex.schema.hasTable('app_devices'))) {
    await knex.schema.createTable('app_devices', t => {
      t.increments('id');
      t.integer('user_id').unsigned().notNullable().unique().references('id').inTable('users').onDelete('CASCADE');
      t.string('platform', 20).notNullable();                 // android · ios
      t.string('fcm_token', 255).notNullable().unique();
      t.string('app_version', 20).nullable();                 // the app's client-app-version header
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }
};

exports.down = async knex => {
  await knex.schema.dropTableIfExists('app_devices');
};

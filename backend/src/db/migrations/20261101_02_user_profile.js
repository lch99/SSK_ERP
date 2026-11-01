// "My profile" (shared/profile.js): each sign-in account's own details, kept
// with the account. The name is also `users.name`; the photo is a small JPG or
// PNG cut to a square by the page (until uploads go to object storage).

exports.up = async knex => {
  if (!(await knex.schema.hasColumn('users', 'profile'))) {
    await knex.schema.alterTable('users', t => {
      t.json('profile').nullable();
      t.timestamp('profile_saved_at').nullable();
      t.timestamp('password_changed_at').nullable();
    });
  }
};

exports.down = async knex => {
  if (await knex.schema.hasColumn('users', 'profile')) {
    await knex.schema.alterTable('users', t => { t.dropColumn('profile'); t.dropColumn('profile_saved_at'); t.dropColumn('password_changed_at'); });
  }
};

// What the website (www.subsaleking.com) keeps once it reads the new system instead of the old database:
//   saved_listings — a staff member's "My Saved Listings" (the old db_user_saved_property; the listings
//                    an agent keeps for their Agent Profile document), one row per person and listing.
//   listing_daily  — how often a listing was opened or tapped in a list, on the website and in the phone
//                    app, as one row per listing and day (never a row per look: the server rule). Kept two
//                    years (db/listingDaily.js prunes).

exports.up = async knex => {
  if (!(await knex.schema.hasTable('saved_listings'))) {
    await knex.schema.createTable('saved_listings', t => {
      t.integer('staff_id').unsigned().notNullable().references('id').inTable('staff').onDelete('CASCADE');
      t.integer('listing_id').unsigned().notNullable().references('id').inTable('listings').onDelete('CASCADE');
      t.datetime('saved_at').notNullable().defaultTo(knex.fn.now());
      t.primary(['staff_id', 'listing_id']);
      t.index('listing_id');
    });
  }
  if (!(await knex.schema.hasTable('listing_daily'))) {
    await knex.schema.createTable('listing_daily', t => {
      t.integer('listing_id').unsigned().notNullable().references('id').inTable('listings').onDelete('CASCADE');
      t.date('day').notNullable();
      t.integer('views_web').unsigned().notNullable().defaultTo(0);
      t.integer('clicks_web').unsigned().notNullable().defaultTo(0);
      t.integer('views_app').unsigned().notNullable().defaultTo(0);
      t.integer('clicks_app').unsigned().notNullable().defaultTo(0);
      t.primary(['listing_id', 'day']);
      t.index('day');
    });
  }
};

exports.down = async knex => {
  await knex.schema.dropTableIfExists('listing_daily');
  await knex.schema.dropTableIfExists('saved_listings');
};

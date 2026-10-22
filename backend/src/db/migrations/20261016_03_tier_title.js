// The name a company gives each tier (e.g. "Senior Negotiator"); tiers.name stays the short code.
exports.up = async knex => {
  if (!(await knex.schema.hasColumn('tiers', 'title'))) {
    await knex.schema.alterTable('tiers', t => { t.string('title', 60).notNullable().defaultTo(''); });
  }
};

exports.down = async knex => {
  if (await knex.schema.hasColumn('tiers', 'title')) {
    await knex.schema.alterTable('tiers', t => { t.dropColumn('title'); });
  }
};

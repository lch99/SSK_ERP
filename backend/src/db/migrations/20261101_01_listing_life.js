// The listing life records the demo keeps (src/demo/erpApi.js, shared/listings.js)
// and planned downtime (shared/maintenance.js):
//   viewings    — appointments to view a listing (VIEW-NNNNN): book → confirm /
//                 reschedule / cancel → review
//   notices     — notifications: to one person (staff id, 0 = the office), a
//                 branch ('branch:<id>') or 'all'; read_by lists who has read it
//   favourites  — each person's starred listings and buildings
//   downtime    — planned maintenance windows
// The last manual checks (`runs`) are one small settings document ('erp:runs').

const TABLES = {
  viewings: (t, knex) => {
    t.increments('id');
    t.string('code', 20).notNullable().unique();
    t.integer('listing_id').unsigned().nullable();             // the first listing viewed (no FK: a deleted listing takes its viewings with it)
    t.json('listing_ids').nullable();
    t.integer('requested_by').unsigned().nullable();
    t.integer('handler_id').unsigned().nullable();
    t.integer('customer_id').unsigned().nullable();
    t.string('customer_name', 150).notNullable().defaultTo('');
    t.string('customer_phone', 30).notNullable().defaultTo('');
    t.date('date').nullable();
    t.string('time', 5).nullable();
    t.string('ends', 5).nullable();
    t.string('status', 12).notNullable().defaultTo('new');      // new · rescheduled · confirmed · cancelled · expired · review · done
    t.datetime('created_at').nullable();
    t.json('remarks').nullable();
    t.json('review').nullable();
    t.timestamp('saved_at').notNullable().defaultTo(knex.fn.now());
    for (const c of ['listing_id', 'requested_by', 'handler_id', 'date', 'status']) t.index(c);
  },

  notices: t => {
    t.increments('id');
    t.string('to_whom', 20).notNullable();
    t.datetime('at').notNullable();
    t.string('cat', 12).notNullable().defaultTo('notice');
    t.text('text').notNullable();
    t.string('link', 200).nullable();
    t.json('read_by').nullable();
    t.index('to_whom');
    t.index('at');
  },

  favourites: t => {
    t.integer('viewer_id').unsigned().primary();               // a staff id, 0 = the office
    t.json('listings').nullable();
    t.json('titles').nullable();
  },

  downtime: t => {
    t.increments('id');
    t.datetime('starts_at').notNullable();
    t.datetime('ends_at').notNullable();
    t.text('message').nullable();
    t.boolean('closes').notNullable().defaultTo(true);
    t.integer('by_id').unsigned().nullable();
    t.datetime('created_at').nullable();
    t.boolean('cancelled').notNullable().defaultTo(false);
    t.datetime('ended_at').nullable();
    t.index('starts_at');
  },
};

const NO_MORE = new Set(['favourites']);

exports.up = async knex => {
  for (const [name, build] of Object.entries(TABLES)) {
    if (!(await knex.schema.hasTable(name))) {
      await knex.schema.createTable(name, t => {
        build(t, knex);
        if (!NO_MORE.has(name)) t.json('more').nullable();
      });
    }
  }
};

exports.down = async knex => {
  for (const name of Object.keys(TABLES).reverse()) await knex.schema.dropTableIfExists(name);
};

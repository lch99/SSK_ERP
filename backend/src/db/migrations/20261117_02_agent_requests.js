// Co-Agent requests: agents who asked through the website ("SubSaleKing Co-Agent", /advertise/agent) to partner
// with us: name, e-mail, phone and whether they are registered with BOVAEA. The office follows them up on
// Agents › Co-Agent requests. The current site keeps them outside the old ERP's database, so none come across.

exports.up = async knex => {
  if (await knex.schema.hasTable('agent_requests')) return;
  await knex.schema.createTable('agent_requests', t => {
    t.increments('id');
    t.string('ticket', 12).notNullable().unique();
    t.date('date').notNullable();
    t.string('name', 150).notNullable().defaultTo('');
    t.string('phone', 30).notNullable().defaultTo('');
    t.string('email', 120).nullable();
    t.boolean('registered').notNullable().defaultTo(false);
    t.tinyint('status').notNullable().defaultTo(0);
    t.integer('handled_by').unsigned().nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.json('more').nullable();
    for (const c of ['status', 'date']) t.index(c);
  });
};

exports.down = knex => knex.schema.dropTableIfExists('agent_requests');

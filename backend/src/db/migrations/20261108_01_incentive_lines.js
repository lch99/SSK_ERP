// Developer incentives paid out (shared/projects.js incentivePayout) are payout
// lines that come from no closed case and belong to no side, with no rate: they
// are the agent's share of what the developer paid. So a line's case, side and
// rate may be empty (every line made by closing a case still has them).

const COLS = ['close_id', 'side', 'pct'];
const nullable = async knex => {
  const [rows] = await knex.raw(
    "select column_name as c, is_nullable as n from information_schema.columns where table_schema = database() and table_name = 'payout_lines' and column_name in ('close_id', 'side', 'pct')");
  return Object.fromEntries(rows.map(r => [r.c, r.n === 'YES']));
};

exports.up = async knex => {
  if (!(await knex.schema.hasTable('payout_lines'))) return;
  const now = await nullable(knex);
  if (COLS.every(c => now[c])) return;
  await knex.schema.alterTable('payout_lines', t => {
    t.integer('close_id').unsigned().nullable().alter();
    t.string('side', 10).nullable().alter();
    t.decimal('pct', 6, 2).nullable().alter();
  });
};

exports.down = async knex => {
  if (!(await knex.schema.hasTable('payout_lines'))) return;
  // Only possible while no line lacks them.
  await knex.schema.alterTable('payout_lines', t => {
    t.integer('close_id').unsigned().notNullable().alter();
    t.string('side', 10).notNullable().alter();
    t.decimal('pct', 6, 2).notNullable().alter();
  });
};

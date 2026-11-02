// The server's side of every list in shared/lists.js: its table, whose records
// each reach sees (the same rules as visibleData() in shared/access.js; team =
// own + downline), the SQL for the custom filters, and each field's column
// (from records.js). The searches, filters, sorts, counts and extras themselves
// come from shared/lists.js, so the demo and the server page the same way.
const SHARED = require('../../../shared/lists.js');
const { loadSetup } = require('./setupStore');
const { MODELS, parseJson } = require('./records');
const { teamIds } = require('./list');

// Records reached through their E-Form (payments, closes, request forms).
const viaDeal = (b, v, col = 'deal_id') => b.whereIn(col, sub => {
  sub.select('id').from('deals');
  if (v.scope === 'branch') sub.where('branch_id', v.branchId);
  else sub.where(x => x.whereIn('agent_id', v.team).orWhereIn('holder_id', v.team));
});
const viaListing = (b, v, col = 'listing_id') => b.whereIn(col, sub => {
  sub.select('id').from('listings');
  if (v.scope === 'branch') sub.where('branch_id', v.branchId);
  else sub.where(x => x.whereIn('holder_id', v.team).orWhereIn('creator_id', v.team));
});
// The people a viewer answers for: their team, or everyone in their branch.
const mine = (b, v, col) => (v.scope === 'branch'
  ? b.whereIn(col, sub => sub.select('id').from('staff').where('branch_id', v.branchId))
  : b.whereIn(col, v.team));
const inBranch = (b, v, col = 'branch_id') => b.where(col, v.branchId);
const either = (cols) => (b, v) => b.where(x => cols.forEach((c, i) => (i ? x.orWhereIn(c, v.team) : x.whereIn(c, v.team))));
const byStaff = { branch: (b, v) => mine(b, v, 'staff_id'), team: (b, v) => mine(b, v, 'staff_id') };

// Cash on an E-Form, in SQL: what cleared, and what is closed already.
const CLEARED = "(select coalesce(sum(m.amount), 0) from money_in m where m.deal_id = deals.id and m.status = 'cleared')";
const CLOSED = '(select coalesce(sum(c.claim), 0) from closes c where c.deal_id = deals.id)';
const GOT = `(case when ${CLEARED} < deals.billed then ${CLEARED} else deals.billed end)`;

const STAFF_SCOPE = { branch: (b, v) => inBranch(b, v, 'staff.branch_id'), team: (b, v) => b.whereIn('staff.id', v.team) };

const SERVER = {
  staff: { table: 'staff', scope: STAFF_SCOPE },
  payees: {
    table: 'staff', scope: STAFF_SCOPE,
    custom: {
      // shared/lists.js readyPay: has a Ready line not requested, archived or stacked, of that kind (incentives have an upline level).
      readyPay: {
        apply: (b, v) => {
          if (v !== 'salary' && v !== 'incentives') return b.whereRaw('1 = 0');
          return b.whereIn('staff.id', sub => sub.select('p.staff_id').from('payout_lines as p').where('p.status', 'approved')
            .whereNull('p.request_id').whereNull('p.archive_id').where(x => x.whereNull('p.stacked').orWhere('p.stacked', 0))
            .where(x => (v === 'incentives' ? x.whereNotNull('p.role') : x.whereNull('p.role'))));
        },
      },
    },
  },
  listings: { table: 'listings', scope: { branch: inBranch, team: either(['holder_id', 'creator_id']) } },
  customers: { table: 'customers', scope: { branch: inBranch, team: (b, v) => b.whereIn('owner_id', v.team) } },
  deals: {
    table: 'deals', scope: { branch: inBranch, team: either(['agent_id', 'holder_id']) },
    custom: {
      // shared/lists.js readyLeft(): open, cleared cash not closed yet, and all of it cleared (or Setup pays as money comes in).
      readyToClose: {
        prepare: async q => parseJson((await q('settings').where('key', 'setup').first())?.value)?.approvals?.payWhen || null,
        apply: (b, v, payWhen) => {
          const ready = `deals.status in ('submitted', 'partial') and ${GOT} - ${CLOSED} > 0.005 and (${CLEARED} >= deals.billed${payWhen === 'received' ? ' or 1 = 1' : ''})`;
          b.whereRaw(v === 'true' || v === '1' ? ready : `not (${ready})`);
        },
      },
    },
  },
  moneyIn: { table: 'money_in', scope: { branch: viaDeal, team: viaDeal } },
  closes: { table: 'closes', scope: { branch: viaDeal, team: viaDeal } },
  sst: { table: 'closes', scope: { branch: viaDeal, team: viaDeal } },
  payouts: {
    table: 'payout_lines', scope: { branch: viaDeal, team: (b, v) => b.whereIn('staff_id', v.team) },
    custom: {
      // shared/lists.js closeKind(): partial = not full; balance = full after a partial (part 2 on); full = the rest.
      closeType: {
        apply: (b, v) => {
          const kind = {
            partial: x => x.where(y => y.whereNull('closes.full').orWhere('closes.full', 0)),
            balance: x => x.where('closes.full', 1).where('closes.part_no', '>', 1),
            full: x => x.where('closes.full', 1).where(y => y.whereNull('closes.part_no').orWhere('closes.part_no', '<=', 1)),
          }[v];
          if (!kind) return b.whereRaw('1 = 0');
          return b.whereIn('payout_lines.close_id', sub => kind(sub.select('closes.id').from('closes')));
        },
      },
    },
  },
  requests: {
    table: 'pay_requests', scope: byStaff,
    counts: {
      // shared/lists.js CUSTOM_COUNTS.payslips: each request's gross (its lines) and the person's tax exemption, then the same sums.
      payslips: async (q, b) => {
        const rows = await q('pay_requests').join('staff', 'staff.id', 'pay_requests.staff_id')
          .leftJoin('payout_lines', 'payout_lines.request_id', 'pay_requests.id')
          .whereIn('pay_requests.id', b.select('pay_requests.id'))
          .groupBy('pay_requests.id', 'staff.wht_exempt').select('pay_requests.id', { exempt: 'staff.wht_exempt' }).sum({ gross: 'payout_lines.amount' });
        const setup = await loadSetup(q);
        return SHARED.addSlips(rows.map(r => ({ amounts: [Number(r.gross) || 0], exempt: !!Number(r.exempt) })), setup);
      },
    },
  },
  archives: { table: 'archives' },
  moneyOut: { table: 'money_out', scope: { branch: viaDeal, team: viaDeal }, columns: { 'payee.name': 'payee_name' } },
  vendorRequests: { table: 'vendor_requests', scope: { branch: inBranch, team: viaListing } },
  enquiries: { table: 'enquiries', scope: { branch: viaListing, team: viaListing } },
  titles: { table: 'titles', scope: { branch: inBranch, team: inBranch } },
  areas: { table: 'areas', scope: { branch: inBranch, team: inBranch } },
  videos: { table: 'videos' },
  propertyTypes: { table: 'property_types' },
  projects: { table: 'projects' },
  v1Eforms: { table: 'v1_eforms', scope: byStaff },
  v1Overrides: { table: 'v1_overrides', scope: byStaff },
};

// ── From a shared description to SQL ────────────────────────────────────────
const { many, valueOf, truthy, personId } = SHARED;

// A record field as stored: { col, kind } (null when it has no column of its own).
function fieldOf(m, path) {
  const [head, sub] = path.split('.');
  const f = m.fields.find(x => x.key === head);
  const g = sub ? f?.group?.find(x => x.key === sub) : f;
  return g?.col ? g : null;
}
// A record field's column, e.g. 'buyer.name' → 'deals.buyer_name'.
function columnOf(m, path, overrides = {}, table = m.table) {
  if (overrides[path]) return `${table}.${overrides[path]}`;
  const col = fieldOf(m, path)?.col;
  if (!col) throw new Error(`${m.name}: no column for "${path}"`);
  return `${table}.${col}`;
}

function filterOf(rule, col, server) {
  if (rule.eq) {
    const cols = [].concat(rule.eq).map(col);
    return {
      apply: (b, v) => {
        const vals = many(v).map(valueOf);
        const set = vals.filter(x => x !== null);
        b.where(x => { for (const c of cols) { if (set.length) x.orWhereIn(c, set); if (set.length < vals.length) x.orWhereNull(c); } });
      },
    };
  }
  if (rule.from) return { apply: (b, v) => b.where(col(rule.from), '>=', valueOf(v) ?? v) };
  if (rule.to) return { apply: (b, v) => b.where(col(rule.to), '<=', valueOf(v) ?? v) };
  if (rule.yes) return { apply: (b, v) => b.where(col(rule.yes), truthy(v) ? 1 : 0) };
  if (rule.notNull) return { apply: (b, v) => (truthy(v) ? b.whereNotNull(col(rule.notNull)) : b.whereNull(col(rule.notNull))) };
  if (rule.oneOf) {
    return {
      apply: (b, v) => {
        const set = rule.sets[v];
        if (Array.isArray(set)) b.whereIn(col(rule.oneOf), set);
        else if (set) b.whereNotIn(col(rule.oneOf), set.not);
      },
    };
  }
  if (rule.team) {
    const cols = rule.team.map(col);
    return {
      prepare: (q, v) => (personId(v) == null ? [] : teamIds(q, personId(v))),
      apply: (b, v, ids) => {
        // Not a person's id: nobody.
        if (personId(v) == null) return b.whereRaw('1 = 0');
        b.where(x => cols.forEach(c => x.orWhereIn(c, ids)));
        if (rule.self === false) b.whereNot(col('id'), personId(v));
      },
    };
  }
  if (rule.custom) return server.custom[rule.custom];
  if (rule.is) return { apply: (b, v) => b.whereRaw('lower(trim(??)) = ?', [col(rule.is), String(v).trim().toLowerCase()]) };
  if (rule.via) {
    // The rule on the record this one points at, as a subquery on its table.
    const m = MODELS[rule.of];
    const inner = filterOf(rule.rule, path => columnOf(m, path), server);
    return {
      prepare: inner.prepare,
      apply: (b, v, p) => b.whereIn(col(rule.via), sub => { sub.select(`${m.table}.id`).from(m.table); inner.apply(sub, v, p); }),
    };
  }
  throw new Error(`Unknown filter rule ${JSON.stringify(rule)}`);
}

function extraOf(key, e) {
  const m = MODELS[e.of];
  const col = f => columnOf(m, f);
  if (e.from && e.pick) {
    // Only the picked columns, read as the record would read them.
    const picks = e.pick.map(path => ({ path, ...fieldOf(m, path) }));
    if (picks.some(p => !p.col)) throw new Error(`${m.name}: no column for a field in ${JSON.stringify(e.pick)}`);
    return { key, from: e.from, table: m.table, picks };
  }
  if (e.from) return { key, from: e.from, table: m.table, fieldCol: col(e.field) };
  return {
    key, table: m.table, model: m, by: e.by, byCol: col(e.by), sumCol: e.sum ? col(e.sum) : null, count: !!e.count, pick: e.pick,
    where: Object.entries(e.where || {}).map(([f, vals]) => [col(f), vals]),
    not: Object.entries(e.not || {}).map(([f, vals]) => [col(f), vals]),
  };
}

function serverSpec(key) {
  const shared = SHARED.LISTS[key], server = SERVER[key], model = MODELS[shared.of || key];
  const col = path => columnOf(model, path, server.columns, server.table);
  // A word in the record this one points at: its id among those whose columns match.
  const searchOf = f => (typeof f === 'string' ? col(f)
    : { via: col(f.via), table: MODELS[f.of].table, cols: f.fields.map(g => columnOf(MODELS[f.of], g)) });
  return {
    key, area: shared.area, readers: shared.readers || {}, fields: shared.fields, table: server.table, model, scope: server.scope, download: shared.download,
    search: (shared.search || []).map(searchOf),
    filters: Object.fromEntries(Object.entries(shared.filters || {}).map(([k, rule]) => [k, filterOf(rule, col, server)])),
    sorts: Object.fromEntries(Object.entries(shared.sorts || {}).map(([k, f]) => [k, col(f)])),
    sort: shared.sort,
    counts: Object.fromEntries(Object.entries(shared.counts || {}).map(([k, c]) => [k,
      typeof c === 'string' ? { col: col(c) }
        : c.only ? { only: c.only, sum: c.sum && col(c.sum), keep: c.keep || [], distinct: c.distinct && col(c.distinct), custom: c.custom && server.counts[c.custom] }
          : c])),
    extras: shared.extras ? Object.entries(shared.extras).map(([k, e]) => extraOf(k, e)) : null,
  };
}

const LISTS = Object.fromEntries(Object.keys(SHARED.LISTS).map(k => [k, serverSpec(k)]));

// The viewer's reach as a where clause on `spec`'s table (nothing for 'all').
// A reach a list has no rule for sees nothing, never everything.
function scopeFor(spec, viewer) {
  if (viewer.scope === 'all' || !spec.scope) return () => {};
  const rule = spec.scope[viewer.scope];
  if (!rule || (viewer.scope === 'branch' && viewer.branchId == null)) return b => b.whereRaw('1 = 0');
  return b => rule(b, viewer);
}

module.exports = { LISTS, scopeFor };

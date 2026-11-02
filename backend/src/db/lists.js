// The server's side of every list in shared/lists.js: its table, whose records
// each reach sees (the same rules as visibleData() in shared/access.js; team =
// own + downline), the SQL for the custom filters, and each field's column
// (from records.js). The searches, filters, sorts, counts and extras themselves
// come from shared/lists.js, so the demo and the server page the same way.
const SHARED = require('../../../shared/lists.js');
const LR = require('../../../shared/listings.js');
const { buildingRankings } = LR;
const { loadSetup } = require('./setupStore');
const { MODELS, KINDS, parseJson, toRecords } = require('./records');
const { localToday } = require('./days');
const { teamIds, rawRows } = require('./list');

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

// ── Listing rules in SQL (shared/listings.js; the demo runs them on the records) ──
const isMysql = b => /mysql/.test(b.client.config.client);
// A JSON array column holds `value`, as each database searches JSON: [sql, bindings].
const jsonHas = (b, col, value) => (isMysql(b)
  ? [`json_contains(coalesce(${col}, '[]'), ?)`, [JSON.stringify(value)]]
  : [`exists (select 1 from json_each(coalesce(${col}, '[]')) where json_each.value = ?)`, [value]]);
// Text holding a word, case and all (categoryGroup).
const hasWord = (b, col, w) => (isMysql(b) ? [`cast(${col} as binary) like ?`, [`%${w}%`]] : [`instr(${col}, ?) > 0`, [w]]);
const any = parts => [`(${parts.map(p => p[0]).join(' or ')})`, parts.flatMap(p => p[1])];
const all = parts => [`(${parts.map(p => p[0]).join(' and ')})`, parts.flatMap(p => p[1])];
// Prices in whole sen, as priceRating compares them.
const ASK = 'round(listings.ask_price * 100)', MV = 'round(listings.market_value * 100)', BEST = 'round(listings.best_price * 100)';
const RATED = ['(listings.ask_price > 0 and listings.market_value > 0)', []];
// The band's edges: under a, a to b, b to c, c and over (% above market value).
const band = name => {
  const [a, b, c] = LR.LISTING_RULES.ratingSteps;
  const [lo, hi] = { red: [null, a], orange: [a, b], green: [b, c], blue: [c, null] }[name] || [];
  if (lo === undefined) return ['1 = 0', []];
  const over = `(${ASK} - ${MV}) * 100`;
  return all([RATED, ...(lo != null ? [[`${over} >= ? * ${MV}`, [lo]]] : []), ...(hi != null ? [[`${over} < ? * ${MV}`, [hi]]] : [])]);
};
const HOT = {
  hotSale: b => all([['listings.type = ?', ['sale']], any([all([band('red'), any([jsonHas(b, 'listings.flags', LR.KEY_FLAG), jsonHas(b, 'listings.flags', 'Vacant'), jsonHas(b, 'listings.flags', 'Friendly Tenant')])]),
    all([band('orange'), jsonHas(b, 'listings.flags', LR.KEY_FLAG)])])]),
  superHot: () => [`(listings.type = 'sale' and listings.market_value > 0 and listings.best_price > 0 and listings.ask_price > listings.best_price and ${BEST} * 100 <= ${MV} * ?)`, [100 + LR.LISTING_RULES.superHotPct]],
  rentKing: b => all([['listings.type = ?', ['rental']], RATED, jsonHas(b, 'listings.flags', LR.KEY_FLAG)]),
};
const raw = (b, [sql, bindings]) => b.whereRaw(sql, bindings);
const LATEST_ACTION = '(select f.action from listing_follow_ups f where f.listing_id = listings.id order by f.id desc limit 1)';

const LISTING_RULES = {
  categoryGroup: {
    apply: (b, v) => {
      const three = any(LR.GROUP_WORDS[3].map(w => hasWord(b, 'listings.category', w)));
      const two = any(LR.GROUP_WORDS[2].map(w => hasWord(b, 'listings.category', w)));
      const not = ([sql, x]) => [`not ${sql}`, x];
      const rule = { 3: three, 2: all([not(three), two]), 1: all([not(three), not(two)]) }[v];
      return rule ? raw(b, rule) : b.whereRaw('1 = 0');
    },
  },
  priceBand: { apply: (b, v) => raw(b, band(v)) },
  hotList: {
    apply: (b, v) => {
      const lists = v === 'any' ? Object.keys(HOT) : HOT[v] ? [v] : [];
      if (!lists.length) return b.whereRaw('1 = 0');
      return raw(b, all([["listings.status = 'active' and listings.photo_count > 0", []], any(lists.map(k => HOT[k](b)))]));
    },
  },
  marketValue: {
    apply: (b, v) => (v === 'complete' ? b.where('listings.market_value', '<>', 0).whereNotNull('listings.market_value')
      : v === 'incomplete' ? b.where(x => x.whereNull('listings.market_value').orWhere('listings.market_value', 0)) : b),
  },
  flag: { apply: (b, v) => raw(b, jsonHas(b, 'listings.flags', v)) },
  followedUp: { apply: (b, v) => b.whereRaw(`${truthy(v) ? '' : 'not '}exists (select 1 from listing_follow_ups f where f.listing_id = listings.id)`) },
  lastFollowUp: { apply: (b, v) => b.whereRaw(`${LATEST_ACTION} = ?`, [valueOf(v)]) },
  favouriteOf: {
    prepare: async (q, v) => {
      const row = personId(v) == null ? null : await q('favourites').where('viewer_id', personId(v)).first();
      return parseJson(row?.listings) || [];
    },
    apply: (b, v, ids) => (ids.length ? b.whereIn('listings.id', ids) : b.whereRaw('1 = 0')),
  },
  // shared/lists.js areaManagers: under this person, down to (and with) the next area manager.
  areaManagerOf: {
    prepare: async (q, v) => {
      const code = [...((await loadSetup(q)).roles || [])].reverse()[1]?.code;
      const me = personId(v) == null ? null : await q('staff').where('id', personId(v)).first('position');
      if (!code || me?.position !== code) return [];
      const rows = rawRows(await q.raw(
        'with recursive under(id, pos) as (select id, position from staff where upline_id = ? union select s.id, s.position from staff s join under u on s.upline_id = u.id where u.pos is null or u.pos <> ?) select id from under',
        [personId(v), code]));
      return rows.map(r => r.id);
    },
    apply: (b, v, ids) => (ids.length ? b.whereIn('listings.holder_id', ids) : b.whereRaw('1 = 0')),
  },
  fromOwnerRequest: {
    apply: (b, v) => b[truthy(v) ? 'whereIn' : 'whereNotIn']('listings.id', sub => sub.select('listing_id').from('vendor_requests').whereNotNull('listing_id')),
  },
};

// The Whole agency: the owner and unit of a listing outside the viewer's reach stay hidden unless they are
// tied to it (erpGuard seesOwner, as the whole-state read does), from the uplines and buildings of the page's rows.
async function hideOwners(q, rows, v) {
  if (v.scope === 'all') return rows;
  const inReach = l => (v.scope === 'branch' ? l.branchId === v.branchId : v.team.includes(l.holderId) || v.team.includes(l.creatorId));
  const others = rows.filter(l => !inReach(l));
  if (!others.length) return rows;
  const holders = [...new Set(others.map(l => l.holderId).filter(x => x != null))];
  const staff = holders.length ? rawRows(await q.raw(
    `with recursive up(id) as (select id from staff where id in (${holders.map(() => '?').join(', ')}) union select s.upline_id from staff s join up on s.id = up.id where s.upline_id is not null)
     select staff.id, staff.upline_id from staff join up on staff.id = up.id`, holders)).map(r => ({ id: r.id, uplineId: r.upline_id })) : [];
  const titleIds = [...new Set(others.map(l => l.titleId).filter(x => x != null))];
  const titles = titleIds.length ? await toRecords(q, MODELS.titles, await q('titles').whereIn('id', titleIds)) : [];
  const { seesOwner } = require('./erpGuard');
  return rows.map(l => (inReach(l) || seesOwner(l, v, { staff, titles }) ? l
    : { ...l, owner: { name: '', ic: '', phone: '' }, address: LR.hideAddress(l), remarks: null, ownerViews: [] }));
}

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
  listings: { table: 'listings', scope: { branch: inBranch, team: either(['holder_id', 'creator_id']) }, custom: LISTING_RULES },
  agency: {
    table: 'listings', custom: LISTING_RULES, rows: hideOwners,
    // Their reach, and every active listing.
    scope: {
      branch: (b, v) => b.where(x => x.where('listings.branch_id', v.branchId).orWhere('listings.status', 'active')),
      team: (b, v) => b.where(x => x.whereIn('listings.holder_id', v.team).orWhereIn('listings.creator_id', v.team).orWhere('listings.status', 'active')),
    },
  },
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
  titles: {
    table: 'titles', scope: { branch: inBranch, team: inBranch },
    extras: {
      // shared/lists.js CUSTOM_EXTRAS.buildingRanking: the same rankings, from the listings and closed sales of the page's buildings only.
      buildingRanking: async (q, rows) => {
        const ids = rows.map(r => r.id);
        const listings = ids.length ? (await q('listings').whereIn('title_id', ids).orderBy('id').select('id', 'title_id', 'type', 'status', 'flags', 'holder_id'))
          .map(l => ({ id: l.id, titleId: l.title_id, type: l.type, status: l.status, flags: parseJson(l.flags) || [], holderId: l.holder_id })) : [];
        const deals = listings.length ? (await q('deals').whereIn('listing_id', listings.map(l => l.id)).where({ status: 'closed', type: 'sale' }).orderBy('id')
          .select('listing_id', 'holder_id', 'price', 'status', 'type')).map(d => ({ listingId: d.listing_id, holderId: d.holder_id, price: Number(d.price), status: d.status, type: d.type })) : [];
        const all = buildingRankings({ listings, deals });
        return new Map(ids.map(id => [id, all.get(id) || { sale: [], rental: [] }]));
      },
    },
  },
  areas: { table: 'areas', scope: { branch: inBranch, team: inBranch } },
  videos: { table: 'videos' },
  propertyTypes: { table: 'property_types' },
  viewings: {
    table: 'viewings', columns: { 'listingIds.0': 'listing_id' },
    // Booked or hosted by someone in the viewer's reach (visibleData).
    scope: {
      branch: (b, v) => b.where(x => x.where(y => mine(y, v, 'viewings.requested_by')).orWhere(y => mine(y, v, 'viewings.handler_id'))),
      team: (b, v) => b.where(x => x.whereIn('viewings.requested_by', v.team).orWhereIn('viewings.handler_id', v.team)),
    },
    custom: {
      viewsListing: { apply: (b, v) => (personId(v) == null ? b.whereRaw('1 = 0') : raw(b, jsonHas(b, 'viewings.listing_ids', personId(v)))) },
      waitingFor: {
        apply: (b, v) => (personId(v) == null ? b.whereRaw('1 = 0') : b.where(x => x
          .where(y => y.where('viewings.handler_id', personId(v)).whereIn('viewings.status', ['new', 'rescheduled']))
          .orWhere(y => y.where('viewings.requested_by', personId(v)).where('viewings.status', 'review')))),
      },
      // shared/listings.js reviewOverdue: in review, and it ended at or before 24 hours before then.
      reviewDue: {
        apply: (b, v) => {
          const ended = isMysql(b) ? "concat(viewings.date, ' ', coalesce(viewings.ends, viewings.time))" : "viewings.date || ' ' || coalesce(viewings.ends, viewings.time)";
          return b.where('viewings.status', 'review').whereRaw(`${ended} <= ?`, [LR.reviewDueBy(String(v))]);
        },
      },
    },
  },
  notices: {
    table: 'notices',
    // Every role: the person's own (shared/listings.js noticeFor). An office account is 0.
    scope: { every: (b, v) => b.whereIn('notices.to_whom', [String(v.staffId ?? 0), 'all', ...(v.branchId != null ? [`branch:${v.branchId}`] : [])]) },
    custom: {
      // Not in read_by (a JSON array of keys), read as MySQL and SQLite each search JSON.
      unreadBy: {
        apply: (b, v) => {
          const key = personId(v);
          if (key == null) return b.whereRaw('1 = 0');
          if (/mysql/.test(b.client.config.client)) return b.whereRaw("not json_contains(coalesce(notices.read_by, '[]'), ?)", [String(key)]);
          return b.whereRaw("not exists (select 1 from json_each(coalesce(notices.read_by, '[]')) where json_each.value = ?)", [key]);
        },
      },
    },
  },
  projects: {
    table: 'projects',
    extras: {
      // shared/lists.js projectSales, on the E-Forms named after the page's projects only.
      projectSales: async (q, rows) => {
        const names = rows.map(p => p.name);
        const deals = names.length ? (await q('deals').where('type', 'project').whereIn('property_title', names).orderBy('id')
          .select('id', 'date', 'type', 'status', 'branch_id', 'agent_id', 'price', 'fee', 'property_title'))
          .map(d => ({ id: d.id, date: KINDS.date.read(d.date), type: d.type, status: d.status, branchId: d.branch_id, agentId: d.agent_id,
            price: Number(d.price), fee: Number(d.fee), property: { title: d.property_title } })) : [];
        const today = localToday();
        return new Map(rows.map(p => [p.id, SHARED.projectSales(p, deals, today)]));
      },
    },
  },
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

function extraOf(key, e, own) {
  const m = MODELS[e.of];
  const col = f => columnOf(m, f);
  if (e.from && e.pick) {
    // Only the picked columns, read as the record would read them; whole records when a field has none (kept in `more`).
    const picks = e.pick.map(path => ({ path, ...fieldOf(m, path) }));
    if (picks.some(p => !p.col)) return { key, from: e.from, many: !!e.many, table: m.table, model: m, pickRecords: e.pick };
    return { key, from: e.from, many: !!e.many, table: m.table, picks };
  }
  if (e.from) return { key, from: e.from, table: m.table, fieldCol: col(e.field) };
  return {
    key, table: m.table, model: m, by: e.by, byCol: col(e.by), on: e.on || null, sumCol: e.sum ? col(e.sum) : null, count: !!e.count, pick: e.pick,
    where: Object.entries(e.where || {}).map(([f, vals]) => [col(f), vals]),
    not: Object.entries(e.not || {}).map(([f, vals]) => [col(f), vals]),
  };
}

function lastOf(model, f, table) {
  const child = model.children[f.last];
  const field = child.fields.find(x => x.key === f.field);
  return { last: { table: child.table, fk: child.fk, col: field.col, of: table } };
}

function serverSpec(key) {
  const shared = SHARED.LISTS[key], server = SERVER[key], model = MODELS[shared.of || key];
  const col = path => columnOf(model, path, server.columns, server.table);
  // A word in the record this one points at: its id among those whose columns match.
  const searchOf = f => (typeof f === 'string' ? col(f) : f.digits ? { digits: col(f.digits) }
    : { via: col(f.via), table: MODELS[f.of].table, cols: f.fields.map(g => columnOf(MODELS[f.of], g)) });
  return {
    key, area: shared.area, readers: shared.readers || {}, fields: shared.fields, mine: shared.mine, rows: server.rows,
    // Filters the server fills with the viewer's own key (their favourites, their unread).
    viewerFilters: Object.keys(shared.filters || {}).filter(k => shared.filters[k].viewer), table: server.table, model, scope: server.scope, download: shared.download,
    search: (shared.search || []).map(searchOf),
    filters: Object.fromEntries(Object.entries(shared.filters || {}).map(([k, rule]) => [k, filterOf(rule, col, server)])),
    sorts: Object.fromEntries(Object.entries(shared.sorts || {}).map(([k, f]) => [k, typeof f === 'string' ? col(f)
      // How many records of that kind point at this one, as a subquery.
      : f.count ? { count: MODELS[f.count].table, by: columnOf(MODELS[f.count], f.by), on: col(f.on || 'id') }
        // A field of the newest child row (a listing's latest follow-up date).
        : lastOf(model, f, server.table)])),
    sort: shared.sort,
    counts: Object.fromEntries(Object.entries(shared.counts || {}).map(([k, c]) => [k,
      typeof c === 'string' ? { col: col(c) } : c.set ? c
        : { only: c.only, found: !c.only, sum: c.sum && col(c.sum), keep: c.keep || [], distinct: c.distinct && col(c.distinct),
          range: c.range && { col: col(c.range), read: fieldOf(model, c.range).kind.read }, custom: c.custom && server.counts?.[c.custom] }])),
    extras: shared.extras ? Object.entries(shared.extras).map(([k, e]) => (e.custom ? { key: k, custom: server.extras[e.custom] } : extraOf(k, e, col))) : null,
  };
}

const LISTS = Object.fromEntries(Object.keys(SHARED.LISTS).map(k => [k, serverSpec(k)]));

// The viewer's reach as a where clause on `spec`'s table (nothing for 'all').
// A reach a list has no rule for sees nothing, never everything.
function scopeFor(spec, viewer) {
  // A list of each person's own: for every role.
  if (spec.scope?.every) return b => spec.scope.every(b, viewer);
  if (viewer.scope === 'all' || !spec.scope) return () => {};
  const rule = spec.scope[viewer.scope];
  if (!rule || (viewer.scope === 'branch' && viewer.branchId == null)) return b => b.whereRaw('1 = 0');
  return b => rule(b, viewer);
}

module.exports = { LISTS, scopeFor };

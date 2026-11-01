// Each ERP record in the shape the pages read (the one src/demo/erpSample.js
// makes), and the table row it is stored in. One list of fields per kind of
// record turns rows into records and records into rows, so the API sends what
// the demo store sends and the pages can switch over without changes.
//
// A field is 'column' or 'column:kind'. Kinds:
//   (none)  as stored, null stays null      text  NOT NULL text ('' for nothing)
//   num     DECIMAL / number                bool  0/1 ↔ false/true
//   date    'YYYY-MM-DD' (blank → null)     at    'YYYY-MM-DD HH:MM'
//   json  json[]  json{}   JSON, with null read back as null, [] or {}
// group({...}, 'col') nests fields under one key (null when `col` is null);
// children are rows of another table read back as a list on the record.
// Any other field a record carries is kept in its `more` JSON column, so
// nothing the pages save is lost before it gets a column of its own.

const parse = v => {
  if (v == null || typeof v !== 'string') return v ?? null;
  try { return JSON.parse(v); } catch { return null; }
};
const day = v => (v == null || v === '' ? null : String(v).slice(0, 10));

const KINDS = {
  any:      { read: v => v ?? null, write: v => (v === undefined ? null : v) },
  text:     { read: v => v ?? '', write: v => (v == null ? '' : String(v)) },
  num:      { read: v => (v == null ? null : Number(v)), write: v => (v === '' || v == null ? null : Number(v)) },
  bool:     { read: v => !!Number(v), write: v => (v ? 1 : 0) },
  date:     { read: day, write: day },
  at:       { read: v => (v == null ? null : String(v).replace('T', ' ').slice(0, 16)), write: v => (v == null || v === '' ? null : String(v)) },
  json:     { read: v => parse(v), write: v => (v == null ? null : JSON.stringify(v)) },
  'json[]': { read: v => parse(v) ?? [], write: v => (v == null ? null : JSON.stringify(v)) },
  'json{}': { read: v => parse(v) ?? {}, write: v => (v == null ? null : JSON.stringify(v)) },
};

const group = (fields, when = null) => ({ group: fields, when });

function compile(spec) {
  return Object.entries(spec).map(([key, def]) => {
    if (typeof def === 'string') {
      const [col, kind = 'any'] = def.split(':');
      if (!KINDS[kind]) throw new Error(`Unknown field kind "${kind}" for ${key}`);
      return { key, col, kind: KINDS[kind] };
    }
    if (def.group) return { key, group: compile(def.group), when: def.when };
    return { key, ...def };  // { read(row), write(value) → row fields }
  });
}

function readFields(fields, row) {
  const out = {};
  for (const f of fields) {
    if (f.col) out[f.key] = f.kind.read(row[f.col]);
    else if (f.group) out[f.key] = f.when && row[f.when] == null ? null : readFields(f.group, row);
    else out[f.key] = f.read(row);
  }
  return out;
}

function writeFields(fields, value, row, name, strict) {
  const byKey = new Map(fields.map(f => [f.key, f]));
  for (const [key, v] of Object.entries(value)) {
    const f = byKey.get(key);
    if (!f) {
      if (strict) throw new Error(`${name}: no column for "${key}"`);
      continue;
    }
    if (f.col) row[f.col] = f.kind.write(v);
    else if (f.group) {
      if (v == null) for (const g of f.group) { if (g.col) row[g.col] = g.kind.write(null); }  // nested groups are not used
      else writeFields(f.group, v, row, `${name}.${key}`, strict);
    } else Object.assign(row, f.write(v));
  }
  return row;
}

function model(name, table, spec, { children = {}, skip = [], more = true } = {}) {
  const fields = compile(spec);
  const known = new Set(fields.map(f => f.key));
  const kids = Object.fromEntries(Object.entries(children).map(([key, c]) => [key, { ...c, fields: compile(c.spec) }]));
  const skipped = new Set(skip);
  return {
    name, table, fields, children: kids,
    columns: Object.fromEntries(fields.filter(f => f.col).map(f => [f.key, f.col])),
    toRecord: row => (more ? { ...parse(row.more), ...readFields(fields, row) } : readFields(fields, row)),
    // The fields of `record` that would go into `more` (no column of their own).
    overflow: record => (more ? Object.keys(record).filter(k => !known.has(k) && !kids[k] && !skipped.has(k)) : []),
    // Only the keys `record` has are written, so a part record is an update
    // (its `more` replaces the stored one: merge first when updating);
    // full: every column, blank where the record has nothing (for inserts).
    // strict: a key with no column is an error (the seed and tests use it).
    toRow(record, { strict = false, full = false } = {}) {
      const own = Object.fromEntries(Object.entries(record).filter(([k]) => !kids[k] && !skipped.has(k)));
      const extra = {};
      if (more) for (const k of Object.keys(own)) if (!known.has(k)) { extra[k] = own[k]; delete own[k]; }
      if (full) for (const f of fields) if (!(f.key in own) && f.key !== 'id') own[f.key] = undefined;
      const row = writeFields(fields, own, {}, name, strict);
      if (more && (full || Object.keys(extra).length)) row.more = Object.keys(extra).length ? JSON.stringify(extra) : null;
      return row;
    },
  };
}

const MODELS = {
  staff: model('staff', 'staff', {
    id: 'id', code: 'code', name: 'name', short: 'short_name:text', sex: 'sex', ic: 'ic_no:text', phone: 'phone:text', phone2: 'phone2:text',
    email: 'email:text', branchId: 'branch_id', role: 'position', uplineId: 'upline_id', status: 'status', joined: 'joined_on:date',
    leftOn: 'left_on:date', renNo: 'ren_no:text', bank: 'bank:text', account: 'account_no:text', accountName: 'account_name:text',
    openingLifetime: 'opening_lifetime:num', tierFloorId: 'tier_floor_id', whtExempt: 'wht_exempt:bool', username: 'username', type: 'type',
    birthday: 'birthday:date', language: 'language:text', education: 'education:text', address: 'address:text', access: 'access:json',
    regType: 'reg_type:text', regNo: 'reg_no:text', bio: 'bio', socials: 'socials:json{}', awards: 'awards:json[]',
    lastActive: 'last_active_on:date', expiresOn: 'expires_on:date', docs: 'docs:json{}', extra: 'extra:json{}',
  }, {
    // depth (how far down the chart) is worked out from the uplines, never stored.
    skip: ['depth'],
    children: {
      marketing: { table: 'staff_marketing', fk: 'staff_id', order: ['member_id'],
        spec: { staffId: 'member_id', customers: 'customers:bool', listings: 'listings:bool', shared: 'shared:bool' } },
    },
  }),

  listings: model('listings', 'listings', {
    id: 'id', code: 'code', type: 'type', category: 'category:text', title: 'title:text', area: 'area:text', city: 'city:text', state: 'state:text',
    postcode: 'postcode:text', address: 'address:text', beds: 'beds', baths: 'baths', builtUp: 'built_up', land: 'land', tenure: 'tenure:text',
    furnishing: 'furnishing:text', askPrice: 'ask_price:num', bestPrice: 'best_price:num', marketValue: 'market_value:num', status: 'status',
    closedOn: 'closed_on:date', branchId: 'branch_id', holderId: 'holder_id', creatorId: 'creator_id', flags: 'flags:json[]', portals: 'portals:json[]',
    created: 'created_on:date', updated: 'updated_on:date', views: 'views', viewsApp: 'views_app', enquiries: 'enquiry_count', photos: 'photo_count',
    videos: 'video_count', owner: group({ name: 'owner_name:text', ic: 'owner_ic:text', phone: 'owner_phone:text' }), dealId: 'deal_id',
    priceUpdated: 'price_updated_on:date', photosOn: 'photos_on:date', titleId: 'title_id', share: 'share:json',
    marketingRemarks: 'marketing_remarks', remarksPrivate: 'remarks_private:bool', priceBefore: 'price_before:num',
    description: 'description', remarks: 'remarks', draft: 'draft:bool', photoSet: 'photo_set:json', videoSet: 'video_set:json',
  }, {
    children: {
      // In the order they were added, as the demo keeps them.
      followUps: { table: 'listing_follow_ups', fk: 'listing_id', order: ['id'],
        spec: { date: 'date:date', action: 'action', by: 'by_id', remark: 'remark', appointment: group({ date: 'appt_date:date', time: 'appt_time' }, 'appt_date') } },
    },
  }),

  customers: model('customers', 'customers', {
    id: 'id', code: 'code:text', date: 'date:date', name: 'name', phone: 'phone:text', type: 'type', area: 'area:text', from: 'source:text',
    budgetMin: 'budget_min:num', budgetMax: 'budget_max:num', action: 'action', track: 'track', remarks: 'remarks', ownerId: 'owner_id',
    branchId: 'branch_id', dealId: 'deal_id',
  }, {
    children: {
      followUps: { table: 'customer_follow_ups', fk: 'customer_id', order: ['id'], spec: { date: 'date:date', action: 'action:text', note: 'note', property: 'property:text', price: 'price:num', listingId: 'listing_id' } },
    },
  }),

  projects: model('projects', 'projects', {
    id: 'id', name: 'name', developer: 'developer:text', location: 'location:text', category: 'category:text', units: 'units:num',
    priceFrom: 'price_from:num', devCommissionPct: 'dev_commission_pct:num', launchedOn: 'launched_on:date', status: 'status',
    payout: 'payout:json', incentives: 'incentives:json[]',
  }),

  deals: model('deals', 'deals', {
    id: 'id', code: 'code', type: 'type', branchId: 'branch_id', date: 'date:date', status: 'status', submittedOn: 'submitted_on:date',
    listingId: 'listing_id', projectId: 'project_id', agentId: 'agent_id', holderId: 'holder_id',
    property: group({ title: 'property_title:text', category: 'property_category:text', address: 'property_address:text', developer: 'developer' }),
    price: 'price:num', fee: 'fee:num', feePct: 'fee_pct:num', sstPct: 'sst_pct:num', sstMode: 'sst_mode',
    money: group({ fee: 'fee_ex_sst:num', sst: 'sst:num', billed: 'billed:num', coBroke: 'co_broke_fee:num', ours: 'ours:num', referral: 'referral_fee:num', net: 'net:num' }),
    buyer: group({ name: 'buyer_name:text', ic: 'buyer_ic:text', phone: 'buyer_phone:text', address: 'buyer_address:text', email: 'buyer_email:text' }),
    owner: group({ name: 'owner_name:text', ic: 'owner_ic:text', phone: 'owner_phone:text', address: 'owner_address:text', email: 'owner_email:text' }),
    otherBuyers: 'other_buyers:json[]', otherOwners: 'other_owners:json[]', coBroke: 'co_broke:json', referral: 'referral:json', rental: 'rental:json',
    docs: 'docs:json{}', files: 'files:json{}', remark: 'remark', cancelledOn: 'cancelled_on:date', cancelReason: 'cancel_reason',
    closedOn: 'closed_on:date',
    landlordCheck: group({ archiveId: 'lv_archive_id', status: 'lv_status', on: 'lv_on:date', remarks: 'lv_remarks' }, 'lv_status'),
    invoiceNo: 'invoice_no', invoiceOn: 'invoice_on:date',
  }),

  moneyIn: model('moneyIn', 'money_in', {
    id: 'id', code: 'code', dealId: 'deal_id', date: 'date:date', bankOn: 'bank_on:date', clearsOn: 'clears_on:date', amount: 'amount:num',
    method: 'method', purpose: 'purpose', payer: 'payer:text', ref: 'ref:text', into: 'into', status: 'status', reason: 'reason',
    cashMethod: 'cash_method', remark: 'remark', file: 'file',
  }),

  closes: model('closes', 'closes', {
    id: 'id', dealId: 'deal_id', date: 'date:date', claim: 'claim:num', full: 'full:bool', partNo: 'part_no', net: 'net:num', sst: 'sst:num',
    sides: 'sides:json[]',
  }),

  payouts: model('payouts', 'payout_lines', {
    id: 'id', code: 'code', closeId: 'close_id', dealId: 'deal_id', date: 'date:date', time: 'time', staffId: 'staff_id', side: 'side',
    role: 'role', pct: 'pct:num', base: 'base:num', amount: 'amount:num', tierId: 'tier_id', status: 'status', query: 'query',
    approvedOn: 'approved_on:date', approvedBy: 'approved_by:json', requestOn: 'request_on:date', requestId: 'request_id',
    archiveId: 'archive_id', paidOn: 'paid_on:date', stacked: 'stacked:bool', stackedOn: 'stacked_on:date',
  }),

  requests: model('requests', 'pay_requests', {
    id: 'id', code: 'code', staffId: 'staff_id', kind: 'kind', date: 'date:date', payOn: 'pay_on:date', status: 'status', remark: 'remark',
    paidOn: 'paid_on:date',
  }),

  archives: model('archives', 'archives', { id: 'id', code: 'code', date: 'date:date', count: 'count' }),

  moneyOut: model('moneyOut', 'money_out', {
    id: 'id', voucherNo: 'voucher_no', dealId: 'deal_id', branchId: 'branch_id', staffId: 'staff_id', type: 'type', date: 'date:date',
    // The payee's name, bank and account are columns (searched, printed on vouchers); anything else they carry is kept with them.
    payee: {
      read: row => ({ name: row.payee_name ?? '', bank: row.payee_bank ?? '', account: row.payee_account ?? '', ...parse(row.payee_extra) }),
      write: p => {
        const { name = '', bank = '', account = '', ...more } = p || {};
        return { payee_name: name, payee_bank: bank, payee_account: account, payee_extra: Object.keys(more).length ? JSON.stringify(more) : null };
      },
    },
    amount: 'amount:num', from: 'from_account', method: 'method', chequeNo: 'cheque_no', approvedBy: 'approved_by', status: 'status',
    query: 'query', readyOn: 'ready_on:date', paidOn: 'paid_on:date', receipt: 'receipt', letter: 'letter',
  }),

  vendorRequests: model('vendorRequests', 'vendor_requests', {
    id: 'id', ticket: 'ticket', date: 'date:date', name: 'name:text', phone: 'phone:text', branchId: 'branch_id', category: 'category:text',
    area: 'area:text', forType: 'for_type:text', price: 'price:num', status: 'status', listingId: 'listing_id', handledBy: 'handled_by',
  }),

  enquiries: model('enquiries', 'enquiries', {
    id: 'id', date: 'date:date', listingId: 'listing_id', name: 'name:text', phone: 'phone:text', via: 'via:text', message: 'message',
    starred: 'starred:bool', trashed: 'trashed:bool',
  }),

  titles: model('titles', 'titles', {
    id: 'id', name: 'name', area: 'area:text', state: 'state:text', branchId: 'branch_id', category: 'category', handlerId: 'handler_id',
    status: 'status', requestedBy: 'requested_by', requestedOn: 'requested_on:date',
  }),

  areas: model('areas', 'areas', {
    id: 'id', name: 'name', state: 'state:text', branchId: 'branch_id', managerId: 'manager_id', status: 'status',
    requestedBy: 'requested_by', requestedOn: 'requested_on:date',
  }),

  videos: model('videos', 'videos', {
    id: 'id', cate: 'cate', title: 'title', date: 'date:date', minutes: 'minutes', description: 'description', file: 'file',
  }),

  propertyTypes: model('propertyTypes', 'property_types', { id: 'id', name: 'name' }, { more: false }),

  v1Eforms: model('v1Eforms', 'v1_eforms', {
    id: 'id', code: 'code', date: 'date:date', type: 'type', staffId: 'staff_id', address: 'address:text', price: 'price:num',
    total: 'total:num', closing: 'closing:num', status: 'status',
  }, { more: false }),

  v1Overrides: model('v1Overrides', 'v1_overrides', {
    id: 'id', year: 'year', staffId: 'staff_id', cases: 'cases', sales: 'sales:num', override: 'override:num',
  }, { more: false }),

  viewings: model('viewings', 'viewings', {
    id: 'id', code: 'code',
    // Every listing viewed; the first is also a column, to find a listing's viewings.
    listingIds: { read: row => parse(row.listing_ids) ?? [], write: v => ({ listing_ids: JSON.stringify(v || []), listing_id: v?.[0] ?? null }) },
    requestedBy: 'requested_by', handlerId: 'handler_id', customerId: 'customer_id',
    customer: group({ name: 'customer_name:text', phone: 'customer_phone:text' }),
    date: 'date:date', time: 'time', end: 'ends', status: 'status', created: 'created_at:at', remarks: 'remarks:json[]', review: 'review:json',
  }),

  notices: model('notices', 'notices', {
    // A staff id (0: the office), 'branch:<id>' or 'all'.
    id: 'id', to: { read: row => (/^\d+$/.test(row.to_whom) ? Number(row.to_whom) : row.to_whom), write: v => ({ to_whom: String(v) }) },
    at: 'at:at', cat: 'cat', text: 'text', link: 'link', readBy: 'read_by:json[]',
  }),

  downtime: model('downtime', 'downtime', {
    id: 'id', start: 'starts_at:at', end: 'ends_at:at', message: 'message:text', closes: 'closes:bool', by: 'by_id', created: 'created_at:at',
    cancelled: 'cancelled:bool', endedAt: 'ended_at:at',
  }),
};

// Rows → records, with each record's children (follow-ups, marketing access) read in one query per kind.
async function toRecords(q, m, rows) {
  const out = rows.map(m.toRecord);
  const ids = rows.map(r => r.id);
  for (const [key, c] of Object.entries(m.children)) {
    const byParent = new Map(ids.map(id => [id, []]));
    if (ids.length) {
      for (let i = 0; i < ids.length; i += 500) {
        const kids = await q(c.table).whereIn(c.fk, ids.slice(i, i + 500)).orderBy([c.fk, ...c.order]);
        for (const k of kids) byParent.get(k[c.fk]).push(readFields(c.fields, k));
      }
    }
    out.forEach((r, i) => { r[key] = byParent.get(ids[i]); });
  }
  return out;
}

// The child rows of `record` (e.g. a listing's follow-ups), ready to insert.
function childRows(m, record, { strict = false } = {}) {
  return Object.entries(m.children).flatMap(([key, c]) =>
    (record[key] || []).map(k => ({ table: c.table, row: writeFields(c.fields, k, { [c.fk]: record.id }, `${m.name}.${key}`, strict) })));
}

module.exports = { MODELS, KINDS, toRecords, childRows, parseJson: parse };

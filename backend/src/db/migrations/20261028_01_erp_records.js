// The ERP's records, as the demo keeps them in the browser (src/demo/erpSample.js),
// in tables built for 2,000+ agents and 100,000+ rows a year:
//   staff            — agents and office staff (account `type` tells them apart)
//   staff_marketing  — who may work a person's customers and listings
//   titles, areas, property_types — buildings, areas and listing types
//   listings (+ listing_follow_ups), enquiries, vendor_requests
//   customers (+ customer_follow_ups), projects
//   deals            — E-Forms
//   money_in         — payments in (transactions), money_out — request forms
//   closes, payout_lines, archives, pay_requests — close case → pay agents
//   v1_eforms, v1_overrides — the first system's records, read only
//   counters         — the next number for each kind of code
//   files            — every upload (the file itself sits in object storage)
// Every column a list filters or sorts on has an index. Money is DECIMAL(14,2),
// rates DECIMAL(6,2), days DATE. Things only ever read with their record (a
// deal's documents, a person's socials) are JSON. Each record table also has
// `more` (JSON): fields the pages save that have no column of their own yet,
// so nothing is lost; give one a column once a list filters or sorts on it.

const money = (t, name) => t.decimal(name, 14, 2);
const pct = (t, name) => t.decimal(name, 6, 2);
const ref = (t, name, table, onDelete = 'RESTRICT') =>
  t.integer(name).unsigned().references('id').inTable(table).onDelete(onDelete);

const TABLES = {
  staff: (t, knex) => {
    t.increments('id');
    t.string('code', 20).notNullable().unique();
    t.string('username', 32).nullable().unique();
    t.string('name', 150).notNullable();
    t.string('short_name', 100).notNullable().defaultTo('');
    t.string('sex', 1).nullable();
    t.string('ic_no', 20).notNullable().defaultTo('');
    t.string('phone', 30).notNullable().defaultTo('');
    t.string('phone2', 30).notNullable().defaultTo('');
    t.string('email', 150).notNullable().defaultTo('');
    ref(t, 'branch_id', 'branches').notNullable();
    t.string('type', 20).notNullable().defaultTo('staff');      // account type: staff, sale-staff, admin-staff, …
    t.string('position', 10).nullable();                        // upline level code (AGA, TSM, …)
    ref(t, 'upline_id', 'staff', 'SET NULL').nullable();
    t.string('status', 10).notNullable().defaultTo('pending');  // active · inactive · pending
    t.date('joined_on').nullable();
    t.date('left_on').nullable();
    t.date('expires_on').nullable();
    t.date('birthday').nullable();
    t.date('last_active_on').nullable();
    t.string('ren_no', 40).notNullable().defaultTo('');
    t.string('reg_type', 10).notNullable().defaultTo('');
    t.string('reg_no', 30).notNullable().defaultTo('');
    t.string('bank', 60).notNullable().defaultTo('');
    t.string('account_no', 40).notNullable().defaultTo('');
    t.string('account_name', 150).notNullable().defaultTo('');
    money(t, 'opening_lifetime').notNullable().defaultTo(0);
    t.integer('tier_floor_id').unsigned().nullable();           // a tier in the Setup document
    t.boolean('wht_exempt').notNullable().defaultTo(false);
    t.string('language', 60).notNullable().defaultTo('');
    t.string('education', 60).notNullable().defaultTo('');
    t.string('address', 300).notNullable().defaultTo('');
    t.text('bio').nullable();
    t.json('access').nullable();
    t.json('socials').nullable();
    t.json('awards').nullable();
    t.json('docs').nullable();
    t.json('extra').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    for (const c of ['branch_id', 'status', 'upline_id', 'type', 'position', 'tier_floor_id', 'joined_on', 'expires_on', 'name', 'phone', 'ic_no']) t.index(c);
  },

  staff_marketing: t => {
    ref(t, 'staff_id', 'staff', 'CASCADE').notNullable();
    ref(t, 'member_id', 'staff', 'CASCADE').notNullable();
    t.boolean('customers').notNullable().defaultTo(false);
    t.boolean('listings').notNullable().defaultTo(false);
    t.boolean('shared').notNullable().defaultTo(false);
    t.primary(['staff_id', 'member_id']);
    t.index('member_id');
  },

  property_types: t => {
    t.increments('id');
    t.string('name', 60).notNullable().unique();
  },

  titles: t => {
    t.increments('id');
    t.string('name', 150).notNullable();
    t.string('area', 100).notNullable().defaultTo('');
    t.string('state', 40).notNullable().defaultTo('');
    ref(t, 'branch_id', 'branches').nullable();
    t.tinyint('category').nullable();
    ref(t, 'handler_id', 'staff', 'SET NULL').nullable();
    t.tinyint('status').notNullable().defaultTo(0);
    ref(t, 'requested_by', 'staff', 'SET NULL').nullable();
    t.date('requested_on').nullable();
    for (const c of ['name', 'area', 'branch_id', 'status']) t.index(c);
  },

  areas: t => {
    t.increments('id');
    t.string('name', 100).notNullable();
    t.string('state', 40).notNullable().defaultTo('');
    ref(t, 'branch_id', 'branches').nullable();
    ref(t, 'manager_id', 'staff', 'SET NULL').nullable();
    t.tinyint('status').notNullable().defaultTo(0);
    ref(t, 'requested_by', 'staff', 'SET NULL').nullable();
    t.date('requested_on').nullable();
    for (const c of ['name', 'branch_id', 'status']) t.index(c);
  },

  listings: (t, knex) => {
    t.increments('id');
    t.string('code', 20).notNullable().unique();
    t.string('type', 10).notNullable();                         // sale · rental
    t.string('category', 40).notNullable().defaultTo('');
    ref(t, 'title_id', 'titles', 'SET NULL').nullable();
    t.string('title', 150).notNullable().defaultTo('');
    t.string('area', 100).notNullable().defaultTo('');
    t.string('city', 60).notNullable().defaultTo('');
    t.string('state', 40).notNullable().defaultTo('');
    t.string('postcode', 10).notNullable().defaultTo('');
    t.string('address', 300).notNullable().defaultTo('');
    t.smallint('beds').nullable();
    t.smallint('baths').nullable();
    t.integer('built_up').nullable();
    t.string('land', 40).nullable();
    t.string('tenure', 20).notNullable().defaultTo('');
    t.string('furnishing', 30).notNullable().defaultTo('');
    money(t, 'ask_price').nullable();
    money(t, 'best_price').nullable();
    money(t, 'market_value').nullable();
    money(t, 'price_before').nullable();
    t.date('price_updated_on').nullable();
    t.string('status', 16).notNullable().defaultTo('active');
    t.date('closed_on').nullable();
    ref(t, 'branch_id', 'branches').notNullable();
    ref(t, 'holder_id', 'staff').nullable();
    ref(t, 'creator_id', 'staff').nullable();
    t.integer('deal_id').unsigned().nullable();                 // the open E-Form on it (no FK: deals point back here)
    t.json('flags').nullable();
    t.json('portals').nullable();
    t.date('created_on').nullable();
    t.date('updated_on').nullable();
    t.integer('views').notNullable().defaultTo(0);
    t.integer('views_app').notNullable().defaultTo(0);
    t.integer('enquiry_count').notNullable().defaultTo(0);
    t.integer('photo_count').notNullable().defaultTo(0);
    t.integer('video_count').notNullable().defaultTo(0);
    t.date('photos_on').nullable();
    t.string('owner_name', 150).notNullable().defaultTo('');
    t.string('owner_ic', 20).notNullable().defaultTo('');
    t.string('owner_phone', 30).notNullable().defaultTo('');
    t.json('share').nullable();
    t.text('marketing_remarks').nullable();
    t.boolean('remarks_private').notNullable().defaultTo(true);
    t.text('description').nullable();
    t.text('remarks').nullable();
    t.boolean('draft').notNullable().defaultTo(false);
    t.json('photo_set').nullable();
    t.json('video_set').nullable();
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    for (const c of ['type', 'status', 'branch_id', 'holder_id', 'creator_id', 'title_id', 'deal_id', 'area', 'created_on', 'ask_price', 'owner_phone']) t.index(c);
  },

  listing_follow_ups: t => {
    t.increments('id');
    ref(t, 'listing_id', 'listings', 'CASCADE').notNullable();
    t.date('date').notNullable();
    t.tinyint('action').notNullable();
    ref(t, 'by_id', 'staff', 'SET NULL').nullable();
    t.text('remark').nullable();
    t.date('appt_date').nullable();
    t.string('appt_time', 5).nullable();
    t.index(['listing_id', 'date']);
    t.index('appt_date');
  },

  enquiries: t => {
    t.increments('id');
    t.date('date').notNullable();
    ref(t, 'listing_id', 'listings', 'CASCADE').notNullable();
    t.string('name', 150).notNullable().defaultTo('');
    t.string('phone', 30).notNullable().defaultTo('');
    t.string('via', 30).notNullable().defaultTo('');
    t.text('message').nullable();
    t.boolean('starred').notNullable().defaultTo(false);
    t.boolean('trashed').notNullable().defaultTo(false);
    for (const c of ['listing_id', 'date']) t.index(c);
  },

  vendor_requests: t => {
    t.increments('id');
    t.string('ticket', 12).notNullable().unique();
    t.date('date').notNullable();
    t.string('name', 150).notNullable().defaultTo('');
    t.string('phone', 30).notNullable().defaultTo('');
    ref(t, 'branch_id', 'branches').nullable();
    t.string('category', 40).notNullable().defaultTo('');
    t.string('area', 100).notNullable().defaultTo('');
    t.string('for_type', 10).notNullable().defaultTo('');
    money(t, 'price').nullable();
    t.tinyint('status').notNullable().defaultTo(0);
    ref(t, 'listing_id', 'listings', 'SET NULL').nullable();
    ref(t, 'handled_by', 'staff', 'SET NULL').nullable();
    for (const c of ['branch_id', 'status', 'date']) t.index(c);
  },

  projects: t => {
    t.increments('id');
    t.string('name', 150).notNullable();
    t.string('developer', 150).notNullable().defaultTo('');
    t.string('location', 150).notNullable().defaultTo('');
    t.string('category', 40).notNullable().defaultTo('');
    t.integer('units').nullable();
    money(t, 'price_from').nullable();
    pct(t, 'dev_commission_pct').nullable();
    t.date('launched_on').nullable();
    t.string('status', 16).notNullable().defaultTo('selling');
    t.json('payout').nullable();
    t.json('incentives').nullable();
    t.index('name');
  },

  deals: (t, knex) => {
    t.increments('id');
    t.string('code', 30).notNullable().unique();
    t.string('type', 10).notNullable();                         // sale · rental · project
    ref(t, 'branch_id', 'branches').notNullable();
    t.date('date').notNullable();
    t.string('status', 12).notNullable().defaultTo('draft');    // draft · submitted · cancelled · closed · partial
    t.date('submitted_on').nullable();
    t.date('closed_on').nullable();
    t.date('cancelled_on').nullable();
    t.text('cancel_reason').nullable();
    ref(t, 'listing_id', 'listings', 'SET NULL').nullable();
    ref(t, 'project_id', 'projects', 'SET NULL').nullable();
    ref(t, 'agent_id', 'staff').notNullable();
    ref(t, 'holder_id', 'staff').nullable();
    t.string('property_title', 150).notNullable().defaultTo('');
    t.string('property_category', 40).notNullable().defaultTo('');
    t.string('property_address', 300).notNullable().defaultTo('');
    t.string('developer', 150).nullable();
    money(t, 'price').notNullable().defaultTo(0);
    money(t, 'fee').notNullable().defaultTo(0);
    pct(t, 'fee_pct').notNullable().defaultTo(0);
    pct(t, 'sst_pct').notNullable().defaultTo(0);
    t.string('sst_mode', 10).notNullable().defaultTo('on_top');
    // The fee worked out by payout.js dealMoney(): kept so reports can add them up in SQL.
    money(t, 'fee_ex_sst').notNullable().defaultTo(0);
    money(t, 'sst').notNullable().defaultTo(0);
    money(t, 'billed').notNullable().defaultTo(0);
    money(t, 'co_broke_fee').notNullable().defaultTo(0);
    money(t, 'ours').notNullable().defaultTo(0);
    money(t, 'referral_fee').notNullable().defaultTo(0);
    money(t, 'net').notNullable().defaultTo(0);
    t.string('buyer_name', 150).notNullable().defaultTo('');
    t.string('buyer_ic', 20).notNullable().defaultTo('');
    t.string('buyer_phone', 30).notNullable().defaultTo('');
    t.string('buyer_address', 300).notNullable().defaultTo('');
    t.string('buyer_email', 150).notNullable().defaultTo('');
    t.string('owner_name', 150).notNullable().defaultTo('');
    t.string('owner_ic', 20).notNullable().defaultTo('');
    t.string('owner_phone', 30).notNullable().defaultTo('');
    t.string('owner_address', 300).notNullable().defaultTo('');
    t.string('owner_email', 150).notNullable().defaultTo('');
    t.json('other_buyers').nullable();
    t.json('other_owners').nullable();
    t.json('co_broke').nullable();
    t.json('referral').nullable();
    t.json('rental').nullable();
    t.json('docs').nullable();
    t.json('files').nullable();
    t.text('remark').nullable();
    // Landlord verification (Reports): −1 pending · 0 unable to verify · 1 verified.
    t.tinyint('lv_status').nullable();
    t.date('lv_on').nullable();
    t.text('lv_remarks').nullable();
    t.integer('lv_archive_id').unsigned().nullable();
    t.string('invoice_no', 40).nullable();                      // Request Invoice (Type 01)
    t.date('invoice_on').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    for (const c of ['type', 'status', 'branch_id', 'date', 'agent_id', 'holder_id', 'listing_id', 'project_id', 'closed_on', 'lv_status', 'invoice_on', 'buyer_name', 'owner_name']) t.index(c);
  },

  money_in: t => {
    t.increments('id');
    t.string('code', 20).notNullable().unique();
    ref(t, 'deal_id', 'deals').notNullable();
    t.date('date').notNullable();
    t.date('bank_on').nullable();
    t.date('clears_on').nullable();
    money(t, 'amount').notNullable();
    t.string('method', 10).notNullable();                       // online · cheque · cash
    t.string('purpose', 20).notNullable();
    t.string('payer', 150).notNullable().defaultTo('');
    t.string('ref', 60).notNullable().defaultTo('');
    t.string('into', 12).notNullable().defaultTo('client');     // client · operating account
    t.string('status', 10).notNullable().defaultTo('draft');    // draft · cleared · returned · pending · invalid
    t.text('reason').nullable();
    t.string('cash_method', 20).nullable();
    t.text('remark').nullable();
    t.string('file', 255).nullable();
    for (const c of ['deal_id', 'status', 'date', 'bank_on']) t.index(c);
  },

  archives: t => {
    t.increments('id');
    t.string('code', 30).notNullable().unique();
    t.date('date').notNullable();
    t.integer('count').notNullable().defaultTo(0);
    t.index('date');
  },

  closes: t => {
    t.increments('id');
    ref(t, 'deal_id', 'deals').notNullable();
    t.date('date').notNullable();
    money(t, 'claim').notNullable();
    t.boolean('full').notNullable().defaultTo(true);
    t.integer('part_no').notNullable().defaultTo(1);
    money(t, 'net').notNullable();
    money(t, 'sst').notNullable().defaultTo(0);
    t.json('sides').nullable();
    for (const c of ['deal_id', 'date']) t.index(c);
  },

  pay_requests: t => {
    t.increments('id');
    t.string('code', 30).notNullable().unique();
    ref(t, 'staff_id', 'staff').notNullable();
    t.string('kind', 12).notNullable();                         // salary · incentives · creator
    t.date('date').notNullable();
    t.date('pay_on').nullable();
    t.string('status', 10).notNullable().defaultTo('new');      // new · ready · clear · invalid
    t.text('remark').nullable();
    t.date('paid_on').nullable();
    for (const c of ['staff_id', 'status', 'kind', 'date', 'pay_on']) t.index(c);
  },

  payout_lines: t => {
    t.increments('id');
    t.string('code', 20).notNullable().unique();
    ref(t, 'close_id', 'closes', 'CASCADE').notNullable();
    ref(t, 'deal_id', 'deals').notNullable();
    t.date('date').notNullable();
    t.string('time', 5).nullable();
    ref(t, 'staff_id', 'staff').notNullable();
    t.string('side', 10).notNullable();                         // sales · listing
    t.string('role', 10).nullable();                            // null: the agent's own line; else the upline level
    pct(t, 'pct').notNullable();
    money(t, 'base').notNullable();
    money(t, 'amount').notNullable();
    t.integer('tier_id').unsigned().nullable();
    t.string('status', 10).notNullable().defaultTo('new');      // new · queried · approved · paid
    t.text('query').nullable();
    t.date('approved_on').nullable();
    t.json('approved_by').nullable();
    t.date('request_on').nullable();
    ref(t, 'request_id', 'pay_requests', 'SET NULL').nullable();
    ref(t, 'archive_id', 'archives', 'SET NULL').nullable();
    t.date('paid_on').nullable();
    t.boolean('stacked').notNullable().defaultTo(false);
    t.date('stacked_on').nullable();
    t.index(['staff_id', 'status']);
    for (const c of ['close_id', 'deal_id', 'status', 'date', 'request_id', 'archive_id']) t.index(c);
  },

  money_out: t => {
    t.increments('id');
    t.string('voucher_no', 30).notNullable().unique();
    ref(t, 'deal_id', 'deals').notNullable();
    ref(t, 'branch_id', 'branches').notNullable();
    ref(t, 'staff_id', 'staff').nullable();
    t.string('type', 12).notNullable();                         // balance · transfer · refund · cobroke · referral · ta
    t.date('date').notNullable();
    t.string('payee_name', 150).notNullable().defaultTo('');
    t.string('payee_bank', 60).notNullable().defaultTo('');
    t.string('payee_account', 40).notNullable().defaultTo('');
    t.json('payee_extra').nullable();
    money(t, 'amount').notNullable();
    t.integer('from_account').unsigned().nullable();            // a bank account in the Setup document
    t.string('method', 10).notNullable().defaultTo('online');
    t.string('cheque_no', 30).nullable();
    t.string('approved_by', 150).nullable();
    t.string('status', 10).notNullable().defaultTo('new');      // new · queried · ready · paid
    t.text('query').nullable();
    t.date('ready_on').nullable();
    t.date('paid_on').nullable();
    t.string('receipt', 255).nullable();
    t.string('letter', 255).nullable();                         // the letter or invoice the request needs
    for (const c of ['deal_id', 'branch_id', 'staff_id', 'type', 'status', 'date']) t.index(c);
  },

  customers: t => {
    t.increments('id');
    t.string('code', 20).notNullable().defaultTo('');
    t.date('date').notNullable();
    t.string('name', 150).notNullable();
    t.string('phone', 30).notNullable().defaultTo('');
    t.string('type', 10).notNullable().defaultTo('Sale');       // Sale · Rent
    t.string('area', 100).notNullable().defaultTo('');
    t.string('source', 30).notNullable().defaultTo('');
    money(t, 'budget_min').nullable();
    money(t, 'budget_max').nullable();
    t.tinyint('action').notNullable().defaultTo(0);
    t.tinyint('track').notNullable().defaultTo(0);
    t.text('remarks').nullable();
    ref(t, 'owner_id', 'staff').nullable();
    ref(t, 'branch_id', 'branches').notNullable();
    ref(t, 'deal_id', 'deals', 'SET NULL').nullable();
    for (const c of ['owner_id', 'branch_id', 'date', 'track', 'action', 'name', 'phone']) t.index(c);
  },

  customer_follow_ups: t => {
    t.increments('id');
    ref(t, 'customer_id', 'customers', 'CASCADE').notNullable();
    t.date('date').notNullable();
    t.string('action', 30).notNullable().defaultTo('');
    t.text('note').nullable();
    t.string('property', 150).notNullable().defaultTo('');      // the property offered or viewed, if any
    money(t, 'price').nullable();
    ref(t, 'listing_id', 'listings', 'SET NULL').nullable();
    t.index(['customer_id', 'date']);
  },

  videos: t => {
    t.increments('id');
    t.string('cate', 20).notNullable();                         // training · meeting
    t.string('title', 200).notNullable();
    t.date('date').notNullable();
    t.integer('minutes').nullable();
    t.text('description').nullable();
    t.string('file', 255).nullable();
    for (const c of ['cate', 'date']) t.index(c);
  },

  v1_eforms: t => {
    t.increments('id');
    t.string('code', 30).notNullable();
    t.date('date').notNullable();
    t.string('type', 10).notNullable();
    ref(t, 'staff_id', 'staff').nullable();
    t.string('address', 300).notNullable().defaultTo('');
    money(t, 'price').nullable();
    money(t, 'total').nullable();
    money(t, 'closing').nullable();
    t.string('status', 12).notNullable();
    for (const c of ['staff_id', 'date', 'code']) t.index(c);
  },

  v1_overrides: t => {
    t.increments('id');
    t.smallint('year').notNullable();
    ref(t, 'staff_id', 'staff').nullable();
    t.integer('cases').notNullable().defaultTo(0);
    money(t, 'sales').notNullable().defaultTo(0);
    money(t, 'override').notNullable().defaultTo(0);
    t.index(['staff_id', 'year']);
  },

  // The last number used for each kind of code (e.g. 'deal:sale:3', 'listing',
  // 'staff'), raised inside the transaction that uses it so two people saving
  // at once never get the same number.
  counters: t => {
    t.string('key', 60).primary();
    t.bigInteger('value').notNullable().defaultTo(0);
  },

  // Uploads. The file is in object storage under `storage_key` (and its small
  // preview under `preview_key`); records point at the file by id or key.
  files: (t, knex) => {
    t.increments('id');
    t.string('kind', 20).notNullable();                         // a shared/files.js UPLOADS kind
    t.string('name', 255).notNullable();
    t.string('mime', 100).notNullable();
    t.bigInteger('size').notNullable();
    t.string('storage_key', 255).notNullable().unique();
    t.string('preview_key', 255).nullable();
    t.string('entity', 40).nullable();
    t.string('entity_id', 40).nullable();
    t.integer('uploaded_by').unsigned().nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['entity', 'entity_id']);
  },
};

const NO_MORE = new Set(['staff_marketing', 'property_types', 'listing_follow_ups', 'customer_follow_ups', 'v1_eforms', 'v1_overrides', 'counters', 'files']);

exports.up = async knex => {
  for (const [name, build] of Object.entries(TABLES)) {
    if (!(await knex.schema.hasTable(name))) {
      await knex.schema.createTable(name, t => {
        build(t, knex);
        if (!NO_MORE.has(name)) t.json('more').nullable();
      });
    }
  }

  // Branch details from Setup.
  for (const [col, len] of [['address', 300], ['phone', 30], ['manager', 100]]) {
    if (!(await knex.schema.hasColumn('branches', col))) {
      await knex.schema.alterTable('branches', t => { t.string(col, len).notNullable().defaultTo(''); });
    }
  }
  // A sign-in account can belong to one staff record (an agent signing in as themselves).
  if (!(await knex.schema.hasColumn('users', 'staff_id'))) {
    await knex.schema.alterTable('users', t => { t.integer('staff_id').unsigned().nullable().unique().references('id').inTable('staff').onDelete('SET NULL'); });
  }
};

exports.down = async knex => {
  if (await knex.schema.hasColumn('users', 'staff_id')) {
    await knex.schema.alterTable('users', t => { t.dropForeign('staff_id'); t.dropUnique(['staff_id']); t.dropColumn('staff_id'); });
  }
  for (const col of ['address', 'phone', 'manager']) {
    if (await knex.schema.hasColumn('branches', col)) await knex.schema.alterTable('branches', t => { t.dropColumn(col); });
  }
  for (const name of Object.keys(TABLES).reverse()) await knex.schema.dropTableIfExists(name);
};

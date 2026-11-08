// How each table of the current ERP's database becomes rows of the new one.
// Table and column names are the real ones (the .NET rewrite's scaffold of the
// live MySQL database, 2026-10-30, and the PHP code that writes them). Rules
// read from the old code: `*_stat = '3'` is a deleted row (db_case_list also
// sets it when a line is archived, with an arc_id), `property_id = 0` on
// E-Forms and case lines is the first system (Mujur Harta, "V1"), and db_trans
// mirrors every close and request form as a negative line.
//
// Every row of every table is also kept, as it was, in `legacy_rows` (import.js),
// so what a mapping leaves out is never lost; except the search logs and sign-in
// secrets (NOT_COPIED) and notifications older than 90 days (RECENT), which the
// new database never holds (the original dump is the archive), and the data log
// (LOGS), which goes to a table of its own. Each `transform`
// returns the new row, { otherTable, row } for a row of another table, or
// skip(reason) to keep the old row in history only.

// ── Values as the old database stores them ───────────────────────────────────
const r2 = n => Math.round(Number(n) * 100) / 100;
const pad = (n, w) => String(n).padStart(w, '0');
const blank = v => v == null || String(v).trim() === '';
// '0000-00-00' and other non-dates are "no date".
function day(v) {
  if (blank(v)) return null;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || m[1] === '0000' || m[2] === '00' || m[3] === '00') return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
const time = v => (String(v ?? '').match(/(\d{1,2}):(\d{2})/) ? String(v).match(/(\d{1,2}):(\d{2})/).slice(1).map((x, i) => (i ? x : pad(x, 2))).join(':') : null);
// Money and counts typed into text boxes: 'RM 1,200.50' → 1200.5.
function num(v) {
  if (blank(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return String(v).match(/\d/) && Number.isFinite(n) ? n : null;
}
const money = v => (num(v) == null ? null : r2(num(v)));
const int = v => (num(v) == null ? null : Math.trunc(num(v)));
const text = v => (blank(v) ? '' : String(v).trim());
const textOrNull = v => (blank(v) ? null : String(v).trim());
// Checkboxes: 'on', 'yes', or a number above 0 (1, '1', '1.0').
const flag = v => v === true || (num(v) != null && /^\s*[\d.]+\s*$/.test(String(v)) ? num(v) > 0 : ['on', 'yes', 'true'].includes(String(v ?? '').trim().toLowerCase()));
const deleted = v => String(v ?? '').trim() === '3';
const id = v => (int(v) > 0 ? int(v) : null);

const skip = reason => ({ skip: reason });

// ── Codes ────────────────────────────────────────────────────────────────────
const CODES = {
  staffStatus: { '-1': 'pending', 0: 'suspended', 1: 'active', 2: 'locked' },
  listingStatus: { 0: 'active', 1: 'sold', 2: 'rented', 3: 'invalid', 4: 'sold_other', 5: 'outdated' },
  listingType: { sales: 'sale', sale: 'sale', rental: 'rental', rent: 'rental' },
  dealStatus: { 0: 'draft', 1: 'submitted', 2: 'cancelled', 3: 'closed', 4: 'partial' },
  moneyInStatus: { 0: 'draft', 1: 'cleared', 2: 'returned', 3: 'pending', 4: 'invalid' },
  purpose: { cashdeposit: 'deposit', balancecommission: 'commission', balancerent: 'rental', others: 'other' },
  method: { cash: 'cash', cheque: 'cheque', online: 'online' },
  payoutStatus: { 0: 'new', 2: 'queried', 3: 'approved' },
  salaryStatus: { 0: 'new', 2: 'ready', 3: 'clear', 4: 'invalid' },
  salaryKind: { salary: 'salary', incentives: 'incentives', creator_fees: 'creator', other: 'other' },
  requestStatus: { 0: 'new', 2: 'queried', 3: 'ready', 4: 'ready', 5: 'paid' },
  requestType: { balancetovendor: 'balance', transferdeposittoother: 'transfer', abortcase: 'refund', chequetocobroagent: 'cobroke', requestintrofees: 'referral', tenancyagreementfees: 'ta' },
  closeType: { fullClose_ver2: true, balanceClose_ver2: true, partialClose_ver2: false, fullClose: true, balanceClose: true, partialClose: false },
  tenure: { FREEHOLD: 'Freehold', LISTHOLD: 'Leasehold', LEASEHOLD: 'Leasehold' },
  furnishing: { 'non-furnish': 'Unfurnished', furnitured: 'Fully furnished', partial_furnished: 'Partly furnished' },
  sex: { male: 'M', female: 'F', m: 'M', f: 'F' },
};
// Payout line types (calc 23H2.3, and the 2020 names) → side, and the short
// role kept on the line (null = the earner's own salary line).
const PAYOUT_ROLES = {
  SALARY_SA: ['sales', null], SALARY_PH: ['listing', null],
  BM_PROFIT_SA: ['sales', 'BM'], BM_PROFIT_PH: ['listing', 'BM'],
  PRE_TEAM_LEADER_INCENTIVE_SA: ['sales', 'PTL'], TEAM_LEADER_INCENTIVE_SA: ['sales', 'TL'], UNIT_MANAGER_INCENTIVE_SA: ['sales', 'UM'], AREA_MANAGER_INCENTIVE_SA: ['sales', 'AM'],
  PRODUCT_HANDLER_INCENTIVE_PH: ['listing', 'PH'], PRE_TEAM_LEADER_INCENTIVE_PH: ['listing', 'PTL'], TEAM_LEADER_INCENTIVE_PH: ['listing', 'TL'],
  UNIT_MANAGER_INCENTIVE_PH: ['listing', 'UM'], AREA_MANAGER_INCENTIVE_PH: ['listing', 'AM'],
  CREATOR_INCENTIVE: ['listing', 'CREATOR'], CREATOR_INCENTIVE_TEAM: ['listing', 'CREATOR_T'],
  'Sales Agent': ['sales', null], 'Sales Agent Upline': ['sales', 'UPLINE'], 'Product Handler': ['listing', null], 'Product Handler Upline': ['listing', 'UPLINE'],
  'Branch Manager': ['sales', 'BM'], 'Branch Manager Upline': ['sales', 'BM_UP'], 'Listing Creator': ['listing', 'CREATOR'], 'Area Manager': ['sales', 'AM'],
};
// Listing settings (the ten check boxes) → the flags the new listing pages show.
const LISTING_FLAGS = [
  ['property_key', 'Key On Agent Hand'], ['property_exclusive', 'Exclusive'], ['property_first_pior', 'Vacant'], ['property_follow_up', 'Need Follow-Up'],
  ['property_slobber', 'Process Deal'], ['property_hot_list', 'Process L&L'], ['property_owner_occupied', 'Owner Occupied'], ['property_tenanted', 'Tenanted'],
  ['property_on_hold', 'On Hold'], ['property_friendly_tenant', 'Friendly Tenant'],
];
const PORTALS = [['iProp', 'iProperty'], ['propGuru', 'PropertyGuru'], ['mudahmy', 'Mudah.my']];
// E-Form document columns → the document names the new E-Form page uses.
const DEAL_DOCS = {
  sale: [['form_loc_file', 'Letter of offer'], ['form_appt_file', 'Appointment letter'], ['form_rec_file', 'Receipts'], ['form_smp_file', 'SPA'],
    ['form_purchaser_ic', 'Buyer IC'], ['form_vendor_ic', 'Vendor IC'], ['form_cobro_file', 'Co-broke letter'],
    ['form_loan_file_1', 'Loan document 1'], ['form_loan_file_2', 'Loan document 2'], ['form_loan_file_3', 'Loan document 3'],
    ['form_vendor_file_1', 'Vendor document 1'], ['form_vendor_file_2', 'Vendor document 2'], ['form_vendor_file_3', 'Vendor document 3']],
  rental: [['form_loc_file', 'Letter of offer'], ['form_appt_file', 'Appointment letter'], ['form_rec_file', 'Receipt'], ['form_smp_file', 'Tenancy agreement'],
    ['form_purchaser_ic', 'Tenant IC'], ['form_vendor_ic', 'Landlord IC'], ['form_cobro_file', 'Co-broke letter']],
};
// Staff documents (the HR form's uploads) → the new HR form's names.
const STAFF_DOCS = [['application_IC', 'NRIC Copy'], ['application_document', 'Application Form'], ['application_POP', 'Joining Fee Receipt']];
const STAFF_EXTRA = [['smoker', 'smoker'], ['marital_status', 'marital'], ['house_owner', 'house'], ['transport_own', 'transportOwn'], ['num_child', 'children'],
  ['transport_type', 'transportType'], ['transport_model', 'transportModel'], ['previous_job', 'prevJob'], ['previous_job_position', 'prevPosition'],
  ['previous_job_income', 'prevIncome'], ['expected_income', 'expIncome'], ['expected_position', 'expPosition']];
const capital = v => (blank(v) ? '' : String(v).trim().replace(/^./, c => c.toUpperCase()));

// ── What is not copied ───────────────────────────────────────────────────────
// Whole tables left out, with the reason (shown in the import report). The search
// logs were 70% of the old database (5.2 of 7.3 GB on 2026-11-04) and a big part of
// why its copies and backups were so big; they stay in the original dump, kept as the archive.
const NOT_COPIED = {
  db_login_session: 'sign-in sessions of the old site (everyone signs in again)',
  db_login_try: 'failed sign-ins, holding the passwords people typed in plain text',
  db_property_search_data_capture: 'a log of every website search with the whole request (4.2 GB, stopped in May 2023); kept in the archived dump',
  db_property_search_log: 'a log of website searches (1 GB, stopped in April 2025); kept in the archived dump',
  user_credential: 'password hashes of a newer sign-in system (passwords are never copied)',
  user_session: 'sign-in sessions of a newer sign-in system', user_token: 'sign-in tokens of a newer sign-in system',
  __drizzle_migrations: 'another tool\'s record of its own table changes, not data',
};
// Copied only for the last `days` before the newest row in the copy (`column`);
// older rows are left out like NOT_COPIED.
const RECENT = {
  db_user_notification: { column: 'created_at', days: 90, why: 'app notifications older than 90 days (the old system kept every one: 763,000, more than half never read)' },
};
// Logs kept for good in a table of their own (not in legacy_rows, which goes after
// the switch-over): the data log, every form anyone sent (the user's call, 2026-11-06).
const LOGS = {
  z_form_data_capture: { into: 'legacy_activity', why: 'the old ERP\'s data log: every form anyone sent, who and when (passwords removed)' },
};

// Password-like fields inside the data log's form posts are blanked.
const SECRET_KEY = /pass|pwd|token|secret|otp|salt/i;
function scrub(value) {
  if (blank(value)) return null;
  try {
    const blankKeys = v => (Array.isArray(v) ? v.map(blankKeys) : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) ? '[removed]' : blankKeys(x)])) : v);
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') return JSON.stringify(blankKeys(parsed));
  } catch { /* not JSON: a query string */ }
  return String(value).replace(/((?:[a-z_]*(?:pass|pwd|token|secret|otp|salt)[a-z_0-9]*)["']?\s*(?:=|:|=>|;s:\d+:)\s*["']?)[^&"',;}\s]*/gi, '$1[removed]');
}

// One data log row → legacy_activity. Its times are 24-hour with an AM/PM after them ('20:07:09 PM').
function activity(r) {
  const d = day(r.data_date), t = String(r.data_time ?? '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return {
    id: int(r.id), at: d ? `${d} ${t ? `${pad(t[1], 2)}:${t[2]}:${t[3] || '00'}` : '00:00:00'}` : null,
    staff_id: id(r.staff_id), admin_id: id(r.admin_id), form: text(r.form_name).slice(0, 60), record_id: id(r.data_id),
    route: scrub(r.route_data), data: scrub(r.form_data),
  };
}

// The day a RECENT table is copied from: `days` before its newest row (the copy's
// own date, so every run on the same copy copies the same rows).
async function recentFrom(legacy, table) {
  const { column, days } = RECENT[table];
  const last = day((await legacy(table).max({ last: column }).first())?.last);
  return last ? new Date(Date.parse(`${last}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10) : null;
}
// Left out unless asked for by name (--include): a decision for the company first.
const HELD_BACK = {
  db_name_1: 'a bought-in contact list (IC numbers, addresses, phones): check PDPA before keeping it',
};
// Columns never copied anywhere, not even into history.
const SECRET_COLUMNS = {
  new_staff: ['user_password', 'encrypted_password', 'salt', 'uuid'],
  db_admin: ['request_token'],
};
// Tables kept in history only (legacy_rows), and why: no table of their own yet,
// or nothing in them that the new ERP shows. Their rows are all there to build
// from later. A table in the copy that is in none of these lists is kept the
// same way, and the report asks where it should go.
const HISTORY_ONLY = {
  db_admin: 'company details: type them into Setup, step 1',
  db_appointment: 'viewings: no table yet (Phase 2)', db_appointment_property: 'viewings: no table yet (Phase 2)',
  db_appointment_remarks: 'viewings: no table yet (Phase 2)', db_appointment_review: 'viewings: no table yet (Phase 2)',
  db_appointment_timesheet: 'viewings: no table yet (Phase 2)',
  db_property_product_handler: 'product handler history: no table yet (listing_roles, Phase 1)',
  db_property_share_users: 'branch managers shared onto listings: no table yet (listing_roles, Phase 1)',
  db_property_title_manager: 'building project manager history: no table yet (title_managers, Phase 1)',
  db_property_title_handler: 'building project handler history: no table yet (title_managers, Phase 1)',
  db_property_draft: 'half-filled new listings (one per agent), never saved',
  db_user_device: 'app push tokens: no table yet (Phase 2)',
  db_user_saved_property: 'the website\'s "My Saved Listings" (not favourites: they sent no notices): no table yet',
  db_case_archieve: 'first system (V1) archives', db_overiding_withdraw: 'first system (V1) override withdrawals',
  db_gst_transaction: 'SST ledger lines: worked out from the E-Forms and closes', db_sap: 'old payment records (feature retired)',
  db_new_sales: 'old sales register (feature retired)', db_new_sales_close: 'old sales register (feature retired)',
  db_offer: 'letters of offer (feature switched off)', db_offer_acceptance: 'letters of offer (feature switched off)', db_offer_signee: 'letters of offer (feature switched off)',
  db_event: 'campaigns (e.g. Sinland BOP): not built yet', db_event_user: 'campaigns: not built yet', db_event_user_activity_log: 'campaigns: not built yet',
  db_staff_upgrade_log: 'rank upgrade history', db_coverage: 'old menu lookup', db_property_branch: 'old sub-area lookup',
  db_property_cate_group: 'category groups lookup', db_property_restrictions: 'restriction lookup', db_property_status: 'status lookup',
  db_form_status: 'status lookup', db_form_close_status: 'status lookup', db_salary_status: 'status lookup', db_trans_status: 'status lookup',
  ...Object.fromEntries(['user', 'user_account', 'user_attribute', 'user_profile', 'user_role', 'role', 'staff_id_sequence']
    .map(t => [t, 'a newer sign-in system\'s accounts (empty on 2026-11-04): if they fill up, map them to sign-in accounts'])),
};
// Each table's key, for history ids (tables not listed use their first column).
const KEYS = {
  db_admin: ['admin_id'], db_case_archieve: ['arc_id'], db_case_archieve_ver2: ['arc_id'], db_case_list: ['case_id'], db_coverage: ['cover_id'],
  db_eforms: ['form_id'], db_eforms_request: ['request_id'], db_gst_transaction: ['gst_id'], db_name: ['name_id'], db_name_1: ['name_id'],
  db_name_followup: ['follow_id'], db_new_sales: ['sale_id'], db_new_sales_close: ['close_id'], db_overiding_record: ['over_id'],
  db_overiding_withdraw: ['draw_id'], db_posts: ['post_id'], db_property: ['property_id'], db_property_area: ['area_id'], db_property_branch: ['branch_id'],
  db_property_cate: ['cate_id'], db_property_cate_group: ['group_id'], db_property_cate_sub: ['sub_id'], db_property_enquiry: ['en_id'],
  db_property_followup: ['follow_id'], db_property_images: ['image_id'], db_property_restrictions: ['res_id'], db_property_share_users: ['share_id'],
  db_property_state: ['state_id'], db_property_status: ['status_id'], db_property_title: ['title_id'], db_property_type: ['type_id'],
  db_salary: ['salary_id'], db_sap: ['tran_id'], db_staff_upgrade_log: ['log_id'], db_trans: ['tran_id'], new_staff: ['user_id'],
  db_user_favourite_property: ['user_id', 'property_id'], db_user_favourite_property_title: ['user_id', 'property_title_id'],
  db_user_saved_property: ['user_id', 'property_id'], db_user_notification: ['id'], z_form_data_capture: ['id'],
};

// ── Lookups (read whole, kept in history, no table of their own) ─────────────
const LOOKUPS = {
  db_property_state: { key: 'state_id', name: 'state_name' },
  db_bank: { key: 'bank_id', name: 'bank_name' },
  db_property_cate: { key: 'cate_id', name: 'cate_name' },
  db_property_cate_sub: { key: 'sub_id', name: 'sub_name' },
};

// ── The tables that become records ───────────────────────────────────────────
// reads: the columns each transform uses (the import stops before writing
// anything if the copy lacks one; legacy:inspect checks them too). optional:
// columns the live forms post that the scaffold may not have; read when present.
const TABLES = {
  new_staff: {
    into: 'staff',
    reads: ['user_id', 'user_name', 'type', 'request_position', 'staff_id', 'status', 'staff_stat', 'ic_name', 'ic_no', 'name_card_name', 'sex',
      'phone_number1', 'phone_number2', 'email', 'bank_id', 'bank_account', 'date', 'birthday', 'logtimestamp', 'language', 'education_level',
      'house_address', 'facebook', 'frontend_access', 'agent_profile_page_enabled', 'agent_profile_document_generation_enabled', 'user_listing',
      'trip_incentive_listing', 'landlord_verification_access', 'hq_id', ...STAFF_DOCS.map(d => d[0]), ...STAFF_EXTRA.map(d => d[0])],
    optional: ['vendor_request_access', 'sinland_bop'],
    transform(r, ctx) {
      const name = text(r.ic_name) || text(r.name_card_name) || text(r.user_name) || `Staff ${r.user_id}`;
      const status = deleted(r.staff_stat) ? 'inactive' : ctx.code('staffStatus', r.status, 'new_staff.status', 'inactive');
      const rank = text(r.request_position);
      const extra = Object.fromEntries(STAFF_EXTRA.map(([c, k]) => [k, ['smoker', 'marital_status', 'house_owner', 'transport_own'].includes(c) ? capital(r[c]) : text(r[c])]).filter(([, v]) => v));
      return {
        id: int(r.user_id), code: `STAFF-${pad(r.user_id, 5)}`, username: ctx.unique('staff.username', textOrNull(r.user_name)?.slice(0, 32), null),
        name, short_name: text(r.name_card_name) || name, sex: CODES.sex[text(r.sex).toLowerCase()] || null, ic_no: text(r.ic_no).replace(/\s/g, ''),
        phone: text(r.phone_number1), phone2: text(r.phone_number2), email: text(r.email),
        branch_id: ctx.branchOfStaff(int(r.user_id)) ?? ctx.hq(), type: text(r.type).toLowerCase() || 'staff', position: ctx.positionFor(rank), upline_id: null,
        // The staff clock starts on the import day (the user's call, 2026-11-08): an active account counts as active
        // that day, so only idling after the switch locks it (its old last activity stays in legacy_rows).
        status, joined_on: day(r.date), left_on: null, expires_on: null, birthday: day(r.birthday), last_active_on: status === 'active' ? ctx.today : day(r.logtimestamp),
        bank: ctx.bankName(r.bank_id), account_no: text(r.bank_account).replace(/\s/g, ''), account_name: text(r.ic_name),
        language: text(r.language), education: text(r.education_level), address: text(r.house_address),
        access: JSON.stringify({
          agent: flag(r.frontend_access), profilePage: flag(r.agent_profile_page_enabled), profileDoc: flag(r.agent_profile_document_generation_enabled),
          addListing: flag(r.user_listing), landlordVerify: flag(r.landlord_verification_access), vendorRequests: flag(r.vendor_request_access),
          tripIncentive: flag(r.trip_incentive_listing), ...(r.sinland_bop === undefined ? {} : { sinlandBop: flag(r.sinland_bop) }),
        }),
        socials: blank(r.facebook) ? null : JSON.stringify({ facebook: text(r.facebook) }),
        docs: JSON.stringify(Object.fromEntries(STAFF_DOCS.map(([c, k]) => [k, !blank(r[c])]))),
        extra: Object.keys(extra).length ? JSON.stringify(extra) : null,
        // A pending account's seven days to be verified start on the import day too.
        more: JSON.stringify({ rank: rank || null, ...(id(r.hq_id) ? { agencyHqId: id(r.hq_id) } : {}), ...(status === 'pending' ? { statusOn: ctx.today } : {}) }),
      };
    },
  },

  db_marketing_user: {
    into: 'staff_marketing',
    reads: ['id', 'staff_id', 'user_id', 'name_data', 'listing', 'shared_saleking_listing', 'user_stat'],
    transform(r, ctx) {
      if (deleted(r.user_stat)) return skip('deleted in the old ERP');
      if (!ctx.has('staff', id(r.staff_id)) || !ctx.has('staff', id(r.user_id))) return skip('a person on it is not in the staff list');
      if (!ctx.firstTime('marketing', `${id(r.staff_id)}:${id(r.user_id)}`)) return skip('the same pair is listed twice; the first one is kept');
      return { staff_id: id(r.staff_id), member_id: id(r.user_id), customers: flag(r.name_data), listings: flag(r.listing), shared: flag(r.shared_saleking_listing) };
    },
  },

  db_property_type: {
    into: 'property_types',
    reads: ['type_id', 'type_name', 'type_stat'],
    transform(r, ctx) {
      if (deleted(r.type_stat)) return skip('deleted in the old ERP');
      const name = text(r.type_name).slice(0, 60);
      if (!name) return skip('no name');
      if (!ctx.firstTime('property_types', name.toLowerCase())) return skip('the same name is listed twice; the first one is kept');
      return { id: int(r.type_id), name };
    },
  },

  db_property_area: {
    into: 'areas',
    reads: ['area_id', 'area_name', 'state_id', 'manager_id', 'staff_id', 'area_draft', 'area_stat'],
    transform(r, ctx) {
      if (deleted(r.area_stat)) return skip('deleted in the old ERP');
      const pending = flag(r.area_draft);
      return {
        id: int(r.area_id), name: text(r.area_name) || `Area ${r.area_id}`, state: ctx.stateName(r.state_id), branch_id: null,
        manager_id: ctx.person(r.manager_id), status: pending ? 2 : 0, requested_by: pending ? ctx.person(r.staff_id) : null, requested_on: null,
      };
    },
  },

  db_property_title: {
    into: 'titles',
    reads: ['title_id', 'title_name', 'area_id', 'cate_id', 'sub_id', 'handler_id', 'manager_id', 'staff_id', 'title_draft', 'title_stat', 'title_description',
      'search_address', 'remark', 'title_photo_url'],
    transform(r, ctx) {
      if (deleted(r.title_stat)) return skip('deleted in the old ERP');
      const status = int(r.title_draft) ?? 0;
      return {
        id: int(r.title_id), name: text(r.title_name) || `Title ${r.title_id}`, area: ctx.areaName(r.area_id), state: ctx.areaState(r.area_id),
        branch_id: null, category: int(r.cate_id) || null, handler_id: ctx.person(r.handler_id),
        status: [0, 1, 2].includes(status) ? status : ctx.unknownCode('db_property_title.title_draft', r.title_draft, 1),
        requested_by: status === 1 ? ctx.person(r.staff_id) : null, requested_on: null,
        more: JSON.stringify(Object.fromEntries(Object.entries({
          managerId: ctx.person(r.manager_id), subCategory: ctx.subName(r.sub_id) || null, description: textOrNull(r.title_description),
          searchAddress: textOrNull(r.search_address), remark: textOrNull(r.remark), photo: textOrNull(r.title_photo_url),
        }).filter(([, v]) => v != null))),
      };
    },
  },

  db_property: {
    into: 'listings',
    reads: ['property_id', 'property_run_id', 'property_type', 'property_stat', 'property_draft', 'property_tracking', 'property_title', 'property_name',
      'area_id', 'state_id', 'cate_id', 'sub_id', 'property_address', 'property_unit', 'property_unit_1', 'property_unit_2', 'property_unit_3',
      'property_room', 'property_bath', 'property_land_built', 'property_built_area_width', 'property_built_area_length', 'property_land_area',
      'property_land_area_width', 'property_land_area_length', 'property_tenure', 'property_furnish', 'property_price', 'property_price_asking',
      'property_price_extra', 'property_price_old', 'property_pdate', 'branch_manager_id', 'manager_id', 'title_manager_id', 'project_handler_id',
      'staff_id', 'property_date', 'property_cdate', 'property_mdate', 'last_modified_at', 'property_details_views_count_web',
      'property_details_views_count_app', 'images_count', 'property_contact', 'property_contact_name', 'property_marketing_remarks',
      'property_marketing_remarks_privacy', 'property_desc', 'property_remarks', 'property_restriction', 'property_placement', 'property_specs',
      'property_reno', 'property_pricing', 'property_comm', 'vendor_request_id', 'iProp', 'propGuru', 'mudahmy', ...LISTING_FLAGS.map(f => f[0])],
    transform(r, ctx) {
      if (deleted(r.property_stat)) return skip('deleted in the old ERP');
      const listingId = int(r.property_id);
      const type = CODES.listingType[text(r.property_type).toLowerCase()] || ctx.unknownCode('db_property.property_type', r.property_type, 'sale');
      const titleId = ctx.has('titles', id(r.property_title)) ? id(r.property_title) : null;
      const built = int(r.property_land_built) || (int(r.property_built_area_width) && int(r.property_built_area_length) ? int(r.property_built_area_width) * int(r.property_built_area_length) : null);
      const land = text(r.property_land_area) || (int(r.property_land_area_width) && int(r.property_land_area_length) ? `${int(r.property_land_area_width)} x ${int(r.property_land_area_length)}` : '');
      const holder = ctx.person(r.project_handler_id), creator = ctx.person(r.staff_id);
      const unit = text(r.property_unit) || [r.property_unit_1, r.property_unit_2, r.property_unit_3].map(text).filter(Boolean).join('-');
      const marketText = text(r.property_price_extra);
      const draftCode = int(r.property_draft) ?? 0;
      const row = {
        id: listingId, code: ctx.unique('listings.code', text(r.property_run_id) || null, `LIST-${pad(listingId, 6)}`),
        type, category: ctx.subName(r.sub_id) || ctx.cateName(r.cate_id), title_id: titleId,
        title: (titleId ? ctx.titleName(titleId) : '') || text(r.property_name), area: ctx.areaName(r.area_id), city: '',
        state: ctx.stateName(r.state_id) || ctx.areaState(r.area_id), postcode: '', address: text(r.property_address),
        beds: int(r.property_room), baths: int(r.property_bath), built_up: built || null, land: land || null,
        tenure: CODES.tenure[text(r.property_tenure).toUpperCase()] || text(r.property_tenure),
        furnishing: CODES.furnishing[text(r.property_furnish).toLowerCase()] || text(r.property_furnish),
        ask_price: money(r.property_price_asking) ?? money(r.property_price), best_price: money(r.property_price),
        market_value: money(marketText), price_before: money(r.property_price_old), price_updated_on: day(r.property_pdate),
        status: ctx.code('listingStatus', r.property_tracking ?? 0, 'db_property.property_tracking', 'active'), closed_on: null,
        branch_id: ctx.branchOfBm(id(r.branch_manager_id)) ?? ctx.branchOfStaff(creator ?? holder) ?? ctx.hq(),
        holder_id: holder, creator_id: creator, deal_id: null,
        flags: JSON.stringify(LISTING_FLAGS.filter(([c]) => flag(r[c])).map(([, f]) => f)),
        portals: JSON.stringify(PORTALS.filter(([c]) => flag(r[c])).map(([, p]) => p)),
        created_on: day(r.property_date) || day(r.property_cdate), updated_on: day(r.property_mdate) || day(r.last_modified_at),
        views: int(r.property_details_views_count_web) || 0, views_app: int(r.property_details_views_count_app) || 0, enquiry_count: 0,
        photo_count: int(r.images_count) || 0, video_count: 0, photos_on: null,
        owner_name: text(r.property_contact_name), owner_ic: '', owner_phone: text(r.property_contact), share: null,
        marketing_remarks: textOrNull(r.property_marketing_remarks), remarks_private: flag(r.property_marketing_remarks_privacy),
        description: textOrNull(r.property_desc), remarks: textOrNull(r.property_remarks), draft: [1, 2].includes(draftCode),
        photo_set: null, video_set: null,
        more: JSON.stringify(Object.fromEntries(Object.entries({
          unit: unit || null, restriction: textOrNull(r.property_restriction), placement: textOrNull(r.property_placement),
          specs: textOrNull(r.property_specs), renovation: textOrNull(r.property_reno), pricing: textOrNull(r.property_pricing),
          commission: textOrNull(r.property_comm), delisted: draftCode === 3 || null,
          marketValueText: marketText && money(marketText) == null ? marketText : null,
          areaManagerId: ctx.person(r.manager_id), projectManagerId: ctx.person(r.title_manager_id), branchManagerId: ctx.person(r.branch_manager_id),
          vendorRequestId: id(r.vendor_request_id),
        }).filter(([, v]) => v != null))),
      };
      if (titleId) ctx.listingTitles.set(listingId, row.title);
      if (id(r.vendor_request_id)) ctx.vendorListing.set(id(r.vendor_request_id), listingId);
      return row;
    },
  },

  db_property_followup: {
    into: 'listing_follow_ups',
    reads: ['follow_id', 'property_id', 'follow_date', 'created_at', 'follow_up_action', 'staff_id', 'follow_up_remarks', 'property_appointment_date',
      'property_appointment_time', 'follow_stat'],
    transform(r, ctx) {
      if (deleted(r.follow_stat)) return skip('deleted in the old ERP');
      if (!ctx.has('listings', id(r.property_id))) return skip('its listing is not imported');
      const date = day(r.follow_date) || day(r.created_at);
      if (!date) return skip('no date');
      return {
        id: int(r.follow_id), listing_id: id(r.property_id), date, action: int(r.follow_up_action) ?? 0, by_id: ctx.person(r.staff_id),
        remark: textOrNull(r.follow_up_remarks), appt_date: day(r.property_appointment_date), appt_time: time(r.property_appointment_time),
      };
    },
  },

  db_property_enquiry: {
    into: 'enquiries',
    reads: ['en_id', 'property_id', 'en_date', 'en_name', 'en_phone', 'en_email', 'en_message', 'en_read', 'en_stat'],
    transform(r, ctx) {
      if (deleted(r.en_stat)) return skip('deleted in the old ERP');
      if (!ctx.has('listings', id(r.property_id))) return skip('its listing is not imported');
      if (!day(r.en_date)) return skip('no date');
      ctx.count('enquiries', id(r.property_id));
      return {
        id: int(r.en_id), date: day(r.en_date), listing_id: id(r.property_id), name: text(r.en_name), phone: text(r.en_phone), via: 'Website',
        message: textOrNull(r.en_message), starred: false, trashed: false,
        more: JSON.stringify({ email: textOrNull(r.en_email), read: flag(r.en_read) }),
      };
    },
  },

  db_vendor_request: {
    into: 'vendor_requests',
    reads: ['id', 'ticket_id', 'created_at', 'name', 'phone', 'email', 'property_name', 'property_price', 'property_sub_id', 'property_type', 'status'],
    transform(r, ctx) {
      const date = day(r.created_at);
      if (!date) return skip('no date');
      const status = int(r.status) ?? 0;
      return {
        id: int(r.id), ticket: ctx.unique('vendor_requests.ticket', text(r.ticket_id).slice(0, 12) || null, `VR${pad(r.id, 8)}`), date,
        name: text(r.name), phone: text(r.phone), branch_id: null, category: ctx.subName(r.property_sub_id), area: '',
        for_type: CODES.listingType[text(r.property_type).toLowerCase()] || text(r.property_type), price: money(r.property_price),
        status: [0, 1, 2, -1, -2].includes(status) ? status : ctx.unknownCode('db_vendor_request.status', r.status, 0),
        listing_id: ctx.vendorListing.get(int(r.id)) ?? null, handled_by: null,
        more: JSON.stringify({ email: textOrNull(r.email), propertyName: textOrNull(r.property_name) }),
      };
    },
  },

  db_name: {
    into: 'customers',
    reads: ['name_id', 'name_date', 'txtDate', 'txtName', 'txtPhone', 'txtType', 'txtArea', 'txtWhere', 'txtWhereOther', 'txtMinBudget', 'txtMaxBudget',
      'txtBudget', 'txtAction', 'name_tracking', 'txtRemarks', 'staff_id', 'name_stat'],
    transform(r, ctx) {
      if (deleted(r.name_stat)) return skip('deleted in the old ERP');
      const date = day(r.txtDate) || day(r.name_date);
      if (!date) return skip('no date');
      const owner = ctx.person(r.staff_id);
      const from = text(r.txtWhere);
      return {
        id: int(r.name_id), code: '', date, name: text(r.txtName), phone: text(r.txtPhone), type: text(r.txtType) || 'Sale', area: text(r.txtArea),
        source: from === 'others' && text(r.txtWhereOther) ? text(r.txtWhereOther) : from,
        budget_min: money(r.txtMinBudget), budget_max: money(r.txtMaxBudget) ?? money(r.txtBudget),
        action: [0, 1, 2, 3].includes(int(r.txtAction)) ? int(r.txtAction) : 0, track: [0, 1, 2].includes(int(r.name_tracking)) ? int(r.name_tracking) : 0,
        remarks: textOrNull(r.txtRemarks), owner_id: owner, branch_id: ctx.branchOfStaff(owner) ?? ctx.hq(), deal_id: null,
      };
    },
  },

  db_name_followup: {
    into: 'customer_follow_ups',
    reads: ['follow_id', 'name_id', 'follow_date', 'follow_up_action', 'follow_up_remarks', 'follow_up_name', 'property_follow_up_name',
      'follow_up_price', 'property_follow_up_price', 'follow_up_list_id', 'property_follow_up_list_id', 'follow_stat'],
    transform(r, ctx) {
      if (deleted(r.follow_stat)) return skip('deleted in the old ERP');
      if (!ctx.has('customers', id(r.name_id))) return skip('its customer is not imported');
      if (!day(r.follow_date)) return skip('no date');
      const listing = id(r.follow_up_list_id) ?? id(r.property_follow_up_list_id);
      return {
        id: int(r.follow_id), customer_id: id(r.name_id), date: day(r.follow_date), action: text(r.follow_up_action), note: textOrNull(r.follow_up_remarks),
        property: text(r.follow_up_name) || text(r.property_follow_up_name), price: money(r.follow_up_price) ?? money(r.property_follow_up_price),
        listing_id: ctx.has('listings', listing) ? listing : null,
      };
    },
  },

  // E-Forms of the first system (property_id = 0) go to v1_eforms; the rest are deals.
  db_eforms: {
    into: 'deals',
    reads: ['form_id', 'form_code', 'form_type', 'form_date', 'form_status', 'form_stat', 'property_id', 'staff_id', 'cobro_id', 'branch_manager_id',
      'area_manager_id', 'property_address', 'property_type', 'rent_price', 'vp_fees', 'pintro_fees', 'intro_fees', 'cobro_fees', 'gst_amount',
      'gst_pay_by', 'tax_rate', 'form_total', 'net_total', 'total_claim_owner',
      'tenant_name', 'tenant_nric', 'tenant_passport_no', 'tenant_company_registration_no', 'tenant_tel', 'tenant_address', 'tenant_faxemail',
      'landlord_name', 'landlord_nric', 'landlord_passport_no', 'landlord_company_registration_no', 'landlord_tel', 'landlord_address', 'landlord_faxemail',
      'cobro_agency_comp_name', 'cobro_agency_reg_num', 'cobro_agency_name', 'cobro_agenct_ic', 'cobro_agent', 'agency_tel', 'agency_fax',
      'intro_ic_name', 'intro_ic_no', 'intro_phone', 'intro_bank_id', 'intro_bank_account', 'listing_agent',
      'deposit_rental', 'deposit_utility', 'deposit_other', 'tenency_fees', 'tenency_office_fees', 'tenency_balance',
      ...new Set([...DEAL_DOCS.sale, ...DEAL_DOCS.rental].map(d => d[0]))],
    transform(r, ctx) {
      if (deleted(r.form_stat)) return skip('deleted in the old ERP');
      const date = day(r.form_date);
      if (date && (date < '2015-01-01' || date > ctx.today)) ctx.note('its date looks mistyped (before 2015, or after the import): kept as it was');
      // A first-system E-Form is an old record either way (Old records lists one with no date without it).
      if (!id(r.property_id)) {
        if (!date) ctx.note('no date in the old ERP: listed without one');
        const type = CODES.listingType[text(r.form_type).toLowerCase()] || ctx.unknownCode('db_eforms.form_type', r.form_type, 'sale');
        return { otherTable: 'v1_eforms', row: v1Eform(r, ctx, { date, type, status: ctx.code('dealStatus', r.form_status, 'db_eforms.form_status', 'submitted') }) };
      }
      if (!date) return skip('no E-Form date');
      const type = CODES.listingType[text(r.form_type).toLowerCase()] || ctx.unknownCode('db_eforms.form_type', r.form_type, 'sale');
      const status = ctx.code('dealStatus', r.form_status, 'db_eforms.form_status', 'submitted');

      const agent = ctx.person(r.staff_id, { required: true });
      const listingId = ctx.has('listings', id(r.property_id)) ? id(r.property_id) : null;
      if (!listingId) ctx.note('its listing is not imported: the address is kept on the E-Form');
      // The old form's money (makeTotal() in themes/eforms/eform_body.php):
      // total = fee + misc − introducer − co-broke; SST comes out of the total when the agent's side pays it.
      const fee = r2((money(r.vp_fees) || 0) + (money(r.pintro_fees) || 0));
      const sst = money(r.gst_amount) || 0;
      const coBroke = money(r.cobro_fees) || 0, referral = money(r.intro_fees) || 0;
      const exSst = r2(fee - sst);
      const ownerPays = text(r.gst_pay_by).toLowerCase() === 'owner';
      const taxRate = num(r.tax_rate);
      const sstPct = ownerPays ? 0 : taxRate ? (taxRate < 1 ? r2(taxRate * 100) : taxRate) : date >= '2024-03-01' ? 8 : 6;
      const price = money(r.rent_price) || 0;
      const party = p => ({
        [`${p}_name`]: text(r[`${p === 'buyer' ? 'tenant' : 'landlord'}_name`]),
        [`${p}_ic`]: text(r[`${p === 'buyer' ? 'tenant' : 'landlord'}_nric`]) || text(r[`${p === 'buyer' ? 'tenant' : 'landlord'}_passport_no`]) || text(r[`${p === 'buyer' ? 'tenant' : 'landlord'}_company_registration_no`]),
        [`${p}_phone`]: text(r[`${p === 'buyer' ? 'tenant' : 'landlord'}_tel`]),
        [`${p}_address`]: text(r[`${p === 'buyer' ? 'tenant' : 'landlord'}_address`]),
        [`${p}_email`]: text(r[`${p === 'buyer' ? 'tenant' : 'landlord'}_faxemail`]),
      });
      const docs = DEAL_DOCS[type] || DEAL_DOCS.sale;
      const coAgency = text(r.cobro_agency_comp_name) || text(r.cobro_agency_name);
      const row = {
        id: int(r.form_id), code: ctx.unique('deals.code', text(r.form_code) || null, `EFORM-${pad(r.form_id, 6)}`), type,
        branch_id: ctx.branchOfBm(id(r.branch_manager_id)) ?? ctx.branchOfStaff(agent) ?? ctx.hq(), date, status,
        submitted_on: null, closed_on: null, cancelled_on: null, cancel_reason: null,
        listing_id: listingId, project_id: null, agent_id: agent, holder_id: ctx.person(r.cobro_id),
        property_title: listingId ? ctx.listingTitles.get(listingId) || '' : '', property_category: text(r.property_type), property_address: text(r.property_address),
        developer: null, price, fee, fee_pct: price ? r2(fee / price * 100) : 0, sst_pct: sstPct, sst_mode: 'included',
        fee_ex_sst: exSst, sst, billed: fee, co_broke_fee: coBroke, ours: r2(exSst - coBroke), referral_fee: referral, net: money(r.net_total) ?? r2(exSst - coBroke - referral),
        ...party('buyer'), ...party('owner'), other_buyers: null, other_owners: null,
        co_broke: coBroke || coAgency ? JSON.stringify({ agency: coAgency, licence: text(r.cobro_agency_reg_num), agent: text(r.cobro_agency_name) || text(r.cobro_agent),
          phone: text(r.agency_tel), fax: text(r.agency_fax), address: text(r.cobro_agenct_ic) }) : null,
        referral: referral || text(r.intro_ic_name) ? JSON.stringify({ name: text(r.intro_ic_name), ic: text(r.intro_ic_no), phone: text(r.intro_phone),
          bank: ctx.bankName(r.intro_bank_id), account: text(r.intro_bank_account) }) : null,
        rental: type === 'rental' ? JSON.stringify({ taFee: money(r.tenency_fees), officeFee: money(r.tenency_office_fees), balance: money(r.tenency_balance),
          deposits: { rental: money(r.deposit_rental), utility: money(r.deposit_utility), other: money(r.deposit_other) } }) : null,
        docs: JSON.stringify(Object.fromEntries(docs.map(([c, n]) => [n, !blank(r[c])]))),
        files: JSON.stringify(Object.fromEntries(docs.filter(([c]) => !blank(r[c])).map(([c, n]) => [n, text(r[c])]))),
        remark: null, lv_status: null, lv_on: null, lv_remarks: null, lv_archive_id: null, invoice_no: null, invoice_on: null,
        created_at: `${date} 00:00:00`, updated_at: `${date} 00:00:00`,
        more: JSON.stringify(Object.fromEntries(Object.entries({
          oldTotal: money(r.form_total), claimFromOwner: money(r.total_claim_owner), sstPaidBy: textOrNull(r.gst_pay_by),
          areaManagerId: ctx.person(r.area_manager_id), branchManagerId: ctx.person(r.branch_manager_id), listingAgent: textOrNull(r.listing_agent),
        }).filter(([, v]) => v != null))),
      };
      ctx.deals.set(row.id, { branchId: row.branch_id, type, status, agentId: agent, listingId, date });
      return row;
    },
  },

  db_trans: {
    into: 'money_in',
    reads: ['tran_id', 'form_id', 'tran_date', 'tran_add_date', 'tran_bank_date', 'tran_amount', 'tran_method', 'tran_purpose', 'tran_reference',
      'tran_cheque', 'tran_cash', 'tran_status', 'tran_invalid_reason', 'tran_remark', 'tran_file', 'tran_stat', 'deleted_at', 'case_id', 'request_id', 'version_id'],
    transform(r, ctx) {
      if (deleted(r.tran_stat) || day(r.deleted_at)) return skip('deleted in the old ERP');
      if (!int(r.version_id)) return skip('first system (V1) ledger line');
      if (id(r.case_id) || id(r.request_id) || (num(r.tran_amount) ?? 0) < 0) return skip('ledger mirror of a close or request form (they are imported themselves)');
      const deal = ctx.deals.get(id(r.form_id));
      if (!deal) return skip('its E-Form is not imported');
      const date = day(r.tran_date) || day(r.tran_add_date);
      if (!date) return skip('no date');
      return {
        id: int(r.tran_id), code: `TRAN#${pad(r.tran_id, 5)}`, deal_id: id(r.form_id), date, bank_on: day(r.tran_bank_date), clears_on: null,
        amount: money(r.tran_amount) || 0, method: CODES.method[text(r.tran_method).toLowerCase()] || ctx.unknownCode('db_trans.tran_method', r.tran_method, 'online'),
        purpose: CODES.purpose[text(r.tran_purpose).toLowerCase()] || ctx.unknownCode('db_trans.tran_purpose', r.tran_purpose, 'other'),
        payer: '', ref: text(r.tran_reference) || text(r.tran_cheque), into: 'client',
        status: ctx.code('moneyInStatus', r.tran_status, 'db_trans.tran_status', 'draft'), reason: textOrNull(r.tran_invalid_reason),
        cash_method: textOrNull(r.tran_cash), remark: textOrNull(r.tran_remark), file: textOrNull(r.tran_file),
        more: blank(r.tran_cheque) ? null : JSON.stringify({ chequeNo: text(r.tran_cheque) }),
      };
    },
  },

  db_case_archieve_ver2: {
    into: 'archives',
    reads: ['arc_id', 'arc_date', 'arc_stat'],
    transform(r) {
      if (deleted(r.arc_stat)) return skip('deleted in the old ERP');
      if (!day(r.arc_date)) return skip('no date');
      return { id: int(r.arc_id), code: `ARC-${pad(r.arc_id, 5)}-${day(r.arc_date)}`, date: day(r.arc_date), count: 0 };
    },
  },

  db_salary: {
    into: 'pay_requests',
    reads: ['salary_id', 'salary_document', 'staff_id', 'salary_type', 'salary_date', 'salary_cheque_date', 'salary_chequ_number', 'salary_status',
      'salary_remark', 'salary_total', 'salary_stat', 'version_id'],
    transform(r, ctx) {
      if (deleted(r.salary_stat)) return skip('deleted in the old ERP');
      if (!int(r.version_id)) return skip('first system (V1) salary request');
      const date = day(r.salary_date);
      if (!date) return skip('no date');
      const status = ctx.code('salaryStatus', r.salary_status, 'db_salary.salary_status', 'new');
      const paidOn = status === 'clear' ? day(r.salary_cheque_date) || date : null;
      ctx.salaries.set(int(r.salary_id), { status, paidOn, date });
      return {
        id: int(r.salary_id), code: ctx.unique('pay_requests.code', text(r.salary_document) || null, `SAL-${date.slice(0, 7)}-${pad(r.salary_id, 5)}`),
        staff_id: ctx.person(r.staff_id, { required: true }), kind: CODES.salaryKind[text(r.salary_type)] || ctx.unknownCode('db_salary.salary_type', r.salary_type, 'other'),
        date, pay_on: day(r.salary_cheque_date), status, remark: textOrNull(r.salary_remark), paid_on: paidOn,
        more: JSON.stringify(Object.fromEntries(Object.entries({ chequeNo: textOrNull(r.salary_chequ_number), oldTotal: money(r.salary_total) }).filter(([, v]) => v != null))),
      };
    },
  },

  // One row per payout line; the first line of each close (case_link) also makes the close.
  db_case_list: {
    into: 'payout_lines',
    reads: ['case_id', 'case_link', 'form_id', 'property_id', 'case_date', 'case_time', 'staff_id', 'role_name', 'staff_per', 'staff_level',
      'total_payout', 'comm_claim', 'tax_rate', 'gst_pay_by', 'case_type', 'case_status', 'case_stat', 'arc_id', 'staff_salary_id', 'payout_calc_ver'],
    transform(r, ctx) {
      const archived = id(r.arc_id) && ctx.has('archives', id(r.arc_id));
      if (deleted(r.case_stat) && !id(r.arc_id)) return skip('deleted in the old ERP');
      if (!id(r.property_id)) return skip('first system (V1) case line');
      const deal = ctx.deals.get(id(r.form_id));
      if (!deal) return skip('its E-Form is not imported');
      const date = day(r.case_date);
      if (!date) return skip('no date');
      const closeId = id(r.case_link) || int(r.case_id);
      const [side, role] = PAYOUT_ROLES[text(r.role_name)] || [ctx.unknownCode('db_case_list.role_name', r.role_name, 'sales'), 'OTHER'];
      const staff = ctx.person(r.staff_id, { required: true });
      const amount = money(r.total_payout) || 0, pct = r2(num(r.staff_per) || 0);
      if (!ctx.closes.has(closeId)) {
        const claim = money(r.comm_claim) || 0;
        const ownerPays = text(r.gst_pay_by).toLowerCase() === 'owner';
        const rate = num(r.tax_rate) ? (num(r.tax_rate) < 1 ? num(r.tax_rate) * 100 : num(r.tax_rate)) : date >= '2024-03-01' ? 8 : 6;
        const net = ownerPays ? claim : r2(claim * 100 / (100 + rate));
        ctx.closes.set(closeId, { id: closeId, deal_id: id(r.form_id), date, claim, full: CODES.closeType[text(r.case_type)] ?? true, part_no: 1, net,
          sst: r2(claim - net), sides: [], more: JSON.stringify({ closeType: textOrNull(r.case_type), calcVersion: textOrNull(r.payout_calc_ver) }) });
      }
      const close = ctx.closes.get(closeId);
      if (!role) close.sides.push({ side, staffId: staff, sharePct: 50, base: r2(close.net / 2), tierId: null, agentRate: pct, totalPct: null, company: null });
      const salary = id(r.staff_salary_id) ? ctx.salaries.get(id(r.staff_salary_id)) : null;
      let status = ctx.code('payoutStatus', r.case_status, 'db_case_list.case_status', 'new');
      if (salary?.status === 'clear') {
        // The salary request that pays it is Payment Clear, whatever the line still says.
        if (status !== 'approved') ctx.note(`paid by a cleared salary request while still ${status === 'queried' ? 'Pending Queries' : 'New'} in the old ERP: imported as paid`);
        status = 'paid';
      }
      return {
        id: int(r.case_id), code: `CASE-${pad(r.case_id, 6)}`, close_id: closeId, deal_id: id(r.form_id), date, time: time(r.case_time), staff_id: staff,
        side, role, pct, base: pct ? r2(amount * 100 / pct) : 0, amount, tier_id: null, status, query: null, approved_on: null, approved_by: null,
        request_on: salary ? salary.date : null, request_id: salary ? id(r.staff_salary_id) : null, archive_id: archived ? id(r.arc_id) : null,
        paid_on: status === 'paid' ? salary.paidOn : null, stacked: false, stacked_on: null,
        more: JSON.stringify({ payoutType: textOrNull(r.role_name), rank: textOrNull(r.staff_level), calcVersion: textOrNull(r.payout_calc_ver) }),
      };
    },
  },

  db_eforms_request: {
    into: 'money_out',
    reads: ['request_id', 'form_id', 'staff_id', 'request_type', 'request_date', 'request_status', 'request_stat', 'request_reasons', 'request_cheque',
      'payment_date', 'receipt', 'file', 'version_id', 'balance_to_vendor', 'transfer_amount', 'return_amount', 'cobro_fees', 'intro_fees', 'net_intro_fees',
      'tenancy_fees', 'transfer_name', 'transfer_nric', 'transfer_bank_id', 'transfer_bank_acc_no', 'tenant_name', 'tenant_nric',
      'cobro_agency_comp_name', 'cobro_agency_reg_num', 'cobro_agency_name', 'cobro_agenct_ic', 'intro_ic_name', 'intro_ic_no', 'intro_ic_phone',
      'tenancy_name', 'tenancy_ic'],
    transform(r, ctx) {
      if (deleted(r.request_stat)) return skip('deleted in the old ERP');
      if (!int(r.version_id)) return skip('first system (V1) request form');
      const deal = ctx.deals.get(id(r.form_id));
      if (!deal) return skip('its E-Form is not imported');
      const date = day(r.request_date);
      if (!date) return skip('no date');
      const type = CODES.requestType[text(r.request_type).replace(/_v(er)?2$/, '')] || ctx.unknownCode('db_eforms_request.request_type', r.request_type, 'balance');
      const amount = {
        balance: money(r.balance_to_vendor), transfer: money(r.transfer_amount), refund: money(r.return_amount), cobroke: money(r.cobro_fees),
        referral: money(r.net_intro_fees) || money(r.intro_fees), ta: money(r.tenancy_fees),
      }[type] || 0;
      const bank = ctx.bankName(r.transfer_bank_id), account = text(r.transfer_bank_acc_no);
      const payee = {
        balance: { name: text(r.transfer_name), ic: text(r.transfer_nric) },
        transfer: { name: text(r.transfer_name), ic: text(r.transfer_nric) },
        refund: { name: text(r.tenant_name) || text(r.transfer_name), ic: text(r.tenant_nric) || text(r.transfer_nric) },
        cobroke: { name: text(r.cobro_agency_comp_name), licence: text(r.cobro_agency_reg_num), agent: text(r.cobro_agency_name), address: text(r.cobro_agenct_ic) },
        referral: { name: text(r.intro_ic_name), ic: text(r.intro_ic_no), phone: text(r.intro_ic_phone) },
        ta: { name: text(r.tenancy_name) || text(r.tenant_name), ic: text(r.tenancy_ic) || text(r.tenant_nric) },
      }[type];
      const { name, ...extra } = payee;
      const status = ctx.code('requestStatus', r.request_status, 'db_eforms_request.request_status', 'new');
      return {
        id: int(r.request_id), voucher_no: `REQ-${pad(r.request_id, 6)}`, deal_id: id(r.form_id), branch_id: deal.branchId, staff_id: ctx.person(r.staff_id),
        type, date, payee_name: name, payee_bank: bank, payee_account: account,
        payee_extra: Object.values(extra).some(v => v) ? JSON.stringify(Object.fromEntries(Object.entries(extra).filter(([, v]) => v))) : null,
        amount, from_account: null, method: blank(r.request_cheque) ? 'online' : 'cheque', cheque_no: textOrNull(r.request_cheque), approved_by: null,
        status, query: status === 'queried' ? textOrNull(r.request_reasons) : null, ready_on: null, paid_on: day(r.payment_date),
        receipt: textOrNull(r.receipt), letter: textOrNull(r.file),
        more: status !== 'queried' && !blank(r.request_reasons) ? JSON.stringify({ reason: text(r.request_reasons) }) : null,
      };
    },
  },

  db_posts: {
    into: 'videos',
    reads: ['post_id', 'post_type', 'title', 'post_date', 'created_at', 'content', 'media_url', 'media_thumbnail_url', 'media_type', 'deleted_at'],
    transform(r) {
      if (day(r.deleted_at)) return skip('deleted in the old ERP');
      const date = day(r.post_date) || day(r.created_at);
      if (!date) return skip('no date');
      return {
        id: int(r.post_id), cate: text(r.post_type).toLowerCase().slice(0, 20) || 'training', title: text(r.title) || `Video ${r.post_id}`, date, minutes: null,
        description: textOrNull(r.content), file: textOrNull(r.media_url),
        more: JSON.stringify({ thumbnail: textOrNull(r.media_thumbnail_url), mediaType: textOrNull(r.media_type) }),
      };
    },
  },
};

// A first-system E-Form, read only (OldRecords page).
function v1Eform(r, ctx, { date, type, status }) {
  return {
    id: int(r.form_id), code: text(r.form_code) || `V1-${pad(r.form_id, 6)}`, date, type, staff_id: ctx.person(r.staff_id),
    address: text(r.property_address), price: money(r.rent_price), total: money(r.form_total), closing: money(r.net_total), status,
  };
}

// ── Notifications (RECENT) → notices ─────────────────────────────────────────
// The old ERP stores each one's details as PHP serialize() text of a flat array;
// lengths are in bytes. → an object, or null when it is not one.
function phpArray(v) {
  const buf = Buffer.from(String(v ?? ''), 'utf8');
  let i = 0;
  const upto = ch => {
    const j = buf.indexOf(ch, i);
    if (j < 0) throw new Error('cut short');
    const s = buf.toString('utf8', i, j);
    i = j + 1;
    return s;
  };
  const value = () => {
    const t = String.fromCharCode(buf[i]);
    i += 2;
    if (t === 'N') return null;
    if (t === 's') {
      const len = Number(upto(':'));
      const s = buf.toString('utf8', i + 1, i + 1 + len);
      i += len + 3;
      return s;
    }
    if (t === 'i' || t === 'd') return Number(upto(';'));
    if (t === 'b') return upto(';') === '1';
    if (t === 'a') {
      const n = Number(upto(':'));
      i += 1;
      const out = {};
      for (let k = 0; k < n; k++) { const key = value(); out[key] = value(); }
      i += 1;
      return out;
    }
    throw new Error(`unknown type ${t}`);
  };
  try {
    const out = value();
    return out && typeof out === 'object' ? out : null;
  } catch { return null; }
}

const NOTICE_CAT = { good_news: 'good', bad_news: 'bad', off_listing: 'bad', listing: 'listing' };
const TRACKING_WORD = { sold: 'Sold', rented: 'Rent Out', invalid: 'Not Valid', sold_other: 'Sold By Other', outdated: 'Outdated' };
const rm = n => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// What each kind said, in the new notices' words (shared/erpActions.js notify()).
// l: 'LIST-… (title)'; p: the old details.
const NOTICE_TEXT = {
  'property.price_updated': (l, p) => {
    const from = money(p.property_price_old), to = money(p.property_price);
    return from && to && from !== to ? `${l} ${to < from ? 'dropped' : 'went up'} from ${rm(from)} to ${rm(to)}.` : `The price of ${l} changed.`;
  },
  'property.listing_tracking_updated': (l, p) => {
    const s = CODES.listingStatus[int(p.property_tracking_id)];
    return s === 'active' ? `${l} is back on the market.` : TRACKING_WORD[s] ? `${l} is now ${TRACKING_WORD[s]}.` : `The tracking of ${l} changed.`;
  },
  'property.listing_published_pm': (l, p, f) => `New listing in your building: ${l}, ${f}.`,
  'property.listing_published_fav': (l, p, f) => `New listing in a building you follow: ${l}, ${f}.`,
  'property.listing_assigned_bm': (l, p) => `${text(p.updater_name) || 'Someone'} added ${l} to your branch.`,
  'property.listing_assigned_bm_other': (l, p, f) => `New listing in a building you follow: ${l}, ${f}.`,
  'property.listing_assigned_ph': l => `You are now the product handler of ${l}.`,
  'property.share_ph': (l, p) => `${text(p.share_staff_name_card_name) || 'Someone'} is now ${text(p.share_type) === 'main_ph' ? 'Main' : 'Co-'}Product Handler of ${l}.`,
};
NOTICE_TEXT['property.share_ph_other'] = NOTICE_TEXT['property.share_ph'];

// One old notification → a notice (its new id is given by the import).
function notification(r, ctx) {
  const to = id(r.user_id), listingId = id(r.reference_id);
  if (!ctx.has('staff', to)) return skip('its person is not in the staff list');
  if (!ctx.has('listings', listingId)) return skip('its listing is not imported');
  const p = phpArray(r.params) || {};
  const say = NOTICE_TEXT[text(r.type)];
  if (!say) ctx.note(`unknown notification type ${text(r.type) || '(none)'}: worded plainly`);
  const l = `${text(p.property_run_id) || `LIST-${pad(listingId, 6)}`}${text(p.property_title) ? ` (${text(p.property_title)})` : ''}`;
  const forType = CODES.listingType[text(p.property_type).toLowerCase()] === 'rental' ? 'for rent' : 'for sale';
  return {
    to_whom: String(to), at: String(r.created_at).replace('T', ' ').slice(0, 19), cat: NOTICE_CAT[text(r.category)] || 'listing',
    text: say ? say(l, p, forType) : `An update on ${l}.`, link: `listings/${listingId}`, read_by: JSON.stringify(flag(r.unread) ? [] : [to]),
  };
}

// A file's address on the old file server, over HTTPS (the server answers both; a bare path is under it).
const OLD_FILES = 'https://storage.subsaleking.com';
function oldFileUrl(v) {
  const t = text(v);
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t.replace(/^http:\/\/storage\.subsaleking\.com\//i, `${OLD_FILES}/`);
  return `${OLD_FILES}/${t.replace(/^\/+/, '')}`;
}

// ── Filled in after the records they belong to ───────────────────────────────
// Read whole, grouped onto the records above (each row is still kept in history).
const AFTER = {
  db_property_share_product_handler: ['id', 'property_id', 'staff_id', 'type', 'slot_no', 'status_id', 'valid_until', 'created_at'],
  db_eforms_meta: ['id', 'form_id', 'meta_key', 'meta_value'],
  db_landlord_verification: ['id', 'case_id', 'verification_status', 'verification_date', 'remarks', 'created_at'],
  db_eforms_update_tracker: ['id', 'form_id', 'user_id', 'type', 'ref', 'data_before', 'data_after', 'created_at'],
  db_overiding_record: ['over_id', 'staff_id', 'year', 'over_date', 'form_id', 'over_amount', 'over_stat'],
  db_user_favourite_property: ['user_id', 'property_id'],
  db_user_favourite_property_title: ['user_id', 'property_title_id'],
  db_property_images: ['image_id', 'property_id', 'image_url', 'image_stat', 'image_display', 'image_cover', 'image_date'],
};

// The columns each table is read for, for legacy:inspect and the tests.
const EXPECTED = {
  ...Object.fromEntries(Object.entries(TABLES).map(([t, m]) => [t, m.reads])),
  ...AFTER,
  ...Object.fromEntries(Object.entries(LOOKUPS).map(([t, l]) => [t, [l.key, l.name]])),
  db_property_area: TABLES.db_property_area.reads,
  db_user_notification: ['id', 'user_id', 'type', 'category', 'reference_id', 'params', 'unread', 'created_at'],
  z_form_data_capture: ['id', 'data_date', 'data_time', 'staff_id', 'admin_id', 'form_name', 'data_id', 'form_data', 'route_data'],
};

module.exports = {
  TABLES, AFTER, LOOKUPS, EXPECTED, CODES, PAYOUT_ROLES, NOT_COPIED, RECENT, LOGS, HELD_BACK, HISTORY_ONLY, SECRET_COLUMNS, KEYS,
  notification, phpArray, recentFrom, activity, oldFileUrl, scrub, day, num, money, int, text, flag, deleted, id, skip, pad, r2,
};

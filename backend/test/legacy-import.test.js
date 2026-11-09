// The import on a made-up copy of the current ERP, with its real table and
// column names: what becomes records, what stays in history, that the totals
// add up, and that no password or personal detail leaks into the report.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../shared/listings.js');
const { db, migrate, legacyTestDb } = require('./helpers');
const M = require('../src/legacy/mapping');
const { importLegacy } = require('../src/legacy/import');
const { verify } = require('../src/legacy/verify');

// The made-up copy, in a test database of its own (it has tables named like ours).
let legacy;

// Columns the live copy keeps as text although their names look like numbers.
const TEXT = new Set(['payout_calc_ver', 'ticket_id', 'property_price', 'property_run_id']);
// PHP's serialize() of a flat array, as the old ERP stores a notification's details.
const php = o => `a:${Object.keys(o).length}:{${Object.entries(o).map(([k, v]) => `s:${Buffer.byteLength(k)}:"${k}";${typeof v === 'number' ? `i:${v};` : `s:${Buffer.byteLength(v)}:"${v}";`}`).join('')}}`;
// A table with the columns the import reads (plus `extra`), typed like the live one.
async function table(name, extra = []) {
  const cols = [...new Set([...(M.KEYS[name] || []), ...(M.EXPECTED[name] || []), ...(M.TABLES[name]?.optional || []), ...extra])];
  await legacy.schema.createTable(name, t => {
    for (const c of cols) {
      if (TEXT.has(c)) t.string(c);
      else if (c === (M.KEYS[name] || ['id'])[0] || /(^|_)id$|_status$|^status$|tracking|^year$/.test(c)) t.integer(c);
      else if (/amount|fees|price|total|claim|payout|_per$|rate|count|balance|deposit/.test(c) && !/_file|_id$|account|_extra/.test(c)) t.decimal(c, 14, 2);
      else t.string(c);
    }
  });
}
const rows = (name, list) => legacy(name).insert(list);

let report, result;

before(async () => {
  legacy = await legacyTestDb();
  await migrate();
  for (const t of [...Object.keys(M.TABLES), ...Object.keys(M.AFTER), ...Object.keys(M.LOOKUPS)]) await table(t);
  await table('db_login_try', ['try_id', 'try_username_1', 'try_password_1']);
  await table('db_login_session', ['id', 'hashed_token', 'user_id']);
  await table('db_name_1', ['name_id', 'CustomerName', 'IC']);
  await table('z_form_data_capture', ['id', 'form_name', 'form_data', 'route_data']);
  await table('db_property_search_log', ['id', 'search_query', 'created_at']);
  await table('user_credential', ['id', 'user_id', 'hashed_password']);
  await table('db_user_notification');
  await legacy.schema.alterTable('db_user_notification', t => { t.text('params').alter(); });
  await table('some_new_table', ['id', 'label']);
  await legacy.schema.alterTable('new_staff', t => { t.string('user_password'); t.string('uuid'); t.string('salt'); });

  await rows('new_staff', [
    { user_id: 1, user_name: 'admin', type: 'admin', status: 1, ic_name: 'Office Admin' },
    { user_id: 10, user_name: 'bmkepong', type: 'sale-staff', status: 1, name_card_name: 'B.M (Kepong) GROUP' },
    { user_id: 11, user_name: 'alice', type: 'staff', staff_id: 10, status: 1, ic_name: 'Alice Lim', request_position: 'Team Leader', bank_id: 3, bank_account: '5140 1234 5678' },
    { user_id: 12, user_name: 'bob', type: 'staff', staff_id: 11, status: 1, ic_name: 'Bob Tan', ic_no: '900505-14-5551', phone_number1: '012-345 6789',
      birthday: '1990-05-05', request_position: 'Agent', frontend_access: 1, user_listing: 1, sex: 'male', smoker: 'no', application_IC: 'hr/ic-12.pdf',
      user_password: 'secret-pw-1', uuid: 'tok-uuid-12', salt: 'salty' },
    { user_id: 13, user_name: 'carol', type: 'staff', staff_id: 11, status: 1, staff_stat: '3', ic_name: 'Carol Ng' },
    { user_id: 14, user_name: 'dan', type: 'staff', staff_id: 99, status: -1, ic_name: 'Dan Ho' },
    { user_id: 20, user_name: 'bmpuchong', type: 'sale-staff', status: 1, name_card_name: 'B.M (Puchong) GROUP' },
    { user_id: 21, user_name: 'eve', type: 'staff', staff_id: 20, status: 2, ic_name: 'Eve Wong' },
  ]);
  await rows('db_marketing_user', [{ id: 1, staff_id: 11, user_id: 12, name_data: 1, listing: 1 }, { id: 2, staff_id: 11, user_id: 21, user_stat: '3' }]);
  await rows('db_property_state', [{ state_id: 1, state_name: 'Kuala Lumpur' }, { state_id: 2, state_name: 'Selangor' }]);
  await rows('db_bank', [{ bank_id: 3, bank_name: 'Maybank' }]);
  await rows('db_property_cate_sub', [{ sub_id: 8, sub_name: 'Condominium' }]);
  await rows('db_property_area', [{ area_id: 5, area_name: 'Kepong', state_id: 1, manager_id: 11 }, { area_id: 6, area_name: 'Old', area_stat: '3' }]);
  await rows('db_property_title', [{ title_id: 7, title_name: 'Kepong Sentral', area_id: 5, cate_id: 2, manager_id: 11 }, { title_id: 8, title_name: 'New Tower', title_draft: 1, staff_id: 12 }]);
  await rows('db_property', [
    { property_id: 100, property_run_id: 'LIST-000100', property_type: 'sales', property_title: 7, area_id: 5, state_id: 1, sub_id: 8, staff_id: 12, project_handler_id: 11,
      branch_manager_id: 10, property_tracking: 0, property_draft: 0, property_price: 600000, property_price_asking: 620000, property_price_extra: '650,000',
      property_key: 'on', iProp: 1, property_contact_name: 'Owner One', property_contact: '013-111 2222', property_tenure: 'FREEHOLD', property_date: '2025-01-10' },
    { property_id: 101, property_run_id: 'LIST-000101', property_type: 'rental', area_id: 5, staff_id: 21, project_handler_id: 21, branch_manager_id: 20,
      property_tracking: 2, property_draft: 0, property_price: 2200, vendor_request_id: 1, property_date: '2025-02-01' },
    { property_id: 102, property_run_id: 'LIST-000102', property_type: 'sales', property_stat: '3', staff_id: 12 },
    { property_id: 103, property_run_id: 'LIST-000100', property_type: 'sales', staff_id: 14, property_tracking: 5, property_draft: 1 },
    { property_id: 104, property_run_id: 'LIST-000104', property_type: 'sales', staff_id: 12, property_land_built: '18446744073709551216', property_room: '40000', property_bath: '2' },
  ]);
  await rows('db_property_followup', [{ follow_id: 1, property_id: 100, follow_date: '2025-02-02', follow_up_action: 1, staff_id: 12, property_appointment_date: '2025-02-05', property_appointment_time: '3:30 PM' },
    { follow_id: 2, property_id: 102, follow_date: '2025-02-02' }]);
  await rows('db_property_enquiry', [{ en_id: 1, property_id: 100, en_date: '2025-03-01', en_name: 'Buyer X' }, { en_id: 2, property_id: 100, en_date: '2025-03-02' }]);
  await rows('db_vendor_request', [{ id: 1, ticket_id: 'GVSDDKLPVB', created_at: '2025-01-30 10:00:00', name: 'Owner Two', property_type: 'rental', property_price: 'RM 2,300', status: 2 }]);
  await rows('db_property_share_product_handler', [
    { id: 1, property_id: 100, staff_id: 11, type: 'main_ph', status_id: 1, created_at: '2025-01-10 09:00:00' },
    { id: 2, property_id: 100, staff_id: 12, type: 'co_ph', slot_no: 1, status_id: 2, valid_until: '2025-12-31 00:00:00', created_at: '2025-02-01 09:00:00' },
    { id: 3, property_id: 100, staff_id: 21, type: 'co_ph', slot_no: 2, status_id: -1 },
  ]);
  await rows('db_name', [{ name_id: 1, txtDate: '2025-01-05', txtName: 'Lead One', txtType: 'Sale', txtWhere: 'others', txtWhereOther: 'Facebook', txtMinBudget: '500,000', staff_id: 12 },
    { name_id: 2, txtDate: '2025-01-06', name_stat: '3' }]);
  await rows('db_name_followup', [{ follow_id: 1, name_id: 1, follow_date: '2025-01-07', follow_up_action: '2', follow_up_list_id: '100', follow_up_price: '600000' }]);
  await rows('db_eforms', [
    { form_id: 500, form_code: '2025-06-SALE-00500', form_type: 'sales', form_date: '2025-06-01', form_status: 3, property_id: 100, staff_id: 12, cobro_id: 11, branch_manager_id: 10,
      rent_price: 600000, vp_fees: 10800, pintro_fees: 0, intro_fees: 0, cobro_fees: 0, gst_pay_by: 'Agent', gst_amount: 800, form_total: 10800, net_total: 10000,
      tenant_name: 'Buyer X', tenant_nric: '880101-10-1111', landlord_name: 'Owner One', form_loc_file: 'docs/500-loc.pdf' },
    { form_id: 501, form_code: '2025-07-RENT-00501', form_type: 'rental', form_date: '2025-07-01', form_status: 1, property_id: 101, staff_id: 21, cobro_id: 21,
      rent_price: 2200, vp_fees: 2000, gst_pay_by: 'Owner', gst_amount: 0, form_total: 2000, net_total: 2000, tenency_fees: 400 },
    { form_id: 502, form_code: '2025-08-SALE-00502', form_type: 'sales', form_date: '2025-08-01', form_status: 0, property_id: 100, staff_id: 777, rent_price: 590000, vp_fees: 0, net_total: 0 },
    { form_id: 503, form_code: '2025-08-SALE-00503', form_type: 'sales', form_date: '2025-08-02', form_status: 1, property_id: 100, staff_id: 12, form_stat: '3' },
    { form_id: 504, form_code: '2019-03-SALE-00504', form_type: 'sales', form_date: '2019-03-01', form_status: 3, property_id: 0, staff_id: 11, rent_price: 400000, form_total: 8000, net_total: 7547 },
    { form_id: 505, form_code: '2025-09-SALE-00505', form_type: 'sales', form_date: '0000-00-00', form_status: 1, property_id: 100, staff_id: 12, rent_price: 0, net_total: 0 },
    { form_id: 506, form_code: '0007-03-SALE-00506', form_type: 'sales', form_date: '0007-03-01', form_status: 3, property_id: 0, staff_id: 11, rent_price: 1000, form_total: 10, net_total: 10 },
    { form_id: 507, form_code: 'MJR/2203-01', form_type: 'sales', form_date: '0000-00-00', form_status: 3, property_id: 0, staff_id: 11, rent_price: 2000, form_total: 20, net_total: 20 },
  ]);
  await rows('db_eforms_meta', [{ id: 1, form_id: 500, meta_key: 'other_landlords', meta_value: JSON.stringify([{ landlord_name: 'Co Owner', landlord_nric: '700101-01-0001' }]) }]);
  await rows('db_trans', [
    { tran_id: 1, form_id: 500, tran_date: '2025-06-02', tran_amount: 5000, tran_method: 'online', tran_purpose: 'cashdeposit', tran_status: 1, version_id: 1, tran_reference: 'IBG1' },
    { tran_id: 2, form_id: 500, tran_date: '2025-06-10', tran_amount: 5800, tran_method: 'cheque', tran_purpose: 'balancecommission', tran_status: 1, version_id: 1, tran_cheque: '000123' },
    { tran_id: 3, form_id: 500, tran_date: '2025-06-15', tran_amount: -10800, tran_status: 1, version_id: 1, case_id: 900 },
    { tran_id: 4, form_id: 500, tran_date: '2025-06-16', tran_amount: 100, tran_status: 1, version_id: 1, tran_stat: '3' },
    { tran_id: 5, form_id: 504, tran_date: '2019-03-02', tran_amount: 8000, tran_status: 1, version_id: 0 },
    { tran_id: 6, form_id: 501, tran_date: '2025-07-02', tran_amount: 2000, tran_method: 'cash', tran_purpose: 'balancerent', tran_status: 3, version_id: 1, tran_cash: 'cashtocompany' },
  ]);
  await rows('db_case_archieve_ver2', [{ arc_id: 40, arc_date: '2025-07-01' }]);
  await rows('db_salary', [{ salary_id: 60, salary_document: 'SAL-2025-06-00060', staff_id: 12, salary_type: 'salary', salary_date: '2025-06-20', salary_cheque_date: '2025-06-25', salary_status: 3, version_id: 1 }]);
  const line = (case_id, role_name, staff_id, staff_per, total_payout, more = {}) => ({
    case_id, case_link: 900, form_id: 500, property_id: 100, case_date: '2025-06-15', case_time: '10:05:00 AM', staff_id, role_name, staff_per, total_payout,
    comm_claim: 10800, tax_rate: 8, gst_pay_by: 'Agent', case_type: 'fullClose_ver2', case_status: 3, case_stat: '3', arc_id: 40, payout_calc_ver: '23H2.3', ...more,
  });
  await rows('db_case_list', [
    line(900, 'SALARY_SA', 12, 70, 3500, { staff_salary_id: 60 }), line(901, 'SALARY_PH', 11, 60, 3000), line(902, 'TEAM_LEADER_INCENTIVE_SA', 11, 5, 250),
    line(903, 'BM_PROFIT_PH', 10, 30, 1500, { case_status: 2, case_stat: '', arc_id: 0 }),
    line(904, 'SALARY_SA', 12, 70, 99, { case_link: 950, case_stat: '3', arc_id: 0 }),
    line(905, '', 11, 70, 1000, { case_link: 905, form_id: 504, property_id: 0, case_stat: '' }),
    line(896, 'TEAM_LEADER_INCENTIVE_PH', 11, 10, 100, { case_status: 2, case_stat: '', arc_id: 0, staff_salary_id: 60 }),   // queried, but its salary request is clear
    line(897, 'SALARY_SA', 12, 70, 99, { case_link: 950, case_stat: '', arc_id: 0 }),                         // close 950: no line 950 itself, and 904 is deleted
  ]);
  await rows('db_landlord_verification', [{ id: 1, case_id: 900, verification_status: 1, verification_date: '2025-07-05', remarks: 'Called' }]);
  await rows('db_eforms_request', [
    { request_id: 70, form_id: 500, staff_id: 12, request_type: 'balancetovendor_ver2', request_date: '2025-06-11', request_status: 5, version_id: 1, balance_to_vendor: 1000,
      transfer_name: 'Owner One', transfer_bank_id: 3, transfer_bank_acc_no: '1122', payment_date: '2025-06-12' },
    { request_id: 71, form_id: 500, request_type: 'balancetovendor_ver2', request_date: '2025-06-11', request_stat: '3', version_id: 1, balance_to_vendor: 50 },
    { request_id: 72, form_id: 501, staff_id: 21, request_type: 'abortcase_ver2', request_date: '2025-07-03', request_status: 2, version_id: 1, return_amount: 500, request_reasons: 'Missing slip' },
  ]);
  await rows('db_eforms_update_tracker', [{ id: 1, form_id: 500, user_id: 1, type: 'rent_price', data_before: '590000', data_after: '600000', created_at: '2025-06-03 11:00:00' }]);
  await rows('db_posts', [{ post_id: 1, post_type: 'training', title: 'Closing 101', post_date: '2025-01-02', media_url: 'videos/1.mp4' }, { post_id: 2, title: 'Gone', deleted_at: '2025-01-03 00:00:00' }]);
  await rows('db_overiding_record', [{ over_id: 1, staff_id: 11, year: 2019, form_id: 504, over_amount: 300 }, { over_id: 2, staff_id: 11, year: 2019, over_amount: 50, over_stat: '3' }]);
  await rows('db_login_try', [{ try_id: 1, try_username_1: 'bob', try_password_1: 'typed-wrong-pw' }]);
  await rows('db_login_session', [{ id: 1, hashed_token: 'sess-hash', user_id: 12 }]);
  await rows('db_name_1', [{ name_id: 1, CustomerName: 'Bought Contact', IC: '660606-06-6666' }]);
  await rows('z_form_data_capture', [{ id: 1, form_name: 'update_staff', form_data: JSON.stringify({ user_name: 'bob', user_password: 'hunter2' }), route_data: 'page=hr&user_password=hunter3&x=1',
    data_date: '2026-01-02', data_time: '20:07:09 PM', staff_id: 12, data_id: 12 }]);
  await rows('db_property_search_log', [{ id: 1, search_query: 'kepong condo', created_at: '2024-01-01 10:00:00' }]);
  await rows('db_user_favourite_property', [{ user_id: 12, property_id: 100 }, { user_id: 12, property_id: 102 }, { user_id: 999, property_id: 100 }]);
  await rows('db_property_share_users', [{ share_id: 1, property_id: 100, staff_id: 10, share_stat: '', share_action: 0 }, { share_id: 2, property_id: 100, staff_id: 20, share_stat: '', share_action: 1 },
    { share_id: 3, property_id: 100, staff_id: 11, share_stat: '3', share_action: 0 }]);
  await rows('db_property_product_handler', [{ id: 1, property_id: 100, staff_id: 12, eval_from: 'listing_creator', created_at: '2025-01-01 09:00:00' },
    { id: 2, property_id: 100, staff_id: 11, eval_from: 'main_ph', created_at: '2025-03-01 09:00:00' }, { id: 3, property_id: 100, staff_id: 10, eval_from: 'suspended_ph_to_bm', created_at: '2025-02-01 09:00:00' }]);
  await rows('db_user_saved_property', [{ user_id: 12, property_id: 100, created_at: '2026-03-01 10:00:00' }, { user_id: 12, property_id: 102, created_at: '2026-03-02 10:00:00' }]);
  await rows('db_user_favourite_property_title', [{ user_id: 12, property_title_id: 7 }, { user_id: 11, property_title_id: 7 }]);
  await rows('user_credential', [{ id: 1, user_id: 1, hashed_password: 'argon-hash-1' }]);
  const kepong = { property_run_id: 'LIST-000100', property_title: 'Kepong Sentral', property_type: 'sales' };
  await rows('db_user_notification', [
    { id: 1, user_id: 12, type: 'property.price_updated', category: 'good_news', reference_id: 100, unread: '0', created_at: '2026-10-01 10:00:00',
      params: php({ ...kepong, property_price: '600000', property_price_old: '650000' }) },
    { id: 2, user_id: 11, type: 'property.share_ph', category: 'listing', reference_id: 100, unread: '1', created_at: '2026-11-01 09:00:00',
      params: php({ ...kepong, share_type: 'co_ph', share_staff_name_card_name: 'Bob' }) },
    { id: 3, user_id: 12, type: 'property.listing_tracking_updated', category: 'bad_news', reference_id: 101, unread: '1', created_at: '2026-08-03 08:00:00',
      params: php({ property_run_id: 'LIST-000101', property_tracking_id: 2 }) },
    { id: 4, user_id: 12, type: 'property.price_updated', category: 'good_news', reference_id: 100, unread: '0', created_at: '2026-08-02 23:00:00', params: php(kepong) },
    { id: 5, user_id: 999, type: 'property.share_ph', category: 'listing', reference_id: 100, unread: '1', created_at: '2026-10-02 09:00:00', params: php(kepong) },
    { id: 6, user_id: 12, type: 'property.price_updated', category: 'bad_news', reference_id: 102, unread: '1', created_at: '2026-10-03 09:00:00', params: php(kepong) },
  ]);
  // Photos: two shown on listing 100 (the second its cover, one on the old http address), one deleted, one on a
  // listing that isn't imported, and 21 on listing 101, one over what an album holds.
  await rows('db_property_images', [
    { image_id: 1, property_id: 100, image_url: 'property-images/100/a.jpg', image_stat: '', image_display: 1, image_cover: 0, image_date: '2026-01-02' },
    { image_id: 2, property_id: 100, image_url: 'http://storage.subsaleking.com/property-images/100/b%20front.jpg', image_stat: '', image_display: 1, image_cover: 1, image_date: '2026-01-03' },
    { image_id: 3, property_id: 100, image_url: 'property-images/100/c.jpg', image_stat: '3', image_display: 1, image_cover: 0, image_date: '2026-01-04' },
    { image_id: 4, property_id: 999, image_url: 'property-images/999/x.jpg', image_stat: '', image_display: 1, image_cover: 0, image_date: '2026-01-04' },
    ...Array.from({ length: 21 }, (_, i) => ({ image_id: 10 + i, property_id: 101, image_url: `https://storage.subsaleking.com/property-images/101/${i}.jpg`,
      image_stat: '', image_display: 1, image_cover: 0, image_date: `2026-02-${String(i + 1).padStart(2, '0')}` })),
  ]);
  await rows('some_new_table', [{ id: 1, label: 'x' }]);

  report = await importLegacy({ legacy, db });
  result = await verify({ legacy, db, report });
});
after(() => Promise.all([legacy.destroy(), db.destroy()]));

const one = (t, id) => db(t).where('id', id).first();
const json = v => JSON.parse(v);

test('everything matches except the E-Form with no date, which the report points at', () => {
  assert.deepEqual(result.checks.filter(c => !c.ok).map(c => c.label), ['E-Forms · submitted · count']);
  assert.equal(report.tables.db_eforms.kept['no E-Form date'], 1);
  assert.match(result.markdown, /E-Forms · submitted · count \| 2 \| 1 \| \*\*differs by -1\*\*/);
});

test('every old row is kept in history, except the logs, sign-in secrets, old notifications and the held-back contact list', async () => {
  const kept = Object.fromEntries((await db('legacy_rows').select('source_table').count({ n: '*' }).groupBy('source_table')).map(r => [r.source_table, Number(r.n)]));
  assert.equal(kept.db_property, 5);
  assert.equal(kept.db_case_list, 8);
  assert.equal(kept.some_new_table, 1);
  assert.equal(kept.db_user_notification, 5);                  // not the one from before the last 90 days
  for (const t of ['db_login_try', 'db_login_session', 'db_name_1', 'z_form_data_capture', 'db_property_search_log', 'user_credential']) assert.equal(kept[t], undefined, t);
  assert.ok(result.checks.filter(c => c.group === 'Every old row kept').every(c => c.ok));
  assert.deepEqual(report.unknownTables, ['some_new_table']);
  assert.match(result.markdown, /`db_property_search_log`: a log of website searches/);
  assert.match(result.markdown, /`db_user_notification`: app notifications older than 90 days .* \(1 rows before 2026-08-03\)/);
});

test('passwords and sign-in tokens are never copied', async () => {
  const all = JSON.stringify(await db('legacy_rows').select('data')) + JSON.stringify(await db('staff').select()) + JSON.stringify(await db('legacy_activity').select());
  for (const secret of ['secret-pw-1', 'tok-uuid-12', 'salty', 'hunter2', 'hunter3', 'typed-wrong-pw', 'sess-hash', 'argon-hash-1']) assert.ok(!all.includes(secret), secret);
});

test('the data log is kept for good in a table of its own, passwords removed', async () => {
  const a = await one('legacy_activity', 1);
  assert.deepEqual([String(a.at).replace('T', ' ').slice(0, 19), a.staff_id, a.form, a.record_id], ['2026-01-02 20:07:09', 12, 'update_staff', 12]);
  assert.match(a.data, /"user_password":"\[removed\]"/);
  assert.equal(a.route, 'page=hr&user_password=[removed]&x=1');
  assert.ok(result.checks.find(c => c.label === 'z_form_data_capture → legacy_activity').ok);
});

test('the last 90 days of notifications become notices, worded and read as they were', async () => {
  assert.deepEqual(report.recent.db_user_notification, { from: '2026-08-03', left: 1 });
  const notices = await db('notices').orderBy('at');
  assert.deepEqual(notices.map(n => [n.to_whom, n.cat, n.text, n.link, json(n.read_by)]), [
    ['12', 'bad', 'LIST-000101 is now Rent Out.', 'listings/101', []],
    ['12', 'good', 'LIST-000100 (Kepong Sentral) dropped from RM 650,000.00 to RM 600,000.00.', 'listings/100', [12]],
    ['11', 'listing', 'Bob is now Co-Product Handler of LIST-000100 (Kepong Sentral).', 'listings/100', []],
  ]);
  assert.deepEqual(report.tables.db_user_notification.kept, { 'its person is not in the staff list': 1, 'its listing is not imported': 1 });
  assert.ok(result.checks.find(c => c.group === 'Notifications').ok);
});

test('a number its column cannot hold is left blank and counted; the old value stays in history', async () => {
  const l = await one('listings', 104);
  assert.deepEqual([l.built_up, l.beds, l.baths], [null, null, 2]);
  assert.deepEqual(report.outOfRange, { 'listings.built_up': 1, 'listings.beds': 1 });
  assert.match(result.markdown, /Numbers the column cannot hold, left blank[\s\S]*`listings.built_up` \| 1/);
  assert.equal(json((await db('legacy_rows').where({ source_table: 'db_property', source_id: '104' }).first()).data).property_room, '40000');
});

test('starred listings and buildings become favourites', async () => {
  const favs = Object.fromEntries((await db('favourites').select()).map(f => [f.viewer_id, { listings: json(f.listings), titles: json(f.titles) }]));
  assert.deepEqual(favs, { 11: { listings: [], titles: [7] }, 12: { listings: [100], titles: [7] } });
  assert.deepEqual(report.tables.db_user_favourite_property.kept, { 'its listing is not imported': 1, 'its person is not in the staff list': 1 });
  assert.ok(result.checks.filter(c => c.group === 'Favourites').every(c => c.ok));
});

test('the website\'s saved listings come across; one on a deleted listing stays in history', async () => {
  assert.deepEqual((await db('saved_listings').select('staff_id', 'listing_id', 'saved_at')).map(r => ({ ...r, saved_at: String(r.saved_at).slice(0, 10) })),
    [{ staff_id: 12, listing_id: 100, saved_at: '2026-03-01' }]);
  assert.match((await db('legacy_rows').where({ source_table: 'db_user_saved_property', source_id: '12:102' }).first()).note, /not imported/);
});

test('the old data\'s loose ends: an undated first-system E-Form, a queried line already paid, a close whose first line is deleted', async () => {
  assert.equal((await one('v1_eforms', 507)).date, null);
  assert.equal(report.tables.db_eforms.notes['no date in the old ERP: listed without one'], 1);
  assert.equal((await one('payout_lines', 896)).status, 'paid');
  assert.equal(report.tables.db_case_list.notes['paid by a cleared salary request while still Pending Queries in the old ERP: imported as paid'], 1);
  assert.equal((await one('closes', 950)).deal_id, 500);
  assert.ok(result.checks.filter(c => c.group === 'Closes and payouts' || c.group === 'E-Forms').every(c => c.ok || c.label === 'E-Forms · submitted · count'));
});

test('mistyped E-Form dates are kept and counted in the report', () => {
  assert.equal(report.tables.db_eforms.notes['its date looks mistyped (before 2015, or after the import): kept as it was'], 1);
});

test('people keep their ids, codes, uplines and branch (the B.M account up their chain)', async () => {
  const branches = Object.fromEntries((await db('branches').select('id', 'name')).map(b => [b.name, b.id]));
  assert.deepEqual(Object.keys(branches).sort(), ['B.M (Kepong) GROUP', 'B.M (Puchong) GROUP', 'Head office']);
  const bob = await one('staff', 12);
  assert.equal(bob.code, 'STAFF-00012');
  assert.equal(bob.upline_id, 11);
  assert.equal(bob.branch_id, branches['B.M (Kepong) GROUP']);
  assert.equal(bob.sex, 'M');
  assert.equal(bob.birthday, '1990-05-05');
  assert.deepEqual(json(bob.access), { agent: true, profilePage: false, profileDoc: false, addListing: true, landlordVerify: false, vendorRequests: false, tripIncentive: false, sinlandBop: false });
  assert.deepEqual(json(bob.docs), { 'NRIC Copy': true, 'Application Form': false, 'Joining Fee Receipt': false });
  assert.deepEqual(json(bob.extra), { smoker: 'No' });
  assert.equal(json(bob.more).rank, 'Agent');
  assert.equal((await one('staff', 11)).bank, 'Maybank');
  assert.equal((await one('staff', 13)).status, 'inactive');   // left (deleted) but still on old records
  const dan = await one('staff', 14);
  assert.equal(dan.upline_id, null);                            // upline 99 does not exist
  assert.equal(dan.branch_id, branches['Head office']);
  assert.equal(dan.status, 'pending');
  assert.equal((await one('staff', 21)).status, 'locked');
  // The staff clock starts on the import day: active accounts were active that day, a pending one's week starts then.
  const today = require('../src/db/days').localToday();
  assert.equal(bob.last_active_on, today);
  assert.equal(json(dan.more).statusOn, today);
  assert.equal(L.staffDue({ status: 'pending', joined: '2020-01-01', statusOn: today }, today), null);
});

test('listings: codes, prices, flags, the people on them and their open E-Form', async () => {
  const l = await one('listings', 100);
  assert.equal(l.code, 'LIST-000100');
  assert.equal(json((await one('titles', 7)).more).managerId, 11);  // the building's Project Manager, where the ERP reads it
  assert.equal(l.type, 'sale');
  assert.equal(l.title, 'Kepong Sentral');
  assert.equal(l.category, 'Condominium');
  assert.equal(l.state, 'Kuala Lumpur');
  assert.equal(Number(l.ask_price), 620000);
  assert.equal(Number(l.best_price), 600000);
  assert.equal(Number(l.market_value), 650000);
  assert.equal(l.tenure, 'Freehold');
  assert.deepEqual(json(l.flags), ['Key On Agent Hand']);
  assert.deepEqual(json(l.portals), ['iProperty']);
  assert.deepEqual(json(l.share), { users: [10, 20], pmId: 11, coPh: [{ staffId: 12, until: '2025-12-31', locked: true, from: '2025-02-01' }] });
  assert.deepEqual(json(l.more).phLog, [{ on: '2025-01-01', staffId: 12, from: 'creator' }, { on: '2025-02-01', staffId: 10, from: 'branchManager' }, { on: '2025-03-01', staffId: 11, from: 'mainPh' }]);
  assert.equal(l.deal_id, 502);
  assert.equal(l.enquiry_count, 2);
  assert.equal((await one('listings', 101)).status, 'rented');
  assert.equal(await one('listings', 102), undefined);          // deleted: history only
  const dup = await one('listings', 103);
  assert.equal(dup.code, 'LIST-000103');                        // repeated code: made from the id
  assert.equal(dup.draft, 1);
  assert.equal((await db('vendor_requests').first()).listing_id, 101);
  const fu = await db('listing_follow_ups').first();
  assert.deepEqual([fu.appt_date, fu.appt_time], ['2025-02-05', '03:30']);
});

test('listing photos join the album at their old address, up to what an album holds; the rest stay in history', async () => {
  const l = await one('listings', 100);
  assert.deepEqual(json(l.photo_set), [
    { id: 1, name: 'a.jpg', published: true, cover: false, url: 'https://storage.subsaleking.com/property-images/100/a.jpg', on: '2026-01-02' },
    { id: 2, name: 'b front.jpg', published: true, cover: true, url: 'https://storage.subsaleking.com/property-images/100/b%20front.jpg', on: '2026-01-03' },
  ]);
  assert.deepEqual([l.photo_count, l.photos_on], [2, '2026-01-03']);
  const many = json((await one('listings', 101)).photo_set);
  assert.equal(many.length, 20);
  assert.ok(!many.some(p => p.id === 10), 'the oldest of the 21 stays in history');
  assert.equal(many.filter(p => p.cover).length, 1);
  const fate = async id => (await db('legacy_rows').where({ source_table: 'db_property_images', source_id: String(id) }).first());
  assert.equal((await fate(2)).target_table, 'listings');
  assert.match((await fate(10)).note, /more than 20 photos/);
  assert.match((await fate(3)).note, /deleted/);
});

test('E-Forms keep the old money exactly, their parties, documents and checks', async () => {
  const d = await one('deals', 500);
  assert.equal(d.code, '2025-06-SALE-00500');
  assert.deepEqual([d.status, d.type, d.agent_id, d.holder_id], ['closed', 'sale', 12, 11]);
  assert.deepEqual([d.billed, d.sst, d.fee_ex_sst, d.net, d.sst_pct, d.sst_mode].map(v => (typeof v === 'string' ? v : Number(v))), [10800, 800, 10000, 10000, 8, 'included']);
  assert.equal(d.closed_on, '2025-06-15');
  assert.equal(d.lv_status, 1);
  assert.equal(d.lv_archive_id, 40);
  assert.deepEqual(json(d.other_owners), [{ name: 'Co Owner', ic: '700101-01-0001', phone: '' }]);
  assert.equal(json(d.docs)['Letter of offer'], true);
  assert.equal(json(d.files)['Letter of offer'], 'docs/500-loc.pdf');
  const rental = await one('deals', 501);
  assert.deepEqual([rental.sst_pct, Number(rental.net)], [0, 2000]);
  assert.equal(json(rental.rental).taFee, 400);
  // The agent on 502 is gone from the staff list: an "Unknown" record keeps the E-Form.
  const ghost = await one('staff', (await one('deals', 502)).agent_id);
  assert.equal(ghost.name, 'Unknown (old staff 777)');
  assert.equal(report.placeholders, 1);
  assert.equal((await db('v1_eforms').first()).code, '2019-03-SALE-00504');
  assert.equal((await db('audit_log').where({ entity: 'deal', entity_id: '500' })).length, 1);
});

test('money in, closes, payout lines, salary requests and request forms', async () => {
  assert.deepEqual((await db('money_in').orderBy('id')).map(t => [t.code, t.status, Number(t.amount), t.purpose]),
    [['TRAN#00001', 'cleared', 5000, 'deposit'], ['TRAN#00002', 'cleared', 5800, 'commission'], ['TRAN#00006', 'pending', 2000, 'rental']]);
  const close = await one('closes', 900);
  assert.deepEqual([Number(close.claim), Number(close.net), Number(close.sst), close.full, close.part_no], [10800, 10000, 800, 1, 1]);
  assert.deepEqual(json(close.sides).map(s => [s.side, s.staffId]), [['sales', 12], ['listing', 11]]);
  const p = await one('payout_lines', 900);
  assert.deepEqual([p.code, p.status, p.request_id, p.archive_id, p.paid_on, p.time], ['CASE-000900', 'paid', 60, 40, '2025-06-25', '10:05']);
  assert.deepEqual([(await one('payout_lines', 902)).role, (await one('payout_lines', 903)).status], ['TL', 'queried']);
  assert.equal((await one('archives', 40)).count, 3);
  assert.equal((await one('pay_requests', 60)).code, 'SAL-2025-06-00060');
  const out = await db('money_out').orderBy('id');
  assert.deepEqual(out.map(m => [m.voucher_no, m.type, Number(m.amount), m.status]), [['REQ-000070', 'balance', 1000, 'paid'], ['REQ-000072', 'refund', 500, 'queried']]);
  assert.equal(out[0].payee_bank, 'Maybank');
  assert.equal(out[1].query, 'Missing slip');
  const v1 = await db('v1_overrides').first();
  assert.deepEqual([v1.staff_id, v1.year, Number(v1.override), Number(v1.sales)], [11, 2019, 300, 400000]);
});

test('the report shows counts only, never anyone\'s details', () => {
  for (const secret of ['Bob Tan', 'Alice', '900505', '012-345', 'Buyer X', 'Owner One', 'Lead One', 'Bought Contact', '660606', 'Missing slip']) {
    assert.ok(!result.markdown.includes(secret), secret);
  }
  assert.match(result.markdown, /`db_name_1`: a bought-in contact list/);
  assert.match(result.markdown, /Tables the import does not know.*`some_new_table`/);
});

test('new codes continue after the highest old number, deleted and first-system rows included', async () => {
  const c = Object.fromEntries((await db('counters').select()).map(r => [r.key, Number(r.value)]));
  // case 905 is a first-system line (not imported), 72 a request form; 777 the "Unknown" stand-in.
  assert.deepEqual([c.staff, c.listing, c.transaction, c.case, c.salary, c.archive, c.request], [777, 104, 6, 905, 60, 40, 72]);
});

test('importing again needs --replace, and replaces instead of adding; sign-in accounts keep their person', async () => {
  await assert.rejects(importLegacy({ legacy, db }), /already has .* records/);
  await db('users').insert({ username: 'bob', name: 'Bob', role: 'staff', staff_id: 12, password_hash: 'x' });
  const again = await importLegacy({ legacy, db, replace: true });
  assert.equal((await db('users').where('username', 'bob').first()).staff_id, 12, 'the account is linked to Bob again');
  assert.equal(again.accountsUnlinked, 0);
  assert.equal(Number((await db('deals').count({ n: '*' }).first()).n), 3);
  assert.equal(Number((await db('legacy_rows').where('source_table', 'db_property').count({ n: '*' }).first()).n), 5);
  assert.equal(Number((await db('notices').count({ n: '*' }).first()).n), 3);
});

test('it refuses to replace records made in the new system', async () => {
  await db('deals').insert({ id: 9999, code: 'NEW-1', type: 'sale', branch_id: (await db('branches').first()).id, date: '2026-11-01', agent_id: 12 });
  await assert.rejects(importLegacy({ legacy, db, replace: true }), /did not come from the old ERP \(1 deals\)/);
  await db('deals').where('id', 9999).del();
});

test('a copy missing a column the import reads stops before anything is written', async () => {
  await legacy.schema.alterTable('db_trans', t => { t.dropColumn('tran_purpose'); });
  const before = Number((await db('legacy_rows').count({ n: '*' }).first()).n);
  await assert.rejects(importLegacy({ legacy, db, replace: true }), /db_trans\.tran_purpose/);
  assert.equal(Number((await db('legacy_rows').count({ n: '*' }).first()).n), before);
});

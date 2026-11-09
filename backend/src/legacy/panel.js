// What only the client's /panel keeps about its people (www.subsaleking.com/panel, its own PostgreSQL,
// old-subsaleking-next): bio, social links, awards, LPPEH registration and the feature switches (agent
// profile page, profile document, trip incentive…). The panel's staff carry the old ERP's ids, as the new
// staff records do, so each lands on its person. Run after `legacy:import` (and again after a re-import):
//
//   PANEL_DB_URL=postgres://readonly:…@host:5432/subsaleking npm run legacy:panel [-- --dry-run]
//
// The panel's value wins where it has one; a blank there leaves the new record as it is. Profile photos
// stay on the panel's own storage (counted in the report) until they are copied.
const SOCIAL = { Facebook: 'facebook', Instagram: 'instagram', TikTok: 'tiktok', Twitter: 'twitter', Xiaohongshu: 'xiaohongshu', Lemon8: 'lemon8', LinkedIn: 'linkedin' };
const SWITCH = { AgentFeatures: 'agent', AgentProfilePage: 'profilePage', AgentProfileDocumentGeneration: 'profileDoc', ListingsCreation: 'addListing',
  LandlordVerification: 'landlordVerify', VendorRequests: 'vendorRequests', TripIncentiveListings: 'tripIncentive' };
const REGISTRATION = new Set(['REN', 'REA', 'PEA']);

const json = v => (v == null ? {} : typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return {}; } })() : v);
const text = v => (v == null ? '' : String(v).trim());
const day = v => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

// The panel's two tables, as they are (Npgsql's names, quoted).
async function readPanel(pg) {
  const staff = (await pg.query('select "ID", "Bio", "SocialLinks", "AgentCertification", "AgentCertificationNumber", "FeatureFlags", "AvatarMediaUID" from "Staff" where "DeletedAt" is null')).rows;
  const awards = (await pg.query('select "StaffID", "AwardName", "AwardingOrganization", "DateReceived", "AwardDescription", "SortOrder" from "StaffAward" where "DeletedAt" is null order by "StaffID", "SortOrder", "ID"')).rows;
  return { staff, awards };
}

// One panel person → the new record's fields (only those the panel has).
function fromPanel(p, awards = []) {
  const out = {};
  if (text(p.Bio)) out.bio = text(p.Bio).slice(0, 4000);
  const socials = Object.fromEntries(Object.entries(json(p.SocialLinks)).map(([k, v]) => [SOCIAL[k], text(v)]).filter(([k, v]) => k && v));
  if (Object.keys(socials).length) out.socials = socials;
  const reg = text(p.AgentCertification).toUpperCase();
  if (REGISTRATION.has(reg) && text(p.AgentCertificationNumber)) Object.assign(out, { regType: reg, regNo: text(p.AgentCertificationNumber).slice(0, 40) });
  const flags = json(p.FeatureFlags);
  const access = Object.fromEntries(Object.entries(SWITCH).filter(([k]) => typeof flags[k] === 'boolean').map(([k, a]) => [a, flags[k]]));
  if (Object.keys(access).length) out.access = access;
  if (awards.length) out.awards = awards.map(a => ({ name: text(a.AwardName), org: text(a.AwardingOrganization), date: day(a.DateReceived), ...(text(a.AwardDescription) && { description: text(a.AwardDescription) }) })).filter(a => a.name);
  return out;
}

// Writes them onto the new staff records (same ids). Returns counts for the report.
async function applyPanel(db, { staff, awards }, { dryRun = false } = {}) {
  const byStaff = new Map();
  for (const a of awards) { const id = Number(a.StaffID); if (!byStaff.has(id)) byStaff.set(id, []); byStaff.get(id).push(a); }
  const report = { panel: staff.length, matched: 0, notFound: 0, bios: 0, socials: 0, registrations: 0, switches: 0, awards: 0, photosLeft: 0 };
  for (const p of staff) {
    const id = Number(p.ID);
    const row = await db('staff').where('id', id).first('id', 'access', 'socials');
    if (!row) { report.notFound++; continue; }
    report.matched++;
    if (text(p.AvatarMediaUID)) report.photosLeft++;
    const f = fromPanel(p, byStaff.get(id) || []);
    const set = {};
    if (f.bio) { set.bio = f.bio; report.bios++; }
    if (f.socials) { set.socials = JSON.stringify({ ...json(row.socials), ...f.socials }); report.socials++; }
    if (f.regNo) { Object.assign(set, { reg_type: f.regType, reg_no: f.regNo }); report.registrations++; }
    if (f.access) { set.access = JSON.stringify({ ...json(row.access), ...f.access }); report.switches++; }
    if (f.awards?.length) { set.awards = JSON.stringify(f.awards); report.awards += f.awards.length; }
    if (Object.keys(set).length && !dryRun) await db('staff').where('id', id).update(set);
  }
  return report;
}

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
  const { Client } = require('pg');
  const db = require('../db/connection');
  if (!process.env.PANEL_DB_URL) { console.error('Set PANEL_DB_URL to the /panel\'s PostgreSQL (a read-only account).'); process.exit(1); }
  const pg = new Client({ connectionString: process.env.PANEL_DB_URL });
  (async () => {
    await pg.connect();
    const r = await applyPanel(db, await readPanel(pg), { dryRun: process.argv.includes('--dry-run') });
    console.log(r);
    await pg.end();
    await db.destroy();
  })().catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { readPanel, fromPanel, applyPanel };

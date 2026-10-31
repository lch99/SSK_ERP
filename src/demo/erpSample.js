// Made-up ERP records for the demo: staff (with uplines and tiers), listings,
// customers, deals, money in, payout lines, pay runs and money out, all linked.
// Built from the current Setup, so the ERP pays by the rules the user just set
// (branches, tiers, uplines, totals, approvals, numbering). Seeded, so the same
// Setup gives the same records; dates count back from the day it is built.
// Every payout goes through shared/payout.js, never through maths of its own.
import * as P from '../../shared/payout.js'
import * as A from '../../shared/agents.js'
import { addListingLife } from './listingSample.js'

export const ERP_VERSION = 10
const SEED = 20261021
const r2 = n => Math.round(n * 100) / 100

// ── Random, but repeatable ───────────────────────────────────────────────────
function makeRng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1))
  const pick = arr => arr[Math.floor(next() * arr.length)]
  const chance = p => next() < p
  const weighted = (items, weight) => {
    const total = items.reduce((s, x) => s + weight(x), 0)
    let r = next() * total
    for (const x of items) { r -= weight(x); if (r <= 0) return x }
    return items[items.length - 1]
  }
  const digits = n => Array.from({ length: n }, () => int(0, 9)).join('')
  return { next, int, pick, chance, weighted, digits }
}

// ── Dates are 'YYYY-MM-DD' strings ───────────────────────────────────────────
const toDate = s => new Date(`${s}T00:00:00Z`)
const isoOf = d => d.toISOString().slice(0, 10)
export const addDays = (s, n) => isoOf(new Date(toDate(s).getTime() + n * 86400000))
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000)
export function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const maxDate = (a, b) => (a > b ? a : b)

// The first pay day after `after`, from Setup → Approvals and paying agents.
// payDay is 1 (Monday) … 7 (Sunday) for weekly runs, a date for monthly ones.
export function nextPayDate(approvals, after) {
  let d = addDays(after, 1)
  for (let i = 0; i < 400; i++, d = addDays(d, 1)) {
    const dt = toDate(d), wd = dt.getUTCDay(), dom = dt.getUTCDate()
    switch (approvals?.payRun) {
      case 'weekly': if (wd === Number(approvals.payDay) % 7) return d; break
      case 'twice': if (dom === 1 || dom === 15) return d; break
      case 'monthly': if (dom === Number(approvals.payDay)) return d; break
      default: if (wd !== 0 && wd !== 6) return d   // any day: the next working day
    }
  }
  return addDays(after, 1)
}

// Who signs off a deal's payout, from Setup → Approvals.
export function payoutApprovers(setup, branchId, paidOut) {
  const manager = setup.branches.find(b => b.id === branchId)?.manager || 'Branch manager'
  const boss = setup.company.reaName || 'Director'
  const a = setup.approvals || {}
  if (a.dealApprover === 'boss') return [boss]
  if (a.dealApprover === 'both') return [manager, boss]
  const limit = a.bossAbove === '' || a.bossAbove == null ? null : Number(a.bossAbove)
  return limit != null && paidOut > limit ? [manager, boss] : [manager]
}

// What the ERP needs from Setup before it can run.
export function erpBlockers(setup) {
  const out = []
  if (!setup?.branches?.length) out.push('Add at least one branch.')
  if (!setup?.tiers?.length) out.push('Set up the tiers.')
  if (!P.DEAL_TYPES.some(dt => setup?.dealTypes?.[dt]?.enabled)) out.push('Turn on at least one deal type.')
  return out
}

// Changes to these parts of Setup rebuild the sample records.
export function setupSignature(s) {
  const json = JSON.stringify([s.branches, s.tiers, s.branchTiers, s.roles, s.splits, s.totals, s.dealTypes, s.numbering, s.approvals, s.agents,
    s.company?.reaName, s.bankAccounts?.map(a => a.id), s.sideSharePct, s.ruleHistory])
  let h = 5381
  for (let i = 0; i < json.length; i++) h = (Math.imul(h, 33) + json.charCodeAt(i)) >>> 0
  return `${ERP_VERSION}-${h.toString(36)}`
}

// ── Pools for names and places (all made up) ─────────────────────────────────
const CN_SURNAMES = ['Tan', 'Lim', 'Lee', 'Wong', 'Ng', 'Chan', 'Ong', 'Teh', 'Goh', 'Chong', 'Yap', 'Lau', 'Khoo', 'Chua', 'Low', 'Foo', 'Soh', 'Leong', 'Choo', 'Kang']
const CN_GIVEN = ['Wei Ming', 'Mei Ling', 'Jia Hui', 'Kok Wai', 'Siew Lan', 'Chee Keong', 'Hui Min', 'Zhi Hao', 'Yee Ling', 'Kah Seng', 'Pei Shan',
  'Wai Kit', 'Xin Yi', 'Boon Hock', 'Li Ting', 'Jun Wei', 'Shu Fen', 'Chin Yong', 'Ka Yan', 'Yong Sheng', 'Sze Ching', 'Kian Hong']
const CN_FEMALE = new Set(['Mei Ling', 'Jia Hui', 'Siew Lan', 'Hui Min', 'Yee Ling', 'Pei Shan', 'Xin Yi', 'Li Ting', 'Shu Fen', 'Ka Yan', 'Sze Ching'])
const EN_MALE = ['Jason', 'Alan', 'Kelvin', 'Ken', 'Eric', 'Marcus', 'Daniel', 'Ivan', 'Leon', 'Vincent']
const EN_FEMALE = ['Vivian', 'Michelle', 'Jessie', 'Joanne', 'Grace', 'Cheryl', 'Elaine', 'Karen', 'Fiona', 'Rachel']
const MY_MALE = ['Ahmad Faiz', 'Muhammad Hafiz', 'Amirul Hakim', 'Khairul Anuar', 'Haziq', 'Aiman', 'Firdaus', 'Izzat', 'Syahmi', 'Azlan']
const MY_FEMALE = ['Nur Aisyah', 'Siti Aminah', 'Farah Nadia', 'Hafizah', 'Syafiqah', 'Norazlina', 'Nurul Huda', 'Aina Sofea', 'Liyana', 'Balqis']
const MY_FATHER = ['Rahman', 'Ismail', 'Hassan', 'Abdullah', 'Yusof', 'Ibrahim', 'Osman', 'Zainal', 'Rashid', 'Kamal']
const IN_MALE = ['Suresh', 'Arjun', 'Ganesh', 'Vinod', 'Ravi', 'Prakash', 'Dinesh', 'Kumaran']
const IN_FEMALE = ['Priya', 'Kavitha', 'Deepa', 'Shalini', 'Thilaga', 'Revathi', 'Malini', 'Anitha']
const IN_FATHER = ['Muthu', 'Raman', 'Krishnan', 'Subramaniam', 'Gopal', 'Nathan', 'Selvam', 'Arumugam']

const BANKS = ['Maybank', 'CIMB Bank', 'Public Bank', 'RHB Bank', 'Hong Leong Bank', 'AmBank', 'Bank Islam', 'UOB Malaysia', 'OCBC Bank', 'Alliance Bank']

// Each branch gets one cluster of nearby areas (matched by name where possible).
const CLUSTERS = [
  { match: /desa|klang|petaling|seputeh|bangsar/i, city: 'Kuala Lumpur', state: 'Kuala Lumpur', postcode: '58100',
    areas: ['Taman Desa', 'Old Klang Road', 'Sri Petaling', 'Bangsar South', 'Seputeh', 'Taman OUG'] },
  { match: /cheras|connaught|balakong/i, city: 'Kuala Lumpur', state: 'Kuala Lumpur', postcode: '56000',
    areas: ['Cheras', 'Taman Connaught', 'Bandar Tun Hussein Onn', 'Taman Midah', 'Cheras Perdana', 'Taman Segar'] },
  { match: /puchong|kinrara/i, city: 'Puchong', state: 'Selangor', postcode: '47100',
    areas: ['Bandar Puteri Puchong', 'Puchong Jaya', 'Bandar Kinrara', 'Taman Wawasan', 'Puchong Prima', 'Puchong Utama'] },
  { match: /\bpj\b|petaling jaya|damansara|kelana/i, city: 'Petaling Jaya', state: 'Selangor', postcode: '47301',
    areas: ['Damansara Utama', 'Kelana Jaya', 'SS2', 'Ara Damansara', 'Taman Tun Dr Ismail', 'Damansara Jaya'] },
  { match: /subang|usj|shah alam|setia/i, city: 'Subang Jaya', state: 'Selangor', postcode: '47500',
    areas: ['Subang Jaya', 'USJ', 'Shah Alam', 'Setia Alam', 'Kota Kemuning', 'Bandar Sunway'] },
  { match: /kiara|hartamas|kepong|setapak|wangsa/i, city: 'Kuala Lumpur', state: 'Kuala Lumpur', postcode: '50480',
    areas: ['Mont Kiara', 'Sri Hartamas', 'Kepong', 'Segambut', 'Setapak', 'Wangsa Maju'] },
]

// Prices in RM thousands for sale, RM for monthly rent.
export const CATEGORIES = {
  'Condominium':           { kind: 'high', w: 24, sale: [380, 950], rent: [1800, 4500], sqft: [850, 1500], beds: [2, 4] },
  'Serviced Residence':    { kind: 'high', w: 15, sale: [350, 800], rent: [1600, 3800], sqft: [550, 1100], beds: [1, 3] },
  'Apartment':             { kind: 'high', w: 12, sale: [220, 420], rent: [1100, 1900], sqft: [700, 1000], beds: [3, 3] },
  'Flat':                  { kind: 'high', w: 5, sale: [150, 260], rent: [900, 1300], sqft: [550, 700], beds: [2, 3] },
  'Single Storey Terrace': { kind: 'land', w: 6, sale: [380, 620], rent: [1300, 2000], sqft: [900, 1300], beds: [3, 3] },
  'Double Storey Terrace': { kind: 'land', w: 18, sale: [550, 1150], rent: [1800, 3500], sqft: [1500, 2400], beds: [4, 5] },
  'Townhouse':             { kind: 'land', w: 5, sale: [450, 780], rent: [1600, 2600], sqft: [1100, 1600], beds: [3, 4] },
  'Semi-D':                { kind: 'land', w: 6, sale: [1200, 2400], rent: [4000, 7000], sqft: [2600, 3800], beds: [4, 6] },
  'Bungalow':              { kind: 'land', w: 2, sale: [2200, 4500], rent: [6500, 12000], sqft: [4000, 6500], beds: [5, 7] },
  'Shop Office':           { kind: 'shop', w: 5, sale: [900, 2200], rent: [3500, 8000], sqft: [1500, 4500], beds: [0, 0] },
}
const BLD_A = ['Residensi', 'Pangsapuri', 'Vista', 'Mutiara', 'Suria', 'The']
const BLD_B = ['Permai', 'Harmoni', 'Damai', 'Indah', 'Bayu', 'Seri', 'Murni', 'Cempaka', 'Kenanga', 'Delima', 'Angsana', 'Sentosa']
const BLD_C = ['Residences', 'Heights', 'Court', 'Park', 'Condominium', 'Villa']
const AGENCIES = [
  ['Bayu Prime Realty', 'E (1) 1532'], ['Kenanga Homes Agency', 'E (3) 0871'], ['Lumina Estate Consultants', 'E (1) 1907'],
  ['Sentosa Property Partners', 'E (2) 0644'], ['Tiara Realty', 'E (1) 1288'],
]
const DEVELOPERS = ['Bayu Development Sdn Bhd', 'Seri Kenanga Land Sdn Bhd', 'Harmoni Properties Bhd']
const PROJECT_NAMES = ['Residensi Sentral', 'The Arc Residences', 'Laman Seri', 'Vista Kinara', 'Taman Damai Hills']
// Listing settings and follow-up actions, as the current ERP names them.
export const LISTING_SETTINGS = ['Key On Agent Hand', 'Exclusive', 'Vacant', 'Need Follow-Up', 'Process Deal', 'Process L&L', 'Owner Occupied', 'Tenanted', 'On Hold', 'Friendly Tenant']
const FLAGS = LISTING_SETTINGS.filter(f => f !== 'Process Deal')
export const FOLLOW_UP_ACTIONS = { 0: 'Call For Followup', 1: 'Viewing', 2: 'Call For Nego', 3: 'Closing', '-1': 'Never Followup' }
const LAW_FIRMS = ['Messrs. Tan, Rahman & Co.', 'Messrs. Lee & Partners', 'Messrs. Aziz Kumar & Associates']
const PORTALS = ['iProperty', 'PropertyGuru', 'Mudah.my', 'SubSaleKing']
const LEAD_SOURCES = ['iProperty', 'Mudah.my', 'Banner', 'Intro', 'others']
const QUERIES = ['SPA stamping receipt not uploaded yet.', 'Co-broke letter is missing.', 'Buyer IC copy is unclear, please re-upload.',
  'Listing holder changed last month, please confirm who gets the listing side.', 'Please confirm the referral fee with the branch manager.']
const CANCEL_REASONS = ["Buyer's loan was rejected.", 'Vendor withdrew from the sale.', 'Tenant withdrew before signing.', 'Buyer could not complete the SPA in time.']

// The documents an E-Form needs before its case can close (Supporting Document Attachments).
export function docNames(type, coBroke) {
  return type === 'sale'
    ? ['Letter of offer', 'Appointment letter', 'Receipts', 'SPA', 'Buyer IC', 'Vendor IC', ...(coBroke ? ['Co-broke letter'] : [])]
    : type === 'rental'
      ? ['Letter of offer', 'Appointment letter', 'Receipt', 'Tenancy agreement', 'Tenant IC', 'Landlord IC', ...(coBroke ? ['Co-broke letter'] : [])]
      : ['Booking form', 'SPA', 'Buyer IC', 'Developer claim letter']
}
// Optional extra documents (the old form's "more documents" tick box).
export const MORE_DOCS = { sale: ['Loan document 1', 'Loan document 2', 'Loan document 3', 'Vendor document 1', 'Vendor document 2', 'Vendor document 3'], rental: ['SMP file'], project: [] }

// Staff access switches, as the client's new HR form names them.
export const ACCESS = {
  agent: 'Enable Agent Features', profilePage: 'Enable Agent Profile Page', profileDoc: 'Enable Agent Profile Document Generation Features',
  addListing: 'Enable Add Listing Features', landlordVerify: 'Enable Landlord Verification Features', vendorRequests: 'Enable Vendor Requests/Listings Features',
  tripIncentive: 'Enable Trip Incentive Listings Features',
}

// One close's payout: the commission `net` is split into the deal's sides, and
// each side's earner is paid at the tier their commission has reached so far
// (creditOf(id) → { lifetime, yearly }), with their uplines and the company's
// share. Used for the sample history and for closing a deal in the demo.
// The rules are the ones in force on the E-Form's date (P.rulesAt); `on` is the
// close date, for whether an agent had left by then.
export function payoutForClose(current, staffById, deal, net, creditOf, on = localToday()) {
  const setup = P.rulesAt(current, deal.date)
  const roles = setup.roles || []
  const all = P.dealSides(deal, setup.sideSharePct)
  const sides = [], lines = []
  let given = 0
  all.forEach((side, i) => {
    const base = i === all.length - 1 ? r2(net - given) : r2(net * side.pct / 100)
    given = r2(given + base)
    // A retracted side's portion goes back to the company; the other side is not topped up.
    if (P.sideRetracted(side, staffById, on)) {
      sides.push({ side: side.side, staffId: side.staffId, sharePct: side.pct, base, retracted: true, tierId: null, agentRate: null, totalPct: null, company: base })
      return
    }
    const earner = staffById[side.staffId]
    const tiers = P.tiersFor(setup, earner.branchId)
    const floor = Math.max(0, tiers.findIndex(t => t.id === earner.tierFloorId))
    const credit = creditOf(earner.id)
    const tier = tiers[P.computeTierIndex(credit.lifetime, credit.yearly, tiers, floor)]
    const total = P.resolveTotal(setup.totals, { branchId: earner.branchId, dealType: deal.type, tierId: tier.id })
    const holders = P.uplineHolders(staffById, earner.id, roles)
    const out = P.payoutLines({ amount: base, earnerId: earner.id, agentRate: tier.agentRate, totalPct: total?.pct, holders, splits: setup.splits, roles })
    sides.push({ side: side.side, staffId: earner.id, sharePct: side.pct, base, tierId: tier.id, agentRate: tier.agentRate,
      totalPct: total?.pct ?? null, company: out.company })
    for (const l of out.lines) lines.push({ ...l, side: side.side, base, tierId: l.role ? null : tier.id })
  })
  return { sides, lines }
}

// ── Builder ──────────────────────────────────────────────────────────────────

export function makeErpSample(setup, asOf = localToday()) {
  const R = makeRng(SEED)
  const enabled = P.DEAL_TYPES.filter(dt => setup.dealTypes?.[dt]?.enabled)
  const roles = setup.roles || []
  const levels = [...roles].reverse()            // most senior first
  const domain = (setup.company?.email || '').split('@')[1] || 'example.com'
  const start = maxDate('2000-01-01', [addDays(asOf, -300), `${asOf.slice(0, 4)}-01-01`].sort()[0])
  let nextId = 1
  const id = () => nextId++

  // People's names, never used twice.
  const used = new Set()
  function person() {
    for (let tries = 0; tries < 50; tries++) {
      const roll = R.next()
      let p
      if (roll < 0.5) {
        const surname = R.pick(CN_SURNAMES), given = R.pick(CN_GIVEN), female = CN_FEMALE.has(given)
        const en = R.chance(0.6) ? R.pick(female ? EN_FEMALE : EN_MALE) : null
        p = { name: `${surname} ${given}`, short: en ? `${en} ${surname}` : `${surname} ${given}`, alt: `${surname} ${given}`, sex: female ? 'F' : 'M' }
      } else if (roll < 0.8) {
        const female = R.chance(0.5), given = R.pick(female ? MY_FEMALE : MY_MALE), father = R.pick(MY_FATHER)
        p = { name: `${given} ${female ? 'binti' : 'bin'} ${father}`, short: given, alt: `${given} ${father}`, sex: female ? 'F' : 'M' }
      } else {
        const female = R.chance(0.5), given = R.pick(female ? IN_FEMALE : IN_MALE), father = R.pick(IN_FATHER)
        p = { name: `${given} ${female ? 'a/p' : 'a/l'} ${father}`, short: given, alt: `${given} ${father}`, sex: female ? 'F' : 'M' }
      }
      if (!used.has(p.name)) { used.add(p.name); return p }
    }
    return { name: `Client ${used.size + 1}`, short: `Client ${used.size + 1}`, sex: 'M' }
  }
  const phone = () => `01${R.pick(['2', '3', '6', '7', '9'])}-${R.digits(3)} ${R.digits(4)}`
  const icNo = born => `${born.slice(2, 4)}${born.slice(5, 7)}${born.slice(8, 10)}-${R.pick(['10', '14', '08', '07', '01'])}-${R.digits(4)}`
  const bankAcc = () => ({ bank: R.pick(BANKS), account: `${R.digits(4)} ${R.digits(4)} ${R.digits(4)}` })
  const client = () => {
    const p = person()
    const born = `${R.int(1960, 1998)}-${String(R.int(1, 12)).padStart(2, '0')}-${String(R.int(1, 28)).padStart(2, '0')}`
    return { name: p.name, ic: icNo(born), phone: phone() }
  }

  // Branch → its cluster of areas.
  const taken = new Set()
  const clusterOf = {}
  for (const b of setup.branches) {
    let i = CLUSTERS.findIndex((c, k) => !taken.has(k) && c.match.test(`${b.name} ${b.address || ''}`))
    if (i < 0) i = CLUSTERS.findIndex((_, k) => !taken.has(k))
    if (i < 0) i = b.id % CLUSTERS.length
    taken.add(i)
    clusterOf[b.id] = CLUSTERS[i]
  }

  // ── Staff: a tree per branch, most senior upline at the top ──
  const staff = []
  const shorts = new Set()
  function addStaff(branch, role, uplineId, depth, fixedName) {
    const tiers = P.tiersFor(setup, branch.id)
    const n = tiers.length
    const lifeIdx = tiers.map((t, i) => (t.basis === 'lifetime' ? i : -1)).filter(i => i >= 0)
    const topLife = lifeIdx[lifeIdx.length - 1] ?? 0
    // Leaders sit near the top of the ladder, negotiators near the bottom.
    const target = role
      ? Math.max(Math.min(1, n - 1), Math.min(n - 1, n - 1 - depth - R.int(0, 1)))
      : R.weighted([0, 1, 2, 3].filter(i => i <= Math.min(topLife, 3)), i => [5, 4, 2, 1][i])
    let opening, floor = 0
    if (tiers[target].basis === 'lifetime') {
      const lo = Number(tiers[target].threshold)
      const nextLife = lifeIdx.find(i => i > target)
      const hi = nextLife != null ? Number(tiers[nextLife].threshold) : lo + 60000
      opening = Math.round((lo + (hi - lo) * R.next() * 0.8) / 100) * 100
    } else {
      opening = Number(tiers[topLife].threshold) + R.int(40, 400) * 1000
      floor = target
    }
    const p = fixedName ? { name: fixedName, short: fixedName, sex: R.chance(0.5) ? 'F' : 'M' } : person()
    used.add(p.name)
    // Staff go by their short name, so no two may share one.
    if (shorts.has(p.short)) p.short = p.alt && !shorts.has(p.alt) ? p.alt : p.name
    shorts.add(p.short)
    const born = `${R.int(role ? 1970 : 1985, role ? 1988 : 2002)}-${String(R.int(1, 12)).padStart(2, '0')}-${String(R.int(1, 28)).padStart(2, '0')}`
    const joined = addDays(start, -(role ? R.int(4 * 365, 12 * 365) : R.int(60, 6 * 365)))
    const first = p.short.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '')
    const s = {
      id: id(), code: '', name: p.name, short: p.short, sex: p.sex, ic: icNo(born), phone: phone(),
      email: `${first}.${staff.length + 1}@${domain}`, branchId: branch.id, role, uplineId, depth,
      status: 'active', joined, leftOn: null, renNo: `REN ${R.int(10000, 59999)}`, ...bankAcc(),
      openingLifetime: opening, tierFloorId: floor ? tiers[floor].id : null, whtExempt: R.chance(0.1),
      username: `${first}${R.int(10, 99)}`, type: 'staff', birthday: born, language: R.pick(['English', 'Malay', 'Chinese', 'Indian']),
      education: R.pick(['SPM', 'STPM', 'Diploma', 'Degree', 'Degree', 'Master']),
      address: `${R.int(1, 60)}, Jalan ${R.pick(['Mawar', 'Melati', 'Kenanga', 'Cempaka', 'Seroja'])} ${R.int(1, 9)}, ${R.pick(clusterOf[branch.id].areas)}`,
    }
    staff.push(s)
    return s
  }
  // Agents imported in Setup: the ERP runs on those people. What the list left
  // out (IC, phone, bank…) is made up; no joined date means they were already
  // there when the sample's history starts.
  const imported = setup.agents || []
  const staffId = new Map(imported.map(a => [a.id, id()]))
  for (const a of imported) {
    const tiers = P.tiersFor(setup, a.branchId)
    const floor = Math.max(0, tiers.findIndex(t => t.id === a.tierId))
    const opening = A.openingLifetime(a, tiers)
    const ic = String(a.ic || '').replace(/\D/g, '')
    const yy = Number(ic.slice(0, 2)), mm = Number(ic.slice(2, 4)), dd = Number(ic.slice(4, 6))
    const born = ic.length >= 6 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 28
      ? `${yy > Number(asOf.slice(2, 4)) ? 19 : 20}${ic.slice(0, 2)}-${ic.slice(2, 4)}-${ic.slice(4, 6)}`
      : `${R.int(1975, 2000)}-${String(R.int(1, 12)).padStart(2, '0')}-${String(R.int(1, 28)).padStart(2, '0')}`
    let short = a.name
    for (let n = 2; shorts.has(short); n++) short = `${a.name} ${n}`
    shorts.add(short)
    used.add(a.name)
    let depth = 0
    for (let up = imported.find(x => x.id === a.uplineId); up && depth < 20; up = imported.find(x => x.id === up.uplineId)) depth++
    const first = short.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '') || 'agent'
    const branch = setup.branches.find(b => b.id === a.branchId)
    staff.push({
      id: staffId.get(a.id), code: '', name: a.name, short, sex: ic.length >= 12 ? (Number(ic.slice(-1)) % 2 ? 'M' : 'F') : R.chance(0.5) ? 'F' : 'M',
      ic: a.ic || icNo(born), phone: a.phone || phone(), email: a.email || `${first}.${staff.length + 1}@${domain}`,
      branchId: a.branchId, role: a.position || null, uplineId: staffId.get(a.uplineId) ?? null, depth,
      status: 'active', joined: a.joined || addDays(start, -R.int(60, 6 * 365)), leftOn: null, renNo: a.renNo || `REN ${R.int(10000, 59999)}`,
      ...(a.bank || a.accountNo ? { bank: a.bank || R.pick(BANKS), account: a.accountNo || `${R.digits(4)} ${R.digits(4)} ${R.digits(4)}` } : bankAcc()),
      openingLifetime: opening, tierFloorId: floor ? tiers[floor].id : null, whtExempt: false,
      username: `${first}${R.int(10, 99)}`, type: 'staff', birthday: born, language: R.pick(['English', 'Malay', 'Chinese', 'Indian']),
      education: R.pick(['SPM', 'STPM', 'Diploma', 'Degree', 'Degree', 'Master']),
      address: `${R.int(1, 60)}, Jalan ${R.pick(['Mawar', 'Melati', 'Kenanga', 'Cempaka', 'Seroja'])} ${R.int(1, 9)}, ${R.pick(clusterOf[branch.id].areas)}`,
    })
  }
  for (const b of imported.length ? [] : setup.branches) {
    if (!levels.length) {
      const size = R.int(5, 7)
      for (let i = 0; i < size; i++) addStaff(b, null, null, 0, i === 0 ? b.manager : null)
      continue
    }
    const grow = (lvl, upline) => {
      const p = addStaff(b, levels[lvl].code, upline?.id ?? null, lvl, lvl === 0 && !upline ? b.manager : null)
      const last = lvl === levels.length - 1
      const leaders = last ? 0 : 1
      for (let i = 0; i < leaders; i++) grow(lvl + 1, p)
      const members = last ? R.int(2, 3) : R.int(0, 1)
      for (let i = 0; i < members; i++) addStaff(b, null, p.id, levels.length)
    }
    for (let i = 0; i < (levels.length === 1 ? 2 : 1); i++) grow(0, null)
  }
  // A few people who left, and a few who have just joined (made-up staff only).
  const plain = imported.length ? [] : staff.filter(s => !s.role)
  for (const s of plain.filter((_, i) => i % 13 === 5)) { s.status = 'inactive'; s.leftOn = addDays(asOf, -R.int(20, 160)) }
  for (const s of plain.filter((_, i) => i % 17 === 8)) { s.status = 'pending'; s.joined = addDays(asOf, -R.int(1, 12)) }
  staff.forEach((s, i) => { s.code = `STAFF-${String(2401 + i).padStart(5, '0')}` })
  const staffById = Object.fromEntries(staff.map(s => [s.id, s]))
  const workingOn = (s, day) => s.status !== 'pending' && s.joined <= day && (!s.leftOn || day < s.leftOn)
  const dealWeight = s => (s.role ? 1.2 : 1) * (1 + (s.openingLifetime > 100000 ? 0.6 : s.openingLifetime > 40000 ? 0.3 : 0))

  // ── Listings ──
  const listings = []
  const buildings = {}
  const shortWord = area => area.split(' ').find(w => !['Taman', 'Bandar', 'Old', 'Sri', 'Road'].includes(w)) || area
  function makeListing(branch, type, created) {
    const cluster = clusterOf[branch.id]
    const area = R.pick(cluster.areas)
    const category = R.weighted(Object.keys(CATEGORIES), k => CATEGORIES[k].w)
    const c = CATEGORIES[category]
    let title, address
    if (c.kind === 'high') {
      const list = buildings[area] || (buildings[area] = [])
      if (list.length < 3 || R.chance(0.3)) {
        const a = R.pick(BLD_A), b = R.pick(BLD_B)
        const name = ['Residensi', 'Pangsapuri'].includes(a) ? `${a} ${b}` : `${a} ${b} ${R.pick(BLD_C)}`
        if (!list.includes(name)) list.push(name)
      }
      title = R.pick(list)
      address = `${R.pick(['A', 'B', 'C'])}-${String(R.int(2, 32)).padStart(2, '0')}-${String(R.int(1, 12)).padStart(2, '0')}, ${title}, ${area}`
    } else {
      title = c.kind === 'shop' ? `${area} Commercial Centre` : `Taman ${shortWord(area)} ${R.pick(['Indah', 'Jaya', 'Permai', 'Utama'])}`
      address = `No. ${R.int(1, 88)}, Jalan ${shortWord(area)} ${R.int(1, 12)}/${R.int(1, 30)}, ${area}`
    }
    const sale = type === 'sale'
    const ask = sale ? R.int(c.sale[0], c.sale[1]) * 1000 : Math.round(R.int(c.rent[0], c.rent[1]) / 50) * 50
    const round = sale ? 5000 : 50
    const askPrice = Math.round(ask / round) * round
    const members = staff.filter(s => s.branchId === branch.id && workingOn(s, created))
    const holder = R.weighted(members.length ? members : staff.filter(s => s.branchId === branch.id), s => (s.role ? 0.6 : 1))
    const creator = R.chance(0.75) ? holder : R.pick(staff.filter(s => s.branchId === branch.id))
    const sqft = Math.round(R.int(c.sqft[0], c.sqft[1]) / 10) * 10
    const l = {
      id: id(), code: '', type, category, title, area, city: cluster.city, state: cluster.state, postcode: cluster.postcode, address,
      beds: R.int(c.beds[0], c.beds[1]), baths: c.beds[1] ? Math.max(1, R.int(c.beds[0] - 1, c.beds[1])) : R.int(1, 3), builtUp: sqft,
      land: c.kind === 'land' ? `${R.pick([20, 22, 24, 40, 50])} x ${R.pick([65, 70, 75, 80, 100])}` : null,
      tenure: R.chance(0.7) ? 'Freehold' : 'Leasehold',
      furnishing: sale ? R.pick(['Unfurnished', 'Partly furnished', 'Partly furnished', 'Fully furnished']) : R.pick(['Partly furnished', 'Fully furnished', 'Fully furnished', 'Unfurnished']),
      askPrice, bestPrice: Math.round(askPrice * (sale ? R.int(93, 99) : R.int(95, 100)) / 100 / round) * round,
      marketValue: sale && R.chance(0.6) ? Math.round(askPrice * R.int(82, 104) / 100 / 1000) * 1000 : null,
      status: 'active', closedOn: null, branchId: branch.id, holderId: holder.id, creatorId: creator.id,
      flags: FLAGS.filter(() => R.chance(0.22)), portals: PORTALS.filter(() => R.chance(0.6)),
      created, updated: created, views: R.int(40, 2400), enquiries: R.int(0, 38), photos: R.chance(0.1) ? 0 : R.int(4, 24),
      owner: client(), dealId: null, priceUpdated: created, photosOn: created, followUps: [],
    }
    listings.push(l)
    return l
  }
  const listingTypes = enabled.filter(t => t !== 'project')
  for (const b of setup.branches) {
    if (!listingTypes.length) break
    for (let i = 0; i < 24; i++) {
      const type = listingTypes.length > 1 && R.chance(0.42) ? 'rental' : listingTypes[0] === 'rental' ? 'rental' : 'sale'
      makeListing(b, listingTypes.includes(type) ? type : listingTypes[0], addDays(asOf, -R.int(0, 420)))
    }
  }

  // ── Deals, with the money that comes in for each ──
  const dt = setup.dealTypes
  const deals = []
  const moneyIn = []
  const typeWeight = { sale: 55, rental: 35, project: 10 }
  const days = daysBetween(start, asOf)
  for (let d = 0; d <= days; d++) {
    const day = addDays(start, d)
    for (const branch of setup.branches) {
      // A quiet year and a busy last 40 days, so every step of the flow has work waiting.
      if (!R.chance(daysBetween(day, asOf) <= 40 ? 0.2 : 0.075)) continue
      const team = staff.filter(s => s.branchId === branch.id && workingOn(s, day))
      if (!team.length) continue
      const type = R.weighted(enabled, t => typeWeight[t])
      const agent = R.weighted(team, dealWeight)
      let listing = null
      if (type !== 'project') {
        const own = listings.filter(l => l.type === type && l.status === 'active' && !l.dealId && l.created <= day)
        const local = own.filter(l => l.branchId === branch.id)
        const pool = local.length && R.chance(0.85) ? local : own
        // Half the deals come from listings taken in shortly before, which keeps stock on the books.
        listing = pool.length && R.chance(0.5) ? R.pick(pool) : makeListing(branch, type, addDays(day, -R.int(10, 90)))
      }
      deals.push(makeDeal(branch, type, agent, listing, day))
    }
  }

  function makeDeal(branch, type, agent, listing, day) {
    const rate = Number(dt[type].defaultRate) || 0
    let price, fee, property
    if (type === 'project') {
      price = R.int(450, 1200) * 1000
      const pct = R.chance(0.7) ? rate : Math.max(0.5, rate + R.pick([-0.5, 0.5]))
      fee = r2(price * pct / 100)
      const name = R.pick(PROJECT_NAMES)
      property = { title: name, category: R.pick(['Condominium', 'Serviced Residence', 'Double Storey Terrace']),
        address: `Unit ${R.pick(['A', 'B'])}-${R.int(3, 38)}-${String(R.int(1, 10)).padStart(2, '0')}, ${name}, ${R.pick(clusterOf[branch.id].areas)}`,
        developer: R.pick(DEVELOPERS) }
    } else {
      const sale = type === 'sale'
      price = sale ? Math.round(listing.askPrice * R.int(92, 100) / 100 / 1000) * 1000 : Math.round(listing.askPrice * R.int(90, 100) / 100 / 50) * 50
      const pct = sale && R.chance(0.3) ? Math.max(1, rate - R.pick([0.5, 1])) : rate
      fee = r2(price * pct / 100)
      property = { title: listing.title, category: listing.category, address: listing.address }
    }
    const coBroke = type !== 'project' && R.chance(type === 'sale' ? 0.18 : 0.1)
    const referral = R.chance(0.1)
    const money = P.dealMoney({ fee, sstPct: dt.sstPct, sstMode: dt.sstMode, coBroke, coaSharePct: dt.coaSharePct, referral, referralPct: dt.referralPct })
    const agency = coBroke ? R.pick(AGENCIES) : null
    const deal = {
      id: id(), code: '', type, branchId: branch.id, date: day, status: 'submitted', submittedOn: addDays(day, R.int(0, 2)),
      listingId: listing?.id ?? null, agentId: agent.id, holderId: listing ? listing.holderId : null,
      property, price, fee, feePct: r2(fee / price * 100), sstPct: Number(dt.sstPct) || 0, sstMode: dt.sstMode, money,
      buyer: client(), owner: type === 'project' ? { name: property.developer, ic: '', phone: `03-${R.digits(4)} ${R.digits(4)}` } : listing.owner,
      coBroke: agency ? { agency: agency[0], licence: agency[1], agent: person().name, phone: phone() } : null,
      referral: referral ? { name: person().name, phone: phone(), ...bankAcc() } : null,
      rental: type === 'rental' ? { months: R.pick([12, 12, 24]), deposit: 2, utility: 0.5, advance: 1, taFee: R.pick([300, 400, 450, 500, 600]) } : null,
      docs: {}, cancelledOn: null, cancelReason: null, closedOn: null,
    }
    if (listing) listing.dealId = deal.id
    if (deal.referral) used.add(deal.referral.name)
    const age = daysBetween(day, asOf)

    if (age <= 10 && R.chance(0.45)) {
      deal.status = 'draft'
      deal.submittedOn = null
    } else if (age > 12 && R.chance(0.05)) {
      deal.status = 'cancelled'
      deal.cancelledOn = addDays(day, R.int(5, Math.min(age, 40)))
      deal.cancelReason = type === 'rental' ? CANCEL_REASONS[2] : R.pick([CANCEL_REASONS[0], CANCEL_REASONS[1], CANCEL_REASONS[3]])
    }
    if (deal.status !== 'draft') scheduleMoney(deal)
    deal.docs = docsFor(deal)
    return deal
  }

  // The client's payments into the company, as they would arrive.
  function scheduleMoney(deal) {
    const { type, price, money } = deal
    const plan = []
    if (type === 'sale') {
      const deposit = Math.round(price * R.pick([0.02, 0.03, 0.03]) / 100) * 100
      plan.push({ purpose: 'deposit', amount: deposit, on: addDays(deal.date, R.int(0, 2)), from: 'buyer' })
      if (deposit < money.billed) plan.push({ purpose: 'commission', amount: r2(money.billed - deposit), on: addDays(deal.date, R.int(20, 75)), from: 'owner' })
    } else if (type === 'rental') {
      const r = deal.rental
      plan.push({ purpose: 'rental', amount: Math.round(price * (r.deposit + r.utility + r.advance) / 50) * 50 + r.taFee, on: addDays(deal.date, R.int(0, 3)), from: 'buyer' })
    } else {
      const half = r2(money.billed / 2)
      plan.push({ purpose: 'commission', amount: half, on: addDays(deal.date, R.int(30, 60)), from: 'owner' })
      plan.push({ purpose: 'commission', amount: r2(money.billed - half), on: addDays(deal.date, R.int(95, 150)), from: 'owner' })
    }
    const until = deal.cancelledOn || asOf
    for (const p of plan) {
      if (p.on > until || p.on > asOf) continue
      addMoneyIn(deal, p)
    }
  }

  function addMoneyIn(deal, p) {
    const method = R.weighted(['online', 'cheque', 'cash'], m => ({ online: 70, cheque: 20, cash: 10 })[m])
    const bankOn = addDays(p.on, method === 'cheque' ? R.int(1, 3) : R.int(0, 1))
    // Accounts checks each payment against the bank statement before it counts.
    const clearsOn = addDays(bankOn, method === 'cheque' ? R.int(2, 4) : R.int(0, 3))
    const payer = p.from === 'buyer' ? deal.buyer.name : deal.owner.name
    const tx = {
      id: id(), code: '', dealId: deal.id, date: p.on, bankOn, clearsOn, amount: p.amount, method, purpose: p.purpose, payer,
      ref: method === 'online' ? `IBG${R.digits(9)}` : method === 'cheque' ? `Cheque ${R.digits(6)}` : `Cash receipt ${R.digits(5)}`,
      into: p.purpose === 'commission' ? 'operating' : 'client', status: 'cleared', reason: null,
      cashMethod: method === 'cash' ? R.pick(['cashtocompany', 'cashbankin']) : null,
      remark: { deposit: 'Earnest deposit', rental: 'Deposit + advance rental + TA fee', commission: deal.type === 'project' ? 'Developer commission claim' : 'Balance commission' }[p.purpose],
    }
    // Recent payments may still be waiting for accounts to check them.
    if (clearsOn > asOf || (daysBetween(clearsOn, asOf) < 6 && R.chance(0.45))) tx.status = R.chance(0.3) ? 'draft' : 'pending'
    else if (method === 'cheque' && R.chance(0.08)) {
      tx.status = 'returned'
      tx.reason = 'Cheque returned by the bank: insufficient funds.'
      moneyIn.push(tx)
      const again = addDays(clearsOn, R.int(3, 8))
      if (again <= asOf && (!deal.cancelledOn || again <= deal.cancelledOn)) addMoneyIn(deal, { ...p, on: again })
      return
    }
    moneyIn.push(tx)
  }

  function docsFor(deal) {
    const names = docNames(deal.type, !!deal.coBroke)
    const age = daysBetween(deal.date, asOf)
    return Object.fromEntries(names.map((n, i) => [n, deal.status === 'draft' ? i < 2 : age > 45 || i < 3 || R.chance(0.6)]))
  }

  // Number deals in date order: each branch and deal type keeps its own run.
  deals.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const caseSeq = {}
  for (const d of deals) {
    const branch = setup.branches.find(b => b.id === d.branchId)
    const k = `${d.branchId}-${d.type}`
    caseSeq[k] = (caseSeq[k] ?? P.branchStart(setup.numbering, d.type, branch)) + (k in caseSeq ? 1 : 0)
    d.code = P.formatNumber(setup.numbering, d.type, branch, caseSeq[k])
  }
  moneyIn.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  moneyIn.forEach((t, i) => { t.code = `TRAN#${82401 + i}` })

  // ── Closing: once the money is in, the deal pays out ──
  const payWhen = setup.approvals?.payWhen || 'full'
  const closes = []
  for (const deal of deals) {
    if (deal.status === 'draft' || deal.status === 'cancelled') continue
    const cleared = moneyIn.filter(t => t.dealId === deal.id && t.status === 'cleared').sort((a, b) => a.clearsOn.localeCompare(b.clearsOn))
    const billed = deal.money.billed
    let got = 0, claimed = 0
    for (const t of cleared) {
      got = r2(got + t.amount)
      const claimable = r2(Math.min(got, billed) - claimed)
      if (claimable <= 0) continue
      const full = Math.min(got, billed) >= billed
      if (payWhen !== 'received' && !full) continue
      const on = addDays(t.clearsOn, R.int(1, 7))
      if (on > asOf) break
      closes.push({ id: id(), dealId: deal.id, date: on, claim: claimable, full: claimed + claimable >= billed, partNo: 0, net: 0, sst: 0, sides: [] })
      claimed = r2(claimed + claimable)
    }
  }
  closes.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)

  // Run the closes in date order, so each earner's tier climbs as they earn.
  const dealById = Object.fromEntries(deals.map(d => [d.id, d]))
  const lifetime = Object.fromEntries(staff.map(s => [s.id, s.openingLifetime]))
  const yearly = {}
  const payouts = []
  const claimedNet = {}, claimedSst = {}, parts = {}
  for (const c of closes) {
    const deal = dealById[c.dealId]
    const { billed, net, sst } = deal.money
    c.partNo = parts[deal.id] = (parts[deal.id] || 0) + 1
    // The last close takes whatever is left, so parts add up to the deal exactly.
    c.net = c.full ? r2(net - (claimedNet[deal.id] || 0)) : r2(net * c.claim / billed)
    c.sst = c.full ? r2(sst - (claimedSst[deal.id] || 0)) : r2(sst * c.claim / billed)
    claimedNet[deal.id] = r2((claimedNet[deal.id] || 0) + c.net)
    claimedSst[deal.id] = r2((claimedSst[deal.id] || 0) + c.sst)
    const year = c.date.slice(0, 4)
    const { sides, lines } = payoutForClose(setup, staffById, deal, c.net,
      id => ({ lifetime: lifetime[id], yearly: yearly[`${id}-${year}`] || 0 }), c.date)
    c.sides = sides
    for (const sd of sides) {
      lifetime[sd.staffId] = r2(lifetime[sd.staffId] + sd.base)
      yearly[`${sd.staffId}-${year}`] = r2((yearly[`${sd.staffId}-${year}`] || 0) + sd.base)
    }

    // Approval (Ready), then the person asks for it to be paid (salary or incentive request).
    const paidOut = r2(lines.reduce((t, l) => t + l.amount, 0))
    // Most closes are approved within a week; some wait on the approver for longer.
    const approvedOn = addDays(c.date, R.int(2, 7) + (R.chance(0.4) ? R.int(6, 18) : 0))
    const approvers = payoutApprovers(setup, deal.branchId, paidOut)
    let status = 'approved', query = null
    if (approvedOn > asOf) {
      status = R.chance(0.25) ? 'queried' : 'new'
      if (status === 'queried') query = R.pick(QUERIES)
    }
    const time = `${String(R.int(9, 18)).padStart(2, '0')}:${String(R.int(0, 59)).padStart(2, '0')}`
    for (const l of lines) {
      // People ask for their pay a few days after approval; some leave it for a week or more.
      const requestOn = status === 'approved' ? addDays(approvedOn, R.int(0, 4) + (R.chance(0.4) ? R.int(4, 12) : 0)) : null
      payouts.push({
        id: id(), code: '', closeId: c.id, dealId: deal.id, date: c.date, time, staffId: l.staffId, side: l.side, role: l.role,
        pct: l.pct, base: l.base, amount: l.amount, tierId: l.tierId, status, query,
        approvedOn: status === 'approved' ? approvedOn : null, approvedBy: status === 'approved' ? approvers : null,
        requestOn: requestOn && requestOn <= asOf ? requestOn : null, requestId: null, archiveId: null, paidOn: null,
      })
    }
  }
  // Make sure the demo shows the query step: the oldest waiting close gets one.
  const waitingClose = payouts.find(p => p.status === 'new')?.closeId
  if (waitingClose != null && !payouts.some(p => p.status === 'queried')) {
    const query = R.pick(QUERIES)
    for (const p of payouts) if (p.closeId === waitingClose) Object.assign(p, { status: 'queried', query })
  }
  payouts.forEach((p, i) => { p.code = `CASE-${110401 + i}` })
  // Some agents stack their commission rather than claim it straight away: what
  // was approved one to six weeks ago waits, Ready and not requested, until they claim it.
  for (const p of payouts) {
    const age = p.status === 'approved' && p.staffId % 3 === 1 ? daysBetween(p.approvedOn, asOf) : -1
    if (age >= 7 && age <= 45) Object.assign(p, { requestOn: null, stacked: true, stackedOn: p.approvedOn })
  }

  // ── Salary and incentive requests: one per person, kind and pay day ──
  const requests = []
  const byKey = {}
  for (const p of payouts) {
    if (!p.requestOn) continue
    const kind = p.role ? 'incentives' : 'salary'
    const payOn = nextPayDate(setup.approvals, p.requestOn)
    const k = `${p.staffId}-${kind}-${payOn}`
    if (!byKey[k]) {
      byKey[k] = { id: id(), code: '', staffId: p.staffId, kind, date: p.requestOn, payOn, status: 'new', remark: null, paidOn: null }
      requests.push(byKey[k])
    }
    const r = byKey[k]
    if (p.requestOn < r.date) r.date = p.requestOn
    p.requestId = r.id
  }
  for (const r of requests) {
    if (r.payOn < asOf) Object.assign(r, { status: 'clear', paidOn: r.payOn })
    else if (daysBetween(r.date, asOf) >= 2) r.status = 'ready'
  }
  // One request sent back for a document, as happens.
  const sentBack = requests.filter(r => r.status !== 'clear').at(-1)
  if (sentBack) Object.assign(sentBack, { status: 'invalid', remark: R.pick(['Bank account name does not match IC.', 'Please upload the signed claim form.']) })
  requests.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  requests.forEach((r, i) => { r.code = `SAL-${r.date.slice(0, 7)}-${String(4801 + i).padStart(5, '0')}` })
  const requestById = Object.fromEntries(requests.map(r => [r.id, r]))
  for (const p of payouts) {
    const r = p.requestId && requestById[p.requestId]
    if (r?.status === 'clear') Object.assign(p, { status: 'paid', paidOn: r.paidOn })
  }

  // ── Weekly archive (Tuesdays) of paid case lines, then the landlord checks ──
  const archives = []
  let tue = start
  while (toDate(tue).getUTCDay() !== 2) tue = addDays(tue, 1)
  for (; tue < asOf; tue = addDays(tue, 7)) {
    const due = payouts.filter(p => p.status === 'paid' && !p.archiveId && p.paidOn <= tue)
    if (!due.length) continue
    const arc = { id: id(), code: `ARC-${String(262 + archives.length).padStart(5, '0')}-${tue}`, date: tue, count: due.length }
    for (const p of due) p.archiveId = arc.id
    archives.push(arc)
  }

  // Deal status from its closes, and listings follow their deals.
  const closedNet = {}
  for (const c of closes) closedNet[c.dealId] = r2((closedNet[c.dealId] || 0) + c.claim)
  for (const d of deals) {
    if (d.status === 'draft' || d.status === 'cancelled') continue
    const done = closedNet[d.id] || 0
    if (done >= d.money.billed) { d.status = 'closed'; d.closedOn = closes.filter(c => c.dealId === d.id).at(-1).date }
    else if (done > 0) d.status = 'partial'
    if (d.status === 'closed') d.docs = Object.fromEntries(Object.keys(d.docs).map(k => [k, true]))
  }
  for (const l of listings) {
    const d = l.dealId && dealById[l.dealId]
    if (d && d.status !== 'cancelled') {
      if (d.status === 'closed') { l.status = l.type === 'sale' ? 'sold' : 'rented'; l.closedOn = d.closedOn }
      else if (!l.flags.includes('Process Deal')) l.flags = ['Process Deal', ...l.flags]
      l.updated = maxDate(l.updated, d.date)
    } else {
      if (d) l.dealId = null
      const idle = daysBetween(l.created, asOf)
      if (idle > 300 && R.chance(0.5)) l.status = 'outdated'
      else if (idle > 90 && R.chance(0.08)) l.status = l.type === 'sale' ? 'sold_other' : 'invalid'
      else l.updated = addDays(l.created, R.int(0, Math.min(idle, 120)))
    }
  }
  // Follow-ups, price changes and photo uploads on the listings still being marketed.
  for (const l of listings) {
    const last = l.closedOn || asOf
    if (l.photos) l.photosOn = addDays(l.created, R.int(0, Math.min(20, Math.max(0, daysBetween(l.created, last)))))
    // One in five well-photographed listings has a walk-through video (picked by id, not R, so the rest of the sample stays the same).
    l.videos = l.photos >= 8 && l.id % 5 === 0 ? 1 + (l.id % 3 === 0) : 0
    if (l.status !== 'active') continue
    if (R.chance(0.35)) {
      const on = addDays(l.created, R.int(0, Math.max(0, daysBetween(l.created, asOf))))
      const was = l.askPrice, step = l.type === 'sale' ? 5000 : 50
      l.askPrice = Math.max(step, Math.round(was * R.pick([0.95, 0.97, 0.98, 1.02]) / step) * step)
      l.priceUpdated = on
      l.priceBefore = was
    }
    let d = l.created
    const visits = R.int(0, 4)
    for (let k = 0; k < visits; k++) {
      d = addDays(d, R.int(3, 30))
      if (d > asOf) break
      const action = R.weighted([0, 1, 2, 3, -1], a => ({ 0: 5, 1: 3, 2: 1.5, 3: 0.5, '-1': 0.5 })[a])
      const viewing = action === 1
      l.followUps.push({ date: d, action, by: l.holderId,
        remark: R.pick(['Owner still keen, price firm.', 'Arranged viewing with buyer.', 'Owner open to nego.', 'Tenant moving out next month.', 'No answer, will call again.']),
        appointment: viewing ? { date: addDays(d, R.int(1, 6)), time: R.pick(['10:00', '11:30', '14:00', '15:30', '17:00', '19:30']) } : null })
    }
    l.updated = [l.updated, l.priceUpdated, l.followUps.at(-1)?.date].filter(Boolean).sort().at(-1)
  }
  listings.forEach((l, i) => { l.code = `LIST-${122301 + i}` })

  // ── Request forms (money out): the six kinds the current ERP has ──
  const moneyOut = []
  const accounts = setup.bankAccounts || []
  const fromAcc = purpose => accounts.find(a => a.purpose === purpose)?.id ?? accounts[0]?.id ?? null
  function addOut(deal, type, on, payee, amount, approver) {
    if (amount <= 0) return
    const readyOn = addDays(on, R.int(1, 5) + (R.chance(0.35) ? R.int(5, 15) : 0))
    const paidOn = addDays(readyOn, R.int(2, 12))
    let status = paidOn <= asOf ? 'paid' : readyOn <= asOf ? 'ready' : 'new'
    const query = status === 'new' && R.chance(0.2) ? R.pick(['Bank account name does not match the payee.', 'Waiting for the signed release letter.']) : null
    if (query) status = 'queried'
    const method = R.chance(0.2) ? 'cheque' : 'online'
    moneyOut.push({ id: id(), voucherNo: '', dealId: deal.id, branchId: deal.branchId, staffId: deal.agentId, type, date: on, payee, amount: r2(amount),
      from: fromAcc(['balance', 'transfer', 'refund', 'ta'].includes(type) ? 'client' : 'operating'), method, chequeNo: method === 'cheque' ? R.digits(6) : null,
      approvedBy: status === 'new' || status === 'queried' ? null : approver,
      status, query, readyOn: status === 'new' || status === 'queried' ? null : readyOn, paidOn: status === 'paid' ? paidOn : null })
  }
  for (const deal of deals) {
    const mgr = setup.branches.find(b => b.id === deal.branchId)?.manager || 'Branch manager'
    const cleared = r2(moneyIn.filter(t => t.dealId === deal.id && t.status === 'cleared').reduce((t, x) => t + x.amount, 0))
    if (deal.status === 'closed') {
      const on = deal.closedOn
      const ta = deal.rental?.taFee || 0
      if (deal.type === 'rental' && ta) addOut(deal, 'ta', on, { name: R.pick(LAW_FIRMS), ...bankAcc() }, ta, mgr)
      if (deal.type === 'sale' && R.chance(0.3)) {
        addOut(deal, 'transfer', on, { name: `${R.pick(LAW_FIRMS)} (for ${deal.owner.name})`, ...bankAcc() }, cleared - deal.money.billed, mgr)
      } else if (deal.type !== 'project') addOut(deal, 'balance', on, { name: deal.owner.name, ...bankAcc() }, cleared - deal.money.billed - ta, mgr)
      if (deal.coBroke) addOut(deal, 'cobroke', on, { name: deal.coBroke.agency, ...bankAcc() }, deal.money.coBroke, mgr)
      if (deal.referral) addOut(deal, 'referral', on, { name: deal.referral.name, bank: deal.referral.bank, account: deal.referral.account }, deal.money.referral, mgr)
    } else if (deal.status === 'cancelled' && cleared > 0) {
      const boss = setup.company.reaName || 'Director'
      addOut(deal, 'refund', addDays(deal.cancelledOn, 1), { name: deal.buyer.name, ...bankAcc() }, cleared, setup.approvals?.refundApprover === 'boss' ? boss : mgr)
    }
  }
  moneyOut.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const voucherSeq = {}
  for (const m of moneyOut) {
    const branch = setup.branches.find(b => b.id === m.branchId)
    voucherSeq[m.branchId] = (voucherSeq[m.branchId] ?? P.branchStart(setup.numbering, 'voucher', branch) - 1) + 1
    m.voucherNo = P.formatNumber(setup.numbering, 'voucher', branch, voucherSeq[m.branchId])
  }

  // ── Landlord verification of archived cases ──
  const archivedDeals = new Map()
  for (const p of payouts) if (p.archiveId && !archivedDeals.has(p.dealId)) archivedDeals.set(p.dealId, p.archiveId)
  const archiveById = Object.fromEntries(archives.map(a => [a.id, a]))
  for (const [dealId, arcId] of archivedDeals) {
    const deal = dealById[dealId]
    if (deal.type === 'project') continue
    const age = daysBetween(archiveById[arcId].date, asOf)
    const roll = R.next()
    const status = age > 21 ? (roll < 0.85 ? 1 : roll < 0.95 ? 0 : -1) : (roll < 0.35 ? 1 : -1)
    deal.landlordCheck = { archiveId: arcId, status, on: status === -1 ? null : addDays(archiveById[arcId].date, R.int(1, Math.max(1, Math.min(age, 14)))),
      remarks: status === 0 ? R.pick(['Landlord did not answer three calls.', 'Phone number no longer in use.']) : status === 1 ? R.pick(['Confirmed by phone.', 'Landlord confirmed the deal and the fees.']) : '' }
  }

  // ── Customer Database: leads with the current ERP's action and status ──
  const customers = []
  const notes = ['Prefers a high floor.', 'Needs to sell current home first.', 'Loan pre-approved.', 'Wants near MRT.', 'Budget is firm.',
    'Comparing with a unit in the same block.', 'Asked for a second viewing with family.', 'Wants a pet-friendly unit.']
  const steps = ['Call', 'WhatsApp', 'Viewing', 'Meeting', 'Sent listings']
  function followUps(from, count) {
    const out = []
    let d = from
    for (let i = 0; i < count; i++) {
      d = addDays(d, R.int(1, 12))
      if (d > asOf) break
      out.push({ date: d, action: R.pick(steps), note: R.pick(notes) })
    }
    return out
  }
  for (const d of deals) {
    if (d.type === 'project' || d.status === 'draft' || !R.chance(0.35)) continue
    const created = addDays(d.date, -R.int(10, 60))
    const range = d.type === 'sale' ? [Math.round(d.price * 0.85 / 10000) * 10000, Math.round(d.price * 1.1 / 10000) * 10000] : [Math.round(d.price * 0.8 / 50) * 50, Math.round(d.price * 1.15 / 50) * 50]
    const fu = [...followUps(created, R.int(2, 4)), { date: d.date, action: 'Offer', note: `Signed the letter of offer for ${d.property.title}.` }]
    customers.push({ id: id(), code: '', date: created, name: d.buyer.name, phone: d.buyer.phone, type: d.type === 'sale' ? 'Sale' : 'Rent',
      area: listings.find(l => l.id === d.listingId)?.area || '', from: R.pick(LEAD_SOURCES), budgetMin: range[0], budgetMax: range[1],
      action: 2, track: d.status === 'cancelled' ? 2 : 1, remarks: fu.at(-1).note, ownerId: d.agentId, branchId: d.branchId, dealId: d.id, followUps: fu })
  }
  for (const b of setup.branches) {
    const team = staff.filter(x => x.branchId === b.id && x.status === 'active')
    for (let i = 0; i < 8; i++) {
      const created = addDays(asOf, -R.int(0, 150))
      const type = listingTypes.includes('rental') && (!listingTypes.includes('sale') || R.chance(0.4)) ? 'Rent' : 'Sale'
      const min = type === 'Sale' ? R.int(25, 90) * 10000 : R.int(24, 70) * 50
      const p = client()
      const fu = daysBetween(created, asOf) < 3 ? [] : followUps(created, R.int(1, 4))
      customers.push({ id: id(), code: '', date: created, name: p.name, phone: p.phone, type, area: R.pick(clusterOf[b.id].areas), from: R.pick(LEAD_SOURCES),
        budgetMin: min, budgetMax: type === 'Sale' ? Math.round(min * R.int(115, 160) / 100 / 10000) * 10000 : Math.round(min * R.int(115, 150) / 100 / 50) * 50,
        action: R.weighted([0, 1, 2, 3], a => [3, 2, 1, 3][a]), track: R.chance(0.12) ? 2 : 0, remarks: fu.at(-1)?.note || '',
        ownerId: R.pick(team.length ? team : staff).id, branchId: b.id, dealId: null, followUps: fu })
    }
  }
  customers.sort((a, b) => a.date.localeCompare(b.date))
  customers.forEach((c, i) => { c.code = `${687 + i}` })

  // ── Vendor requests from the public site (owners asking us to list) ──
  const vendorRequests = []
  for (let i = 0; i < 12; i++) {
    const b = R.pick(setup.branches)
    const date = addDays(asOf, -R.int(0, 120))
    const age = daysBetween(date, asOf)
    const status = age < 4 ? 0 : R.weighted([0, 1, 2, -1, -2], x => ({ 0: 1, 1: 2, 2: 4, '-1': 1, '-2': 0.6 })[x])
    const owner = client()
    const category = R.weighted(Object.keys(CATEGORIES), k => CATEGORIES[k].w)
    const rent = listingTypes.includes('rental') && R.chance(0.35)
    const created = status === 2 ? listings.find(l => l.branchId === b.id && l.created >= date && !vendorRequests.some(v => v.listingId === l.id)) : null
    vendorRequests.push({ id: id(), ticket: Array.from({ length: 10 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[R.int(0, 23)]).join(''), date,
      name: owner.name, phone: owner.phone, branchId: b.id, category, area: R.pick(clusterOf[b.id].areas), forType: rent ? 'Rent' : 'Sale',
      price: rent ? R.int(14, 50) * 100 : R.int(30, 150) * 10000, status: status === 2 && !created ? 1 : status, listingId: created?.id ?? null,
      handledBy: status === 0 ? null : R.pick(staff.filter(x => x.branchId === b.id)).id })
  }
  vendorRequests.sort((a, b) => b.date.localeCompare(a.date))

  // ── Enquiries from the website and app ──
  const enquiries = []
  const live = listings.filter(l => l.status === 'active')
  for (let i = 0; i < Math.min(20, live.length * 2); i++) {
    const l = R.pick(live)
    const p = client()
    enquiries.push({ id: id(), date: addDays(asOf, -R.int(0, 45)), listingId: l.id, name: p.name, phone: p.phone, via: R.pick(['Website', 'Website', 'App']),
      message: R.pick(['Is this still available?', 'Can I view this weekend?', 'Is the price negotiable?', 'Pet friendly?', 'What is the maintenance fee?', 'Can I get the floor plan?']),
      starred: R.chance(0.2), trashed: R.chance(0.08) })
  }
  enquiries.sort((a, b) => b.date.localeCompare(a.date))

  // ── Titles (buildings and housing areas) and areas, from the listings ──
  const titles = []
  const titleKey = {}
  // Leaders look after titles; with no upline levels in Setup, anyone in the branch does.
  const leadersOf = branchId => { const l = staff.filter(x => x.branchId === branchId && x.role); return l.length ? l : staff.filter(x => x.branchId === branchId) }
  for (const l of listings) {
    const k = `${l.title}|${l.area}`
    if (!titleKey[k]) {
      const kind = CATEGORIES[l.category]?.kind
      titleKey[k] = { id: id(), name: l.title, area: l.area, state: l.state, branchId: l.branchId, category: kind === 'shop' ? 3 : kind === 'high' ? 2 : 1,
        handlerId: R.pick(leadersOf(l.branchId)).id, status: 0, requestedBy: null }
      titles.push(titleKey[k])
    }
    l.titleId = titleKey[k].id
  }
  for (let i = 0; i < 6; i++) {
    const b = R.pick(setup.branches)
    titles.push({ id: id(), name: `${R.pick(BLD_A)} ${R.pick(BLD_B)} ${R.pick(BLD_C)}`, area: R.pick(clusterOf[b.id].areas), state: clusterOf[b.id].state, branchId: b.id,
      category: R.pick([1, 2, 2, 3]), handlerId: null, status: i < 4 ? 1 : 2, requestedBy: R.pick(staff.filter(x => x.branchId === b.id)).id, requestedOn: addDays(asOf, -R.int(0, 20)) })
  }
  const areas = setup.branches.flatMap(b => clusterOf[b.id].areas.map(name => ({ id: id(), name, state: clusterOf[b.id].state, branchId: b.id,
    managerId: staff.find(x => x.branchId === b.id && x.role && x.uplineId == null)?.id ?? null, status: 0 })))

  // ── Video gallery: the training and meeting recordings ──
  const TRAININGS = ['1.1 Log In to the ERP', '1.2 Submit New Case', '1.3 Add Transaction', '1.4 How to Close Case: Upload Details', '1.5 How to Close Case: Full Close, Partial Close',
    '1.6 How to Check Close Case & Request Salary', '1.7 How to Request Salary', '1.8 Balance to Vendor', '1.9 Tenancy Agreement Fees', '2.0 Request Transfer Deposit to Other',
    '2.1 Abort Case', '2.2 How to Add a New Listing', '2.3 Managing Your Listings', '2.4 Completing a Listing']
  const videos = [
    ...TRAININGS.map((title, i) => ({ id: id(), cate: 'training', title, date: addDays(asOf, -400 + i * 3), minutes: R.int(3, 14), description: 'Step-by-step walkthrough for agents.' })),
    ...['Monthly sales meeting', 'New tier rates briefing', 'Q3 results and top achievers', 'Branch managers sync'].map((title, i) => ({
      id: id(), cate: 'meeting', title, date: addDays(asOf, -150 + i * 35), minutes: R.int(25, 70), description: 'Recording of the company meeting.' })),
  ]

  // ── E-Forms Update Tracker: who changed what on a case ──
  const ADMINS = ['admin', 'account1', 'hq.admin']
  const audit = []
  for (const d of deals) {
    if (d.submittedOn) audit.push({ at: `${d.submittedOn} ${String(R.int(9, 18)).padStart(2, '0')}:${String(R.int(0, 59)).padStart(2, '0')}`, by: staffById[d.agentId].username, dealId: d.id, field: 'Status', before: 'Draft', after: 'Submitted' })
    if (d.closedOn) audit.push({ at: `${d.closedOn} ${String(R.int(9, 18)).padStart(2, '0')}:${String(R.int(0, 59)).padStart(2, '0')}`, by: R.pick(ADMINS), dealId: d.id, field: 'Status', before: 'Submitted', after: d.status === 'closed' ? 'Closed Full' : 'Closed Partial' })
    if (d.cancelledOn) audit.push({ at: `${d.cancelledOn} 10:${String(R.int(10, 59))}`, by: R.pick(ADMINS), dealId: d.id, field: 'Status', before: 'Submitted', after: 'Abort/Cancel' })
    if (d.submittedOn && R.chance(0.08)) {
      const was = Math.round(d.price * 1.03 / 1000) * 1000
      audit.push({ at: `${d.submittedOn} 16:${String(R.int(10, 59))}`, by: R.pick(ADMINS), dealId: d.id, field: 'Selling Price', before: was.toLocaleString('en-MY'), after: d.price.toLocaleString('en-MY') })
    }
  }
  audit.sort((a, b) => b.at.localeCompare(a.at))

  // ── Extras (own random stream, so the records above stay the same) ──
  const X = makeRng(SEED + 7)
  // Staff: access switches, public profile, documents, last activity and the
  // yearly renewal of the account (the client's new HR form has all of these).
  const nextAnniversary = from => {
    let d = `${asOf.slice(0, 4)}${from.slice(4)}`
    if (d.endsWith('02-29')) d = `${d.slice(0, 8)}28`
    return d > asOf ? d : `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`
  }
  const company = setup.company?.name || 'the agency'
  for (const s of staff) {
    const years = Math.max(1, Math.round(daysBetween(s.joined, asOf) / 365))
    s.access = { agent: true, profilePage: s.status === 'active' && X.chance(0.75), profileDoc: s.status === 'active' && X.chance(0.5), addListing: s.status !== 'pending',
      landlordVerify: !!s.role && X.chance(0.6), vendorRequests: !!s.role || X.chance(0.25), tripIncentive: X.chance(0.2) }
    s.regType = 'REN'
    s.regNo = String(s.renNo || '').replace(/^\D+\s*/, '')
    const myAreas = [...new Set(listings.filter(l => l.holderId === s.id).map(l => l.area))].slice(0, 3)
    s.bio = s.role || X.chance(0.3) ? `${years} year${years > 1 ? 's' : ''} in property${myAreas.length ? `, mostly around ${myAreas.join(', ')}` : ''}. Happy to help you buy, sell or rent.` : ''
    s.socials = s.bio && X.chance(0.6) ? { facebook: `https://www.facebook.com/${s.username}`, instagram: X.chance(0.5) ? `https://www.instagram.com/${s.username}` : '' } : {}
    s.awards = []
    s.lastActive = s.status === 'inactive' ? s.leftOn : addDays(asOf, -X.int(0, s.status === 'pending' ? 4 : 25))
    s.expiresOn = s.status === 'inactive' ? s.leftOn : nextAnniversary(s.joined)
    s.docs = { 'NRIC Copy': true, 'Application Form': true, 'Joining Fee Receipt': s.status !== 'pending' || X.chance(0.4) }
    s.marketing = []
  }
  const ranked = [...staff].sort((a, b) => b.openingLifetime - a.openingLifetime)
  ranked.slice(0, 2).forEach((s, i) => s.awards.push({ name: i ? 'Top Negotiator' : 'Top Achiever', org: company, date: `${Number(asOf.slice(0, 4)) - 1}-12-${i ? 12 : 5}` }))
  // Two leaders let an assistant see their customers and listings.
  for (const s of staff.filter(x => x.role).slice(0, 2)) {
    const helper = X.pick(staff.filter(x => x.id !== s.id && x.branchId === s.branchId && !x.role) || [])
    if (helper) s.marketing.push({ staffId: helper.id, customers: true, listings: true, shared: X.chance(0.5) })
  }
  for (const l of listings) Object.assign(l, { share: { users: [], pmId: null, coPh: [] }, marketingRemarks: '', remarksPrivate: true, viewsApp: Math.round(l.views * 0.35) })
  for (const d of deals) Object.assign(d, { otherBuyers: [], otherOwners: [], files: {} })
  // Areas agents asked for, waiting for an admin.
  for (let i = 0; i < 2; i++) {
    const b = X.pick(setup.branches)
    areas.push({ id: id(), name: X.pick(['Taman Bukit Indah', 'Bandar Baru Seri', 'Taman Mutiara Rini', 'Desa Aman Puri']) + (i ? ' 2' : ''), state: clusterOf[b.id].state, branchId: b.id,
      managerId: null, status: 2, requestedBy: (X.pick(staff.filter(x => x.branchId === b.id)) || staff[0]).id, requestedOn: addDays(asOf, -X.int(0, 10)) })
  }
  const propertyTypes = Object.keys(CATEGORIES).map(name => ({ id: id(), name }))

  // ── Old records from the first system (V1, 2016–2020): read only ──
  const v1 = { eforms: [], overrides: [] }
  const v1Seq = { sale: 0, rental: 0 }
  for (let i = 0; i < 40; i++) {
    const year = X.int(2016, 2020), month = String(X.int(1, 12)).padStart(2, '0')
    const type = X.chance(0.6) ? 'sale' : 'rental'
    const l = X.pick(listings)
    const price = type === 'sale' ? Math.round(l.askPrice * X.int(70, 90) / 100 / 1000) * 1000 : Math.round(X.int(900, 3200) / 50) * 50
    const fee = r2(type === 'sale' ? price * X.pick([2, 2.5, 3]) / 100 : price)
    const status = X.weighted(['closed', 'partial', 'cancelled', 'submitted'], s => ({ closed: 14, partial: 2, cancelled: 2, submitted: 0.5 })[s])
    v1Seq[type]++
    v1.eforms.push({ id: id(), code: `${year}-${month}-${type === 'sale' ? 'SALE' : 'RENT'}-${String(v1Seq[type] + (type === 'sale' ? 1200 : 800)).padStart(5, '0')}`,
      date: `${year}-${month}-${String(X.int(1, 28)).padStart(2, '0')}`, type, staffId: X.pick(staff).id, address: l.address, price, total: fee,
      closing: status === 'closed' ? fee : status === 'partial' ? r2(fee / 2) : 0, status })
  }
  v1.eforms.sort((a, b) => b.date.localeCompare(a.date))
  for (const year of [2016, 2017, 2018, 2019]) {
    for (const s of staff.filter(x => x.role)) {
      const sales = X.int(8, 60) * 10000
      v1.overrides.push({ id: id(), year, staffId: s.id, cases: X.int(3, 30), sales, override: r2(sales * X.pick([1, 1.5, 2, 2.5]) / 100) })
    }
  }

  // ── Office staff: admins, accounting and marketing (System → Users) ──
  // Made last, so the agents and records above stay exactly the same.
  const hq = setup.branches[0]?.id
  const office = [...setup.branches.map(b => ['admin-staff2', b.id]), ['admin-staff', hq], ['account', hq], ['sale-marketing', hq]].filter(([, b]) => b != null)
  for (const [type, branchId] of office) {
    const p = person()
    if (shorts.has(p.short)) p.short = p.alt && !shorts.has(p.alt) ? p.alt : p.name
    shorts.add(p.short)
    const born = `${R.int(1978, 2000)}-${String(R.int(1, 12)).padStart(2, '0')}-${String(R.int(1, 28)).padStart(2, '0')}`
    const joined = addDays(asOf, -R.int(200, 6 * 365))
    const first = p.short.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '') || 'office'
    staff.push({
      id: id(), code: `STAFF-${String(2401 + staff.length).padStart(5, '0')}`, name: p.name, short: p.short, sex: p.sex, ic: icNo(born), phone: phone(),
      email: `${first}.${staff.length + 1}@${domain}`, branchId, role: null, uplineId: null, depth: 0, status: 'active', joined, leftOn: null, renNo: '', ...bankAcc(),
      openingLifetime: 0, tierFloorId: null, whtExempt: false, username: `${first}${R.int(10, 99)}`, type, birthday: born,
      language: R.pick(['English', 'Malay', 'Chinese']), education: R.pick(['Diploma', 'Degree']), address: '',
      access: { agent: false, profilePage: false, profileDoc: false, addListing: type === 'sale-marketing', landlordVerify: false, vendorRequests: type !== 'account', tripIncentive: false },
      regType: '', regNo: '', bio: '', socials: {}, awards: [], lastActive: addDays(asOf, -R.int(0, 3)), expiresOn: nextAnniversary(joined),
      docs: { 'NRIC Copy': true, 'Application Form': true, 'Joining Fee Receipt': false }, marketing: [],
    })
  }

  const records = { staff, listings, customers, deals, moneyIn, closes, payouts, requests, archives, moneyOut, vendorRequests, enquiries, titles, areas, videos, audit, propertyTypes, v1 }
  const life = addListingLife(records, { R: makeRng(SEED + 11), asOf, id })
  return { version: ERP_VERSION, sig: setupSignature(setup), asOf, start, ...records, ...life }
}

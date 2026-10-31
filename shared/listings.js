// Listing rules of the current SubSaleKing system (read from its source, the
// old-subsaleking-* repos), in one place for the page and, later, the server:
// price against market value, the hot lists, who may see the owner, who the
// Product Handler is and why, who leads each building, the viewing clock and
// the staff clock. Pure functions over plain records; dates are 'YYYY-MM-DD',
// times 'YYYY-MM-DD HH:MM' (compared as text).

export const LISTING_RULES = {
  // A listing nobody touched for this long is Outdated (days, by listing type).
  outdatedDays: { sale: 90, rental: 45 },
  // Price against market value, % above it: under 5 is a hot price, then 10, then 15.
  ratingSteps: [5, 10, 15],
  // Super Hot: the owner's best price at most this % above market value. (The
  // current system used 5% in one place and 2.5% in another; this is the one rule.)
  superHotPct: 5,
  coPhSlots: 3,
  // A building's Project Manager (sales): the product handler with the most
  // full-closed sale value there, above `win`; from `keep` the post is theirs for good.
  projectManager: { win: 5000000, keep: 20000000 },
  // A building's Project Handler (rentals): most active rental listings there with the key on hand.
  projectHandler: { win: 10, keep: 100 },
  // A viewing should be reviewed within this many hours of ending.
  reviewWithinHours: 24,
  // Staff: not verified this many days after joining → Suspended; no activity this long → Locked.
  pendingDays: 7,
  idleDays: 60,
}

const DAY = 86400000
const toDate = s => new Date(`${String(s).slice(0, 10)}T00:00:00Z`)
export const addDays = (s, n) => new Date(toDate(s).getTime() + n * DAY).toISOString().slice(0, 10)
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY)
const plusHours = (stamp, h) => {
  const t = new Date(`${stamp.slice(0, 10)}T${stamp.slice(11, 16) || '00:00'}:00Z`).getTime() + h * 3600000
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ')
}
const has = (l, flag) => (l.flags || []).includes(flag)
export const KEY_FLAG = 'Key On Agent Hand'

// ── Price against market value (the current system's rate colour) ──
export const RATING = {
  red: { label: 'Hot price', tone: 'red', help: 'Less than 5% above market value, or below it. The best buys: push these first.' },
  orange: { label: 'Good price', tone: 'amber', help: '5% to 10% above market value.' },
  green: { label: 'Fair price', tone: 'green', help: '10% to 15% above market value.' },
  blue: { label: 'Above market', tone: 'blue', help: '15% or more above market value. Talk the owner down before marketing it hard.' },
}
// { band, pct, diff } for the Ad Price against the market value, or null without one.
export function priceRating(l) {
  const ask = Number(l.askPrice), mv = Number(l.marketValue)
  if (!(ask > 0) || !(mv > 0)) return null
  const pct = Math.round(((ask - mv) / mv) * 1000) / 10
  const [a, b, c] = LISTING_RULES.ratingSteps
  return { band: pct < a ? 'red' : pct < b ? 'orange' : pct < c ? 'green' : 'blue', pct, diff: ask - mv }
}

// ── Hot lists (the app's home shortcuts), worked out from the listing ──
export const HOT_LISTS = {
  hotSale: { label: 'Hot Sales', help: 'For sale with photos, at a hot price with the key, vacant or a friendly tenant, or at a good price with the key on hand.' },
  superHot: { label: 'Super Hot', help: `For sale with photos; the owner's best price is at most ${LISTING_RULES.superHotPct}% above market value and the Ad Price leaves room to negotiate.` },
  rentKing: { label: 'Rent King', help: 'For rent with photos, a market value, and the key on the agent\'s hand.' },
}
export function hotLists(l) {
  if (l.status !== 'active' || !(l.photos > 0)) return []
  const r = priceRating(l)
  const key = has(l, KEY_FLAG)
  const out = []
  if (l.type === 'sale' && r && ((r.band === 'red' && (key || has(l, 'Vacant') || has(l, 'Friendly Tenant'))) || (r.band === 'orange' && key))) out.push('hotSale')
  if (l.type === 'sale' && l.marketValue > 0 && l.bestPrice > 0 && l.askPrice > l.bestPrice && l.bestPrice <= l.marketValue * (1 + LISTING_RULES.superHotPct / 100)) out.push('superHot')
  if (l.type === 'rental' && r && key) out.push('rentKing')
  return out
}

// ── Who someone is to a listing (the current system's "affiliations") ──
// Only these people see the owner's name, contact and unit number. `ctx`:
// { title, leaders } with the building and the ids of the product handler's uplines.
export const LISTING_ROLE = {
  creator: 'Listing creator', holder: 'Product Handler', mainPh: 'Main Product Handler', coPh: 'Co-Product Handler', shared: 'Shared with',
  leader: 'Leader of the Product Handler', projectManager: 'Project Manager of the building', projectHandler: 'Project Handler of the building',
}
export function listingRoles(l, staffId, { title = null, leaders = [] } = {}) {
  if (staffId == null) return []
  const share = l.share || {}
  return [
    l.creatorId === staffId && 'creator',
    l.holderId === staffId && 'holder',
    share.pmId === staffId && 'mainPh',
    (share.coPh || []).some(c => c.staffId === staffId) && 'coPh',
    (share.users || []).includes(staffId) && 'shared',
    leaders.includes(staffId) && 'leader',
    l.type === 'sale' && title?.managerId === staffId && 'projectManager',
    l.type === 'rental' && title?.handlerId === staffId && 'projectHandler',
  ].filter(Boolean)
}
// What others see instead: the building and area without the unit or street,
// and the phone number's first and last three digits.
export const hideAddress = l => `${l.title}, ${l.area} (unit hidden)`
export const hidePhone = phone => {
  const d = String(phone || '').replace(/\D/g, '')
  return d.length < 7 ? '•••' : `${d.slice(0, 3)}-•••• ${d.slice(-3)}`
}

// ── Product Handler: who handles the listing, and why ──
// Slots on `l.share`: `pmId` is the Main Product Handler (the current ERP's
// pm_user_id), `coPh` up to three Co-Product Handlers { staffId, until, locked }.
// Order, as the current system: a locked co-PH; else the co-PH who followed the
// listing up most recently; else the Main PH; else the current handler while
// active; else the building's Project Manager (sale) or Project Handler (rent);
// else the area manager; else the creator; else the branch manager.
export const HANDLER_FROM = {
  locked: 'Locked co-product handler (has the key or an exclusive)',
  coPh: 'Co-product handler who followed it up last',
  mainPh: 'Main product handler',
  kept: 'Kept: nobody in the slots outranks them',
  projectManager: 'Project Manager of the building',
  projectHandler: 'Project Handler of the building',
  areaManager: 'Area manager (the handler was not active)',
  creator: 'Listing creator',
  branchManager: 'Branch manager (the handler was not active)',
  manual: 'Changed by hand',
  created: 'Listed it',
  assigned: 'Assigned when it was listed',
  returned: 'Given back on returning',
}
// Co-PH slots still in force on `today` (a locked slot never expires).
export const liveSlots = (l, today) => (l.share?.coPh || []).filter(c => c.staffId && (c.locked || !c.until || c.until >= today))

// `ctx`: { today, active(id), title, areaManagerId, branchManagerId }.
// Returns { staffId, from } or null when there is nobody to hand it to.
export function pickHandler(l, ctx) {
  const { today, active } = ctx
  const live = liveSlots(l, today).filter(c => active(c.staffId))
  const locked = live.find(c => c.locked)
  if (locked) return { staffId: locked.staffId, from: 'locked' }
  // The co-PH with the latest follow-up on this listing (they must have followed it up at least once).
  const lastBy = {}
  for (const f of l.followUps || []) if (f.by != null && (!lastBy[f.by] || f.date >= lastBy[f.by])) lastBy[f.by] = f.date
  const top = live.filter(c => lastBy[c.staffId]).sort((a, b) => lastBy[b.staffId].localeCompare(lastBy[a.staffId]))[0]
  if (top) return { staffId: top.staffId, from: 'coPh' }
  if (l.share?.pmId && active(l.share.pmId)) return { staffId: l.share.pmId, from: 'mainPh' }
  if (l.holderId != null && active(l.holderId)) return { staffId: l.holderId, from: 'kept' }
  const lead = l.type === 'sale' ? ctx.title?.managerId : ctx.title?.handlerId
  if (lead && active(lead)) return { staffId: lead, from: l.type === 'sale' ? 'projectManager' : 'projectHandler' }
  if (ctx.areaManagerId && active(ctx.areaManagerId)) return { staffId: ctx.areaManagerId, from: 'areaManager' }
  if (l.creatorId != null && active(l.creatorId)) return { staffId: l.creatorId, from: 'creator' }
  if (ctx.branchManagerId && active(ctx.branchManagerId)) return { staffId: ctx.branchManagerId, from: 'branchManager' }
  return null
}

// Listings that left `staffId` while their account was not active, and are
// still with the stand-in the rules picked: what "Give back" returns to them.
const STAND_IN = ['areaManager', 'projectManager', 'projectHandler', 'creator', 'branchManager']
export const handedAway = (listings, staffId) => listings.filter(l => {
  const log = l.phLog || []
  return l.status === 'active' && log.length > 1 && STAND_IN.includes(log.at(-1).from) && log.at(-2).staffId === staffId && l.holderId === log.at(-1).staffId
})

// ── Building leads: Project Manager (sales) and Project Handler (rentals) ──
// Ranks the product handlers of each building, in one pass: sales by full-closed
// sale value (E-Forms Closed Full on its listings), rentals by active listings
// with the key on hand. Map titleId → { sale, rental }, each [{ staffId, n }] best first.
export function buildingRankings({ listings, deals }) {
  const titleOf = new Map(listings.map(l => [l.id, l.titleId]))
  const tally = new Map()
  const bump = (titleId, kind, staffId, n) => {
    if (titleId == null || staffId == null) return
    const t = tally.get(titleId) || { sale: {}, rental: {} }
    t[kind][staffId] = (t[kind][staffId] || 0) + n
    tally.set(titleId, t)
  }
  for (const d of deals) if (d.status === 'closed' && d.type === 'sale') bump(titleOf.get(d.listingId), 'sale', d.holderId, Number(d.price || 0))
  for (const l of listings) if (l.type === 'rental' && l.status === 'active' && has(l, KEY_FLAG)) bump(l.titleId, 'rental', l.holderId, 1)
  const rank = o => Object.entries(o).map(([id, n]) => ({ staffId: Number(id), n })).sort((a, b) => b.n - a.n)
  return new Map([...tally].map(([id, t]) => [id, { sale: rank(t.sale), rental: rank(t.rental) }]))
}
export const buildingRanking = (titleId, data) => buildingRankings(data).get(titleId) || { sale: [], rental: [] }
// The lead a building should have now: { staffId, permanent, changed, top } per kind.
// A permanent lead is never replaced; otherwise the top handler takes over once past `win`.
export function nextLead(kind, title, ranking) {
  const rule = kind === 'sale' ? LISTING_RULES.projectManager : LISTING_RULES.projectHandler
  const current = kind === 'sale' ? title.managerId ?? null : title.handlerId ?? null
  const permanent = !!(kind === 'sale' ? title.managerPermanent : title.handlerPermanent)
  const top = ranking[0] || null
  if (permanent || !top || top.n < rule.win || (kind === 'sale' && top.n === rule.win)) return { staffId: current, permanent, changed: false, top }
  const keep = top.n >= rule.keep
  return { staffId: top.staffId, permanent: keep, changed: top.staffId !== current || keep !== permanent, top }
}

// ── Viewings (the current app's appointments) ──
export const VIEWING_STATUS = {
  new: { label: 'Waiting to confirm', tone: 'amber', help: 'Booked by the agent with the customer. The product handler has to confirm the time with the owner.' },
  rescheduled: { label: 'Rescheduled', tone: 'amber', help: 'Moved to a new time. The product handler has to confirm it again.' },
  confirmed: { label: 'Confirmed', tone: 'blue', help: 'The owner and the product handler expect the viewing.' },
  review: { label: 'To review', tone: 'violet', help: 'The viewing is over. The agent who booked it records how it went.' },
  done: { label: 'Completed', tone: 'green', help: 'Viewed and reviewed. The review is on the listing\'s follow-up history.' },
  cancelled: { label: 'Cancelled', tone: 'gray', help: 'Called off before it happened (the reason is in the remarks).' },
  expired: { label: 'Expired', tone: 'gray', help: 'Never confirmed before its time passed.' },
}
export const VIEWING_OUTCOME = {
  interested: 'Interested', second: 'Wants a second viewing', offer: 'Making an offer', no: 'Not interested', noShow: 'Customer did not turn up',
}
// The status a viewing has by `now` ('YYYY-MM-DD HH:MM'): unconfirmed ones
// expire at their start time, confirmed ones wait for a review once over.
export function viewingClock(v, now) {
  const end = `${v.date} ${v.end || v.time}`
  if ((v.status === 'new' || v.status === 'rescheduled') && `${v.date} ${v.time}` <= now) return 'expired'
  if (v.status === 'confirmed' && end <= now) return 'review'
  return v.status
}
// A viewing past its review deadline (24 hours after it ended).
export const reviewOverdue = (v, now) => v.status === 'review' && plusHours(`${v.date} ${v.end || v.time}`, LISTING_RULES.reviewWithinHours) <= now
export const endTime = (time, minutes = 30) => {
  const [h, m] = String(time || '00:00').split(':').map(Number)
  const t = Math.min(23 * 60 + 59, h * 60 + m + Number(minutes || 30))
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
// Two viewings for the same product handler that overlap in time.
export const clashes = (a, b) => a.date === b.date && a.time < (b.end || b.time) && b.time < (a.end || a.time)

// ── Notifications: meant for one person (staff id; 0 is the office), a branch ('branch:<id>') or everyone ('all') ──
export const noticeFor = (n, who, branchId) => n.to === 'all' || n.to === who || (branchId != null && n.to === `branch:${branchId}`)
export const NOTICE_CAT = {
  viewing: { label: 'Viewings', tone: 'blue' }, listing: { label: 'Listings', tone: 'violet' }, good: { label: 'Good news', tone: 'green' },
  bad: { label: 'Heads-up', tone: 'amber' }, commission: { label: 'Commission', tone: 'brand' }, office: { label: 'Office', tone: 'gray' }, notice: { label: 'Notice', tone: 'red' },
}

// ── Staff clock: what the current system does to accounts by itself ──
// 'suspend' a pending account not verified within 7 days of joining; 'lock' an
// active one with no activity for 60 days; else null.
export function staffDue(s, today) {
  if (s.status === 'pending' && s.joined && daysBetween(s.joined, today) > LISTING_RULES.pendingDays) return 'suspend'
  if (s.status === 'active' && s.lastActive && daysBetween(String(s.lastActive).slice(0, 10), today) > LISTING_RULES.idleDays) return 'lock'
  return null
}

// ── Outdated: active listings nobody updated within the window ──
export const isOutdated = (l, today) => l.status === 'active' && daysBetween(l.updated || l.created, today) > LISTING_RULES.outdatedDays[l.type === 'rental' ? 'rental' : 'sale']

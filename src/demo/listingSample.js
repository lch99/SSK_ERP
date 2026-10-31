// The life around the sample listings, made after everything else from its own
// random stream (so the records erpSample.js made stay the same): market values
// for rentals, Main and Co-Product Handler slots (and the handler they lead
// to), building leads, viewings, favourites and notifications.
import * as L from '../../shared/listings.js'

const SLOTS = ['10:00', '10:30', '11:30', '14:00', '15:00', '15:30', '17:00', '19:30', '20:00']
const AGENT_TYPES = ['staff', 'sale-staff']

export function addListingLife(data, { R, asOf, id }) {
  const { listings, staff, titles, customers } = data
  const byId = Object.fromEntries(staff.map(s => [s.id, s]))
  const agents = staff.filter(s => AGENT_TYPES.includes(s.type || 'staff'))
  const working = agents.filter(s => s.status === 'active')
  const inBranch = b => working.filter(s => s.branchId === b)
  const active = sid => byId[sid]?.status === 'active'
  const titleById = Object.fromEntries(titles.map(t => [t.id, t]))
  // The top of someone's upline chain: their branch manager.
  const topOf = sid => { let p = byId[sid], n = 0; while (p?.uplineId != null && byId[p.uplineId] && n++ < 50) p = byId[p.uplineId]; return p?.id ?? null }
  const at = (day, time = SLOTS[R.int(0, SLOTS.length - 1)]) => `${day} ${time}`

  // A few agents have not signed in for almost 60 days (the Locked rule is near).
  agents.filter(s => s.status === 'active').forEach((s, i) => { if (i % 45 === 7) s.lastActive = L.addDays(asOf, -R.int(50, 58)) })

  // Rentals get a market rent too (sales already have a market value).
  for (const l of listings) {
    if (l.type === 'rental' && l.marketValue == null && R.chance(0.6)) l.marketValue = Math.round(l.askPrice * R.int(82, 104) / 100 / 50) * 50
  }

  // Building leads: a Project Manager (sales) for most buildings; the Project
  // Handler (rentals) is the one erpSample picked.
  const leaders = b => { const x = working.filter(s => s.branchId === b && s.role); return x.length ? x : inBranch(b) }
  for (const t of titles) if (t.status === 0 && R.chance(0.7)) t.managerId = R.pick(leaders(t.branchId))?.id ?? null

  // Main and Co-Product Handler slots on the listings still on the market,
  // then the handler they lead to (as the rules pick it), with its history.
  for (const l of listings) {
    l.phLog = [{ on: l.created, staffId: l.holderId, from: l.holderId === l.creatorId ? 'created' : 'assigned' }]
    // Listings with an E-Form under way keep their handler (the E-Form names them).
    if (l.status !== 'active' || l.dealId) continue
    const others = inBranch(l.branchId).filter(s => s.id !== l.holderId)
    if (R.chance(0.3)) l.share.pmId = l.holderId
    if (others.length && R.chance(0.22)) {
      const n = R.chance(0.35) ? 2 : 1
      for (let i = 0; i < n; i++) {
        const s = R.pick(others)
        if (l.share.coPh.some(c => c.staffId === s.id)) continue
        const until = R.chance(0.25) ? null : L.addDays(asOf, R.int(-12, 75))
        l.share.coPh.push({ staffId: s.id, until, locked: false, from: L.addDays(asOf, -R.int(15, 120)) })
        // Half of them work the listing: a follow-up of their own.
        if (R.chance(0.5)) {
          const day = L.addDays(asOf, -R.int(0, 25))
          l.followUps.push({ date: day, action: R.pick([0, 1, 2]), by: s.id, remark: R.pick(['Called the owner, still available.', 'Brought a buyer to view.', 'Owner agreed to show on weekends.']), appointment: null })
          l.followUps.sort((a, b) => a.date.localeCompare(b.date))
          if (day > l.updated) l.updated = day
        }
      }
      // One in six: a co-PH holds the key, so they are locked in.
      if (l.share.coPh.length && R.chance(0.17)) {
        const c = l.share.coPh[0]
        Object.assign(c, { locked: true, until: null })
        if (!l.flags.includes(L.KEY_FLAG)) l.flags = [L.KEY_FLAG, ...l.flags]
      }
    }
    const pick = L.pickHandler(l, { today: asOf, active, title: titleById[l.titleId], branchManagerId: topOf(l.holderId) })
    if (pick && pick.staffId !== l.holderId) {
      l.holderId = pick.staffId
      l.phLog.push({ on: L.addDays(asOf, -R.int(0, 10)), staffId: pick.staffId, from: pick.from })
    }
  }

  // ── Viewings: booked by agents with their customers, confirmed by the listing's handler ──
  const viewings = []
  const live = listings.filter(l => l.status === 'active')
  const customersOf = sid => customers.filter(c => c.ownerId === sid && c.track === 0)
  const want = Math.min(Math.round(live.length * 0.9), 420)
  for (let i = 0; i < want && live.length && working.length; i++) {
    const l = R.pick(live)
    const near = inBranch(l.branchId)
    const by = (R.chance(0.65) && near.length ? R.pick(near) : R.pick(working))
    const date = L.addDays(asOf, R.int(-40, 12))
    const time = SLOTS[R.int(0, SLOTS.length - 1)]
    const minutes = R.pick([30, 30, 45, 60])
    const mine = customersOf(by.id)
    const c = mine.length && R.chance(0.7) ? R.pick(mine) : null
    const created = L.addDays(date, -R.int(1, 6))
    const v = { id: id(), code: '', listingIds: [l.id], requestedBy: by.id, handlerId: l.holderId, customerId: c?.id ?? null,
      customer: { name: c?.name || R.pick(['Mr. Tan', 'Ms. Wong', 'Encik Faiz', 'Puan Aminah', 'Mr. Kumar', 'Ms. Lim', 'Mr. & Mrs. Lee']), phone: c?.phone || `01${R.int(0, 9)}-${R.int(200, 999)} ${R.int(1000, 9999)}` },
      date, time, end: L.endTime(time, minutes), status: 'new', created: at(created, '09:30'), remarks: [], review: null }
    if (by.id === l.holderId && near.length > 1) v.requestedBy = R.pick(near.filter(s => s.id !== l.holderId)).id
    // A second listing in the same building, now and then.
    const twin = live.find(x => x.id !== l.id && x.titleId === l.titleId && x.type === l.type)
    if (twin && R.chance(0.2)) v.listingIds.push(twin.id)
    const past = date < asOf
    if (past) {
      const roll = R.next()
      if (roll < 0.62) {
        const outcome = R.weighted(Object.keys(L.VIEWING_OUTCOME), k => ({ interested: 3, second: 2, offer: 1, no: 3, noShow: 0.8 })[k])
        v.status = 'done'
        v.review = { at: at(L.addDays(date, R.int(0, 1)), '21:00'), outcome, text: R.pick(['Liked the layout, comparing with one more unit.', 'Price too high for them.', 'Wants to bring parents to view.', 'Will make an offer this week.', 'Did not reply after the viewing.']) }
      } else if (roll < 0.74) { v.status = 'cancelled'; v.remarks.push({ at: at(L.addDays(date, -1), '18:00'), by: v.requestedBy, text: R.pick(['Customer cannot make it, will rebook.', 'Owner not around that day.', 'Customer found another unit.']) }) }
      else if (roll < 0.84) v.status = 'expired'
      else v.status = L.daysBetween(date, asOf) <= 4 ? 'review' : 'done'
      if (v.status === 'done' && !v.review) v.review = { at: at(date, '22:00'), outcome: 'interested', text: 'Will decide by the weekend.' }
    } else {
      const roll = R.next()
      v.status = roll < 0.45 ? 'new' : roll < 0.9 ? 'confirmed' : 'rescheduled'
    }
    if (v.status !== 'new' && v.status !== 'expired' && R.chance(0.3)) v.remarks.push({ at: at(created, '12:00'), by: v.handlerId, text: R.pick(['Owner will be there, bring IC.', 'Please call the guard house first.', 'Unit is tenanted, give 1 hour notice.']) })
    viewings.push(v)
  }
  viewings.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
  viewings.forEach((v, i) => { v.code = `VIEW-${String(30001 + i)}` })

  // ── Favourites: listings and buildings people keep an eye on (0 = the office demo user) ──
  const favourites = {}
  const pickIds = (arr, n) => [...new Set(Array.from({ length: n }, () => R.pick(arr)?.id).filter(Boolean))]
  if (live.length) favourites[0] = { listings: pickIds(live, 4), titles: pickIds(titles.filter(t => t.status === 0), 2) }
  for (const s of working) {
    if (!R.chance(0.3)) continue
    const near = live.filter(l => l.branchId === s.branchId && l.holderId !== s.id)
    favourites[s.id] = { listings: pickIds(near.length ? near : live, R.int(1, 4)), titles: R.chance(0.4) ? pickIds(titles.filter(t => t.branchId === s.branchId && t.status === 0), 1) : [] }
  }

  // ── Notifications from the last month (to: a staff id, 0 for the office, 'all') ──
  const notices = []
  const add = (to, when, cat, text, link) => notices.push({ id: id(), to, at: when, cat, text, link, readBy: [] })
  const nameOf = sid => byId[sid]?.short || 'Someone'
  const recent = d => d >= L.addDays(asOf, -30)
  const lById = Object.fromEntries(listings.map(l => [l.id, l]))
  for (const v of viewings) {
    const l = lById[v.listingIds[0]]
    if ((v.status === 'new' || v.status === 'rescheduled') && recent(v.created.slice(0, 10))) add(v.handlerId, v.created, 'viewing', `${nameOf(v.requestedBy)} asked to view ${l.code} (${l.title}) on ${v.date} at ${v.time}. Confirm it with the owner.`, `appointments/${v.id}`)
    if (v.status === 'confirmed' && recent(v.created.slice(0, 10))) add(v.requestedBy, at(v.created.slice(0, 10), '15:00'), 'viewing', `${nameOf(v.handlerId)} confirmed your viewing of ${l.code} on ${v.date} at ${v.time}.`, `appointments/${v.id}`)
  }
  for (const [who, f] of Object.entries(favourites)) {
    for (const lid of f.listings) {
      const l = lById[lid]
      if (l?.priceBefore && l.priceUpdated && recent(l.priceUpdated)) {
        const down = l.askPrice < l.priceBefore
        add(Number(who), at(l.priceUpdated), down ? 'good' : 'bad', `${l.code} (${l.title}) ${down ? 'dropped' : 'went up'} from RM ${l.priceBefore.toLocaleString('en-MY')} to RM ${l.askPrice.toLocaleString('en-MY')}.`, `listings/${l.id}`)
      }
    }
    for (const tid of f.titles) {
      for (const l of listings.filter(x => x.titleId === tid && recent(x.created))) add(Number(who), at(l.created), 'listing', `New listing in ${l.title}: ${l.code}, ${l.type === 'sale' ? 'for sale' : 'for rent'} at RM ${l.askPrice.toLocaleString('en-MY')}.`, `listings/${l.id}`)
    }
  }
  for (const l of listings) {
    const last = l.phLog.at(-1)
    if (l.phLog.length > 1 && recent(last.on)) add(last.staffId, at(last.on), 'listing', `You are now the product handler of ${l.code} (${l.title}): ${L.HANDLER_FROM[last.from].toLowerCase()}.`, `listings/${l.id}`)
  }
  const ready = {}
  for (const p of data.payouts) if (p.status === 'approved' && !p.requestId && !p.stacked) ready[p.staffId] = (ready[p.staffId] || 0) + p.amount
  for (const [sid, amount] of Object.entries(ready)) add(Number(sid), at(L.addDays(asOf, -R.int(0, 6)), '11:00'), 'commission', `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} of your commission is ready. Get paid or stack it.`, 'my-pay')
  for (const v of data.vendorRequests.filter(x => x.status === 0 && recent(x.date))) add(0, at(v.date), 'office', `New owner request ${v.ticket}: ${v.category} at ${v.area}, for ${v.forType.toLowerCase()}.`, 'vendor-requests')
  for (const t of titles.filter(x => x.status === 1)) add(0, at(t.requestedOn || asOf), 'office', `${nameOf(t.requestedBy)} asked to add the building "${t.name}" in ${t.area}.`, 'titles')
  add('all', at(L.addDays(asOf, -2), '09:00'), 'notice', 'Monthly sales meeting this Friday, 10 am at HQ. Bring your pipeline.', null)
  notices.sort((a, b) => b.at.localeCompare(a.at))
  // Ones older than a week were read already.
  const weekAgo = L.addDays(asOf, -7)
  for (const n of notices) if (n.at < weekAgo && n.to !== 'all') n.readBy = [n.to]

  return { viewings, favourites, notices: notices.slice(0, 900) }
}

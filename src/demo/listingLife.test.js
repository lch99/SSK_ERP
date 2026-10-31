import { describe, it, expect } from 'vitest'
import { loadSample } from './localApi.js'
import * as erp from './erpApi.js'
import * as L from '../../shared/listings.js'

// The listing life in the demo store: viewings, the product handler rules,
// staff hand-over, favourites and notifications (rules in shared/listings.js).
const tomorrow = () => { const t = new Date(Date.now() + 86400000); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` }

describe('listing life', () => {
  it('books, confirms, moves, and refuses a clash with the product handler', async () => {
    await loadSample()
    let { data } = await erp.getErp()
    const l = data.listings.find(x => x.status === 'active' && !x.dealId)
    const agent = data.staff.find(s => s.status === 'active' && s.id !== l.holderId && (s.type || 'staff') === 'staff')
    const day = tomorrow()
    const body = { listingIds: [l.id], requestedBy: agent.id, customerName: 'Mr. Test', customerPhone: '012-3456789', date: day, time: '10:00', minutes: 30 }
    await expect(erp.bookViewing({ ...body, customerPhone: '123' })).rejects.toThrow(/valid phone/)
    ;({ data } = await erp.bookViewing(body))
    const v = data.viewings.at(-1)
    expect(v).toMatchObject({ status: 'new', handlerId: l.holderId, requestedBy: agent.id, end: '10:30' })
    expect(data.notices.some(n => n.to === l.holderId && n.link === `appointments/${v.id}`)).toBe(true)
    // The handler is busy 10:00–10:30, so 10:15 clashes.
    await expect(erp.bookViewing({ ...body, time: '10:15' })).rejects.toThrow(/already has/)
    ;({ data } = await erp.confirmViewing(v.id, l.holderId))
    expect(data.viewings.find(x => x.id === v.id).status).toBe('confirmed')
    // Moved by the agent: it waits for the handler again, who is told.
    ;({ data } = await erp.rescheduleViewing(v.id, { date: day, time: '15:00', minutes: 45, by: agent.id }))
    expect(data.viewings.find(x => x.id === v.id)).toMatchObject({ status: 'rescheduled', time: '15:00', end: '15:45' })
    await expect(erp.cancelViewing(v.id, ' ', agent.id)).rejects.toThrow(/why/)
    ;({ data } = await erp.cancelViewing(v.id, 'Customer found another unit', agent.id))
    expect(data.viewings.find(x => x.id === v.id).status).toBe('cancelled')
  })

  it('a review goes on the listing follow-ups', async () => {
    let { data } = await erp.getErp()
    const v = data.viewings.find(x => x.status === 'review')
    if (!v) return
    const before = data.listings.find(l => l.id === v.listingIds[0]).followUps.length
    await expect(erp.reviewViewing(v.id, { outcome: 'maybe' })).rejects.toThrow(/how it went/)
    ;({ data } = await erp.reviewViewing(v.id, { outcome: 'offer', text: 'Signing on Monday' }))
    const l = data.listings.find(x => x.id === v.listingIds[0])
    expect(data.viewings.find(x => x.id === v.id).status).toBe('done')
    expect(l.followUps.length).toBe(before + 1)
    expect(l.followUps.some(f => f.remark.includes('Making an offer') && f.remark.includes(v.code))).toBe(true)
  })

  it('a locked co-product handler becomes the product handler, and the slots are checked', async () => {
    let { data } = await erp.getErp()
    const l = data.listings.find(x => x.status === 'active' && !x.dealId)
    const co = data.staff.filter(s => s.status === 'active' && s.branchId === l.branchId && s.id !== l.holderId && (s.type || 'staff') === 'staff')
    await expect(erp.updateListing(l.id, { share: { users: [], pmId: null, coPh: [{ staffId: co[0].id, locked: true }, { staffId: co[0].id }] } })).rejects.toThrow(/two co-product handler slots/)
    ;({ data } = await erp.updateListing(l.id, { share: { users: [], pmId: null, coPh: [{ staffId: co[0].id, locked: true }] } }))
    const after = data.listings.find(x => x.id === l.id)
    expect(after.holderId).toBe(co[0].id)
    expect(after.phLog.at(-1)).toMatchObject({ staffId: co[0].id, from: 'locked' })
    expect(data.notices.some(n => n.to === co[0].id && n.text.includes('product handler of'))).toBe(true)
  })

  it('suspending someone hands their listings on; giving them back returns them', async () => {
    let { data } = await erp.getErp()
    const holder = data.staff.find(s => s.status === 'active' && data.listings.filter(l => l.holderId === s.id && l.status === 'active').length >= 2)
    const theirs = data.listings.filter(l => l.holderId === holder.id && l.status === 'active').map(l => l.id)
    ;({ data } = await erp.setStaffStatus(holder.id, 'suspended'))
    expect(data.runs.handover).toMatchObject({ staffId: holder.id })
    const moved = data.listings.filter(l => theirs.includes(l.id) && l.holderId !== holder.id)
    expect(moved.length).toBe(data.runs.handover.changed)
    expect(moved.length).toBeGreaterThan(0)
    await expect(erp.returnListings(holder.id)).rejects.toThrow(/back on first/)
    ;({ data } = await erp.setStaffStatus(holder.id, 'active'))
    expect(L.handedAway(data.listings, holder.id).length).toBe(moved.length)
    ;({ data } = await erp.returnListings(holder.id))
    expect(data.listings.filter(l => theirs.includes(l.id) && l.holderId === holder.id).length).toBe(theirs.length)
  })

  it('favourites hear about price changes; notices are read per person', async () => {
    let { data } = await erp.getErp()
    const fan = data.staff.find(s => s.status === 'active')
    const l = data.listings.find(x => x.status === 'active' && x.holderId !== fan.id && !(data.favourites[fan.id]?.listings || []).includes(x.id))
    ;({ data } = await erp.toggleFavourite('listings', l.id, fan.id))
    expect(data.favourites[fan.id].listings).toContain(l.id)
    ;({ data } = await erp.updateListing(l.id, { askPrice: l.askPrice - 1000 }))
    const n = data.notices.find(x => x.to === fan.id && x.cat === 'good' && x.text.includes(l.code))
    expect(n).toBeTruthy()
    ;({ data } = await erp.readNotices('all', fan.id))
    expect(data.notices.filter(x => L.noticeFor(x, fan.id, fan.branchId)).every(x => x.readBy.includes(fan.id))).toBe(true)
    ;({ data } = await erp.sendNotice({ to: `branch:${fan.branchId}`, text: 'Branch lunch on Friday' }))
    expect(L.noticeFor(data.notices[0], fan.id, fan.branchId)).toBe(true)
    await expect(erp.sendNotice({ to: 'all', text: ' ' })).rejects.toThrow(/Type the message/)
  })

  it('the office checks run and say what changed', async () => {
    let { data } = await erp.getErp()
    // Re-checking twice changes nothing the second time.
    ;({ data } = await erp.recheckHandlers())
    ;({ data } = await erp.recheckHandlers())
    expect(data.runs.handlers.changed).toBe(0)
    ;({ data } = await erp.recheckBuildingLeads())
    expect(data.runs.leads).toBeTruthy()
    const due = data.listings.filter(l => L.isOutdated(l, data.asOf)).length
    ;({ data } = await erp.markOutdated())
    expect(data.runs.outdated.changed).toBeGreaterThanOrEqual(due ? 1 : 0)
    expect(data.listings.filter(l => L.isOutdated(l, data.asOf)).length).toBe(0)
  })
})

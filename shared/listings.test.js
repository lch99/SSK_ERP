import { describe, it, expect } from 'vitest'
import * as L from './listings.js'

const listing = over => ({ id: 1, type: 'sale', status: 'active', photos: 6, askPrice: 500000, bestPrice: 480000, marketValue: 490000, flags: [],
  holderId: 10, creatorId: 10, share: { users: [], pmId: null, coPh: [] }, followUps: [], titleId: 7, ...over })

describe('price against market value', () => {
  it('bands the Ad Price by % above market value', () => {
    expect(L.priceRating(listing({ askPrice: 500000, marketValue: 490000 }))).toMatchObject({ band: 'red', pct: 2 })
    expect(L.priceRating(listing({ askPrice: 400000, marketValue: 500000 })).band).toBe('red')
    expect(L.priceRating(listing({ askPrice: 525000, marketValue: 500000 })).band).toBe('orange')
    expect(L.priceRating(listing({ askPrice: 560000, marketValue: 500000 })).band).toBe('green')
    expect(L.priceRating(listing({ askPrice: 575000, marketValue: 500000 })).band).toBe('blue')
    expect(L.priceRating(listing({ marketValue: null }))).toBe(null)
  })
})

describe('hot lists', () => {
  it('Hot Sales needs a hot price with the key, vacant or a friendly tenant, or a good price with the key', () => {
    expect(L.hotLists(listing({ flags: ['Vacant'] }))).toContain('hotSale')
    expect(L.hotLists(listing())).not.toContain('hotSale')
    expect(L.hotLists(listing({ askPrice: 525000, marketValue: 500000, flags: [L.KEY_FLAG] }))).toContain('hotSale')
    expect(L.hotLists(listing({ askPrice: 525000, marketValue: 500000, flags: ['Vacant'] }))).not.toContain('hotSale')
  })
  it('Super Hot: best price within 5% of market value, with room to negotiate', () => {
    expect(L.hotLists(listing({ askPrice: 560000, bestPrice: 520000, marketValue: 500000 }))).toContain('superHot')
    expect(L.hotLists(listing({ askPrice: 560000, bestPrice: 530000, marketValue: 500000 }))).not.toContain('superHot')
    expect(L.hotLists(listing({ askPrice: 520000, bestPrice: 520000, marketValue: 500000 }))).not.toContain('superHot')
  })
  it('Rent King: a rental with a market value and the key', () => {
    expect(L.hotLists(listing({ type: 'rental', askPrice: 2000, bestPrice: 1900, marketValue: 1800, flags: [L.KEY_FLAG] }))).toEqual(['rentKing'])
    expect(L.hotLists(listing({ type: 'rental', askPrice: 2000, marketValue: 1800 }))).toEqual([])
  })
  it('only active listings with photos', () => {
    expect(L.hotLists(listing({ flags: ['Vacant'], photos: 0 }))).toEqual([])
    expect(L.hotLists(listing({ flags: ['Vacant'], status: 'sold' }))).toEqual([])
  })
})

describe('who is tied to a listing', () => {
  it('names every role, and nobody else', () => {
    const l = listing({ creatorId: 1, holderId: 2, share: { users: [3], pmId: 4, coPh: [{ staffId: 5 }] } })
    const ctx = { title: { managerId: 6, handlerId: 7 }, leaders: [8] }
    expect(L.listingRoles(l, 1, ctx)).toEqual(['creator'])
    expect(L.listingRoles(l, 2, ctx)).toEqual(['holder'])
    expect(L.listingRoles(l, 4, ctx)).toEqual(['mainPh'])
    expect(L.listingRoles(l, 5, ctx)).toEqual(['coPh'])
    expect(L.listingRoles(l, 6, ctx)).toEqual(['projectManager'])
    expect(L.listingRoles(l, 7, ctx)).toEqual([])
    expect(L.listingRoles(l, 8, ctx)).toEqual(['leader'])
    expect(L.listingRoles(l, 99, ctx)).toEqual([])
  })
  it('hides the phone and unit', () => {
    expect(L.hidePhone('012-345 6789')).toBe('012-•••• 789')
    expect(L.hideAddress({ title: 'Vista Harmoni', area: 'Cheras' })).toBe('Vista Harmoni, Cheras (unit hidden)')
  })
})

describe('product handler', () => {
  const today = '2026-10-31'
  const active = id => id !== 99
  it('a locked co-PH comes first', () => {
    const l = listing({ share: { pmId: 3, coPh: [{ staffId: 4 }, { staffId: 5, locked: true, until: '2026-01-01' }] }, followUps: [{ date: '2026-10-30', by: 4 }] })
    expect(L.pickHandler(l, { today, active })).toEqual({ staffId: 5, from: 'locked' })
  })
  it('then the co-PH with the latest follow-up, if they followed it up at all', () => {
    const l = listing({ share: { pmId: 3, coPh: [{ staffId: 4 }, { staffId: 5 }] }, followUps: [{ date: '2026-10-01', by: 5 }, { date: '2026-10-20', by: 4 }] })
    expect(L.pickHandler(l, { today, active })).toEqual({ staffId: 4, from: 'coPh' })
    const none = listing({ share: { pmId: 3, coPh: [{ staffId: 4 }] }, followUps: [] })
    expect(L.pickHandler(none, { today, active })).toEqual({ staffId: 3, from: 'mainPh' })
  })
  it('expired slots do not count', () => {
    const l = listing({ share: { coPh: [{ staffId: 4, until: '2026-10-30' }] }, followUps: [{ date: '2026-10-20', by: 4 }] })
    expect(L.pickHandler(l, { today, active })).toEqual({ staffId: 10, from: 'kept' })
  })
  it('an inactive handler hands over to the building lead, area manager, creator, then branch manager', () => {
    const l = listing({ holderId: 99, creatorId: 99 })
    expect(L.pickHandler(l, { today, active, title: { managerId: 20 } })).toEqual({ staffId: 20, from: 'projectManager' })
    expect(L.pickHandler({ ...l, type: 'rental' }, { today, active, title: { managerId: 20, handlerId: 21 } })).toEqual({ staffId: 21, from: 'projectHandler' })
    expect(L.pickHandler(l, { today, active, areaManagerId: 30 })).toEqual({ staffId: 30, from: 'areaManager' })
    expect(L.pickHandler({ ...l, creatorId: 40 }, { today, active })).toEqual({ staffId: 40, from: 'creator' })
    expect(L.pickHandler(l, { today, active, branchManagerId: 50 })).toEqual({ staffId: 50, from: 'branchManager' })
    expect(L.pickHandler(l, { today, active })).toBe(null)
  })
})

describe('building leads', () => {
  const listings = [listing({ id: 1, titleId: 7 }), listing({ id: 2, titleId: 7 }), listing({ id: 3, titleId: 8 }),
    ...Array.from({ length: 11 }, (_, i) => listing({ id: 10 + i, titleId: 7, type: 'rental', holderId: 30, flags: [L.KEY_FLAG] }))]
  const deals = [
    { listingId: 1, status: 'closed', type: 'sale', holderId: 20, price: 3000000 },
    { listingId: 2, status: 'closed', type: 'sale', holderId: 20, price: 2500000 },
    { listingId: 2, status: 'submitted', type: 'sale', holderId: 21, price: 9000000 },
    { listingId: 3, status: 'closed', type: 'sale', holderId: 21, price: 9000000 },
  ]
  const ranking = L.buildingRanking(7, { listings, deals })
  it('ranks by full-closed sale value and by rentals with the key', () => {
    expect(ranking.sale).toEqual([{ staffId: 20, n: 5500000 }])
    expect(ranking.rental).toEqual([{ staffId: 30, n: 11 }])
  })
  it('the top handler takes over past the threshold, and keeps it for good past the second', () => {
    expect(L.nextLead('sale', { managerId: 5 }, ranking.sale)).toMatchObject({ staffId: 20, permanent: false, changed: true })
    expect(L.nextLead('sale', { managerId: 5 }, [{ staffId: 20, n: 4000000 }])).toMatchObject({ staffId: 5, changed: false })
    expect(L.nextLead('sale', { managerId: 5 }, [{ staffId: 20, n: 20000000 }])).toMatchObject({ staffId: 20, permanent: true })
    expect(L.nextLead('sale', { managerId: 5, managerPermanent: true }, ranking.sale)).toMatchObject({ staffId: 5, changed: false })
    expect(L.nextLead('rental', { handlerId: null }, ranking.rental)).toMatchObject({ staffId: 30, changed: true })
  })
})

describe('viewing clock', () => {
  const v = { date: '2026-10-31', time: '10:00', end: '10:30' }
  it('unconfirmed viewings expire at their start, confirmed ones wait for review', () => {
    expect(L.viewingClock({ ...v, status: 'new' }, '2026-10-31 09:59')).toBe('new')
    expect(L.viewingClock({ ...v, status: 'new' }, '2026-10-31 10:00')).toBe('expired')
    expect(L.viewingClock({ ...v, status: 'confirmed' }, '2026-10-31 10:15')).toBe('confirmed')
    expect(L.viewingClock({ ...v, status: 'confirmed' }, '2026-10-31 10:30')).toBe('review')
    expect(L.reviewOverdue({ ...v, status: 'review' }, '2026-11-01 10:29')).toBe(false)
    expect(L.reviewOverdue({ ...v, status: 'review' }, '2026-11-01 10:30')).toBe(true)
  })
  it('works out the end time and clashes', () => {
    expect(L.endTime('10:45', 30)).toBe('11:15')
    expect(L.clashes({ date: '2026-11-02', time: '10:00', end: '10:30' }, { date: '2026-11-02', time: '10:15', end: '10:45' })).toBe(true)
    expect(L.clashes({ date: '2026-11-02', time: '10:00', end: '10:30' }, { date: '2026-11-02', time: '10:30', end: '11:00' })).toBe(false)
  })
})

describe('staff clock', () => {
  it('suspends unverified accounts after 7 days and locks idle ones after 60', () => {
    expect(L.staffDue({ status: 'pending', joined: '2026-10-24' }, '2026-10-31')).toBe(null)
    expect(L.staffDue({ status: 'pending', joined: '2026-10-23' }, '2026-10-31')).toBe('suspend')
    expect(L.staffDue({ status: 'active', lastActive: '2026-09-01' }, '2026-10-31')).toBe(null)
    expect(L.staffDue({ status: 'active', lastActive: '2026-08-31' }, '2026-10-31')).toBe('lock')
  })
  it('outdated after 90 days for sale, 45 for rent', () => {
    expect(L.isOutdated(listing({ updated: '2026-08-02' }), '2026-10-31')).toBe(false)
    expect(L.isOutdated(listing({ updated: '2026-08-01' }), '2026-10-31')).toBe(true)
    expect(L.isOutdated(listing({ type: 'rental', updated: '2026-09-15' }), '2026-10-31')).toBe(true)
  })
})

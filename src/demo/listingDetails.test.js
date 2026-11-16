import { describe, it, expect } from 'vitest'
import { loadSample } from './localApi.js'
import * as erp from './erpApi.js'
import * as L from '../../shared/listings.js'

// The rest of the current ERP's listing form (car park, race, placement, renovation, bank value…)
// and landlord checks that are tried again: saved, checked and kept.
describe('listing details', () => {
  const body = (data, more = {}) => ({
    type: 'sale', title: 'Detail Tower', area: 'Kepong', askPrice: 500000, unit: 'A-1-1', ownerName: 'Owner D', ownerPhone: '012-3456789',
    holderId: data.staff.find(s => s.status === 'active').id, ...more,
  })

  it('Add a listing keeps the race, car parks and the other details', async () => {
    await loadSample()
    let { data } = await erp.getErp()
    await expect(erp.addListing(body(data, { placement: 'middle' }))).rejects.toThrow(/listing placement/)
    await expect(erp.addListing(body(data, { carpark: -1 }))).rejects.toThrow(/cannot be negative/)
    ;({ data } = await erp.addListing(body(data, { restriction: 'malay-reserved', carpark: '2', utilityRooms: '1', placement: 'cornerlot', specs: 'renovated',
      renovation: 'fully', renoCost: '45000', pricing: 'nego', bankValue: '480000', land: '22 x 75', shortDescription: ' Corner unit ', renoDescription: '', builtUp: 1000 })))
    const l = data.listings.at(-1)
    expect(l).toMatchObject({ restriction: 'malay-reserved', carpark: 2, utilityRooms: 1, placement: 'cornerlot', specs: 'renovated', renovation: 'fully',
      renoCost: 45000, pricing: 'nego', bankValue: 480000, land: '22 x 75', shortDescription: 'Corner unit' })
    expect('renoDescription' in l).toBe(false)
    expect(L.pricePerSqft(l)).toBe(500)
    expect(L.choiceLabel('restriction', l.restriction)).toBe('Malay Reserved')
  })

  it('videos uploaded with the Add form are kept on the listing', async () => {
    let { data } = await erp.getErp()
    const many = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, name: `v${i}.mp4`, file: `files/${90 + i}/v${i}.mp4` }))
    await expect(erp.addListing(body(data, { title: 'Video Court', videoSet: many }))).rejects.toThrow(/up to \d+ videos/)
    ;({ data } = await erp.addListing(body(data, { title: 'Video Court', videoSet: many.slice(0, 2) })))
    const l = data.listings.at(-1)
    expect(l.videos).toBe(2)
    expect(l.videoSet).toEqual([{ id: 1, name: 'v0.mp4', published: true, file: 'files/90/v0.mp4' }, { id: 2, name: 'v1.mp4', published: true, file: 'files/91/v1.mp4' }])
  })

  it('Edit changes and clears them; the app may send renovation as text', async () => {
    let { data } = await erp.getErp()
    const l = data.listings.find(x => x.title === 'Detail Tower')
    await expect(erp.updateListing(l.id, { pricing: 'cheap' })).rejects.toThrow(/pricing/)
    ;({ data } = await erp.updateListing(l.id, { carpark: '', placement: '', pricing: 'nett', renovation: 'New kitchen and floor tiles' }))
    expect(data.listings.find(x => x.id === l.id)).toMatchObject({ carpark: null, placement: null, pricing: 'nett', renovation: 'New kitchen and floor tiles', restriction: 'malay-reserved' })
    expect(L.choiceLabel('renovation', 'New kitchen and floor tiles')).toBe('New kitchen and floor tiles')
  })

  it('an imported value that is not one of the choices can stay as it is', () => {
    // The import keeps whatever the old record had; saving it again unchanged is fine, a new odd value is not.
    expect(L.listingDetails({ specs: 'semi-reno' }, { specs: 'semi-reno' })).toEqual({ fields: { specs: 'semi-reno' } })
    expect(L.listingDetails({ specs: 'semi-reno' }, {}).error).toMatch(/specs/)
  })
})

describe('landlord checks', () => {
  it('Unable to verify can be tried again, and the earlier try is kept', async () => {
    await loadSample()
    let { data } = await erp.getErp()
    const d = data.deals.find(x => x.landlordCheck?.status === -1)
    await expect(erp.verifyLandlord(d.id, 0, ' ')).rejects.toThrow(/why/)
    ;({ data } = await erp.verifyLandlord(d.id, 0, 'No answer'))
    expect(data.deals.find(x => x.id === d.id).landlordCheck).toMatchObject({ status: 0, remarks: 'No answer', history: [] })
    ;({ data } = await erp.verifyLandlord(d.id, 1, ''))
    const check = data.deals.find(x => x.id === d.id).landlordCheck
    expect(check).toMatchObject({ status: 1, remarks: 'Confirmed by phone.' })
    expect(check.history).toEqual([{ status: 0, on: expect.any(String), remarks: 'No answer' }])
  })
})

import { describe, it, expect } from 'vitest'
import * as A from './erpActions.js'

// The real ERP holds 100,000+ listings and payout lines (and grows every year). A save that
// makes a record finds the next id over all of them: it once spread every id into one
// Math.max(...) call, which overflows the stack at that size, so closing a case failed.
describe('saves at the real ERP\'s size', () => {
  const many = (n, from) => Array.from({ length: n }, (_, i) => ({ id: from + i, code: String(from + i) }))
  const big = () => ({
    staff: [{ id: 1, status: 'active', branchId: 1, type: 'staff' }], listings: many(200000, 10), payouts: many(200000, 300000),
    customers: many(150000, 600000), notices: [], favourites: {},
  })

  it('a notice gets the next id after every record loaded', () => {
    const data = big()
    expect(A.sendNotice({ to: 1, text: 'Hello' })(data, {}, '2026-11-14')).toBeUndefined()
    expect(data.notices[0].id).toBe(749999 + 1)
  })

  it('a new customer gets the next id and the next customer number', () => {
    const data = big()
    const why = A.addCustomer({ name: 'Big Data', phone: '012-345 6789', type: 'Sale', ownerId: 1 })(data, { branches: [{ id: 1 }] }, '2026-11-14')
    expect(why).toBeUndefined()
    const c = data.customers.at(-1)
    expect(c.id).toBe(750000)
    expect(c.code).toBe('750000')
  })
})

describe('a customer\'s phone', () => {
  const data = () => ({ staff: [{ id: 1, status: 'active', branchId: 1, type: 'staff' }], customers: [{ id: 5, code: '5', name: 'Old', phone: 'ask office', type: 'Sale' }], notices: [], favourites: {} })
  const setup = { branches: [{ id: 1 }] }
  it('is any real number, local or abroad; text or a few digits is refused', () => {
    for (const phone of ['012-345 6789', '03-7728 1234', '+65 9123 4567', '(03) 7728-1234']) expect(A.addCustomer({ name: 'A', phone, type: 'Sale', ownerId: 1 })(data(), setup, '2026-11-17')).toBeUndefined()
    for (const phone of ['abc', '12', '012 345 6789 ext 5', '0123456789012345678']) expect(A.addCustomer({ name: 'A', phone, type: 'Sale', ownerId: 1 })(data(), setup, '2026-11-17')).toMatch(/does not look right/)
  })
  it('an imported odd one stays when other fields change; a new odd one is refused', () => {
    expect(A.updateCustomer(5, { name: 'Renamed', phone: 'ask office' })(data(), setup, '2026-11-17')).toBeUndefined()
    expect(A.updateCustomer(5, { phone: 'call me' })(data(), setup, '2026-11-17')).toMatch(/does not look right/)
  })
})

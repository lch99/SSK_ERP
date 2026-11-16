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

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import * as A from './access.js'

const policy = A.defaultPolicy()

describe('role levels', () => {
  it('a higher level includes the lower ones', () => {
    expect(A.allows(policy, 'account', 'moneyIn', 'view')).toBe(true)
    expect(A.allows(policy, 'account', 'moneyIn', 'full')).toBe(true)
    expect(A.allows(policy, 'staff', 'moneyIn', 'view')).toBe(true)
    expect(A.allows(policy, 'staff', 'moneyIn', 'edit')).toBe(false)
    expect(A.allows(policy, 'sale-marketing', 'payouts', 'view')).toBe(false)
  })
  it('the Superadmin is always full, whatever was saved', () => {
    const saved = { superadmin: { scope: 'team', levels: { payouts: 'none' } }, staff: { scope: 'branch', levels: { payouts: 'full', bogus: 'full' } } }
    const p = A.tidyPolicy(saved)
    expect(p.superadmin.scope).toBe('all')
    expect(A.allows(p, 'superadmin', 'payouts', 'full')).toBe(true)
    expect(p.staff.scope).toBe('branch')
    expect(p.staff.levels.payouts).toBe('full')
    expect(p.staff.levels.bogus).toBeUndefined()
    expect(p.staff.levels.customers).toBe('edit')
  })
  it('every role has a level for every area', () => {
    for (const r of A.ROLES) for (const a of A.AREA_KEYS) expect(A.LEVELS).toContain(r.levels[a])
  })
})

describe('actions', () => {
  it('refuses what a role cannot do, and says why', () => {
    expect(A.refusal(policy, 'staff', 'approvePayouts')).toBe('Agent has view on Payouts; this needs Full.')
    expect(A.refusal(policy, 'account', 'approvePayouts')).toBe(null)
    expect(A.refusal(policy, 'sale-marketing', 'addDeal')).toBe('Marketing has no access on Deals (E-Forms); this needs Edit.')
  })
  it('an action without a rule is the Superadmin\'s only', () => {
    expect(A.refusal(policy, 'superadmin', 'somethingNew')).toBe(null)
    expect(A.refusal(policy, 'admin-staff', 'somethingNew')).toMatch(/no access rule yet/)
  })
  it('every ERP action has a rule', () => {
    const src = readFileSync(new URL('../src/erp/ErpContext.jsx', import.meta.url), 'utf8')
    const list = src.match(/Object\.fromEntries\(\[([\s\S]*?)\]\.map/)[1]
    const names = [...list.matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1])
    expect(names.length).toBeGreaterThan(20)
    expect(names.filter(n => !A.ACTIONS[n])).toEqual([])
  })
})

describe('pages', () => {
  it('matches the longest address start', () => {
    expect(A.pathNeeds('money-in')).toEqual({ area: 'moneyIn', level: 'view' })
    expect(A.pathNeeds('money-in/new')).toEqual({ area: 'moneyIn', level: 'edit' })
    expect(A.pathNeeds('deals/42/edit')).toEqual({ area: 'deals', level: 'view' })
    expect(A.pathNeeds('dashboard')).toBe(null)
  })
  it('opens pages by role', () => {
    expect(A.opens(policy, 'staff', 'money-in')).toBe(true)
    expect(A.opens(policy, 'staff', 'money-in/new')).toBe(false)
    expect(A.opens(policy, 'staff', 'dashboard')).toBe(true)
    expect(A.opens(policy, 'admin-staff', 'setup')).toBe(false)
    expect(A.opens(policy, 'superadmin', 'access')).toBe(true)
  })
})

describe('whose records', () => {
  // 1 leads 2 and 3; 3 leads 4. 5 is in another branch.
  const staff = [
    { id: 1, branchId: 10, uplineId: null }, { id: 2, branchId: 10, uplineId: 1 }, { id: 3, branchId: 10, uplineId: 1 },
    { id: 4, branchId: 10, uplineId: 3 }, { id: 5, branchId: 20, uplineId: null }, { id: 6, branchId: 10, uplineId: null },
  ]
  const data = {
    staff,
    deals: [{ id: 100, agentId: 4, holderId: 6, branchId: 10 }, { id: 101, agentId: 6, holderId: 6, branchId: 10 }, { id: 102, agentId: 5, holderId: 5, branchId: 20 }],
    listings: [{ id: 7, holderId: 2, creatorId: 2, branchId: 10 }, { id: 8, holderId: 6, creatorId: 6, branchId: 10 }],
    customers: [{ id: 1, ownerId: 3, branchId: 10 }, { id: 2, ownerId: 6, branchId: 10 }],
    moneyIn: [{ id: 1, dealId: 100 }, { id: 2, dealId: 102 }], moneyOut: [], closes: [{ id: 1, dealId: 101 }],
    payouts: [{ id: 1, dealId: 100, staffId: 4 }, { id: 2, dealId: 100, staffId: 6 }],
    requests: [{ id: 1, staffId: 2 }, { id: 2, staffId: 5 }],
    vendorRequests: [{ id: 1, branchId: 10, listingId: 7 }], enquiries: [{ id: 1, listingId: 8 }], titles: [{ id: 1, branchId: 20 }], areas: [],
  }
  it('finds a leader\'s whole downline', () => {
    expect([...A.teamOf(1, staff)].sort()).toEqual([1, 2, 3, 4])
    expect([...A.teamOf(3, staff)].sort()).toEqual([3, 4])
  })
  it('own and downline: only the team\'s records', () => {
    const d = A.visibleData(data, { staffId: 1 }, 'team')
    expect(d.staff.map(x => x.id).sort()).toEqual([1, 2, 3, 4])
    expect(d.deals.map(x => x.id)).toEqual([100])
    expect(d.moneyIn.map(x => x.id)).toEqual([1])
    expect(d.listings.map(x => x.id)).toEqual([7])
    expect(d.customers.map(x => x.id)).toEqual([1])
    expect(d.payouts.map(x => x.id)).toEqual([1])
    expect(d.requests.map(x => x.id)).toEqual([1])
    expect(d.vendorRequests.map(x => x.id)).toEqual([1])
    expect(d.enquiries).toEqual([])
  })
  it('branch: everything in the viewer\'s branch', () => {
    const d = A.visibleData(data, { staffId: 2 }, 'branch')
    expect(d.deals.map(x => x.id)).toEqual([100, 101])
    expect(d.staff.map(x => x.id)).toEqual([1, 2, 3, 4, 6])
    expect(d.closes.map(x => x.id)).toEqual([1])
    expect(d.requests.map(x => x.id)).toEqual([1])
    expect(d.titles).toEqual([])
  })
  it('all: untouched', () => {
    expect(A.visibleData(data, { staffId: 2 }, 'all')).toBe(data)
  })
})

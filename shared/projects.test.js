import { describe, it, expect } from 'vitest'
import * as J from './projects.js'

const project = { name: 'Vista Kinara' }
const deal = (id, date, agentId, branchId = 1, status = 'closed', title = 'Vista Kinara') =>
  ({ id, type: 'project', date, agentId, branchId, status, property: { title } })
const deals = [
  deal(1, '2026-10-02', 10), deal(2, '2026-10-05', 10), deal(3, '2026-10-09', 11), deal(4, '2026-10-12', 12, 2),
  deal(5, '2026-10-15', 11, 1, 'cancelled'), deal(6, '2026-10-16', 11, 1, 'draft'), deal(7, '2026-09-30', 10),
  deal(8, '2026-10-03', 10, 1, 'closed', 'Laman Seri'),
]
const oct = { from: '2026-10-01', to: '2026-10-31' }

describe('project payout rule', () => {
  const tier = { id: 1, agentRate: 60 }
  it('boost raises both the agent rate and the total', () => {
    expect(J.projectPayout({ payout: { mode: 'boost', boostPct: 2 } }, tier, 85)).toEqual({ agentRate: 62, totalPct: 87 })
  })
  it('custom uses the project total, else Setup', () => {
    const p = { payout: { mode: 'custom', customTotals: { 1: 90 } } }
    expect(J.projectPayout(p, tier, 85)).toEqual({ agentRate: 60, totalPct: 90 })
    expect(J.projectPayout(p, { id: 2, agentRate: 65 }, 86)).toEqual({ agentRate: 65, totalPct: 86 })
    expect(J.validateProjectTotals({ payout: { mode: 'custom', customTotals: { 1: 55 } } }, [{ id: 1, name: 'T1', agentRate: 60 }])[0]).toMatch(/below/)
  })
})

describe('incentive progress', () => {
  it('counts only this project, in the period, not drafts or cancelled', () => {
    const r = J.incentiveProgress({ ...oct, kind: 'target', counts: 'company', steps: [{ units: 10, amount: 3000 }], paidTo: 'agents' }, project, deals, '2026-10-21')
    expect(r.units).toBe(4)
    expect(r.status).toBe('active')
    expect(r.groups[0]).toMatchObject({ units: 4, amount: 0, reached: null, next: { units: 10, amount: 3000 } })
  })
  it('pays the highest target reached, shared by units sold', () => {
    const inc = { ...oct, kind: 'target', counts: 'company', steps: [{ units: 6, amount: 6000 }, { units: 3, amount: 3000 }], paidTo: 'agents' }
    const g = J.incentiveProgress(inc, project, deals, '2026-11-02').groups[0]
    expect(g.amount).toBe(3000)
    expect(g.next.units).toBe(6)
    expect(g.shares.find(s => s.agentId === 10)).toEqual({ agentId: 10, units: 2, amount: 1500 })
    expect(g.shares.reduce((t, s) => t + s.amount, 0)).toBe(3000)
  })
  it('each agent / each branch counts on its own; split keeps the company part', () => {
    const perAgent = J.incentiveProgress({ ...oct, kind: 'target', counts: 'agent', steps: [{ units: 2, amount: 1000 }], paidTo: 'agents' }, project, deals, '2026-10-21')
    expect(perAgent.groups.filter(g => g.amount > 0).map(g => g.key)).toEqual([10])
    const perBranch = J.incentiveProgress({ ...oct, kind: 'perUnit', counts: 'branch', perUnit: 500, paidTo: 'split', agentPct: 80 }, project, deals, '2026-10-21')
    const b1 = perBranch.groups.find(g => g.key === 1)
    expect(b1).toMatchObject({ units: 3, amount: 1500, toAgents: 1200, toCompany: 300 })
    expect(perBranch.total).toBe(2000)
  })
  it('knows upcoming and ended', () => {
    expect(J.incentiveStatus(oct, '2026-09-30')).toBe('upcoming')
    expect(J.incentiveStatus(oct, '2026-11-01')).toBe('ended')
  })
})

describe('checks', () => {
  const ok = { name: 'October push', ...oct, kind: 'target', counts: 'company', steps: [{ units: 10, amount: 3000 }], paidTo: 'agents' }
  it('accepts a good incentive and catches mistakes', () => {
    expect(J.validateIncentive(ok)).toEqual([])
    expect(J.validateIncentive({ ...ok, to: '2026-09-01' })[0]).toMatch(/before the start/)
    expect(J.validateIncentive({ ...ok, steps: [{ units: 5, amount: 1 }, { units: 5, amount: 2 }] })[0]).toMatch(/same number/)
    expect(J.validateIncentive({ ...ok, paidTo: 'split', agentPct: 100 })[0]).toMatch(/between 0% and 100%/)
  })
  it('project needs a name, developer and commission', () => {
    expect(J.validateProject({ name: 'A', developer: 'B', devCommissionPct: 3, payout: { mode: 'setup' } })).toEqual([])
    expect(J.validateProject({ payout: { mode: 'boost', boostPct: 0 } }).length).toBe(4)
  })
})

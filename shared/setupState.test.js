import { describe, it, expect } from 'vitest'
import * as P from './payout.js'
import { emptyState, sampleState, view, applyStep, applySteps, migrate } from './setupState.js'

describe('setupState', () => {
  it('starts with nothing ticked, even steps whose defaults are valid', () => {
    const list = view(emptyState()).checklist
    expect(list.filter(i => i.done)).toEqual([])
    expect(list.find(i => i.key === 'approvals').detail).not.toBe('Not checked yet')     // approvals start blank
    // A wizard page covering two parts is ticked only once both are confirmed.
    const s = sampleState()
    const half = { ...s, confirmed: { ...s.confirmed, numbering: false } }
    expect(view(half).checklist.find(i => i.key === 'approvals').detail).toBe('Not checked yet')
    expect(view(applyStep(half, 'numbering', s.numbering)).checklist.find(i => i.key === 'approvals').done).toBe(true)
  })
  it('sample data completes every step', () => {
    expect(view(sampleState()).checklist.every(i => i.done)).toBe(true)
  })
  it('keeps plan and tier ids across saves, and puts tiers in ladder order', () => {
    const s = sampleState()
    const plans = structuredClone(s.plans)
    plans[0].tiers[0].title = 'Rookie'
    plans[0].tiers.reverse()
    const next = applyStep(s, 'plans', { plans })
    expect(next.plans.map(p => p.id)).toEqual(s.plans.map(p => p.id))
    expect(next.plans[0].tiers.map(t => t.id)).toEqual(s.plans[0].tiers.map(t => t.id))
    expect(next.plans[0].tiers[0]).toMatchObject({ name: 'T1', title: 'Rookie' })
  })
  it('gives the ERP the tiers and totals each branch pays on', () => {
    const v = view(sampleState())
    const [td, , pc] = v.branches
    expect(P.tiersFor(v, td.id).map(t => t.name)).toEqual(v.plans[0].tiers.map(t => t.name))
    expect(P.tiersFor(v, pc.id).map(t => t.name)).toEqual(['P1', 'P2', 'P3', 'P4'])
    const p1 = P.tiersFor(v, pc.id)[0]
    expect(P.resolveTotal(v.totals, { branchId: pc.id, dealType: 'rental', tierId: p1.id })?.pct).toBe(75)
    expect(p1.totals).toBeUndefined()
  })
  it('a branch is on one plan; a plan for other branches must name them', () => {
    const s = sampleState()
    const [td, ch, pc] = s.branches
    const copy = { name: 'Franchise', branchIds: [ch.id, pc.id], tiers: s.plans[0].tiers.map(t => ({ ...t, id: null })) }
    expect(() => applyStep(s, 'plans', { plans: [...s.plans, copy] })).toThrow(/Puchong is on two plans/)
    expect(() => applyStep(s, 'plans', { plans: [s.plans[0], { ...copy, branchIds: [] }] })).toThrow(/pick the branches/)
    const next = applyStep(s, 'plans', { plans: [s.plans[0], { ...copy, branchIds: [ch.id, pc.id] }] })
    expect(next.plans[1].tiers.every(t => !s.plans[0].tiers.some(x => x.id === t.id))).toBe(true)   // new ids
    const v = view(next)
    expect(P.tiersFor(v, ch.id)).toEqual(P.tiersFor(v, pc.id))
    expect(P.tiersFor(v, td.id)).toEqual(v.tiers)
  })
  it('needs a total payout for each deal type in use, at least the agent rate', () => {
    const s = sampleState()
    const plans = structuredClone(s.plans)
    delete plans[0].tiers[1].totals.rental
    expect(() => applyStep(s, 'plans', { plans })).toThrow(/Rental of T2/)
    plans[0].tiers[1].totals.rental = 50
    expect(() => applyStep(s, 'plans', { plans })).toThrow(/at least the agent rate/)
  })
  it('removing a branch takes it off its plan and drops its numbering', () => {
    const s = sampleState()
    const pc = s.branches.find(b => b.code === 'PC'), td = s.branches.find(b => b.code === 'TD')
    const next = applyStep(s, 'branches', { branches: s.branches.filter(b => b.id !== pc.id && b.id !== td.id) })
    expect(next.plans[1].branchIds).toEqual([])
    expect(next.numbering.branches[td.id]).toBeUndefined()
    expect(view(next).checklist.find(i => i.key === 'tiers').detail).toMatch(/Puchong: pick the branches/)
  })
  it('turns data saved before tier plans into plans', () => {
    const v1 = {
      ...emptyState(), plans: undefined, nextId: 100, confirmed: { company: true, tiers: true, payouts: true },
      branches: [{ id: 1, name: 'HQ', code: 'HQ' }, { id: 2, name: 'Klang', code: 'KL' }, { id: 3, name: 'Ipoh', code: 'IP' }],
      tiers: [{ id: 10, name: 'T1', title: '', basis: 'lifetime', threshold: 0, agentRate: 60 }],
      branchTiers: { 3: [{ id: 20, name: 'I1', title: '', basis: 'lifetime', threshold: 0, agentRate: 50 }] },
      totals: [
        { branchId: 0, dealType: 'sale', tierId: 10, totalPct: 85 },
        { branchId: 2, dealType: 'sale', tierId: 10, totalPct: 88 },       // Klang paid more on the company tiers
        { branchId: 3, dealType: 'sale', tierId: 20, totalPct: 70 },
      ],
    }
    const s = migrate(v1)
    expect(s.plans.map(p => [p.name, p.branchIds])).toEqual([['Standard', []], ['Klang', [2]], ['Ipoh', [3]]])
    expect(s.plans[0].tiers[0]).toMatchObject({ id: 10, totals: { sale: 85 } })
    expect(s.plans[1].tiers[0].totals).toEqual({ sale: 88 })
    expect(s.plans[1].tiers[0].id).not.toBe(10)
    expect(s.plans[2].tiers[0]).toMatchObject({ id: 20, totals: { sale: 70 } })
    expect(s.confirmed).toEqual({ company: true, tiers: true })
    expect(migrate(s)).toBe(s)
    const v = view(v1)
    expect(P.resolveTotal(v.totals, { branchId: 2, dealType: 'sale', tierId: P.tiersFor(v, 2)[0].id }).pct).toBe(88)
  })
})

describe('payout rules by date', () => {
  it('keeps the replaced rules for E-Forms dated before the change', () => {
    const s = sampleState()
    const plans = structuredClone(s.plans)
    plans[0].tiers[0].agentRate = 62
    const next = applySteps(s, [['rules-from', { from: '2026-11-01' }], ['plans', { plans, sideSharePct: 60 }],
      ['uplines', { roles: s.roles, splits: { AGA: 30, TSM: 20, GSM: 50 } }]])
    const v = view(next)
    expect(v.ruleHistory).toHaveLength(1)
    expect(P.rulesSince(v)).toBe('2026-11-01')
    const before = P.rulesAt(v, '2026-10-31'), after = P.rulesAt(v, '2026-11-01')
    expect(P.tiersFor(before, v.branches[0].id)[0].agentRate).toBe(60)
    expect(before).toMatchObject({ sideSharePct: 50, splits: { AGA: 20, TSM: 20, GSM: 60 }, rulesUntil: '2026-11-01' })
    expect(P.tiersFor(after, v.branches[0].id)[0].agentRate).toBe(62)
    expect(after).toMatchObject({ sideSharePct: 60, splits: { AGA: 30, TSM: 20, GSM: 50 } })
    expect(P.rulesAt(v, null)).toBe(v)
  })
  it('a later change must start after the last one; correcting needs no date', () => {
    const s = applyStep(sampleState(), 'rules-from', { from: '2026-11-01' })
    expect(() => applyStep(s, 'rules-from', { from: '2026-11-01' })).toThrow(/after 1 Nov 2026/)
    expect(() => applyStep(s, 'rules-from', { from: '' })).toThrow(/date the new rules start/)
    expect(applyStep(s, 'rules-from', { from: '2026-12-01' }).ruleHistory.map(h => h.until)).toEqual(['2026-11-01', '2026-12-01'])
    // Saving plans alone changes the current rules and leaves the history alone.
    expect(applyStep(s, 'plans', { plans: s.plans }).ruleHistory).toHaveLength(1)
  })
  it('the side share defaults to 50 and is checked', () => {
    const s = sampleState()
    expect(view(s).sideSharePct).toBe(50)
    expect(applyStep(s, 'plans', { plans: s.plans, sideSharePct: 70 }).sideSharePct).toBe(70)
    expect(() => applyStep(s, 'plans', { plans: s.plans, sideSharePct: 120 })).toThrow(/0 to 100/)
  })
})

describe('old sample company', () => {
  it('reads as SSK Ventures Sdn Bhd, bank account names too', () => {
    const s = sampleState()
    const old = { ...s, company: { ...s.company, name: 'Sample Realty Sdn Bhd', email: 'admin@sample-realty.example' },
      bankAccounts: s.bankAccounts.map(a => ({ ...a, accountName: a.accountName.replace('SSK Ventures Sdn Bhd', 'Sample Realty Sdn Bhd') })) }
    const v = view(old)
    expect(v.company.name).toBe('SSK Ventures Sdn Bhd')
    expect(v.company.email).toBe('admin@ssk-ventures.example')
    expect(v.bankAccounts.map(a => a.accountName)).toEqual(['SSK Ventures Sdn Bhd', 'SSK Ventures Sdn Bhd - Clients Account'])
  })
  it('leaves any other company alone', () => {
    const s = sampleState()
    expect(view({ ...s, company: { ...s.company, name: 'Another Realty Sdn Bhd' } }).company.name).toBe('Another Realty Sdn Bhd')
  })
})

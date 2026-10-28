import { describe, it, expect } from 'vitest'
import * as P from '../../shared/payout.js'
import { sampleState, view, applyStep } from '../../shared/setupState.js'
import { makeErpSample, nextPayDate, payoutForClose } from './erpSample.js'
import * as A from '../../shared/agents.js'

const AS_OF = '2026-10-21'
const setup = view(sampleState())
const data = makeErpSample(setup, AS_OF)
const r2 = n => Math.round(n * 100) / 100
const sum = (xs, f) => r2(xs.reduce((s, x) => s + f(x), 0))

describe('ERP sample records', () => {
  it('are the same every time for the same Setup', () => {
    expect(JSON.stringify(makeErpSample(setup, AS_OF))).toBe(JSON.stringify(data))
  })

  it('have a sensible size', () => {
    // Small enough to read through in a demo: about 20 people and 70 E-Forms.
    expect(data.staff.length).toBeGreaterThanOrEqual(15)
    expect(data.staff.length).toBeLessThanOrEqual(30)
    expect(data.deals.length).toBeGreaterThanOrEqual(50)
    expect(data.deals.length).toBeLessThanOrEqual(100)
    expect(data.payouts.length).toBeGreaterThan(100)
    expect(JSON.stringify(data).length).toBeLessThan(2_500_000)
  })

  it('link only to records that exist', () => {
    const ids = name => new Set(data[name].map(x => x.id))
    const staff = ids('staff'), deals = ids('deals'), listings = ids('listings'), requests = ids('requests'), archives = ids('archives'), branches = new Set(setup.branches.map(b => b.id))
    for (const s of data.staff) {
      expect(branches.has(s.branchId)).toBe(true)
      if (s.uplineId != null) expect(staff.has(s.uplineId)).toBe(true)
    }
    for (const d of data.deals) {
      expect(staff.has(d.agentId)).toBe(true)
      if (d.holderId != null) expect(staff.has(d.holderId)).toBe(true)
      if (d.listingId != null) expect(listings.has(d.listingId)).toBe(true)
    }
    for (const x of [...data.moneyIn, ...data.moneyOut, ...data.closes]) expect(deals.has(x.dealId)).toBe(true)
    for (const p of data.payouts) {
      expect(staff.has(p.staffId)).toBe(true)
      if (p.requestId != null) expect(requests.has(p.requestId)).toBe(true)
      if (p.archiveId != null) expect(archives.has(p.archiveId)).toBe(true)
    }
  })

  it('pays out exactly what each close brings in, by the Setup rules', () => {
    for (const c of data.closes) {
      const lines = data.payouts.filter(p => p.closeId === c.id)
      expect(r2(sum(lines, l => l.amount) + sum(c.sides, s => s.company))).toBe(c.net)
      expect(sum(c.sides, s => s.base)).toBe(c.net)
      for (const s of c.sides) {
        // A side whose agent had left by the close goes back to the company.
        if (s.retracted) {
          expect(s.company).toBe(s.base)
          expect(data.staff.find(x => x.id === s.staffId).leftOn <= c.date).toBe(true)
          continue
        }
        const earner = lines.find(l => l.side === s.side && l.role === null)
        expect(earner.staffId).toBe(s.staffId)
        expect(earner.pct).toBe(s.agentRate)
        const tier = P.tiersFor(setup, data.staff.find(x => x.id === s.staffId).branchId).find(t => t.id === s.tierId)
        expect(tier.agentRate).toBe(s.agentRate)
      }
    }
  })

  it('closes a deal only for the money that cleared, and all of it once closed', () => {
    for (const d of data.deals) {
      const closes = data.closes.filter(c => c.dealId === d.id)
      const cleared = sum(data.moneyIn.filter(t => t.dealId === d.id && t.status === 'cleared'), t => t.amount)
      expect(sum(closes, c => c.claim)).toBeLessThanOrEqual(Math.min(cleared, d.money.billed))
      if (d.status === 'closed') {
        expect(sum(closes, c => c.claim)).toBe(d.money.billed)
        expect(sum(closes, c => c.net)).toBe(d.money.net)
      }
      if (d.status === 'draft' || d.status === 'cancelled') expect(closes).toHaveLength(0)
    }
  })

  it('numbers cases and vouchers with the Setup numbering', () => {
    const codes = data.deals.map(d => d.code)
    expect(new Set(codes).size).toBe(codes.length)
    const td = setup.branches.find(b => b.code === 'TD')
    expect(data.deals.find(d => d.branchId === td.id && d.type === 'sale').code).toBe('TDS1251')
    const vouchers = data.moneyOut.map(m => m.voucherNo)
    expect(new Set(vouchers).size).toBe(vouchers.length)
    expect(data.moneyOut.find(m => m.branchId === td.id).voucherNo).toBe('VTD0087')
  })

  it('pays lines through salary and incentive requests on the Setup pay day', () => {
    const req = Object.fromEntries(data.requests.map(r => [r.id, r]))
    for (const p of data.payouts) {
      if (p.status === 'new' || p.status === 'queried') expect(p.requestId).toBeNull()
      if (p.requestId) {
        const r = req[p.requestId]
        expect(r.staffId).toBe(p.staffId)
        expect(r.kind).toBe(p.role ? 'incentives' : 'salary')
        expect(r.payOn).toBe(nextPayDate(setup.approvals, p.requestOn))
        expect(p.status === 'paid').toBe(r.status === 'clear')
      }
      if (p.status === 'paid') expect(p.paidOn < AS_OF).toBe(true)
      if (p.archiveId) expect(p.status).toBe('paid')
    }
    expect(new Date(`${nextPayDate({ payRun: 'weekly', payDay: 5 }, '2026-10-21')}T00:00:00Z`).getUTCDay()).toBe(5)
  })

  it('works with no uplines, rental only, and paying as money comes in', () => {
    let s = applyStep(sampleState(), 'uplines', { roles: [], splits: {} })
    s = applyStep(s, 'deal-types', { ...s.dealTypes, sale: { enabled: false, defaultRate: 3 }, project: { enabled: false, defaultRate: 2 } })
    const plain = makeErpSample(view(s), AS_OF)
    expect(plain.deals.every(d => d.type === 'rental')).toBe(true)
    expect(plain.payouts.every(p => p.role === null)).toBe(true)

    // Imported agents replace the made-up people, uplines and tiers included.
    const rows = A.readAgentTable([A.AGENT_COLUMNS.map(A.templateHeader), ...A.exampleAgents(setup).map(r => A.AGENT_COLUMNS.map(c => r[c.key]))]).rows
    const team = applyStep(sampleState(), 'agents', { mode: 'replace', rows })
    const real = makeErpSample(view(team), AS_OF)
    // The imported agents, plus the sample's office staff (admins, accounting, marketing).
    expect(real.staff.filter(x => x.type === 'staff').map(x => x.name).sort()).toEqual(team.agents.map(a => a.name).sort())
    expect(real.staff.filter(x => x.type !== 'staff').every(x => x.role == null && x.uplineId == null)).toBe(true)
    const lead = real.staff.find(x => x.uplineId != null)
    expect(real.staff.find(x => x.id === lead.uplineId).name).toBe(team.agents.find(a => a.id === team.agents.find(b => b.name === lead.name).uplineId).name)
    expect(real.deals.length).toBeGreaterThan(20)

    const received = applyStep(sampleState(), 'approvals', { ...sampleState().approvals, payWhen: 'received' })
    const parts = makeErpSample(view(received), AS_OF)
    expect(parts.deals.some(d => d.status === 'partial')).toBe(true)
  })
})

describe('two agents on one deal', () => {
  const b = setup.branches[0].id
  const person = (id, status) => ({ id, branchId: b, status, uplineId: null, role: null, tierFloorId: null })
  const newcomer = () => ({ lifetime: 0, yearly: 0 })
  const t1 = P.tiersFor(setup, b)[0].agentRate
  it('a retracted side goes back to the company; the other side is not topped up', () => {
    const staff = { 1: person(1, 'active'), 2: person(2, 'inactive') }
    const { sides, lines } = payoutForClose(setup, staff, { agentId: 1, holderId: 2, listingId: 5, type: 'sale', date: AS_OF }, 1000, newcomer)
    expect(sides.map(s => [s.side, s.base, !!s.retracted])).toEqual([['sales', 500, false], ['listing', 500, true]])
    expect(sides[1].company).toBe(500)
    expect(lines.every(l => l.staffId === 1)).toBe(true)
    expect(sum(lines, l => l.amount)).toBe(r2(500 * t1 / 100))
  })
  it('an agent who left after the close is still paid for it', () => {
    const staff = { 1: person(1, 'active'), 2: { ...person(2, 'inactive'), leftOn: '2026-09-01' } }
    const deal = { agentId: 1, holderId: 2, listingId: 5, type: 'sale', date: '2026-07-01' }
    expect(payoutForClose(setup, staff, deal, 1000, newcomer, '2026-08-15').sides.some(s => s.retracted)).toBe(false)
    expect(payoutForClose(setup, staff, deal, 1000, newcomer, '2026-09-01').sides[1].retracted).toBe(true)
  })
  it('a holder taken off the E-Form leaves that portion with the company too', () => {
    const staff = { 1: person(1, 'active') }
    const { sides } = payoutForClose(setup, staff, { agentId: 1, holderId: null, listingId: 5, type: 'sale', date: AS_OF }, 1000, newcomer)
    expect(sides.map(s => [s.side, s.base, !!s.retracted])).toEqual([['sales', 500, false], ['listing', 500, true]])
  })
})

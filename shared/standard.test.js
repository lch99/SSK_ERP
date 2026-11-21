import { describe, it, expect } from 'vitest'
import * as ST from './standard.js'
import * as S from './setupState.js'
import * as P from './payout.js'
import { payoutForClose, erpBlockers } from './erpRules.js'

const std = ST.standardOf({ standard: { kind: 'existing' } })
// A chain: earner 1 → upline 2 → 3 → 4 … with these positions (code per person).
const chain = (...codes) => Object.fromEntries(codes.map((role, i) => [i + 1, { id: i + 1, role, uplineId: i + 1 < codes.length ? i + 2 : null, status: 'active' }]))
const side = (staffById, extra = {}) => ST.existingSide({ standard: std, amount: 10000, earnerId: 1, staffById, bmId: 99, ...extra })
const shape = out => out.lines.map(l => [l.role ?? 'SALARY', l.staffId, l.pct])

describe('the existing standard (the current ERP, 23H2.3)', () => {
  it('has valid defaults', () => {
    expect(ST.validateStandard(std)).toEqual([])
  })

  it('pays an Agent with a full chain in bands to 90%', () => {
    const out = side(chain('AG', 'PTL', 'TL', 'UM'))
    expect(shape(out)).toEqual([['SALARY', 1, 70], ['PTL', 2, 10], ['TL', 3, 5], ['UM', 4, 3], ['BM', 99, 2]])
    expect(out.company).toBe(1000)
    expect(out.lines.reduce((s, l) => s + l.amount, 0)).toBe(9000)
  })

  it('gives a band nobody holds to the Branch Manager', () => {
    // A Senior Negotiator under a Team Leader only: TL band to them, the UM band and the rest to the BM.
    expect(shape(side(chain('SN', 'TL')))).toEqual([['SALARY', 1, 80], ['TL', 2, 5], ['BM', 99, 5]])
    // Nobody above at all.
    expect(shape(side(chain('AG')))).toEqual([['SALARY', 1, 70], ['BM', 99, 20]])
  })

  it('pays both bands to one upline who holds both', () => {
    expect(shape(side(chain('TR', 'TL', 'UM')))).toEqual([['SALARY', 1, 60], ['PTL', 2, 20], ['TL', 2, 5], ['UM', 3, 3], ['BM', 99, 2]])
  })

  it('lets a Unit Manager keep their own UM band, but not a Pre-Unit Manager', () => {
    expect(shape(side(chain('UM')))).toEqual([['SALARY', 1, 85], ['UM', 1, 3], ['BM', 99, 2]])
    expect(shape(side(chain('PUM', 'UM')))).toEqual([['SALARY', 1, 85], ['UM', 2, 3], ['BM', 99, 2]])
    expect(shape(side(chain('PUM')))).toEqual([['SALARY', 1, 85], ['BM', 99, 5]])
  })

  it('pays an Area Manager band to the Area Manager, themselves included', () => {
    expect(shape(side(chain('TL', 'UM', 'AM')))).toEqual([['SALARY', 1, 85], ['UM', 2, 3], ['AM', 3, 2]])
    expect(shape(side(chain('AM')))).toEqual([['SALARY', 1, 85], ['UM', 1, 3], ['AM', 1, 2]])
  })

  it('passes over people who have left', () => {
    const s = chain('AG', 'PTL', 'TL')
    s[2].status = 'inactive'
    expect(shape(side(s))).toEqual([['SALARY', 1, 70], ['PTL', 3, 10], ['TL', 3, 5], ['BM', 99, 5]])
  })

  it("gives the listing creator's part on the listing side", () => {
    // Holder 1 (Agent) under a Team Leader 2; creator 10 (Trainee) under a Pre-Team Leader 11 under a Team Leader 12.
    const s = { ...chain('AG', 'TL', 'UM'),
      10: { id: 10, role: 'TR', uplineId: 11, status: 'active' }, 11: { id: 11, role: 'PTL', uplineId: 12, status: 'active' }, 12: { id: 12, role: 'TL', uplineId: null, status: 'active' } }
    expect(shape(side(s, { creatorId: 10 }))).toEqual([
      ['SALARY', 1, 60], ['CREATOR', 10, 5], ['CREATOR_T', 11, 10], ['CREATOR_T', 12, 5], ['TL', 2, 5], ['UM', 3, 3], ['BM', 99, 2]])
  })

  it('lets a Team Leader holder keep 65 and a senior creator take all 20', () => {
    const s = { ...chain('TL', 'UM'), 10: { id: 10, role: 'TL', uplineId: null, status: 'active' } }
    expect(shape(side(s, { creatorId: 10 }))).toEqual([['SALARY', 1, 65], ['CREATOR', 10, 20], ['UM', 2, 3], ['BM', 99, 2]])
  })

  it("pays a creator who has left nothing: their part goes up their chain, or to the BM", () => {
    const s = { ...chain('SN'), 10: { id: 10, role: 'AG', uplineId: 11, status: 'inactive' }, 11: { id: 11, role: 'TL', uplineId: null, status: 'active' } }
    expect(shape(side(s, { creatorId: 10 }))).toEqual([['SALARY', 1, 60], ['CREATOR_T', 11, 20], ['BM', 99, 10]])
  })

  it('ignores a creator who is the holder', () => {
    expect(shape(side(chain('AG', 'TL'), { creatorId: 1 }))).toEqual([['SALARY', 1, 70], ['PTL', 2, 10], ['TL', 2, 5], ['BM', 99, 5]])
  })

  it('leaves BM profit with the company when the branch has no Branch Manager account', () => {
    const out = side(chain('AG'), { bmId: null })
    expect(shape(out)).toEqual([['SALARY', 1, 70]])
    expect(out.company).toBe(3000)
  })

  it("pays the closing agent's own branch BM, or the case's when their branch has none", () => {
    const st = { ...std, branchManagers: { 1: 90, 2: 91 } }
    expect(ST.branchManagerFor(st, 'sales', { deal: { branchId: 1 }, earner: { branchId: 2 } })).toBe(91)
    expect(ST.branchManagerFor(st, 'sales', { deal: { branchId: 1 }, earner: { branchId: 3 } })).toBe(90)
    expect(ST.branchManagerFor(st, 'listing', { deal: { branchId: 1 }, earner: { branchId: 2 } })).toBe(90)
    expect(ST.branchManagerFor(st, 'listing', { deal: { branchId: 4 }, earner: { branchId: 2 } })).toBe(null)
  })

  it('checks the values', () => {
    expect(ST.validateStandard({ ...std, cap: 120 })[0]).toMatch(/at most 100/)
    expect(ST.validateStandard({ ...std, bands: [{ code: 'TL', upTo: 85, from: 'XX', selfFrom: '' }] }).join(' ')).toMatch(/pick the position/)
    expect(ST.validateStandard({ ...std, positions: [...std.positions, { code: 'AG', name: 'Again', rate: 70, rank: '' }] }).join(' ')).toMatch(/Two positions/)
  })
})

describe('the existing standard in Setup and on a close', () => {
  const base = () => {
    let s = S.emptyState()
    s = S.applyStep(s, 'branches', { branches: [{ name: 'Taman Desa', code: 'TD' }] })
    return s
  }

  it('is saved by its step, ticks the payout part of the checklist, and lets the ERP run without tiers', () => {
    let s = base()
    s = S.applyStep(s, 'standard', { ...ST.existingDefault(), kind: 'existing', branchManagers: { [s.branches[0].id]: 7 } })
    const v = S.view(s)
    expect(v.standard.kind).toBe('existing')
    expect(v.standard.branchManagers).toEqual({ [s.branches[0].id]: 7 })
    expect(v.checklist.find(i => i.key === 'tiers')).toMatchObject({ title: 'Payout standard', done: true })
    expect(erpBlockers(v)).not.toContain('Set up the tiers.')
  })

  it('refuses wrong values', () => {
    expect(() => S.applyStep(base(), 'standard', { ...ST.existingDefault(), kind: 'existing', cap: 0 })).toThrow(/paid-out share/)
  })

  it("keeps people's positions when Setup is saved", () => {
    let s = base()
    s = { ...s, agents: [{ id: 50, name: 'A', branchId: s.branches[0].id, position: 'TL', uplineId: null, tierId: null }] }
    s = S.applyStep(s, 'standard', { ...ST.existingDefault(), kind: 'existing' })
    expect(s.agents[0].position).toBe('TL')
    // Also while the CMS pays (the positions stay for when the company comes back to them).
    s = S.applyStep(s, 'standard', { kind: 'cms' })
    expect(s.agents[0].position).toBe('TL')
  })

  it('applies from a date: earlier E-Forms keep the rules they were made under', () => {
    let s = base()
    s = S.applyStep(s, 'standard', { ...ST.existingDefault(), kind: 'existing' })
    s = S.applyStep(s, 'rules-from', { from: '2027-01-01' })
    s = S.applyStep(s, 'standard', { kind: 'cms' })
    const v = S.view(s)
    expect(ST.standardOf(P.rulesAt(v, '2026-12-31')).kind).toBe('existing')
    expect(ST.standardOf(P.rulesAt(v, '2027-01-01')).kind).toBe('cms')
  })

  it('pays a close with both halves, the listing creator, and each side its Branch Manager', () => {
    let s = base()
    const br = s.branches[0].id
    s = S.applyStep(s, 'branches', { branches: [...s.branches, { name: 'Cheras', code: 'CH' }] })
    const ch = s.branches[1].id
    s = S.applyStep(s, 'standard', { ...ST.existingDefault(), kind: 'existing', branchManagers: { [br]: 90, [ch]: 91 } })
    const setup = S.view(s)
    const staff = {
      1: { id: 1, role: 'AG', uplineId: 2, branchId: ch, status: 'active' },   // closes the deal and holds the listing
      2: { id: 2, role: 'TL', uplineId: null, branchId: ch, status: 'active' },
      5: { id: 5, role: 'SN', uplineId: 2, branchId: br, status: 'active' },   // created the listing
    }
    const deal = { agentId: 1, holderId: 1, listingId: 77, branchId: br, type: 'sale', date: '2026-12-01' }
    const { sides, lines } = payoutForClose(setup, staff, deal, 10000, () => ({ lifetime: 0, yearly: 0 }), '2026-12-02', null, () => ({ id: 77, creatorId: 5 }))
    expect(sides.map(x => [x.side, x.base])).toEqual([['sales', 5000], ['listing', 5000]])
    const of = sd => lines.filter(l => l.side === sd).map(l => [l.role ?? 'SALARY', l.staffId, l.pct])
    // The closing agent's side: their own branch's BM (Cheras).
    expect(of('sales')).toEqual([['SALARY', 1, 70], ['PTL', 2, 10], ['TL', 2, 5], ['BM', 91, 5]])
    // The listing side: the creator (a Senior Negotiator takes 5, their Team Leader the rest), the case's branch BM.
    expect(of('listing')).toEqual([['SALARY', 1, 60], ['CREATOR', 5, 5], ['CREATOR_T', 2, 15], ['TL', 2, 5], ['BM', 90, 5]])
    expect(lines.reduce((t, l) => t + l.amount, 0)).toBe(9000)
  })
})

describe('a branch on its own numbers (a Branch Partner\'s, within the existing standard)', () => {
  const company = ST.standardOf({ standard: { kind: 'existing' } })
  const own = { cap: 92, rates: { AG: 75 }, bands: { AM: 92 }, creator: { pct: 18, steps: { TL: 18 } } }
  const setup = { standard: { ...ST.existingDefault(), kind: 'existing', branchRules: { 7: own } } }

  it('takes the branch\'s numbers over the company\'s, and only for that branch', () => {
    const st = ST.standardFor(setup, 7)
    expect([st.cap, st.positions.find(p => p.code === 'AG').rate, st.positions.find(p => p.code === 'TL').rate]).toEqual([92, 75, 85])
    expect(st.bands.map(b => b.upTo)).toEqual([80, 85, 88, 92])
    expect([st.creator.pct, st.creator.holderKeeps, st.creator.steps.map(s => s.upTo)]).toEqual([18, 60, [5, 15, 18]])
    expect(ST.validateStandard(st)).toEqual([])
    expect(ST.moneyKeyOf(ST.standardFor(setup, 8))).toBe(ST.moneyKeyOf(company))
    expect(ST.moneyKeyOf(ST.standardFor(setup, null))).toBe(ST.moneyKeyOf(company))
  })

  it('keeps what it changed in the shape Setup stores, and the positions stay the company\'s', () => {
    const st = ST.standardFor(setup, 7)
    expect(ST.moneyKeyOf(ST.standardFor({ standard: { ...setup.standard, branchRules: { 7: ST.ownRulesOf(st) } } }, 7))).toBe(ST.moneyKeyOf(st))
    expect(st.positions.map(p => [p.code, p.rank])).toEqual(company.positions.map(p => [p.code, p.rank]))
  })

  it('pays each side on its earner\'s branch: own numbers in that branch, the company\'s elsewhere', () => {
    let s = S.emptyState()
    s = S.applyStep(s, 'branches', { branches: [{ name: 'Taman Desa', code: 'TD' }, { name: 'Kepong', code: 'KP' }] })
    const [td, kp] = s.branches.map(b => b.id)
    s = S.applyStep(s, 'standard', { ...ST.existingDefault(), kind: 'existing', branchManagers: { [td]: 90, [kp]: 91 }, branchRules: { [kp]: { cap: 92, rates: { AG: 75 }, bands: { AM: 92 } } } })
    const staff = {
      1: { id: 1, role: 'AG', uplineId: 2, branchId: kp, status: 'active' },   // Kepong: closes the deal
      2: { id: 2, role: 'TL', uplineId: null, branchId: kp, status: 'active' },
      3: { id: 3, role: 'AG', uplineId: 4, branchId: td, status: 'active' },   // Taman Desa: holds the listing
      4: { id: 4, role: 'TL', uplineId: null, branchId: td, status: 'active' },
    }
    const deal = { agentId: 1, holderId: 3, listingId: 77, branchId: td, type: 'sale', date: '2026-12-01' }
    const { sides, lines } = payoutForClose(S.view(s), staff, deal, 10000, () => ({ lifetime: 0, yearly: 0 }), '2026-12-02', null, () => ({ id: 77, creatorId: 3 }))
    const of = sd => lines.filter(l => l.side === sd).map(l => [l.role ?? 'SALARY', l.staffId, l.pct])
    // Kepong's agent: 75 own rate, PTL band nobody below TL holds… the TL takes 80–85, and the BM the rest up to Kepong's 92.
    expect(of('sales')).toEqual([['SALARY', 1, 75], ['PTL', 2, 5], ['TL', 2, 5], ['BM', 91, 7]])
    expect(sides.find(x => x.side === 'sales').totalPct).toBe(92)
    // Taman Desa's holder: the company's numbers (70, up to 90).
    expect(of('listing')).toEqual([['SALARY', 3, 70], ['PTL', 4, 10], ['TL', 4, 5], ['BM', 90, 5]])
    expect(sides.find(x => x.side === 'listing').totalPct).toBe(90)
  })

  it('Setup keeps branches\' numbers when the Superadmin saves the standard, and drops removed branches\'', () => {
    let s = S.emptyState()
    s = S.applyStep(s, 'branches', { branches: [{ name: 'Taman Desa', code: 'TD' }, { name: 'Kepong', code: 'KP' }] })
    const [td, kp] = s.branches.map(b => b.id)
    s = S.applyStep(s, 'standard', { ...ST.existingDefault(), kind: 'existing', branchRules: { [kp]: own } })
    s = S.applyStep(s, 'standard', { ...ST.existingDefault(), kind: 'existing', cap: 90 })
    expect(ST.branchRulesOf(S.view(s).standard, kp)).toEqual(own)
    s = S.applyStep(s, 'branches', { branches: [s.branches.find(b => b.id === td)] })
    s = S.applyStep(s, 'standard', { ...ST.existingDefault(), kind: 'existing' })
    expect(S.view(s).standard.branchRules).toEqual({})
  })
})

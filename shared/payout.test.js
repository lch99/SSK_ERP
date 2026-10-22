import { describe, it, expect } from 'vitest'
import * as P from './payout.js'

const tiers = [
  { id: 1, name: 'T1', basis: 'lifetime', threshold: 0, agentRate: 60 },
  { id: 2, name: 'T2', basis: 'lifetime', threshold: 30000, agentRate: 65 },
  { id: 3, name: 'T3', basis: 'yearly', threshold: 100000, agentRate: 80 },
]
const roles = [{ code: 'AGA', name: 'Agent Leader' }, { code: 'TSM', name: 'Team Sales Manager' }, { code: 'GSM', name: 'Group Sales Manager' }]

describe('validateTiers', () => {
  it('accepts a valid ladder', () => expect(P.validateTiers(tiers)).toEqual([]))
  it('needs the first threshold at 0', () => {
    expect(P.validateTiers([{ ...tiers[0], threshold: 10 }])[0]).toMatch(/must be RM 0/)
  })
  it('rejects lifetime after yearly and non-rising thresholds', () => {
    const errs = P.validateTiers([tiers[0], tiers[2], { ...tiers[1], threshold: 0 }])
    expect(errs.some(e => /come before the yearly/.test(e))).toBe(true)
    expect(errs.some(e => /higher than the tier before/.test(e))).toBe(true)
  })
  it('rejects duplicate names and bad rates', () => {
    const errs = P.validateTiers([tiers[0], { ...tiers[1], name: 't1', agentRate: 100 }])
    expect(errs.some(e => /Two tiers/.test(e))).toBe(true)
    expect(errs.some(e => /agent rate/.test(e))).toBe(true)
  })
})

describe('computeTierIndex', () => {
  it('climbs lifetime, then yearly only from the top lifetime tier', () => {
    expect(P.computeTierIndex(0, 0, tiers)).toBe(0)
    expect(P.computeTierIndex(30000, 0, tiers)).toBe(1)
    expect(P.computeTierIndex(30000, 150000, tiers)).toBe(2)
    expect(P.computeTierIndex(10000, 150000, tiers)).toBe(0)
  })
  it('respects the floor', () => expect(P.computeTierIndex(0, 0, tiers, 1)).toBe(1))
})

describe('splits', () => {
  it('lists every combination of two or more uplines', () => {
    expect(P.roleCombos(roles).map(P.comboKey)).toEqual(['AGA+GSM', 'AGA+TSM', 'TSM+GSM', 'AGA+TSM+GSM'])
  })
  it('defaults juniors to 20% each', () => {
    expect(P.defaultSplit(['AGA', 'TSM', 'GSM'])).toEqual({ AGA: 20, TSM: 20, GSM: 60 })
  })
  it('requires every combination to add to 100', () => {
    const splits = P.normalizeSplits({}, roles)
    expect(P.validateSplits(splits, roles)).toEqual([])
    splits['AGA+TSM'].TSM = 70
    expect(P.validateSplits(splits, roles)[0]).toMatch(/add up to 90%/)
  })
})

describe('totals', () => {
  const totals = [
    { branchId: 0, dealType: 'sale', tierId: 1, totalPct: 85 },
    { branchId: 7, dealType: 'sale', tierId: 1, totalPct: 88 },
  ]
  it('prefers the branch override, falls back to the company default', () => {
    expect(P.resolveTotal(totals, { branchId: 7, dealType: 'sale', tierId: 1 })).toEqual({ pct: 88, source: 'branch' })
    expect(P.resolveTotal(totals, { branchId: 9, dealType: 'sale', tierId: 1 })).toEqual({ pct: 85, source: 'company' })
    expect(P.resolveTotal(totals, { branchId: 9, dealType: 'rental', tierId: 1 })).toBeNull()
  })
  it('cannot be below the agent rate or above 100', () => {
    expect(P.validateTotal(59, 60)).toMatch(/at least/)
    expect(P.validateTotal(101, 60)).toMatch(/more than 100/)
    expect(P.validateTotal(85, 60)).toBeNull()
  })
})

describe('distribute', () => {
  const splits = P.normalizeSplits({}, roles)
  it('shares the pool and always adds up to 100', () => {
    const out = P.distribute({ agentRate: 60, totalPct: 85, uplines: ['AGA', 'TSM', 'GSM'], splits, roles })
    expect(out).toEqual({ agent: 60, uplines: { AGA: 5, TSM: 5, GSM: 15 }, company: 15 })
  })
  it('gives a lone upline the whole pool', () => {
    expect(P.distribute({ agentRate: 60, totalPct: 85, uplines: ['TSM'], splits, roles }).uplines).toEqual({ TSM: 25 })
  })
  it('puts rounding on the most senior upline', () => {
    const odd = { ...splits, 'AGA+TSM+GSM': { AGA: 33.33, TSM: 33.33, GSM: 33.34 } }
    const out = P.distribute({ agentRate: 65, totalPct: 86, uplines: ['AGA', 'TSM', 'GSM'], splits: odd, roles })
    const sum = out.agent + out.company + Object.values(out.uplines).reduce((a, b) => a + b, 0)
    expect(Math.round(sum * 100)).toBe(10000)
  })
  it('without uplines the company keeps the rest', () => {
    expect(P.distribute({ agentRate: 70, totalPct: 90, uplines: [], splits, roles })).toEqual({ agent: 70, uplines: {}, company: 30 })
  })
})

describe('numbering', () => {
  it('builds case and voucher numbers', () => {
    const n = { letters: { sale: 'S' }, caseDigits: 4, voucherPrefix: 'PV', voucherDigits: 5 }
    expect(P.previewCaseNo(n, 'sale', 'TD', 12)).toBe('STD0012')
    expect(P.previewVoucherNo(n, 'TD')).toBe('PVTD00001')
  })
  it('catches clashing prefixes', () => {
    const n = { letters: { sale: 'S', rental: 's' }, caseDigits: 4, voucherDigits: 4, voucherPrefix: 'PV' }
    const dt = { sale: { enabled: true }, rental: { enabled: true } }
    expect(P.validateNumbering(n, dt)[0]).toMatch(/clash/)
  })
})

describe('branch numbering', () => {
  const branches = [{ id: 1, name: 'Taman Desa', code: 'TD' }, { id: 2, name: 'Cheras', code: 'CH' }]
  const dt = { sale: { enabled: true }, rental: { enabled: true } }
  const base = { letters: { sale: 'S', rental: 'R' }, caseDigits: 4, voucherPrefix: 'PV', voucherDigits: 4 }

  it('uses the default formula unless the branch sets its own', () => {
    const n = { ...base, branches: { 1: { prefixes: { sale: 'TDS', voucher: 'PTD' }, starts: { sale: 1251 } } } }
    expect(P.formatNumber(n, 'sale', branches[0])).toBe('TDS1251')
    expect(P.formatNumber(n, 'rental', branches[0])).toBe('RTD0001')
    expect(P.formatNumber(n, 'voucher', branches[0])).toBe('PTD0001')
    expect(P.formatNumber(n, 'sale', branches[1])).toBe('SCH0001')
    expect(P.validateNumbering(n, dt, branches)).toEqual([])
  })
  it('catches a branch prefix that clashes with another branch', () => {
    const n = { ...base, branches: { 2: { prefixes: { sale: 'STD' } } } }
    expect(P.validateNumbering(n, dt, branches)[0]).toMatch(/Taman Desa Sub-Sales and Cheras Sub-Sales would both use "STD"/)
  })
  it('checks prefixes and first numbers', () => {
    const n = { ...base, branches: { 1: { prefixes: { sale: 'T-D' }, starts: { rental: 0, voucher: 10000 } } } }
    const errs = P.validateNumbering(n, dt, branches)
    expect(errs.some(e => /prefix must be 1–8 letters or numbers/.test(e))).toBe(true)
    expect(errs.filter(e => /first number/.test(e)).length).toBe(2)
  })
  it('drops blanks and branches that no longer exist', () => {
    const raw = { 1: { prefixes: { sale: ' tds ', rental: '' }, starts: { sale: '1251', rental: '' } }, 9: { prefixes: { sale: 'X' } } }
    expect(P.cleanBranchNumbering(raw, branches)).toEqual({ 1: { prefixes: { sale: 'TDS' }, starts: { sale: 1251 } } })
  })
})

describe('setupChecklist', () => {
  it('flags missing company totals per enabled deal type', () => {
    const list = P.setupChecklist({
      company: { name: 'SSK', regNo: '123' },
      branches: [{ id: 1, name: 'HQ', code: 'HQ' }],
      dealTypes: { sale: { enabled: true, defaultRate: 3 }, sstPct: 8 },
      tiers, roles: [], splits: {},
      totals: [{ branchId: 0, dealType: 'sale', tierId: 1, totalPct: 85 }],
      numbering: { letters: { sale: 'S' }, caseDigits: 4, voucherDigits: 4, voucherPrefix: 'PV' },
    })
    const byKey = Object.fromEntries(list.map(i => [i.key, i]))
    expect(byKey.company.done).toBe(true)
    expect(byKey.tiers.done).toBe(false)
    expect(byKey.tiers.detail).toMatch(/total payout of T2/)
    expect(byKey.uplines.done).toBe(true)
  })
})

describe('company, banks and approvals', () => {
  it('needs the BOVAEPM licence and REA once those fields exist', () => {
    expect(P.validateCompany({ name: 'A', regNo: '1' })).toEqual([])
    const errs = P.validateCompany({ name: 'A', regNo: '1', licenceNo: '', reaName: '', reaNo: '' })
    expect(errs.length).toBe(3)
  })
  it('bank accounts: digits, no duplicates, one operating account', () => {
    const ok = { bank: 'Maybank', accountName: 'A', accountNo: '5140 0000 0001', purpose: 'operating' }
    expect(P.validateBankAccounts([ok])).toEqual([])
    expect(P.validateBankAccounts([])[0]).toMatch(/at least one/)
    expect(P.validateBankAccounts([{ ...ok, accountNo: '12ab' }])[0]).toMatch(/6–20 digits/)
    expect(P.validateBankAccounts([ok, { ...ok, accountNo: '514000000001' }])[0]).toMatch(/listed twice/)
    expect(P.validateBankAccounts([{ ...ok, purpose: 'client' }])[0]).toMatch(/Operating/)
  })
  it('approvals: every choice is needed; boss limit only for manager approval', () => {
    const a = { dealApprover: 'manager', bossAbove: 20000, refundApprover: 'boss', payWhen: 'full', payRun: 'weekly', payDay: 5 }
    expect(P.validateApprovals(a)).toEqual([])
    expect(P.describeApprovals(a)).toBe('Branch manager approves, boss too above RM 20,000 · paid every Friday')
    expect(P.describeApprovals({ ...a, payRun: 'monthly', payDay: 22 })).toMatch(/on the 22nd$/)
    expect(P.describeApprovals({ ...a, payRun: 'monthly', payDay: 11 })).toMatch(/on the 11th$/)
    expect(P.validateApprovals({ ...a, payRun: 'monthly', payDay: 31 })[0]).toMatch(/1 to 28/)
    expect(P.validateApprovals({}).length).toBe(4)
  })
})

describe('dealMoney', () => {
  it('adds SST on top and takes co-broke and referral off our share', () => {
    expect(P.dealMoney({ fee: 18000, sstPct: 8, sstMode: 'on_top', coBroke: true, coaSharePct: 50, referral: true, referralPct: 10 }))
      .toEqual({ fee: 18000, sst: 1440, billed: 19440, coBroke: 9000, ours: 9000, referral: 900, net: 8100 })
  })
  it('takes SST out of a fee that already includes it', () => {
    const m = P.dealMoney({ fee: 10800, sstPct: 8, sstMode: 'included' })
    expect(m).toMatchObject({ fee: 10000, sst: 800, billed: 10800, coBroke: 0, referral: 0, net: 10000 })
  })
})

describe('deal sides and payout lines', () => {
  const splits = P.normalizeSplits({}, roles)
  const staff = {
    1: { id: 1, uplineId: 2, role: null },
    2: { id: 2, uplineId: 3, role: 'AGA' },
    3: { id: 3, uplineId: 4, role: 'TSM' },
    4: { id: 4, uplineId: 5, role: 'TSM' },   // a second TSM further up is skipped
    5: { id: 5, uplineId: null, role: 'GSM' },
  }
  it('splits between two people, or gives one person everything', () => {
    expect(P.dealSides(1, 2).map(s => [s.side, s.pct])).toEqual([['sales', 50], ['listing', 50]])
    expect(P.dealSides(1, 1)).toEqual([{ side: 'sales', staffId: 1, pct: 100 }])
    expect(P.dealSides(1, null)).toHaveLength(1)
  })
  it('finds the nearest holder of each upline role', () => {
    expect(P.uplineHolders(staff, 1, roles)).toEqual({ AGA: 2, TSM: 3, GSM: 5 })
    expect(P.uplineHolders(staff, 3, roles)).toEqual({ TSM: 4, GSM: 5 })
  })
  it('prices lines so they and the company add up to the amount', () => {
    const { lines, company } = P.payoutLines({ amount: 4629.63, earnerId: 1, agentRate: 60, totalPct: 85,
      holders: { AGA: 2, TSM: 3, GSM: 5 }, splits, roles })
    expect(lines.map(l => [l.staffId, l.role, l.pct])).toEqual([[1, null, 60], [2, 'AGA', 5], [3, 'TSM', 5], [5, 'GSM', 15]])
    expect(lines[0].amount).toBe(2777.78)
    const sum = lines.reduce((s, l) => s + l.amount, 0) + company
    expect(Math.round(sum * 100)).toBe(462963)
  })
  it('without uplines pays only the earner', () => {
    const { lines, company } = P.payoutLines({ amount: 1000, earnerId: 1, agentRate: 70, totalPct: 90, holders: {}, splits, roles })
    expect(lines).toEqual([{ staffId: 1, role: null, pct: 70, amount: 700 }])
    expect(company).toBe(300)
  })
  it('payslip withholds tax unless exempt', () => {
    expect(P.payslipTotals([1000, 250.5], 2)).toEqual({ gross: 1250.5, wht: 25.01, net: 1225.49 })
    expect(P.payslipTotals([1000], 2, true)).toEqual({ gross: 1000, wht: 0, net: 1000 })
  })
})

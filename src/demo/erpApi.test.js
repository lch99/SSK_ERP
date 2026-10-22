import { describe, it, expect } from 'vitest'
import { loadSample } from './localApi.js'
import * as erp from './erpApi.js'

// No localStorage under the test runner: both stores fall back to memory.
describe('ERP demo actions', () => {
  it('runs a deal from cleared cash to a paid, archived case', async () => {
    await loadSample()
    let { data } = await erp.getErp()
    const cleared = id => data.moneyIn.filter(t => t.dealId === id && t.status === 'cleared').reduce((s, t) => s + t.amount, 0)
    const received = id => data.moneyIn.filter(t => t.dealId === id && !['returned', 'invalid'].includes(t.status)).reduce((s, t) => s + t.amount, 0)
    // A deal still collecting whose payments, once checked, cover the commission.
    const short = data.deals.find(d => d.status === 'submitted' && received(d.id) < d.money.billed && cleared(d.id) > 0)
    if (short) await expect(erp.closeDeal(short.id)).rejects.toThrow(/paid in full/)
    const deal = data.deals.find(d => d.status === 'submitted' && received(d.id) >= d.money.billed)
    for (const t of data.moneyIn.filter(t => t.dealId === deal.id && t.status !== 'cleared')) ({ data } = await erp.setMoneyInStatus(t.id, 'cleared'))
    ;({ data } = await erp.closeDeal(deal.id))
    const lines = data.payouts.filter(p => p.dealId === deal.id)
    const close = data.closes.find(c => c.dealId === deal.id)
    const total = lines.reduce((s, l) => s + l.amount, 0) + close.sides.reduce((s, x) => s + x.company, 0)
    expect(Math.round(total * 100)).toBe(Math.round(deal.money.net * 100))
    expect(lines.every(l => l.status === 'new')).toBe(true)
    expect(data.deals.find(d => d.id === deal.id).status).toBe('closed')

    ;({ data } = await erp.approvePayouts(lines.map(l => l.id)))
    expect(data.payouts.filter(p => p.dealId === deal.id).every(p => p.status === 'approved')).toBe(true)
    // Each person asks for their pay: salary for own lines, incentives for overrides.
    const people = [...new Set(lines.map(l => l.staffId))]
    ;({ data } = await erp.createRequests(people, 'salary'))
    if (lines.some(l => l.role)) ({ data } = await erp.createRequests(people, 'incentives'))
    const mine = data.payouts.filter(p => p.dealId === deal.id)
    expect(mine.every(p => p.requestId)).toBe(true)
    for (const rid of new Set(mine.map(p => p.requestId))) ({ data } = await erp.setRequestStatus(rid, 'clear'))
    expect(data.payouts.filter(p => p.dealId === deal.id).every(p => p.status === 'paid')).toBe(true)
    ;({ data } = await erp.archiveCases())
    expect(data.payouts.filter(p => p.dealId === deal.id).every(p => p.archiveId)).toBe(true)
    await expect(erp.closeDeal(deal.id)).rejects.toThrow(/Only a submitted E-Form/)
  })

  it('asks for a reason before querying', async () => {
    const { data } = await erp.getErp()
    const line = data.payouts.find(p => (p.status === 'new' || p.status === 'approved') && !p.requestId)
    await expect(erp.queryPayouts([line.id], ' ')).rejects.toThrow(/Say what needs checking/)
    const after = (await erp.queryPayouts([line.id], 'Missing SPA')).data.payouts.find(p => p.id === line.id)
    expect(after).toMatchObject({ status: 'queried', query: 'Missing SPA', requestId: null })
  })
})

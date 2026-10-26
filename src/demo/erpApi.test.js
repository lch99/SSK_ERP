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

  it('records a payment with the current form rules', async () => {
    const { data } = await erp.getErp()
    const deal = data.deals.find(d => d.status === 'submitted')
    const pay = { dealId: deal.id, amount: '1500', bankOn: '2026-01-05', method: 'online', reference: 'IBG123456789', purpose: 'commission', remark: 'Balance commission', file: 'slip.pdf' }
    await expect(erp.addTransaction({ ...pay, reference: ' ' })).rejects.toThrow(/reference number/)
    await expect(erp.addTransaction({ ...pay, method: 'cash', reference: '' })).rejects.toThrow(/reference number/)
    await expect(erp.addTransaction({ ...pay, method: 'cheque' })).rejects.toThrow(/cheque number/)
    await expect(erp.addTransaction({ ...pay, bankOn: '2999-01-01' })).rejects.toThrow(/future/)
    await expect(erp.addTransaction({ ...pay, file: '' })).rejects.toThrow(/Attach/)
    const t = (await erp.addTransaction(pay)).data.moneyIn.at(-1)
    expect(t).toMatchObject({ dealId: deal.id, amount: 1500, status: 'draft', ref: 'IBG123456789', file: 'slip.pdf', payer: deal.owner.name, into: 'operating' })
    // Switching to cheque needs the cheque number; the reference is kept for the others.
    await expect(erp.updateTransaction(t.id, { method: 'cheque' })).rejects.toThrow(/cheque number/)
    const u = (await erp.updateTransaction(t.id, { method: 'cheque', chequeNo: '004512' })).data.moneyIn.find(x => x.id === t.id)
    expect(u.ref).toBe('Cheque 004512')
  })

  it('clears several payments at once, all or nothing', async () => {
    const { data } = await erp.getErp()
    const open = data.moneyIn.filter(t => t.status === 'draft' || t.status === 'pending').slice(0, 3)
    await expect(erp.setMoneyInStatus([...open.map(t => t.id), -1], 'cleared')).rejects.toThrow(/no longer exists/)
    expect((await erp.getErp()).data.moneyIn.filter(t => open.some(o => o.id === t.id)).every(t => t.status !== 'cleared')).toBe(true)
    const after = (await erp.setMoneyInStatus(open.map(t => t.id), 'cleared')).data.moneyIn
    expect(after.filter(t => open.some(o => o.id === t.id)).every(t => t.status === 'cleared')).toBe(true)
  })
})

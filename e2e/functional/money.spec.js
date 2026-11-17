import { test, expect, STAMP, tokenOf, agentInfo, api } from './fixtures.js'

// The money chain, as the office runs it: an E-Form, the client's payment, Accounts clearing it, the case
// closed, its payout lines approved, a salary request, paid. Every step tried the wrong way too, in order.
test.skip(!process.env.E2E_URL, 'needs a server: E2E_URL')
test.describe.configure({ mode: 'serial' })

const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n')
let admin, deal, listing, payment, lines, request
const one = async (path) => (await admin.call('GET', path)).body

test.beforeAll(async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL })
  admin = api(ctx, tokenOf())
})

test('an E-Form is refused for each thing wrong with it', async () => {
  const listings = (await one('/erp/listings?status=active&counts=0&size=50&sort=-updated')).rows
  listing = listings.find(l => l.type === 'sale' && !l.dealId)
  const rental = listings.find(l => l.type === 'rental')
  const base = { type: 'sale', date: today(), agentId: agentInfo().id, listingId: listing.id, price: 600000, feePct: 2, fee: 12000,
    buyer: { name: `${STAMP} Buyer` }, owner: { name: `${STAMP} Seller` }, rental: {}, property: {}, files: {}, otherBuyers: [], otherOwners: [], submit: true }
  const why = async b => (await admin.act('addDeal', b)).body.error || ''
  expect(await why({ ...base, type: 'barter' })).toMatch(/Pick the form type/)
  expect(await why({ ...base, agentId: 999999999 })).toMatch(/Pick the agent/)
  expect(await why({ ...base, price: 0 })).toMatch(/Enter the selling price/)
  expect(await why({ ...base, fee: -10 })).toMatch(/Vendor Professional Fees/)
  expect(await why({ ...base, listingId: 999999999 })).toMatch(/no longer exists/)
  if (rental) expect(await why({ ...base, listingId: rental.id })).toMatch(/is a rental listing/)
  expect(await why({ ...base, buyer: { name: '' } })).toMatch(/purchaser's name/)
  expect(await why({ ...base, otherOwners: [{ name: 'Co Owner', ic: '1234' }] })).toMatch(/12-digit NRIC/)
  expect(await why({ ...base, coBroke: { agency: '' } })).toMatch(/co-bro agency name/)
  expect(await why({ ...base, holderId: agentInfo().id })).toMatch(/not a product handler/)
})

test('an E-Form submitted; the same listing on a second one is refused', async () => {
  const body = { type: 'sale', date: today(), agentId: agentInfo().id, listingId: listing.id, price: 600000, feePct: 2, fee: 12000,
    buyer: { name: `${STAMP} Buyer` }, owner: { name: `${STAMP} Seller` }, rental: {}, property: {}, files: {}, otherBuyers: [], otherOwners: [], submit: true }
  const made = await admin.act('addDeal', body)
  expect(made.status, JSON.stringify(made.body)).toBe(200)
  deal = await one(`/erp/deals/${made.body.added.deals[0]}`)
  expect(deal.status).toBe('submitted')
  expect(deal.money.billed).toBeGreaterThan(12000)
  expect((await admin.act('addDeal', body)).body.error).toMatch(/is already on E-Form/)
})

test('a payment for the whole claim, cleared by Accounts; once paid out it cannot be un-cleared', async () => {
  const slip = await (await admin.call('POST', '/files?kind=document', PDF, { 'Content-Type': 'application/pdf', 'X-File-Name': 'slip.pdf' })).body
  const r = await admin.act('addTransaction', { dealId: deal.id, amount: deal.money.billed, bankOn: today(), method: 'online', reference: `${STAMP}-FULL`,
    purpose: 'commission', remark: 'full claim', file: slip.ref })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  payment = (await one(`/erp/moneyIn?dealId=${deal.id}&counts=0&size=10`)).rows[0]
  expect(payment.status).toBe('draft')
  expect((await admin.act('setMoneyInStatus', [payment.id], 'lost')).body.error).toMatch(/Unknown status/)
  expect((await admin.act('setMoneyInStatus', [999999999], 'cleared')).body.error).toMatch(/no longer exists/)
  expect((await admin.act('setMoneyInStatus', [payment.id], 'cleared')).status).toBe(200)
})

test('the case closed; closing it again has nothing new', async () => {
  expect((await admin.act('closeDeal', 999999999)).body.error).toMatch(/Only a submitted E-Form/)
  const r = await admin.act('closeDeal', deal.id)
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  deal = await one(`/erp/deals/${deal.id}`)
  expect(deal.status).toBe('closed')
  expect((await admin.act('closeDeal', deal.id)).body.error).toMatch(/Only a submitted E-Form|no new cleared cash/)
  expect((await admin.act('setMoneyInStatus', [payment.id], 'draft')).body.error).toMatch(/already been paid out on a close/)
  lines = (await one(`/erp/payouts?dealId=${deal.id}&counts=0&size=50`)).rows
  expect(lines.length).toBeGreaterThan(0)
  expect(lines.every(l => ['new', 'queried'].includes(l.status))).toBe(true)
})

test('payout lines: a query needs a reason; approved; approving again has nothing to do', async () => {
  const ids = lines.map(l => l.id)
  expect((await admin.act('queryPayouts', ids, '  ')).body.error).toMatch(/Say what needs checking/)
  const r = await admin.act('approvePayouts', ids)
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  expect((await admin.act('approvePayouts', ids)).body.error).toMatch(/Nothing to approve/)
  lines = (await one(`/erp/payouts?dealId=${deal.id}&counts=0&size=50`)).rows
  expect(lines.every(l => l.status === 'approved')).toBe(true)
})

test('a salary request for the agent; the close can then be neither re-run nor deleted', async () => {
  expect((await admin.act('createRequests', [999999999], 'salary')).body.error).toMatch(/Nobody picked has Ready lines/)
  const r = await admin.act('createRequests', [agentInfo().id], 'salary')
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  request = (await one(`/erp/requests?staffId=${agentInfo().id}&counts=0&size=5&sort=-date`)).rows[0]
  expect(request).toBeTruthy()
  const close = (await one(`/erp/payouts?dealId=${deal.id}&counts=0&size=1`)).rows[0].closeId
  expect((await admin.act('rerunClose', close)).body.error).toMatch(/already requested for salary/)
  expect((await admin.act('deleteClose', close)).body.error).toMatch(/already requested for salary/)
})

test('the request paid: a "not valid" needs a reason; once paid it cannot change again', async () => {
  expect((await admin.act('setRequestStatus', request.id, 'invalid', '')).body.error).toMatch(/Say which document/)
  expect((await admin.act('setRequestStatus', request.id, 'refunded')).body.error).toMatch(/Unknown status/)
  expect((await admin.act('setRequestStatus', request.id, 'ready')).status).toBe(200)
  expect((await admin.act('setRequestStatus', request.id, 'clear')).status).toBe(200)
  expect((await admin.act('setRequestStatus', request.id, 'new')).body.error).toMatch(/already been paid/)
  // The agent's lines are paid; the listing side (its product handler, someone else) waits for their own request.
  const after = (await one(`/erp/payouts?dealId=${deal.id}&counts=0&size=50`)).rows
  expect(after.filter(l => l.staffId === agentInfo().id).every(l => l.status === 'paid')).toBe(true)
  expect(after.filter(l => l.staffId !== agentInfo().id).every(l => l.status === 'approved' && !l.requestId)).toBe(true)
})

test('the agent sees their own pay, and cannot pay themselves', async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL })
  const agent = api(ctx, tokenOf('e2e/.auth/agent.json'))
  const mine = (await agent.call('GET', `/erp/payouts?dealId=${deal.id}&counts=0&size=50`)).body.rows
  expect(mine.length).toBeGreaterThan(0)
  expect(mine.every(l => l.staffId === agentInfo().id || l.staffId != null)).toBe(true)
  expect((await agent.act('setRequestStatus', request.id, 'clear')).status).toBe(403)
  expect((await agent.act('approvePayouts', mine.map(l => l.id))).status).toBe(403)
})

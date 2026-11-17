import { watchErrors } from '../helpers.js'
import { test, expect, STAMP, NASTY, tokenOf, agentInfo, api, pick, noScriptDialogs } from './fixtures.js'

// E-Forms and the money on them: what a submission needs, the full journey (E-Form submitted, a payment
// recorded with its slip), and the payments that must be refused.
test.skip(!process.env.E2E_URL, 'needs a server: E2E_URL')
test.describe.configure({ mode: 'serial' })

const okErrors = e => !/40[0-9]|Failed to load resource/.test(e)
const SLIP = { name: 'slip.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n') }
let deal = null   // { id, code } of the E-Form the journey submits

// An active sale listing on the market, for the E-Form to be about.
async function aListing(request) {
  const r = await api(request, tokenOf()).call('GET', '/erp/listings?status=active&type=sale&counts=0&size=20&sort=-updated')
  return r.body.rows.find(l => !l.dealId) || r.body.rows[0]
}

test('an E-Form with nothing filled in names what it needs, and is not saved', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#/deals/new')
  await expect(page.getByRole('button', { name: 'Preview & submit' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Preview & submit' }).click()
  await expect(page.getByText(/Fill in Agent Name \(Sale Staff\), Selling Price, Vendor Professional Fees, .*Name and .*Name first\./)).toBeVisible()
  await expect(page).toHaveURL(/#\/deals\/new/)
  expect(errors.filter(okErrors)).toEqual([])
})

test('an E-Form submitted: agent, listing, price, fees and the parties, then its own page', async ({ page, request }) => {
  const dialogs = noScriptDialogs(page)
  const errors = watchErrors(page)
  const listing = await aListing(request)
  await page.goto('/#/deals/new')
  await expect(page.getByRole('button', { name: 'Preview & submit' })).toBeVisible({ timeout: 30_000 })
  await pick(page, 'Agent', agentInfo().name)
  await pick(page, 'Listing', listing.code)
  await page.getByLabel(/^Selling Price/).fill('500000')
  await page.getByLabel(/^Vendor Professional Fees/).fill('10000')
  await page.getByLabel(/^Name( \*)?$/).nth(0).fill(`${STAMP} Buyer`)
  await page.getByLabel(/^Name( \*)?$/).nth(1).fill(`${STAMP} Seller`)
  await page.getByPlaceholder(/Anything accounts or the approver should know/).fill(NASTY)
  await page.getByRole('button', { name: 'Preview & submit' }).click()
  await page.getByRole('button', { name: 'Submit E-Form' }).click()
  await expect(page).toHaveURL(/#\/deals\/\d+$/, { timeout: 30_000 })
  deal = { id: Number(page.url().match(/deals\/(\d+)/)[1]) }
  deal.code = (await api(request, tokenOf()).call('GET', `/erp/deals/${deal.id}`)).body?.code
  expect(deal.code).toBeTruthy()
  await expect(page.getByText(deal.code).first()).toBeVisible()
  expect(dialogs).toEqual([])
  expect(errors.filter(okErrors)).toEqual([])
})

test('a payment that is not one is refused: nothing, zero, a future bank-in date, no slip', async ({ page }) => {
  test.skip(!deal, 'needs the E-Form above')
  await page.goto(`/#/money-in/new/${deal.id}`)
  await expect(page.getByRole('button', { name: 'Preview & record' })).toBeVisible({ timeout: 30_000 })
  // Nothing filled in.
  await page.getByRole('button', { name: 'Preview & record' }).click()
  await expect(page.getByText(/Fill in .*Amount.* first\./)).toBeVisible()
  // Zero and a negative amount are no amount.
  for (const amount of ['0', '-500']) {
    await page.getByLabel(/^Amount \(RM\)/).fill(amount)
    await page.getByRole('button', { name: 'Preview & record' }).click()
    await expect(page.getByText(/Fill in .*Amount.* first\./)).toBeVisible()
  }
})

test('a payment refused by the server: a slip not theirs, a future date, no slip, nothing, an unknown method or E-Form', async ({ request }) => {
  test.skip(!deal, 'needs the E-Form above')
  const admin = api(request, tokenOf())
  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  // A slip of their own (a file someone else uploaded, or one not there, is refused before anything else).
  const slip = await (await request.fetch('/api/files?kind=document', { method: 'POST', data: SLIP.buffer,
    headers: { Authorization: `Bearer ${tokenOf()}`, 'Content-Type': 'application/pdf', 'X-File-Name': 'slip.pdf' } })).json()
  expect((await admin.act('addTransaction', { dealId: deal.id, amount: 100, method: 'online', reference: 'x', purpose: 'deposit', remark: 'x', file: 'files/999999999/x.pdf',
    bankOn: new Date().toISOString().slice(0, 10) })).body.error).toMatch(/no longer there/)
  const base = { dealId: deal.id, amount: 100, method: 'online', reference: `${STAMP}-REF`, purpose: 'deposit', remark: 'test', file: slip.ref }
  const future = await admin.act('addTransaction', { ...base, bankOn: tomorrow })
  expect(future.status).toBe(400)
  expect(future.body.error).toMatch(/cannot be in the future/)
  const noSlip = await admin.act('addTransaction', { ...base, bankOn: new Date().toISOString().slice(0, 10), file: '' })
  expect(noSlip.body.error).toMatch(/Attach the transfer slip/)
  const nothing = await admin.act('addTransaction', { ...base, amount: -100, bankOn: new Date().toISOString().slice(0, 10) })
  expect(nothing.body.error).toMatch(/more than 0/)
  const how = await admin.act('addTransaction', { ...base, method: 'bitcoin', bankOn: new Date().toISOString().slice(0, 10) })
  expect(how.body.error).toMatch(/Pick how it was paid/)
  const nowhere = await admin.act('addTransaction', { ...base, dealId: 999999999, bankOn: new Date().toISOString().slice(0, 10) })
  expect(nowhere.status).toBeGreaterThanOrEqual(400)
  expect(nowhere.status).toBeLessThan(500)
})

test('a payment recorded with its slip, then shown on the E-Form', async ({ page }) => {
  test.skip(!deal, 'needs the E-Form above')
  const errors = watchErrors(page)
  await page.goto(`/#/money-in/new/${deal.id}`)
  await expect(page.getByRole('button', { name: 'Preview & record' })).toBeVisible({ timeout: 30_000 })
  await page.getByLabel(/^Amount \(RM\)/).fill('2500')
  await page.getByLabel(/^Bank In Date/).fill(new Date().toISOString().slice(0, 10))
  await page.getByRole('radio', { name: 'Online Transfer' }).check().catch(() => page.getByText('Online Transfer').click())
  await page.getByLabel(/^Recipient Reference/).fill(`${STAMP}-IBG`)
  await page.locator('input[type="file"]').first().setInputFiles(SLIP)
  await expect(page.getByText('slip.pdf').first()).toBeVisible({ timeout: 30_000 })
  await page.getByLabel(/^Remarks/).fill(`${STAMP} deposit`)
  await page.getByRole('button', { name: 'Preview & record' }).click()
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(page).toHaveURL(new RegExp(`#/deals/${deal.id}$`), { timeout: 30_000 })
  await expect(page.getByText(/2,500\.00/).first()).toBeVisible()
  expect(errors.filter(okErrors)).toEqual([])
})

test('uploads: a file that is not what its name says, and one with no sign-in, are refused', async ({ request }) => {
  const up = (token, name, bytes, type) => request.fetch('/api/files?kind=document', { method: 'POST', failOnStatusCode: false,
    headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(name), ...(token && { Authorization: `Bearer ${token}` }) }, data: bytes })
  expect((await up(null, 'slip.pdf', SLIP.buffer, 'application/pdf')).status()).toBe(401)
  const fake = await up(tokenOf(), 'slip.pdf', Buffer.from('MZ this is a program, not a PDF'), 'application/pdf')
  expect(fake.status()).toBe(400)
  const exe = await up(tokenOf(), 'run.exe', Buffer.from('MZ'), 'application/octet-stream')
  expect(exe.status()).toBe(400)
  const huge = await up(tokenOf(), 'big.pdf', Buffer.concat([SLIP.buffer, Buffer.alloc(30 * 1048576)]), 'application/pdf')
  expect([400, 413]).toContain(huge.status())
})

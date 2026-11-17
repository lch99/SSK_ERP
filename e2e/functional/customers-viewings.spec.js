import { watchErrors } from '../helpers.js'
import { test, expect, STAMP, NASTY, tokenOf, agentInfo, api, pick, noScriptDialogs } from './fixtures.js'

// Customers (the Customer Database) and viewings booked on a listing: what is refused, and the journeys.
test.skip(!process.env.E2E_URL, 'needs a server: E2E_URL')

const okErrors = e => !/40[0-9]|Failed to load resource/.test(e)
const isoDay = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

async function addCustomerForm(page, { name, phone, remarks } = {}) {
  await page.goto('/#/customers/new')
  await expect(page.getByRole('button', { name: 'Preview & add' })).toBeVisible({ timeout: 30_000 })
  if (name != null) await page.getByLabel(/^Name/).fill(name)
  if (phone != null) await page.getByLabel(/^Phone/).fill(phone)
  if (remarks != null) await page.getByLabel(/^Remarks/).fill(remarks)
  await page.getByRole('button', { name: 'Preview & add' }).click()
}

test('a customer with no name or phone is named as missing; one with a phone of letters is refused', async ({ page }) => {
  const errors = watchErrors(page)
  await addCustomerForm(page, {})
  await expect(page.getByText('Fill in Name and Phone first.')).toBeVisible()
  await addCustomerForm(page, { name: `${STAMP} Letters`, phone: 'call me maybe' })
  await page.getByRole('button', { name: 'Add customer' }).click()
  await expect(page.getByText(/phone number does not look right/)).toBeVisible()
  expect(errors.filter(okErrors)).toEqual([])
})

test('a customer added, then the same phone again is warned about in the preview', async ({ page }) => {
  const dialogs = noScriptDialogs(page)
  const phone = `012-${String(Date.now()).slice(-7, -4)} ${String(Date.now()).slice(-4)}`
  await addCustomerForm(page, { name: `${STAMP} Tan Mei Ling`, phone, remarks: NASTY })
  await page.getByRole('button', { name: 'Add customer' }).click()
  await expect(page.getByText(`${STAMP} Tan Mei Ling added to the Customer Database`)).toBeVisible()
  await addCustomerForm(page, { name: `${STAMP} Someone Else`, phone })
  await expect(page.getByText(/Already in the Customer Database with this phone/)).toBeVisible()
  await page.getByRole('button', { name: 'Back to edit' }).click()
  expect(dialogs).toEqual([])
})

test('a viewing: refused empty, in the past and on a busy slot; booked; cancelled only with a reason', async ({ page, request }) => {
  const errors = watchErrors(page)
  const admin = api(request, tokenOf())
  const listing = (await admin.call('GET', '/erp/listings?status=active&counts=0&size=20&sort=-updated')).body.rows.find(l => l.holderId)
  await page.goto(`/#/listings/${listing.id}`)
  await page.getByRole('button', { name: 'Actions' }).last().click()
  await page.getByRole('menuitem', { name: /Book a viewing/ }).click()
  const box = page.locator('.ssk-modal-wrap').filter({ hasText: 'Book a viewing' })
  await expect(box).toBeVisible()
  // Nothing filled in.
  await box.getByRole('button', { name: 'Book viewing' }).click()
  await expect(page.getByText(/Fill in .* first\./).first()).toBeVisible()
  // In the past.
  await pick(page, 'Agent', agentInfo().name)
  await box.getByLabel('Customer name').fill(`${STAMP} Viewer`)
  await box.getByLabel(/^Customer phone/).fill('012-3456789')
  await box.getByLabel(/^Date/).fill(isoDay(-2))
  await box.getByRole('button', { name: 'Book viewing' }).click()
  await expect(page.getByText(/later than now/)).toBeVisible()
  // Tomorrow, at a time of its own: booked.
  const slot = `${String(8 + Math.floor(Math.random() * 11)).padStart(2, '0')}:${Math.random() < 0.5 ? '00' : '30'}`
  await box.getByLabel(/^Date/).fill(isoDay(1))
  await pick(page, 'Time', slot)
  await box.getByRole('button', { name: 'Book viewing' }).click()
  await expect(box).toBeHidden({ timeout: 30_000 })
  // The same slot again: the product handler is busy then.
  await page.getByRole('button', { name: 'Actions' }).last().click()
  await page.getByRole('menuitem', { name: /Book a viewing/ }).click()
  await pick(page, 'Agent', agentInfo().name)
  await box.getByLabel('Customer name').fill(`${STAMP} Second`)
  await box.getByLabel(/^Customer phone/).fill('012-3456780')
  await box.getByLabel(/^Date/).fill(isoDay(1))
  await pick(page, 'Time', slot)
  await box.getByRole('button', { name: 'Book viewing' }).click()
  await expect(page.getByText(/already has VIEW-\d+ from/)).toBeVisible()
  await box.getByRole('button', { name: 'Cancel' }).click()
  // On file (for the listing), and cancelling it needs a reason (the server says so too).
  const find = async () => (await admin.call('GET', `/erp/viewings?listing=${listing.id}&counts=0&size=50&sort=-date`)).body.rows.find(x => x.customer?.name === `${STAMP} Viewer`)
  await expect.poll(find, { timeout: 15_000 }).toBeTruthy()
  const v = await find()
  const noReason = await admin.act('cancelViewing', v.id, '   ', null)
  expect(noReason.body.error).toMatch(/Say why/)
  expect((await admin.act('cancelViewing', v.id, `${STAMP} customer changed mind`, null)).status).toBe(200)
  expect((await admin.act('cancelViewing', v.id, 'again', null)).body.error).toMatch(/Only an upcoming viewing/)
  expect(errors.filter(okErrors)).toEqual([])
})

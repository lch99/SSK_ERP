import { watchErrors } from '../helpers.js'
import { test, expect, STAMP, NASTY, tokenOf, api, noScriptDialogs } from './fixtures.js'

// Listings: adding one (and every way it can be refused), its details shown, edited, followed up and deleted.
test.skip(!process.env.E2E_URL, 'needs a server: E2E_URL')

const okErrors = e => !/40[0-9]|Failed to load resource/.test(e)
const title = what => `${STAMP} ${what} Residence`

// The Add form filled with what a listing needs; `more` overrides (null leaves a field empty).
async function fill(page, more = {}) {
  const v = { area: 'Kepong', title: title('Test'), price: '450000', unit: `U-${STAMP}-${Math.random().toString(36).slice(2, 6)}`, owner: 'E2E Owner', phone: '012-3456789', ...more }
  await page.goto('/#/listing-new')
  await expect(page.getByRole('heading', { name: /Add a listing/ })).toBeVisible({ timeout: 30_000 })
  if (v.area != null) await page.getByLabel(/^Area/).fill(v.area)
  if (v.title != null) await page.getByLabel(/^Title \(building/).fill(v.title)
  if (v.price != null) await page.getByLabel(/^Advertised Price/).fill(v.price)
  if (v.unit != null) await page.getByLabel(/^Unit Number/).fill(v.unit)
  if (v.owner != null) await page.getByLabel(/^Owner Name/).fill(v.owner)
  if (v.phone != null) await page.getByLabel(/^Owner Contact/).fill(v.phone)
  if (v.desc != null) await page.getByLabel(/^Full Descriptions/).fill(v.desc)
  if (v.carpark != null) await page.getByLabel(/^Car Parks/).fill(v.carpark)
  return v
}
const listingsTitled = async (request, t) => (await api(request, tokenOf()).call('GET', `/erp/listings?q=${encodeURIComponent(t)}&counts=0&size=50`)).body.rows.filter(l => l.title === t)

test('missing fields are named, and nothing is saved', async ({ page, request }) => {
  const errors = watchErrors(page)
  await fill(page, { area: null, title: title('Missing'), price: null, unit: null, owner: null, phone: null })
  await page.getByRole('button', { name: 'Preview & publish' }).click()
  await expect(page.getByText(/Fill in Area, Advertised Price, Unit Number & Jalan, Owner Name and Owner Contact first\./)).toBeVisible()
  expect(await listingsTitled(request, title('Missing'))).toEqual([])
  expect(errors.filter(okErrors)).toEqual([])
})

test('a phone that is not one, an emoji, and a negative car park are refused', async ({ page }) => {
  await fill(page, { phone: '12345' })
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByText(/valid phone number for the owner/)).toBeVisible()

  await fill(page, { desc: 'Nice unit 🏠' })
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByText('Emojis are not allowed.')).toBeVisible()

  await fill(page, { carpark: '-1' })
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByText(/cannot be negative/)).toBeVisible()
})

test('text that looks like code is kept as text: nothing runs, the page shows it as typed', async ({ page, request }) => {
  const dialogs = noScriptDialogs(page)
  const errors = watchErrors(page)
  const t = `${STAMP} ${NASTY.slice(0, 40)}`.slice(0, 120)
  await fill(page, { title: t, desc: NASTY })
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page).toHaveURL(/#\/listings\/\d+/, { timeout: 30_000 })
  await expect(page.getByText(NASTY.trim().slice(0, 30), { exact: false }).first()).toBeVisible()
  expect(dialogs, 'no script ran').toEqual([])
  expect(errors.filter(okErrors)).toEqual([])
  // The database still has its listings (the "DROP TABLE" was only text).
  expect((await api(request, tokenOf()).call('GET', '/erp/listings?size=1&counts=0')).body.total).toBeGreaterThan(1000)
})

test('the same unit, owner and building twice is refused as a duplicate', async ({ page }) => {
  const v = await fill(page, { title: title('Dup') })
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page).toHaveURL(/#\/listings\/\d+/, { timeout: 30_000 })
  await fill(page, { title: v.title, unit: v.unit, phone: v.phone })
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByText(/This unit is already listed as LIST-/)).toBeVisible()
})

test('clicking Save twice fast makes one listing, not two', async ({ page, request }) => {
  const v = await fill(page, { title: title('Double') })
  const save = page.getByRole('button', { name: 'Save as Draft' })
  await save.dblclick()
  await expect(page).toHaveURL(/#\/listings\/\d+/, { timeout: 30_000 })
  await page.waitForTimeout(1500)
  expect((await listingsTitled(request, v.title)).length).toBe(1)
})

test('a listing published, its details shown, edited, followed up, then deleted', async ({ page }) => {
  const errors = watchErrors(page)
  const v = await fill(page, { title: title('Journey'), carpark: '2', desc: 'Corner unit near MRT' })
  await page.getByLabel(/^Utilities \/ Store Rooms/).fill('1')
  await page.getByLabel(/^Renovation Cost/).fill('45000')
  await page.getByRole('button', { name: 'Preview & publish' }).click()
  await page.getByRole('button', { name: 'Publish listing' }).click()
  await expect(page).toHaveURL(/#\/listings\/\d+/, { timeout: 30_000 })
  const panel = page.locator('[role="dialog"]').filter({ hasText: v.title }).last()
  for (const [label, value] of [['Car Parks', '2'], ['Utilities / Store Rooms', '1'], ['Renovation Cost', 'RM']]) {
    await expect(panel.getByText(label, { exact: true }).first()).toBeVisible()
    await expect(panel.getByText(new RegExp(value)).first()).toBeVisible()
  }

  // Edit: a detail changes, through the review.
  await page.getByRole('button', { name: 'Actions' }).last().click()
  await page.getByRole('menuitem', { name: 'Edit listing' }).click()
  await page.getByLabel(/^Car Parks/).fill('3')
  await page.getByRole('button', { name: 'Review changes' }).click()
  await expect(page.getByText('Car Parks').first()).toBeVisible()
  await page.getByRole('button', { name: 'Save & Publish' }).click()
  await expect(page.getByText(/saved/).first()).toBeVisible()

  // A follow-up saves (its action starts at Call For Followup).
  await page.getByRole('button', { name: 'Actions' }).last().click()
  await page.getByRole('menuitem', { name: 'Follow-up' }).click()
  await page.getByLabel('Remarks').last().fill(`${STAMP} owner open to nego`)
  await page.locator('.ssk-modal-wrap').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Follow-up saved').first()).toBeVisible()

  // Deleted (Full on listings).
  await page.getByRole('button', { name: 'Actions' }).last().click()
  await page.getByRole('menuitem', { name: /Delete listing/ }).click()
  await page.locator('.ssk-modal-wrap').getByRole('button', { name: 'Delete' }).click()
  await expect(page).toHaveURL(/#\/listings$/, { timeout: 30_000 })
  expect(errors.filter(okErrors)).toEqual([])
})

import { watchErrors } from '../helpers.js'
import { test, expect, STAMP, NASTY, tokenOf, agentInfo, api, noScriptDialogs } from './fixtures.js'

// Photo albums through the page, Setup and Roles kept from bad values, office accounts, one's own profile,
// projects, quick search, and junk in the address bar.
test.skip(!process.env.E2E_URL, 'needs a server: E2E_URL')

const okErrors = e => !/40[0-9]|Failed to load resource/.test(e)
// A real 1×1 PNG, and things that only pretend to be pictures.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const photo = (name, buffer = PNG, mimeType = 'image/png') => ({ name, mimeType, buffer })

async function testListing(request) {
  const admin = api(request, tokenOf())
  const r = await admin.act('addListing', { type: 'sale', title: `${STAMP} Album Residence`, area: 'Kepong', askPrice: 450000, unit: `AL-${STAMP}-${Date.now() % 100000}`,
    ownerName: 'Album Owner', ownerPhone: '012-3456789', holderId: agentInfo().id, draft: true })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return r.body.added.listings[0]
}

test('an album: photos uploaded through the page and saved; a GIF and a fake JPG are refused', async ({ page, request }) => {
  const errors = watchErrors(page)
  const id = await testListing(request)
  await page.goto(`/#/listings/${id}`)
  await page.getByRole('button', { name: 'Actions' }).last().click()
  await page.getByRole('menuitem', { name: /^Album/ }).click()
  const box = page.locator('.ssk-modal-wrap').filter({ hasText: 'Album' }).last()
  const input = box.locator('input[type="file"]').first()
  // Not a JPG or PNG: refused before anything is sent.
  await input.setInputFiles(photo('anim.gif', Buffer.from('GIF89a'), 'image/gif'))
  await expect(page.getByText(/JPG or PNG|not a|can't|cannot/i).first()).toBeVisible()
  // Two real photos.
  await input.setInputFiles([photo('front.png'), photo('kitchen.png')])
  await box.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(/album saved/).first()).toBeVisible({ timeout: 30_000 })
  const l = (await api(request, tokenOf()).call('GET', `/erp/listings/${id}`)).body
  expect(l.photos).toBe(2)
  expect(l.photoSet.filter(p => p.cover).length).toBe(1)
  // Text named .jpg: the server reads its first bytes and refuses it.
  const fake = await request.fetch('/api/files?kind=photo', { method: 'POST', failOnStatusCode: false, data: Buffer.from('this is not a picture'),
    headers: { Authorization: `Bearer ${tokenOf()}`, 'Content-Type': 'image/jpeg', 'X-File-Name': 'fake.jpg' } })
  expect(fake.status()).toBe(400)
  expect(errors.filter(okErrors)).toEqual([])
})

test('an album holds at most 50 photos', async ({ request }) => {
  const admin = api(request, tokenOf())
  const id = await testListing(request)
  const photoSet = Array.from({ length: 51 }, (_, i) => ({ id: i + 1, name: `p${i}.jpg`, published: true, cover: i === 0, url: `https://storage.subsaleking.com/property-images/x/${i}.jpg` }))
  const r = await admin.act('updateListing', id, { photoSet })
  expect(r.status).toBe(400)
  expect(r.body.error).toMatch(/up to 50 photos/)
  const l = (await admin.call('GET', `/erp/listings/${id}`)).body
  expect(l.photos ?? 0).toBeLessThanOrEqual(50)
})

test('Setup refuses values that make no sense, and is closed to an agent', async ({ request }) => {
  const admin = api(request, tokenOf())
  const before = (await admin.call('GET', '/setup')).body
  const dealTypes = before.dealTypes || before.setup?.dealTypes
  expect(dealTypes, 'Setup has deal types').toBeTruthy()
  for (const [field, value, why] of [['sstPct', 150, /SST must be 0–100%/], ['sstPct', -1, /SST must be 0–100%/], ['whtPct', 'lots', /must be 0/]]) {
    const r = await admin.call('PUT', '/setup/deal-types', { ...dealTypes, [field]: value })
    expect(r.status, `${field}=${value}`).toBe(400)
    expect(JSON.stringify(r.body)).toMatch(why)
  }
  const after = (await admin.call('GET', '/setup')).body
  expect(JSON.stringify(after.dealTypes || after.setup?.dealTypes)).toBe(JSON.stringify(dealTypes))
  expect((await api(request, tokenOf('e2e/.auth/agent.json')).call('PUT', '/setup/deal-types', dealTypes)).status).toBe(403)
})

test('office accounts: a bad username, a weak password, a taken name and an unknown role are refused', async ({ request }) => {
  const admin = api(request, tokenOf())
  const add = b => admin.call('POST', '/users', { name: 'Office Test', role: 'superadmin', branchId: null, password: 'good-password-1', ...b })
  expect((await add({ username: 'Has Spaces' })).body.error).toMatch(/Username/)
  expect((await add({ username: `ok${STAMP}`.toLowerCase(), password: '123' })).body.error).toMatch(/at least 8/)
  expect((await add({ username: 'superadmin' })).body.error).toMatch(/taken/)
  expect((await add({ username: `ok2${STAMP}`.toLowerCase(), role: 'god' })).body.error).toMatch(/Pick a role/)
  expect((await add({ username: `ok3${STAMP}`.toLowerCase(), name: '' })).body.error).toMatch(/Name is required/)
})

test('one\'s own profile: a bad e-mail, phone, bank account or photo is refused', async ({ request }) => {
  const me = api(request, tokenOf('e2e/.auth/agent.json'))
  const save = p => me.call('PUT', '/auth/profile', { name: agentInfo().name, ...p })
  expect((await save({ email: 'not-an-email' })).body.error).toMatch(/e-mail/)
  expect((await save({ phone: 'call me' })).body.error).toMatch(/Use digits/)
  expect((await save({ bankAccount: '12' , bank: 'Maybank', bankHolder: 'A' })).body.error).toMatch(/Digits only/)
  expect((await save({ bankAccount: '1234567890' })).body.error).toMatch(/Pick the bank/)
  expect((await save({ photo: 'data:image/gif;base64,R0lGOD' })).body.error).toMatch(/JPG or PNG/)
  expect((await save({ name: 'x'.repeat(200) })).body.error).toMatch(/under 80/)
  expect((await save({ name: '' })).body.error).toMatch(/Enter the name/)
  expect((await save({ name: NASTY.slice(0, 70) })).status, 'odd characters are only text').toBe(200)
  await save({ name: agentInfo().name })
})

test('projects: no name or developer, a commission over 20% and part units are refused', async ({ request }) => {
  const admin = api(request, tokenOf())
  const project = { name: `${STAMP} Residensi`, developer: 'E2E Developer', devCommissionPct: 3, units: 100, payout: { mode: 'setup' } }
  const why = async p => JSON.stringify((await admin.act('saveProject', p)).body)
  expect(await why({ ...project, name: '' })).toMatch(/Project name is required/)
  expect(await why({ ...project, developer: '' })).toMatch(/Developer is required/)
  expect(await why({ ...project, devCommissionPct: 50 })).toMatch(/at most 20%/)
  expect(await why({ ...project, units: 1.5 })).toMatch(/whole number/)
  expect(await why({ ...project, payout: { mode: 'magic' } })).toMatch(/Pick how this project pays/)
  expect((await admin.act('saveIncentive', 999999999, { name: 'x' })).status).toBeLessThan(500)
})

test('quick search: odd input finds nothing and breaks nothing; a listing code finds the listing', async ({ page, request }) => {
  const dialogs = noScriptDialogs(page)
  const errors = watchErrors(page)
  const code = (await api(request, tokenOf()).call('GET', '/erp/listings?status=active&counts=0&size=1')).body.rows[0].code
  await page.goto('/#/dashboard')
  await expect(page.locator('.ssk-page').first()).toBeVisible({ timeout: 30_000 })
  for (const q of [NASTY, '%%%', '\\', ' '.repeat(50), code]) {
    await page.getByRole('button', { name: /Quick search/ }).first().click()
    const box = page.getByRole('combobox').or(page.getByPlaceholder(/Search/)).last()
    await box.fill(q)
    await page.waitForTimeout(700)
    if (q === code) await expect(page.getByText(code).first()).toBeVisible()
    await page.keyboard.press('Escape')
  }
  expect(dialogs).toEqual([])
  expect(errors.filter(okErrors)).toEqual([])
})

test('junk in the address bar opens the page, never breaks it', async ({ page }) => {
  const errors = watchErrors(page)
  for (const path of ['listings?status=<b>x</b>&sort=;drop', 'deals?page=-1&size=999999', 'staff/abc/def', 'reports/%E0%A4%A', 'money-in/new/not-a-deal', 'listing-new?vr=abc']) {
    await page.goto(`/#/${path}`)
    await expect(page.locator('.ssk-page').first()).toBeVisible({ timeout: 30_000 })
  }
  expect(errors.filter(okErrors)).toEqual([])
})

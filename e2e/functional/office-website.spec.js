import { watchErrors, fitsWidth } from '../helpers.js'
import { test, expect, STAMP, NASTY, tokenOf, agentInfo, api } from './fixtures.js'

// The office's guards (closing a case, landlord checks, adding people), the website's public reads and its
// owner form with bad input, and one journey on a phone.
test.skip(!process.env.E2E_URL, 'needs a server: E2E_URL')

const okErrors = e => !/40[0-9]|Failed to load resource/.test(e)

test('closing a case is refused when there is nothing to close', async ({ request }) => {
  const admin = api(request, tokenOf())
  const draft = (await admin.call('GET', '/erp/deals?status=draft&counts=0&size=1')).body.rows[0]
  if (draft) expect((await admin.act('closeDeal', draft.id, {})).body.error).toMatch(/Only a submitted E-Form/)
  expect((await admin.act('closeDeal', 999999999, {})).status).toBeLessThan(500)
  // A submitted E-Form with no cleared money: nothing to close.
  const open = (await admin.call('GET', '/erp/deals?status=submitted&counts=0&size=50&sort=-date')).body.rows.find(d => !(d.$?.cleared > 0))
  if (open) expect((await admin.act('closeDeal', open.id, {})).body.error).toMatch(/no new cleared cash|Only|in full/)
})

test('a landlord check marked "Unable to verify" needs a reason', async ({ page, request }) => {
  const admin = api(request, tokenOf())
  const pending = (await admin.call('GET', '/erp/deals?lvStatus=-1&counts=0&size=1')).body.rows[0]
  test.skip(!pending, 'no landlord check waiting in this data')
  expect((await admin.act('verifyLandlord', pending.id, 0, '  ')).body.error).toMatch(/Say why/)
  expect((await admin.act('verifyLandlord', pending.id, 7, 'x')).body.error).toMatch(/Pick Verified or Unable/)
  await page.goto('/#/reports/landlord')
  await expect(page.getByRole('button', { name: 'Verify' }).first()).toBeVisible({ timeout: 30_000 })
})

test('adding a person: no username or name is refused, a taken username too, and a role above one\'s own', async ({ request }) => {
  const admin = api(request, tokenOf())
  const branchId = agentInfo().branchId
  expect((await admin.act('addStaff', { name: 'No Username', branchId })).body.error).toMatch(/User name is required/)
  expect((await admin.act('addStaff', { username: `nobody${STAMP}`.toLowerCase(), branchId })).body.error).toMatch(/IC name is required/)
  expect((await admin.act('addStaff', { username: agentInfo().username, name: 'Copy', branchId })).body.error).toMatch(/taken/)
  expect((await admin.act('addStaff', { username: `nobranch${STAMP}`.toLowerCase(), name: 'No Branch', branchId: 999999 })).body.error).toMatch(/Pick the branch/)
  // The agent cannot add anyone at all.
  expect((await api(request, tokenOf('e2e/.auth/agent.json')).act('addStaff', { username: `x${STAMP}`.toLowerCase(), name: 'X', branchId })).status).toBe(403)
})

test.describe('the website\'s reads (no sign-in)', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('listings are public fields only, pages stay small, and nonsense is answered calmly', async ({ request }) => {
    const site = api(request)
    const list = await site.call('GET', '/public/listings?size=100000')
    expect(list.status).toBe(200)
    expect(list.body.rows.length).toBeLessThanOrEqual(50)
    const one = list.body.rows[0]
    expect(Object.keys(one).filter(k => /owner|unit|address|ic\b|remarksPrivate|bankValue|restriction|commission/i.test(k))).toEqual([])
    for (const p of ['/public/listings/999999999', '/public/listings/abc', '/public/agents/no-such-agent-' + STAMP, '/public/photos/1']) {
      expect((await site.call('GET', p)).status, p).toBe(404)
    }
    for (const q of ['minPrice=abc&maxPrice=-5', 'sort=;drop%20table', 'page=-3', `q=${encodeURIComponent(NASTY)}`, 'areaIds=1,2,x,,']) {
      expect((await site.call('GET', `/public/listings?${q}`)).status, q).toBe(200)
    }
  })

  test('the owner form refuses no name, a phone that is not one, and a bad e-mail; a good one gets a ticket', async ({ request }) => {
    const site = api(request)
    const send = b => site.call('POST', '/public/owner-requests', b)
    expect((await send({ phone: '012-3456789' })).body.error).toMatch(/Enter your name/)
    expect((await send({ name: 'Owner', phone: '12' })).body.error).toMatch(/phone number/)
    expect((await send({ name: 'Owner', phone: '012-3456789', email: 'not-an-email' })).body.error).toMatch(/e-mail/)
    const ok = await send({ name: `${STAMP} ${NASTY}`, phone: '012-3456789', email: 'owner@example.com', propertyName: 'Kepong', price: 'lots', type: 'sale' })
    expect(ok.status).toBe(200)
    expect(ok.body.ticket).toMatch(/^[A-Z0-9]{10}$/)
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true })

  test('adding a customer works at 360 px, and no page in the journey scrolls sideways', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/#/customers/new')
    await expect(page.getByRole('button', { name: 'Preview & add' })).toBeVisible({ timeout: 30_000 })
    await fitsWidth(page)
    await page.getByLabel(/^Name/).fill(`${STAMP} Phone Customer`)
    await page.getByLabel(/^Phone/).fill('+65 9123 4567')
    await page.getByRole('button', { name: 'Preview & add' }).click()
    await fitsWidth(page)
    await page.getByRole('button', { name: 'Add customer' }).click()
    await expect(page.getByText(`${STAMP} Phone Customer added to the Customer Database`)).toBeVisible()
    await fitsWidth(page)
    expect(errors.filter(okErrors)).toEqual([])
  })
})

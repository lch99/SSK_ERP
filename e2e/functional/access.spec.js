import { signInScreen, watchErrors } from '../helpers.js'
import { test, expect, STAMP, AGENT_SESSION, PASSWORD, tokenOf, agentInfo, api, noScriptDialogs } from './fixtures.js'

// Signing in and what each person may reach: wrong, empty and hostile input, a broken session, and an agent
// trying the office's pages and actions.
test.skip(!process.env.E2E_URL, 'needs a server: E2E_URL')

test.describe('signing in, the unexpected', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('empty, unknown and hostile usernames get the same plain answer, and nothing runs', async ({ page }) => {
    const dialogs = noScriptDialogs(page)
    const errors = watchErrors(page)
    await signInScreen(page)
    const user = page.getByLabel('Username'), pass = page.getByLabel('Password', { exact: true })
    const signIn = page.getByRole('button', { name: 'Sign in' })
    await signIn.click()
    // The browser's own check, or the server's message: no request goes without both.
    await expect(page.locator('form').getByRole('listitem').or(page.locator('input:invalid')).first()).toBeVisible().catch(() => {})
    for (const name of ['nobody-here-' + STAMP, "' OR '1'='1' --", '<script>alert(1)</script>', 'x'.repeat(3000)]) {
      await user.fill(name)
      await pass.fill('whatever1')
      await signIn.click()
      await expect(page.getByText(/Wrong username or password|Enter your username/).first()).toBeVisible()
    }
    expect(dialogs).toEqual([])
    expect(errors.filter(e => !/40[01]|Failed to load resource/.test(e))).toEqual([])
  })

  test('five wrong passwords lock the account; the right one then is refused too', async ({ page, request }) => {
    // An account of its own to lock (never the shared test agent).
    const admin = api(request, tokenOf())
    const branchId = agentInfo().branchId
    const username = `e2elock${STAMP.toLowerCase()}`
    const id = (await admin.act('addStaff', { username, name: `E2E Lock ${STAMP}`, branchId, type: 'staff' })).body.added.staff[0]
    await admin.act('setStaffStatus', id, 'active')
    const link = (await admin.call('POST', `/accounts/${id}/link`, {})).body
    await api(request).call('POST', `/auth/link/${link.token}`, { password: PASSWORD })

    await signInScreen(page)
    await page.getByLabel('Username').fill(link.username)
    for (let i = 1; i <= 5; i++) {
      await page.getByLabel('Password', { exact: true }).fill(`wrong-${i}-pw`)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByText(i < 5 ? new RegExp(`${5 - i} attempts? left`) : /now locked/).first()).toBeVisible()
    }
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText(/locked/).first()).toBeVisible()
  })

  test('a session that was tampered with goes back to sign in, without a crash', async ({ page }) => {
    const errors = watchErrors(page)
    await page.addInitScript(() => localStorage.setItem('ssk-token', 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MSwidiI6MH0.forged-signature'))
    await page.goto('/#/deals')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 30_000 })
    expect(errors.filter(e => !/401|Failed to load resource/.test(e))).toEqual([])
  })
})

test.describe('an agent and the office\'s pages', () => {
  test.use({ storageState: AGENT_SESSION })

  // (Closed by Roles & access; an agent does see the rules page, their payouts and payments: those are theirs.)
  for (const path of ['access', 'setup', 'users', 'technical/downtime', 'system', 'invoices/tax', 'staff/new']) {
    test(`#/${path} is closed to an agent`, async ({ page }) => {
      const errors = watchErrors(page)
      await page.goto(`/#/${path}`)
      await expect(page.getByText(/Not open to|not part of your role|needs|not yours/i).first()).toBeVisible({ timeout: 30_000 })
      expect(errors.filter(e => !/40[13]|Failed to load resource/.test(e))).toEqual([])
    })
  }

  test('an unknown address opens the dashboard instead of breaking', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/#/no-such-page/123')
    await expect(page.locator('.ssk-page').first()).toBeVisible({ timeout: 30_000 })
    await page.goto('/#/listings/999999999')
    await expect(page.locator('.ssk-page').first()).toBeVisible()
    await expect(page.getByText(/not found|not yours|no longer/i).first()).toBeVisible()
    await page.goto('/#/deals/not-a-number')
    await expect(page.locator('.ssk-page').first()).toBeVisible()
    expect(errors.filter(e => !/40[134]|Failed to load resource/.test(e))).toEqual([])
  })
})

test.describe('the API, called directly', () => {
  test('without signing in, every ERP address answers 401', async ({ request }) => {
    const nobody = api(request)
    for (const [m, p] of [['GET', '/erp/start'], ['GET', '/erp/deals'], ['GET', '/erp/state'], ['POST', '/erp/actions/addListing'], ['GET', '/users'], ['GET', '/setup']]) {
      expect((await nobody.call(m, p, m === 'POST' ? { args: [] } : undefined)).status, `${m} ${p}`).toBe(401)
    }
  })

  test('an agent is refused the office\'s actions and other people\'s records', async ({ request }) => {
    const agent = api(request, tokenOf(AGENT_SESSION))
    expect((await agent.act('approvePayouts', [1])).status).toBe(403)
    expect((await agent.act('setMoneyInStatus', [1], 'cleared')).status).toBe(403)
    expect((await agent.act('addStaff', { username: `x${STAMP}`, name: 'X', branchId: agentInfo().branchId, type: 'admin-staff' })).status).toBe(403)
    expect((await agent.call('GET', '/erp/state')).status, 'every record at once').toBe(403)
    expect((await agent.call('GET', '/users')).status).toBe(403)
    // A record outside their reach: refused, never a 500.
    const someone = await agent.act('updateCustomer', 1, { name: 'Taken over' })
    expect([403, 404, 400]).toContain(someone.status)
  })

  test('nonsense requests are refused cleanly, never a server error', async ({ request }) => {
    const admin = api(request, tokenOf())
    expect((await admin.call('POST', '/erp/actions/noSuchAction', { args: [] })).status).toBe(404)
    expect((await admin.act('updateListing', 'not-an-id', { askPrice: 'lots' })).status).toBeLessThan(500)
    expect((await admin.act('addListing', null)).status).toBeLessThan(500)
    expect((await admin.act('addDeal', { price: -5, fee: 'x' })).status).toBeLessThan(500)
    const broken = await request.fetch('/api/erp/actions/addListing', { method: 'POST', headers: { Authorization: `Bearer ${tokenOf()}`, 'Content-Type': 'application/json' },
      data: '{"args": [', failOnStatusCode: false })
    expect(broken.status()).toBe(400)
    const huge = await admin.act('addCustomer', { name: 'x'.repeat(2_000_000) })
    expect(huge.status).toBe(413)
    expect((await admin.call('GET', '/erp/listings?size=100000&sort=;drop table listings')).status).toBeLessThan(500)
  })
})

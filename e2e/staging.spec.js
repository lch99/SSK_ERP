import { test, expect } from '@playwright/test'
import { watchErrors, ADMIN, SESSION, signInScreen } from './helpers.js'

// A real server (E2E_URL): the first account with the setup key, signing in and out, and an agent
// given their own account by a one-time link, as the office will do for each client who tests.
// Runs first (the other files sign in with the account made here). Skipped against the demo.
test.skip(!process.env.E2E_URL, 'needs a server: E2E_URL')
test.describe.configure({ mode: 'serial' })

test('the first account is made with the setup key (a new server only)', async ({ page, request }) => {
  const status = await (await request.get('/api/auth/status')).json()
  test.skip(!status.needsFirstUser, 'the server already has accounts')
  expect(status.needsSetupKey, 'the server asks for its ADMIN_TOKEN').toBe(true)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Welcome to SubSaleKing ERP' })).toBeVisible()
  await page.getByLabel('Your name').fill('E2E Admin')
  await page.getByLabel('Username').fill(ADMIN.username)
  await page.getByLabel(/^Password \(at least/).fill(ADMIN.password)
  await page.getByLabel('Password again', { exact: true }).fill(ADMIN.password)
  await page.getByLabel(/^Setup key/).fill('not-the-key')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('That setup key is not right.')).toBeVisible()
  await page.getByLabel(/^Setup key/).fill(process.env.E2E_SETUP_KEY || '')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.locator('.ssk-page').first()).toBeVisible({ timeout: 30_000 })
})

test('signing in: a wrong password is refused, the right one opens the ERP, and signing out returns here', async ({ page }) => {
  const errors = watchErrors(page)
  await signInScreen(page)
  await page.getByLabel('Username').fill(ADMIN.username)
  await page.getByLabel('Password', { exact: true }).fill('not the password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('form').getByRole('listitem')).toBeVisible()
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.ssk-page').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'User menu' }).click()
  await page.getByRole('menuitem', { name: 'Logout' }).or(page.getByRole('button', { name: 'Logout' })).first().click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  expect(errors.filter(e => !/401|Failed to load resource/.test(e))).toEqual([])
})

// The agent the link test gives an account to (their username), for the tests after it.
let agentName = null
const AGENT_PASSWORD = 'agent correct horse'

test('an agent gets a one-time link, chooses a password and signs in with it', async ({ page, browser }) => {
  await signInScreen(page)
  await page.getByLabel('Username').fill(ADMIN.username)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.ssk-page').first()).toBeVisible({ timeout: 30_000 })
  // An active agent from the list.
  await page.goto('/#/staff')
  await page.locator('.ssk-row').filter({ hasText: 'Active' }).first().click({ position: { x: 8, y: 8 } })
  await expect(page).toHaveURL(/#\/staff\/\d+/)
  await page.getByRole('button', { name: /Send a (new password link|link to set the password)/ }).click()
  const url = await page.getByRole('textbox', { name: 'Password link' }).inputValue()
  const username = await page.locator('.ssk-modal-wrap b').first().innerText().catch(() => null)
  expect(url).toMatch(/#\/password\?t=/)

  // The agent, on their own phone or computer.
  const agent = await browser.newPage()
  await agent.goto(url)
  const name = (await agent.getByText(/your username is/i).innerText()).match(/username is (\S+?)\./i)?.[1]
  expect(name || username).toBeTruthy()
  agentName = name
  await agent.getByLabel(/^Password \(at least/).fill(AGENT_PASSWORD)
  await agent.getByLabel('Password again', { exact: true }).fill(AGENT_PASSWORD)
  await agent.getByRole('button', { name: 'Save and sign in' }).click()
  await expect(agent.locator('.ssk-page').first()).toBeVisible({ timeout: 30_000 })
  // The link works once.
  const again = await browser.newPage()
  await again.goto(url)
  await expect(again.getByText(/used|expired|no longer/i).first()).toBeVisible()
  // And the new password signs in.
  const fresh = await browser.newPage()
  await signInScreen(fresh)
  await fresh.getByLabel('Username').fill(name)
  await fresh.getByLabel('Password', { exact: true }).fill(AGENT_PASSWORD)
  await fresh.getByRole('button', { name: 'Sign in' }).click()
  await expect(fresh.locator('.ssk-page').first()).toBeVisible({ timeout: 30_000 })
})

test('the superadmin session is kept for the page tests', async ({ page }) => {
  await signInScreen(page)
  await page.getByLabel('Username').fill(ADMIN.username)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.ssk-page').first()).toBeVisible({ timeout: 30_000 })
  await page.context().storageState({ path: SESSION })
})

test('the agent adds a listing as a draft, with its car parks, and deletes their own draft', async ({ page }) => {
  test.skip(!agentName, 'needs the agent from the link test')
  const errors = watchErrors(page)
  await signInScreen(page)
  await page.getByLabel('Username').fill(agentName)
  await page.getByLabel('Password', { exact: true }).fill(AGENT_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.ssk-page').first()).toBeVisible({ timeout: 30_000 })

  const unit = `E2E-${Date.now().toString(36).slice(-5)}`
  await page.goto('/#/listing-new')
  await page.getByLabel(/^Area/).fill('Kepong')
  await page.getByLabel(/^Title \(building/).fill('E2E Test Residence')
  await page.getByLabel(/^Advertised Price/).fill('450000')
  await page.getByLabel(/^Car Parks/).fill('2')
  await page.getByLabel(/^Unit Number/).fill(unit)
  await page.getByLabel(/^Owner Name/).fill('E2E Owner')
  await page.getByLabel(/^Owner Contact/).fill('012-3456789')
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page).toHaveURL(/#\/listings\/\d+/, { timeout: 30_000 })
  await expect(page.getByText('Car Parks', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Actions' }).last().click()
  await page.getByRole('menuitem', { name: /Delete draft/ }).or(page.getByRole('button', { name: /Delete draft/ })).first().click()
  await page.locator('.ssk-modal-wrap').getByRole('button', { name: 'Delete' }).click()
  await expect(page).toHaveURL(/#\/listings$/, { timeout: 30_000 })
  expect(errors.filter(e => !/401|Failed to load resource/.test(e))).toEqual([])
})

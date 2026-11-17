import { expect } from '@playwright/test'

// Running against the demo (no server): pages that need the server's sign-in are left out.
export const DEMO = !process.env.E2E_URL

// Errors the page raised (uncaught, or logged as errors) while a test ran: none is the rule.
export function watchErrors(page) {
  const errors = []
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  return errors
}

// On a server (E2E_URL): the superadmin the tests sign in as (staging.spec.js makes it on a new server).
export const ADMIN = { username: process.env.E2E_USER || 'superadmin', password: process.env.E2E_PASSWORD || 'admin1234' }

// Where staging.spec.js keeps the superadmin's signed-in session for the other files (never in git).
export const SESSION = 'e2e/.auth/admin.json'

// The sign-in screen of a server, signed out.
export async function signInScreen(page) {
  await page.addLocatorHandler(page.getByRole('button', { name: 'Got it' }), b => b.click())
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 30_000 })
}

// The ERP with the demo's sample company and records (on a server: signed in as ADMIN), the
// "What's new" note closed whenever it shows.
export async function openErp(page, path = 'dashboard') {
  await page.addLocatorHandler(page.getByRole('button', { name: 'Got it' }), b => b.click())
  // On a server: already signed in (the session staging.spec.js saved, SESSION).
  if (!DEMO) return go(page, path)
  await page.goto('/')
  // Each test starts with an empty browser: Setup's welcome, then its filled-in example.
  await page.getByText('See a filled-in example').click({ timeout: 30_000 })
  await expect(page).toHaveURL(/#\/setup\/review/)
  await expect(page.getByText('Ready to go live', { exact: true })).toBeVisible()
  await go(page, path)
}

// A page's content once drawn (the Users page has a layout of its own: its heading).
export const content = page => page.locator('.ssk-page').or(page.getByRole('heading', { level: 1 })).first()

// Another page of the ERP, waiting for it to draw.
export async function go(page, path) {
  await page.goto(`/#/${path}`)
  await expect(content(page)).toBeVisible({ timeout: 30_000 })
}

// The page fits the screen: nothing pushes it wider than the window (phones).
export async function fitsWidth(page) {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
  expect(scroll, 'the page scrolls sideways').toBeLessThanOrEqual(client + 1)
}

// A dialog by its title.
export const dialog = (page, title) => page.locator('.ssk-modal-wrap').filter({ hasText: title }).last()

// A unique bit of text for records a test makes.
export const stamp = () => Date.now().toString(36).slice(-5).toUpperCase()

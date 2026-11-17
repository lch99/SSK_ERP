import fs from 'node:fs'
import { test as base, expect } from '@playwright/test'

// Every functional test: the "What's new" note closed whenever it shows (it would cover the form).
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addLocatorHandler(page.getByRole('button', { name: 'Got it' }), b => b.click())
    await use(page)
  },
})
export { expect }
import { SESSION } from '../helpers.js'

// The functional tests run against a server (E2E_URL), on whatever data it holds (the local copy of the real
// data, or staging): every record they make carries STAMP in its name, so it is easy to find and remove.
export const STAMP = `E2E${Date.now().toString(36).slice(-4).toUpperCase()}`
export const AGENT_SESSION = 'e2e/.auth/agent.json'
export const AGENT_FILE = 'e2e/.auth/agent-info.json'
export const PASSWORD = 'agent1234'

// The signed-in token in a saved session (the ERP keeps it in localStorage as ssk-token).
export function tokenOf(file = SESSION) {
  const s = JSON.parse(fs.readFileSync(file, 'utf8'))
  return s.origins.flatMap(o => o.localStorage).find(x => x.name === 'ssk-token')?.value
}
export const agentInfo = () => JSON.parse(fs.readFileSync(AGENT_FILE, 'utf8'))

// The API as someone (a token), or as nobody. Returns { status, body }.
export function api(request, token) {
  const call = async (method, path, data, headers = {}) => {
    const r = await request.fetch(`/api${path}`, { method, data, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...headers }, failOnStatusCode: false })
    let body = null
    try { body = await r.json() } catch { body = null }
    return { status: r.status(), body }
  }
  return { call, act: (name, ...args) => call('POST', `/erp/actions/${name}`, { args, small: true }) }
}

// A Select (ui.jsx): its button is named "Label: value"; typing in its search narrows the options.
export async function pick(page, label, search, option = search) {
  await page.getByRole('button', { name: new RegExp(`^${label}:`) }).first().click()
  const box = page.getByRole('textbox', { name: `Search ${label}` })
  if (search != null && await box.isVisible().catch(() => false)) await box.fill(String(search))
  const opt = page.getByRole('option', { name: option instanceof RegExp ? option : new RegExp(String(option).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first()
  await expect(opt).toBeVisible({ timeout: 15_000 })
  await opt.click()
}

// The red notice a form shows when it refuses (or the confirm dialog's error).
export const refusal = page => page.locator('[role="alert"], .ssk-notice-red, [data-tone="red"]').or(page.getByText(/first\.$|is required|not allowed|valid phone|cannot|already|Pick /)).first()

// Any browser dialog (alert/confirm/prompt) fails the test: text typed into a form must never run as code.
export function noScriptDialogs(page) {
  const seen = []
  page.on('dialog', d => { seen.push(d.message()); d.dismiss().catch(() => {}) })
  return seen
}

// Text that would run as code or break a query if it were not handled as text.
export const NASTY = `<img src=x onerror=alert('xss')> '"); DROP TABLE listings;-- ${'‮'}`

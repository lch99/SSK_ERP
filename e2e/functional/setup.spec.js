import fs from 'node:fs'
import { test, expect } from '@playwright/test'
import { STAMP, AGENT_SESSION, AGENT_FILE, PASSWORD, tokenOf, api } from './fixtures.js'

// A test agent of its own for the functional tests (never a real person's account): added as the office adds
// one, set Active, given a password through the one-time link, and signed in; the session is kept.
test.skip(!process.env.E2E_URL, 'needs a server: E2E_URL')

test('a test agent of their own, signed in', async ({ page, request }) => {
  const admin = api(request, tokenOf())
  const branches = (await admin.call('GET', '/branches')).body
  const branchId = (branches.branches || branches)[0].id
  const username = `e2eagent${STAMP.toLowerCase()}`
  const add = await admin.act('addStaff', { username, name: `E2E Agent ${STAMP}`, short: `E2E Agent ${STAMP}`, branchId, type: 'staff', phone: '012-3456789' })
  expect(add.status, JSON.stringify(add.body)).toBe(200)
  const id = add.body.added?.staff?.[0]
  expect(id).toBeTruthy()
  expect((await admin.act('setStaffStatus', id, 'active')).status).toBe(200)
  const link = await admin.call('POST', `/accounts/${id}/link`, {})
  expect(link.status, JSON.stringify(link.body)).toBe(200)
  const set = await api(request).call('POST', `/auth/link/${link.body.token}`, { password: PASSWORD })
  expect(set.status, JSON.stringify(set.body)).toBe(200)

  await page.addInitScript(t => localStorage.setItem('ssk-token', t), set.body.token)
  await page.goto('/#/dashboard')
  await expect(page.locator('.ssk-page').first()).toBeVisible({ timeout: 30_000 })
  await page.context().storageState({ path: AGENT_SESSION })
  fs.writeFileSync(AGENT_FILE, JSON.stringify({ id, username: link.body.username, branchId, name: `E2E Agent ${STAMP}` }))
})

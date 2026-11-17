import { test, expect } from '@playwright/test'
import { MODULES } from '../src/erp/modules.js'
import { openErp, watchErrors, fitsWidth, content, DEMO } from './helpers.js'

// Every page of every module opens with the sample data: no error, a page drawn, nothing wider than a phone.
// (Sign-in accounts lists the server's accounts: not in the demo, whose menu hides it.)
const pages = MODULES.flatMap(m => m.items.filter(i => i.path && !(DEMO && i.needsSignIn)).map(i => ({ module: m.label, ...i })))

for (const p of pages) {
  test(`${p.module} › ${p.label} (#/${p.path})`, async ({ page }) => {
    const errors = watchErrors(page)
    await openErp(page, p.path)
    await expect(content(page)).not.toBeEmpty()
    await page.waitForTimeout(300)
    await fitsWidth(page)
    expect(errors).toEqual([])
  })
}

// A record from each list's first row: its page (or panel) opens without errors and fits the screen.
// (Projects, payouts to approve and viewings show cards and groups; enquiries, owner requests, titles and areas act through buttons: the page test covers them.)
const lists = ['listings', 'deals', 'staff', 'customers', 'money-in', 'money-out', 'salary']
for (const list of lists) {
  test(`a record from ${list}`, async ({ page }) => {
    const errors = watchErrors(page)
    await openErp(page, list)
    const row = page.locator('.ssk-row').first()
    await expect(row).toBeVisible()
    const before = page.url()
    await row.click({ position: { x: 8, y: 8 } })
    await page.waitForTimeout(600)
    await expect(content(page)).toBeVisible()
    expect(page.url() !== before || await page.locator('.ssk-modal-wrap, [role="dialog"]').count() > 0, 'the row opened nothing').toBe(true)
    await fitsWidth(page)
    expect(errors).toEqual([])
  })
}

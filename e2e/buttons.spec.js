import { test, expect } from '@playwright/test'
import { MODULES } from '../src/erp/modules.js'
import { DEMO, watchErrors, openErp, go } from './helpers.js'

// Every button on every page: each page of the menu, and a record of each kind, opened in the demo (its
// sample data is the browser's own, so clicking everything changes nothing real). Each button is clicked once
// (rows repeat the same buttons: the first row's stand for the rest), each item of every menu it opens, and the
// main button of every dialog that comes up (so a form is sent as it is: half-empty, as people do). Nothing may
// raise an error, log one, or show the page's "Something went wrong" card.
// On a server only when asked (E2E_CRAWL=1) and only on a copy that may change: these clicks save, approve and
// delete. There, a refusal the server explains (4xx) is an answer, not a fault; a server error (5xx) is a fault.
test.skip(!DEMO && !process.env.E2E_CRAWL, 'the demo, or a disposable server copy with E2E_CRAWL=1: these clicks change records')
// On a server: not the pages where a stray click locks the crawl out or rewrites the company (sign-in accounts,
// Roles & access, Setup, planned downtime), nor the rules that rewrite every listing.
const SERVER_SKIP = new Set(['setup', 'users', 'access', 'technical', 'technical/downtime', 'system/rules'])
test.describe.configure({ mode: 'parallel' })

const SKIP = /sign out|log ?out|reset|start over|clear (the )?demo|^toggle menu$|^menu$/i
const MAX_CLICKS = 45
const IN_PAGE = '.ssk-page button:visible:not([disabled]), .ssk-page [role="button"]:visible:not([aria-disabled="true"])'
const BROKEN = /Something (on it )?went wrong/

const pages = MODULES.flatMap(m => m.items.filter(i => i.path && !(DEMO && i.needsSignIn) && (DEMO || !SERVER_SKIP.has(i.path)))
  .map(i => ({ name: `${m.label} › ${i.label}`, path: i.path })))
// A record of each kind: the first one its list links to.
const RECORDS = ['listings', 'deals', 'customers', 'staff', 'projects', 'money-in', 'money-out', 'salary', 'appointments', 'titles']

async function labelsOf(page) {
  return page.locator(IN_PAGE).evaluateAll(els => els.map((e, i) => {
    const text = (e.getAttribute('aria-label') || e.innerText || e.title || '').trim().replace(/\s+/g, ' ').slice(0, 60)
    return { i, key: text || `(${e.tagName.toLowerCase()} ${e.className?.toString?.().slice(0, 30) || ''} #${i})` }
  }))
}

async function settle(page) {
  await page.waitForTimeout(250)
}

// After a click: a dialog's main button (its last one), then close it.
async function finishDialog(page) {
  const modal = page.locator('.ssk-modal-wrap:visible').last()
  if (!(await modal.count())) return
  const buttons = modal.locator('button:visible:not([disabled])')
  const n = await buttons.count()
  const last = n ? buttons.nth(n - 1) : null
  const label = last ? ((await last.innerText().catch(() => '')) || '').trim() : ''
  if (last && !/^(close|cancel|×|✕)$/i.test(label) && !SKIP.test(label)) await last.click({ timeout: 3000 }).catch(() => {})
  await settle(page)
  for (let k = 0; k < 3 && (await page.locator('.ssk-modal-wrap:visible').count()); k++) await page.keyboard.press('Escape')
}

async function crawl(page, path, problems) {
  const errors = watchErrors(page)
  const done = new Set()
  let clicks = 0
  const check = async what => {
    // "View the ERP as…" works by switching who you are: come back as the Superadmin before the next click.
    const back = page.getByRole('button', { name: 'Back to Superadmin' }).first()
    if (await back.isVisible().catch(() => false)) { await back.click().catch(() => {}); await settle(page) }
    const fresh = errors.splice(0).filter(e => !/status of 4\d\d|\b4\d\d \((Bad Request|Forbidden|Not Found|Conflict|Too Many|Payload)/.test(e))
    for (const e of fresh) problems.push(`${path} › ${what}: ${e.slice(0, 200)}`)
    if (await page.getByText(BROKEN).count()) problems.push(`${path} › ${what}: the page broke (error card)`)
  }
  while (clicks < MAX_CLICKS) {
    await go(page, path)
    const next = (await labelsOf(page)).find(l => !done.has(l.key) && !SKIP.test(l.key))
    if (!next) break
    done.add(next.key)
    clicks++
    await page.locator(IN_PAGE).nth(next.i).click({ timeout: 3000 }).catch(() => {})
    await settle(page)
    const menu = page.getByRole('menu').last()
    if (await menu.isVisible().catch(() => false)) {
      const items = (await menu.getByRole('menuitem').evaluateAll(els => els.filter(e => e.getAttribute('aria-disabled') !== 'true' && !e.disabled).map(e => e.innerText.trim().replace(/\s+/g, ' ')))).filter(t => t && !SKIP.test(t))
      await page.keyboard.press('Escape')
      for (const item of items.slice(0, 10)) {
        if (clicks >= MAX_CLICKS) break
        clicks++
        await go(page, path)
        const again = (await labelsOf(page)).find(l => l.key === next.key)
        if (!again) break
        await page.locator(IN_PAGE).nth(again.i).click({ timeout: 3000 }).catch(() => {})
        await settle(page)
        await page.getByRole('menu').last().getByRole('menuitem', { name: item, exact: true }).first().click({ timeout: 3000 }).catch(() => {})
        await settle(page)
        await finishDialog(page)
        await check(`${next.key} › ${item}`)
      }
      continue
    }
    await finishDialog(page)
    await check(next.key)
  }
  return clicks
}

for (const p of pages) {
  test(`every button: ${p.name} (#/${p.path})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop only')
    test.setTimeout(5 * 60_000)
    const problems = []
    await openErp(page, p.path)
    const clicks = await crawl(page, p.path, problems)
    console.log(`${testInfo.title}: ${clicks} clicks`)
    expect(problems).toEqual([])
  })
}

for (const list of RECORDS) {
  test(`every button: a record from ${list}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop only')
    test.setTimeout(5 * 60_000)
    await openErp(page, list)
    // Rows open their record when clicked.
    const row = page.locator('.ssk-page tbody tr').first()
    test.skip(!(await row.count()), `no record to open in ${list}`)
    await row.click()
    await page.waitForURL(new RegExp(`#/${list}/\\d+`), { timeout: 10_000 }).catch(() => {})
    const path = decodeURIComponent(new URL(page.url()).hash.slice(2))
    test.skip(!new RegExp(`^${list}/\\d+`).test(path), `a row of ${list} opens no record page`)
    const problems = []
    const clicks = await crawl(page, path, problems)
    console.log(`${testInfo.title}: ${clicks} clicks`)
    expect(problems).toEqual([])
  })
}

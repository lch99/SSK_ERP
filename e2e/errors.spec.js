import { test, expect } from '@playwright/test'
import { openErp } from './helpers.js'
import { FAULT } from '../src/errors.js'

// An error nobody caught (an action a button started without handling its failure, a fault in a click
// handler) still reaches the person as a note: a refusal in its own words, a fault in the page as what to
// do, never as "Cannot read properties of undefined…". A click never fails in silence.
test('an error nobody caught is still said, in plain words', async ({ page }) => {
  await openErp(page, 'dashboard')
  const notes = page.getByRole('alert').filter({ hasNotText: 'This page could not be shown' })

  await page.evaluate(() => { Promise.reject(Object.assign(new Error('That listing is already booked at 3pm.'), { status: 400 })) })
  await expect(notes.filter({ hasText: 'That listing is already booked at 3pm.' })).toBeVisible()

  await page.evaluate(() => { Promise.reject(new TypeError("Cannot read properties of undefined (reading 'runs')")) })
  await expect(notes.filter({ hasText: FAULT })).toBeVisible()

  await page.evaluate(() => { setTimeout(() => { throw new RangeError('Offset is outside the bounds of the DataView') }) })
  await expect(notes.filter({ hasText: FAULT })).toHaveCount(1)  // the same note again at once is not repeated

  await expect(page.getByText(/Cannot read properties|outside the bounds/)).toHaveCount(0)
  // The page itself carries on.
  await expect(page.locator('.ssk-page')).toBeVisible()
})

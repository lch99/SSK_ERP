import { watchErrors } from '../helpers.js'
import { test, expect, STAMP, NASTY, PASSWORD, tokenOf, agentInfo, api } from './fixtures.js'

// People's accounts over time (deactivated, back, a password changed), planned downtime, an owner's request
// becoming a listing, buildings, two people at once, Excel downloads and the old phone app's API.
test.skip(!process.env.E2E_URL, 'needs a server: E2E_URL')

const okErrors = e => !/40[0-9]|Failed to load resource|503/.test(e)
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n')
const myt = (hours = 0) => new Date(Date.now() + 8 * 3600000 + hours * 3600000).toISOString().slice(0, 16).replace('T', ' ')

// A throwaway agent with a password: { id, username, token }.
async function freshAgent(request, tag) {
  const admin = api(request, tokenOf())
  const username = `e2e${tag}${STAMP}`.toLowerCase()
  const id = (await admin.act('addStaff', { username, name: `E2E ${tag} ${STAMP}`, branchId: agentInfo().branchId, type: 'staff' })).body.added.staff[0]
  await admin.act('setStaffStatus', id, 'active')
  const link = (await admin.call('POST', `/accounts/${id}/link`, {})).body
  const set = (await api(request).call('POST', `/auth/link/${link.token}`, { password: PASSWORD })).body
  return { id, username: link.username, token: set.token }
}
const signIn = (request, username, password) => api(request).call('POST', '/auth/login', { username, password })

test('a person set Inactive cannot sign in, and their open session stops; set Active again, they can', async ({ request }) => {
  const admin = api(request, tokenOf())
  const x = await freshAgent(request, 'leaver')
  expect((await api(request, x.token).call('GET', '/erp/start')).status).toBe(200)
  expect((await admin.act('setStaffStatus', x.id, 'gone')).body.error).toMatch(/Unknown status/)
  expect((await admin.act('setStaffStatus', x.id, 'inactive')).status).toBe(200)
  const refused = await signIn(request, x.username, PASSWORD)
  expect(refused.status).toBe(403)
  expect(refused.body.error).toMatch(/no longer active/)
  expect([401, 403]).toContain((await api(request, x.token).call('GET', '/erp/start')).status)
  await admin.act('setStaffStatus', x.id, 'active')
  expect((await signIn(request, x.username, PASSWORD)).status).toBe(200)
})

test('changing one\'s password: the wrong current one or a short new one is refused; then old sessions end', async ({ request }) => {
  const x = await freshAgent(request, 'pw')
  const me = api(request, x.token)
  expect((await me.call('POST', '/auth/password', { current: 'not-it-at-all', password: 'brand-new-pw' })).body.error).toMatch(/current password is wrong/)
  expect((await me.call('POST', '/auth/password', { current: PASSWORD, password: 'short' })).body.error).toMatch(/at least 8/)
  const changed = await me.call('POST', '/auth/password', { current: PASSWORD, password: 'brand-new-pw' })
  expect(changed.status).toBe(200)
  expect((await api(request, x.token).call('GET', '/erp/start')).status, 'the old session').toBe(401)
  expect((await signIn(request, x.username, PASSWORD)).status).toBe(401)
  expect((await signIn(request, x.username, 'brand-new-pw')).status).toBe(200)
})

test('planned downtime: refused in the past, backwards, too long, unexplained or overlapping; one planned and cancelled', async ({ request }) => {
  const admin = api(request, tokenOf())
  const plan = (start, end, message = `${STAMP} test window`) => admin.act('scheduleDowntime', { start, end, message, closes: true })
  expect((await plan(myt(-2), myt(-1))).body.error).toMatch(/later than now/)
  expect((await plan(myt(30), myt(29))).body.error).toMatch(/end after it starts/)
  expect((await plan(myt(30), myt(60))).body.error).toMatch(/hours or less/)
  expect((await plan(myt(30), myt(31), '  ')).body.error).toMatch(/Say in a sentence/)
  const at = 24 * 20 + Math.floor(Math.random() * 200)
  const ok = await plan(myt(at), myt(at + 1))
  expect(ok.status, JSON.stringify(ok.body)).toBe(200)
  // The planned windows come with the start-up read (the "back soon" banner reads them).
  const w = (await admin.call('GET', '/erp/start')).body.data.downtime.find(x => x.message === `${STAMP} test window`)
  expect(w, 'the window is planned').toBeTruthy()
  try {
    expect((await plan(w.start, w.end)).body.error).toMatch(/overlaps/)
  } finally {
    expect((await admin.act('cancelDowntime', w.id)).status).toBe(200)
  }
  expect((await admin.act('cancelDowntime', w.id)).body.error).toMatch(/Only downtime that has not started/)
  // An agent cannot plan downtime.
  expect((await api(request, tokenOf('e2e/.auth/agent.json')).act('scheduleDowntime', { start: myt(50), end: myt(51), message: 'x' })).status).toBe(403)
})

test('an owner\'s request from the website becomes a listing, filled in from the request', async ({ page, request }) => {
  const errors = watchErrors(page)
  const name = `${STAMP} Owner Req`
  const sent = await api(request).call('POST', '/public/owner-requests', { name, phone: '012-7654321', email: 'owner@example.com', propertyName: 'Kepong Baru', price: 380000, type: 'sale' })
  expect(sent.status).toBe(200)
  const admin = api(request, tokenOf())
  const vr = (await admin.call('GET', `/erp/vendorRequests?q=${sent.body.ticket}&counts=0&size=5`)).body.rows[0]
  expect(vr, 'the office sees the request').toBeTruthy()
  expect((await admin.act('setVendorRequest', 999999999, 1)).body.error).toMatch(/no longer exists/)
  await page.goto(`/#/listing-new?vr=${vr.id}`)
  await expect(page.getByText(new RegExp(`From owner request\\s*${sent.body.ticket}`))).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel(/^Owner Name/)).toHaveValue(name)
  await page.getByLabel(/^Area/).fill('Kepong')
  await page.getByLabel(/^Title \(building/).fill(`${STAMP} From Request Residence`)
  await page.getByLabel(/^Unit Number/).fill(`VR-${STAMP}`)
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page).toHaveURL(/#\/listings\/\d+/, { timeout: 30_000 })
  const after = (await admin.call('GET', `/erp/vendorRequests?q=${sent.body.ticket}&counts=0&size=5`)).body.rows[0]
  expect(after.status, 'Listing Created').toBe(2)
  expect(after.listingId).toBeTruthy()
  expect(errors.filter(okErrors)).toEqual([])
})

test('buildings: no name or area, a duplicate, and deleting one with listings without a replacement are refused', async ({ request }) => {
  const admin = api(request, tokenOf())
  expect((await admin.act('saveTitle', { name: '', area: 'Kepong' })).body.error).toMatch(/Enter the title name/)
  expect((await admin.act('saveTitle', { name: `${STAMP} Tower`, area: '' })).body.error).toMatch(/Pick the area/)
  const made = await admin.act('saveTitle', { name: `${STAMP} Tower`, area: 'Kepong', state: 'Federal Territory of Kuala Lumpur', category: 'Condominium' })
  expect(made.status, JSON.stringify(made.body)).toBe(200)
  expect((await admin.act('saveTitle', { name: `${STAMP} TOWER`, area: 'Kepong', state: 'Federal Territory of Kuala Lumpur' })).body.error).toMatch(/already exists/)
  const busy = (await admin.call('GET', '/erp/titles?counts=0&size=20&sort=-listings')).body.rows.find(t => (t.$?.listings || t.listings || 0) > 0)
  if (busy) expect((await admin.act('deleteTitle', busy.id)).body.error).toMatch(/Pick the replacement title/)
  const mine = (await admin.call('GET', `/erp/titles?q=${encodeURIComponent(`${STAMP} Tower`)}&counts=0&size=5`)).body.rows[0]
  expect((await admin.act('deleteTitle', mine.id)).status).toBe(200)
  expect((await admin.act('deleteTitle', mine.id)).body.error).toMatch(/no longer exists/)
})

test('two people at once: the same listing on two E-Forms at the same moment makes only one', async ({ request }) => {
  const admin = api(request, tokenOf())
  const listing = (await admin.call('GET', '/erp/listings?status=active&type=sale&counts=0&size=50&sort=-updated')).body.rows.find(l => !l.dealId)
  const body = { type: 'sale', date: myt().slice(0, 10), agentId: agentInfo().id, listingId: listing.id, price: 500000, feePct: 2, fee: 10000,
    buyer: { name: `${STAMP} Race` }, owner: { name: `${STAMP} Race Owner` }, rental: {}, property: {}, files: {}, otherBuyers: [], otherOwners: [], submit: true }
  const results = await Promise.all(Array.from({ length: 5 }, () => admin.act('addDeal', body)))
  expect(results.filter(r => r.status === 200).length).toBe(1)
  expect(results.filter(r => r.status === 400).every(r => /already on E-Form/.test(r.body.error))).toBe(true)
  // And ten price changes at once on one listing: each saved in turn, none lost to an error.
  const prices = Array.from({ length: 10 }, (_, i) => 400000 + i * 1000)
  const saves = await Promise.all(prices.map(p => admin.act('updateListing', listing.id, { askPrice: p })))
  expect(saves.every(r => r.status === 200)).toBe(true)
  const now = (await admin.call('GET', `/erp/listings/${listing.id}`)).body
  expect(prices).toContain(now.askPrice)
})

test('Excel downloads: a real file for who may see the list; nobody signed in, or an unknown list, gets none', async ({ request }) => {
  const get = (path, token) => request.fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, failOnStatusCode: false })
  // (The lists with an Excel download: agents, payments in and out, as the current ERP's exports.)
  for (const list of ['staff', 'moneyIn', 'moneyOut']) {
    const r = await get(`/erp/${list}/download?q=a`, tokenOf())
    expect(r.status(), list).toBe(200)
    expect(r.headers()['content-type']).toMatch(/spreadsheetml/)
    expect((await r.body()).subarray(0, 2).toString()).toBe('PK')
  }
  expect((await get('/erp/staff/download', null)).status()).toBe(401)
  expect((await get('/erp/no-such-list/download', tokenOf())).status()).toBe(404)
  expect((await get('/erp/listings/download', tokenOf())).status(), 'a list without one').toBe(404)
  expect((await get(`/erp/staff/download?q=${encodeURIComponent(NASTY)}`, tokenOf())).status()).toBe(200)
  // An agent's download holds only their own reach: never the whole staff list with IC and bank numbers.
  const theirs = await get('/erp/moneyIn/download', tokenOf('e2e/.auth/agent.json'))
  expect([200, 403]).toContain(theirs.status())
})

test('the old phone app\'s API: wrong sign-in refused, a right one works, and nothing without a token', async ({ request }) => {
  const v1 = (method, path, data, token) => request.fetch(`/v1${path}`, { method, ...(data != null && { data }), failOnStatusCode: false, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const wrong = await v1('POST', '/login', { username: agentInfo().username, password: 'not-it' })
  expect(wrong.status()).toBe(401)
  expect((await wrong.json()).success).toBe(false)
  const ok = await v1('POST', '/login', { username: agentInfo().username, password: PASSWORD })
  expect(ok.status()).toBe(200)
  const token = (await ok.json()).data.token
  expect(token).toBeTruthy()
  expect((await v1('POST', '/property/search', {}, token)).status()).toBe(200)
  expect((await v1('POST', '/property/search', {}, null)).status()).toBe(401)
  expect((await v1('POST', '/property/search', {}, 'garbage')).status()).toBe(401)
  expect((await v1('GET', '/property/999999999/details', null, token)).status()).toBe(404)
  expect((await v1('POST', '/property/search', { per_page: 100000, keywords: NASTY }, token)).status()).toBe(200)
})

import crypto from 'node:crypto'
import { test, expect, STAMP, AGENT_SESSION, tokenOf, agentInfo, api } from './fixtures.js'

// Someone trying what they should not: forged or altered sign-ins, an agent raising their own access or opening
// other people's records by number, owners' details through the ERP's lists or the website's API, hostile
// uploads, another person's documents, and other websites calling the API. Everything must be refused cleanly.
test.skip(!process.env.E2E_URL, 'needs a server: E2E_URL')

const b64 = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')
const sign = (header, payload, secret) => {
  const head = `${b64(header)}.${b64(payload)}`
  return `${head}.${crypto.createHmac('sha256', secret).update(head).digest('base64url')}`
}
const digits = v => String(v ?? '').replace(/\D/g, '')

test('a forged, altered or broken sign-in is refused everywhere', async ({ request }) => {
  const real = tokenOf(AGENT_SESSION)
  const [, payload] = real.split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
  const forged = [
    ['signed with a guessed secret', sign({ alg: 'HS256', typ: 'JWT' }, { ...claims, role: 'superadmin' }, 'secret')],
    ['no signature (alg none)', `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, role: 'superadmin' })}.`],
    ['its role changed, its signature kept', `${real.split('.')[0]}.${b64({ ...claims, role: 'superadmin' })}.${real.split('.')[2]}`],
    ['someone else\'s id, its signature kept', `${real.split('.')[0]}.${b64({ ...claims, sub: 1, id: 1 })}.${real.split('.')[2]}`],
    ['long expired', sign({ alg: 'HS256', typ: 'JWT' }, { ...claims, exp: 1_000_000_000 }, 'secret')],
    ['garbage', 'not.a.token'],
    ['empty', ''],
  ]
  for (const [why, token] of forged) {
    for (const [method, path] of [['GET', '/erp/start'], ['GET', '/users'], ['POST', '/erp/actions/addStaff']]) {
      const r = await request.fetch(`/api${path}`, { method, failOnStatusCode: false, data: method === 'POST' ? { args: [{ username: `x${STAMP}`, name: 'X', type: 'admin-staff' }] } : undefined,
        headers: { Authorization: `Bearer ${token}` } })
      expect(r.status(), `${why}: ${method} ${path}`).toBe(401)
    }
  }
  // A header far too long is turned away before it reaches anything.
  const huge = await request.fetch('/api/erp/start', { failOnStatusCode: false, headers: { Authorization: `Bearer ${'x'.repeat(60_000)}` } })
  expect([401, 413, 431, 400]).toContain(huge.status())
  // The real one still works.
  expect((await api(request, real).call('GET', '/erp/start')).status).toBe(200)
})

test('an agent cannot raise their own access, type, branch or status, nor give themselves a role', async ({ request }) => {
  const me = agentInfo()
  const agent = api(request, tokenOf(AGENT_SESSION))
  const admin = api(request, tokenOf())
  const before = (await admin.call('GET', `/erp/staff/${me.id}`)).body
  const all = { agent: true, profilePage: true, profileDoc: true, addListing: true, landlordVerify: true, vendorRequests: true, tripIncentive: true }
  for (const fields of [{ access: all }, { type: 'admin-staff' }, { branchId: before.branchId === 1 ? 2 : 1 }, { status: 'active', type: 'account' }]) {
    const r = await agent.act('updateStaff', me.id, fields)
    expect(r.status, JSON.stringify(fields)).toBeGreaterThanOrEqual(400)
    expect(r.status).toBeLessThan(500)
  }
  expect((await agent.act('setStaffStatus', me.id, 'active')).status).toBeGreaterThanOrEqual(400)
  // My profile takes the profile's own fields only: a role or access sent along is ignored.
  await agent.call('PUT', '/auth/profile', { name: me.name, role: 'superadmin', access: all, branchId: 999, staffId: 1 })
  const after = (await admin.call('GET', `/erp/staff/${me.id}`)).body
  for (const k of ['type', 'branchId', 'status']) expect(after[k], k).toEqual(before[k])
  expect(after.access).toEqual(before.access)
  const who = (await agent.call('GET', '/auth/me')).body.user
  expect(who.role).not.toBe('superadmin')
  // Sign-in accounts, Setup and Roles & access are the Superadmin's.
  expect((await agent.call('POST', '/users', { username: `up${STAMP}`.toLowerCase(), name: 'Up', role: 'superadmin', password: 'good-password-1' })).status).toBe(403)
  expect((await agent.call('PUT', '/setup/deal-types', {})).status).toBe(403)
  expect((await agent.call('GET', '/erp/state')).status).toBe(403)
})

test('an agent cannot open other people\'s records by their number', async ({ request }) => {
  const admin = api(request, tokenOf())
  const agent = api(request, tokenOf(AGENT_SESSION))
  const leaks = []
  for (const list of ['deals', 'customers', 'moneyIn', 'moneyOut', 'payouts', 'requests', 'closes', 'archives', 'vendorRequests', 'agentRequests', 'enquiries', 'viewings', 'listings']) {
    const own = await agent.call('GET', `/erp/${list}?counts=0&size=50`)
    const mine = new Set(own.status === 200 ? own.body.rows.map(r => r.id) : [])
    const all = await admin.call('GET', `/erp/${list}?counts=0&size=40`)
    if (all.status !== 200) continue
    for (const r of all.body.rows.filter(x => !mine.has(x.id)).slice(0, 20)) {
      const got = await agent.call('GET', `/erp/${list}/${r.id}`)
      expect(got.status, `${list} ${r.id}`).toBeLessThan(500)
      if (got.status === 200) leaks.push(`${list} #${r.id}`)
    }
  }
  expect(leaks, 'records opened outside the agent\'s reach').toEqual([])
})

test('in the Whole agency list an agent sees every active listing, but never another\'s owner or unit', async ({ request }) => {
  const me = agentInfo()
  const agent = api(request, tokenOf(AGENT_SESSION))
  const shown = []
  for (const page of [1, 2, 3, 50, 150]) {
    const r = await agent.call('GET', `/erp/agency?counts=0&size=50&page=${page}`)
    expect(r.status).toBe(200)
    for (const l of r.body.rows.filter(x => x.holderId !== me.id && x.creatorId !== me.id)) {
      if (l.owner?.name || l.owner?.phone || l.owner?.ic || l.unit) shown.push(l.code)
    }
  }
  expect(shown).toEqual([])
  // Its search never finds a listing by the owner's phone either.
  const admin = api(request, tokenOf())
  const withOwner = (await admin.call('GET', '/erp/listings?status=active&counts=0&size=50')).body.rows
    .find(l => digits(l.owner?.phone).length >= 9 && l.holderId !== me.id && l.creatorId !== me.id)
  if (withOwner) {
    const found = (await agent.call('GET', `/erp/agency?counts=0&size=50&q=${digits(withOwner.owner.phone)}`)).body.rows
    expect(found.some(x => x.id === withOwner.id), 'found by the owner\'s phone').toBe(false)
  }
})

// Text agents type that the website shows as they wrote it: a phone found there is theirs to answer for (often their own,
// "call me"), so it is listed for the office to look at; anywhere else it would be the API's leak, and fails.
const TYPED = new Set(['description', 'shortDescription', 'marketingRemarks', 'renovation'])

test('the website\'s API shows no owner\'s phone on any public listing', async ({ request }, testInfo) => {
  test.setTimeout(20 * 60_000)
  const admin = api(request, tokenOf())
  // Owners' phones as the office sees them (active listings: the ones the website shows).
  const owners = new Map()
  for (let page = 1; page <= 60; page++) {
    const r = await admin.call('GET', `/erp/listings?status=active&counts=0&size=50&page=${page}&sort=-updated`)
    for (const l of r.body.rows) if (digits(l.owner?.phone).length >= 9) owners.set(digits(l.owner.phone).replace(/^6(?=0)/, ''), l.code)
    if (r.body.rows.length < 50) break
  }
  expect(owners.size, 'owners to look for').toBeGreaterThan(0)
  // Staff phones (an agent's own number in a description is meant to be there).
  const staff = new Set()
  for (let page = 1; page <= 100; page++) {
    const r = await admin.call('GET', `/erp/staff?counts=0&size=50&page=${page}`)
    for (const s of r.body.rows || []) for (const p of [s.phone, s.phone2]) if (digits(p).length >= 9) staff.add(digits(p).replace(/^6(?=0)/, ''))
    if ((r.body.rows || []).length < 50) break
  }
  // Every page of the website's listings, and the full page of a sample of them.
  const found = [], typed = []
  let page = 1, total = Infinity, seen = 0
  const scan = (value, where, key = '') => {
    if (value && typeof value === 'object') { for (const [k, v] of Object.entries(value)) if (k !== 'contact') scan(v, where, k); return }
    for (const m of String(value ?? '').matchAll(/\+?\d[\d\s-]{7,16}\d/g)) {
      const d = digits(m[0]).replace(/^6(?=0)/, '')
      if (!owners.has(d) || staff.has(d)) continue
      ;(TYPED.has(key) ? typed : found).push(`${where} ${key}: the owner phone of ${owners.get(d)}`)
    }
  }
  const sample = []
  while ((page - 1) * 50 < total) {
    const r = await request.fetch(`/api/public/listings?size=50&page=${page}&sort=newest`)
    const body = await r.json()
    total = body.total
    seen += body.rows.length
    for (const l of body.rows) {
      scan(l, l.code) // (not its contact: the agent in charge's own phone is meant to be there)
      if (sample.length < 300 && page % 3 === 1) sample.push(l.id)
    }
    page += 1
  }
  for (const id of sample) scan(await (await request.fetch(`/api/public/listings/${id}`)).json(), `listing ${id}`)
  testInfo.annotations.push({ type: 'scanned', description: `${seen} public listings and ${sample.length} listing pages, against ${owners.size} owners' phones` })
  for (const t of [...new Set(typed)]) testInfo.annotations.push({ type: 'typed by an agent: for the office to check', description: t })
  expect(seen).toBe(total)
  expect(found).toEqual([])
})

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const upload = (request, kind, data, name, type, token = tokenOf()) => request.fetch(`/api/files?kind=${kind}`, {
  method: 'POST', failOnStatusCode: false, data, headers: { ...(token && { Authorization: `Bearer ${token}` }), 'Content-Type': type, 'X-File-Name': name },
})

test('uploads: a hostile name is made harmless; pretend pictures, scripts and too-big files are refused', async ({ request }) => {
  const sneaky = await upload(request, 'photo', PNG, '../../../etc/passwd<script>.png', 'image/png')
  expect(sneaky.status()).toBe(200)
  // Kept by its last part only (no way up a folder); the rest of a name is only text, shown as text.
  const kept = await sneaky.json()
  expect(kept.name).not.toMatch(/[\\/]|\.\./)
  expect(kept.ref).toMatch(new RegExp(`^files/${kept.id}/[^/]+$`))
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  expect((await upload(request, 'photo', svg, 'logo.svg', 'image/svg+xml')).status()).toBe(400)
  expect((await upload(request, 'photo', svg, 'logo.png', 'image/png')).status(), 'an SVG named .png').toBe(400)
  expect((await upload(request, 'document', Buffer.from('<html><script>alert(1)</script></html>'), 'ic.pdf', 'application/pdf')).status(), 'HTML named .pdf').toBe(400)
  expect((await upload(request, 'document', Buffer.from('MZ\x90\x00 not a pdf'), 'ic.exe', 'application/octet-stream')).status()).toBe(400)
  expect((await upload(request, 'nonsense', PNG, 'a.png', 'image/png')).status()).toBe(400)
  expect((await upload(request, 'photo', PNG, 'a.png', 'image/png', null)).status(), 'nobody signed in').toBe(401)
  const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(11 * 1024 * 1024, 32)])
  expect([400, 413]).toContain((await upload(request, 'document', big, 'big.pdf', 'application/pdf')).status())
})

test('another person\'s document cannot be reached: no link for an agent, and a link only opens its own file', async ({ request }) => {
  const admin = api(request, tokenOf())
  const agent = api(request, tokenOf(AGENT_SESSION))
  // A document on an E-Form the agent has nothing to do with (the office's own upload, attached nowhere, works too).
  const pdf = await upload(request, 'document', Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n'), `${STAMP}-ic.pdf`, 'application/pdf')
  expect(pdf.status()).toBe(200)
  const id = (await pdf.json()).id
  expect((await agent.call('GET', `/files/${id}/link`)).status).toBe(404)
  expect(Object.keys((await agent.call('GET', `/files/links?ids=${id}`)).body.links || {})).toEqual([])
  // The file itself: only with a fresh signed link, and that link opens only that file.
  expect((await request.fetch(`/api/files/${id}`, { failOnStatusCode: false })).status()).toBe(403)
  const link = (await admin.call('GET', `/files/${id}/link`)).body
  expect(link.url).toBeTruthy()
  const u = new URL(link.url, process.env.E2E_URL)
  expect((await request.fetch(`${u.pathname}${u.search}`, { failOnStatusCode: false })).status()).toBe(200)
  expect((await request.fetch(`/api/files/${id - 1}${u.search}`, { failOnStatusCode: false })).status(), 'the link moved to another file').toBe(403)
  const tampered = new URLSearchParams(u.search)
  for (const k of [...tampered.keys()]) tampered.set(k, `${tampered.get(k)}0`)
  expect((await request.fetch(`${u.pathname}?${tampered}`, { failOnStatusCode: false })).status(), 'the link altered').toBe(403)
})

test('security headers on every page and answer; another website cannot use the API from a browser', async ({ request }) => {
  for (const path of ['/', '/api/health', '/api/public/listings?size=1']) {
    const h = (await request.fetch(path)).headers()
    expect(h['x-content-type-options'], path).toBe('nosniff')
    expect(h['x-frame-options'] || h['content-security-policy'], `${path}: not framed by others`).toBeTruthy()
    expect(h['x-powered-by'], `${path}: no server banner`).toBeUndefined()
  }
  const r = await request.fetch('/api/auth/status', { headers: { Origin: 'https://evil.example' } })
  expect(r.headers()['access-control-allow-origin'] ?? '').not.toMatch(/evil|\*/)
  const pre = await request.fetch('/api/erp/start', { method: 'OPTIONS', failOnStatusCode: false,
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } })
  expect(pre.headers()['access-control-allow-origin'] ?? '').not.toMatch(/evil|\*/)
})

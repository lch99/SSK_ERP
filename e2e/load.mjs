// Load test: many people at once on the ERP and the website, on whatever data the server holds.
//   E2E_URL=http://localhost:3998 node e2e/load.mjs [users per step, e.g. 10,25,50] [seconds per step]
// Signs in with the sessions `npm run e2e` keeps (e2e/.auth), or E2E_USER / E2E_PASSWORD. Reads only, plus a
// few saves on one draft listing of its own, deleted at the end. Prints, for each step, how fast each kind of
// request answered (median, 95th percentile, slowest) and anything that was not a success.
import fs from 'node:fs'

const BASE = (process.env.E2E_URL || 'http://localhost:3998').replace(/\/$/, '')
const STEPS = (process.argv[2] || '10,25,50').split(',').map(Number)
const SECONDS = Number(process.argv[3] || 30)

const fromSession = file => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).origins.flatMap(o => o.localStorage).find(x => x.name === 'ssk-token')?.value } catch { return null }
}
async function signIn(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
  if (!r.ok) throw new Error(`Sign-in as ${username}: ${r.status}`)
  return (await r.json()).token
}
const office = fromSession('e2e/.auth/admin.json') || await signIn(process.env.E2E_USER || 'superadmin', process.env.E2E_PASSWORD || 'admin1234')
const agent = fromSession('e2e/.auth/agent.json')
const call = async (token, path, init = {}) => {
  const t = performance.now()
  let status = 0
  try {
    const r = await fetch(`${BASE}/api${path}`, { ...init, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(init.body && { 'Content-Type': 'application/json' }), ...init.headers } })
    status = r.status
    await r.arrayBuffer()
  } catch { status = -1 }
  return { status, ms: performance.now() - t }
}
const json = async (token, path, init) => (await fetch(`${BASE}/api${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.body && { 'Content-Type': 'application/json' }) } })).json()
const rand = n => Math.floor(Math.random() * n)
const pick = a => a[rand(a.length)]

// What the traffic picks from: real listing numbers, areas, states and search words.
const ids = (await json(office, '/erp/listings?status=active&counts=0&size=50&sort=-updated')).rows.map(l => l.id)
const publicIds = (await (await fetch(`${BASE}/api/public/listings?size=50&sort=newest`)).json()).rows.map(l => l.id)
const areas = (await (await fetch(`${BASE}/api/public/areas`)).json()).map(a => a.id)
const words = ['kepong', 'condo', 'cheras', 'puchong', 'residence', 'damansara', 'setapak', 'bangi']
const me = JSON.parse(fs.readFileSync('e2e/.auth/agent-info.json', 'utf8') || 'null')
// One draft listing of its own for the saves.
const made = await json(office, '/erp/actions/addListing', { method: 'POST', body: JSON.stringify({ small: true, args: [{ type: 'sale', title: 'LOAD TEST Residence', area: 'Kepong', askPrice: 400000,
  unit: `LT-${Date.now() % 1e6}`, ownerName: 'Load Test', ownerPhone: '012-0000000', holderId: me?.id, draft: true }] }) })
const mine = made.added?.listings?.[0]

const KINDS = [
  // [kind, weight, () => [token, path, init?]]
  ['office: start', 2, () => [office, '/erp/start']],
  ['office: listings page', 10, () => [office, `/erp/listings?status=active&counts=0&size=20&page=${1 + rand(200)}&sort=-updated`]],
  ['office: listings search', 6, () => [office, `/erp/listings?q=${pick(words)}&size=20`]],
  ['office: a listing', 8, () => [office, `/erp/listings/${pick(ids)}`]],
  ['office: E-Forms with counts', 4, () => [office, '/erp/deals?size=20&counts=status,readyToClose']],
  ['office: payments in', 3, () => [office, '/erp/moneyIn?size=20&counts=toCheck']],
  ['office: payouts waiting', 3, () => [office, '/erp/payouts?size=20&counts=waiting,readyToRequest,salaryToRequest']],
  ['office: customers', 3, () => [office, `/erp/customers?size=20&page=${1 + rand(20)}`]],
  ['office: agents', 3, () => [office, `/erp/staff?size=20&q=${pick(['a', 'tan', 'lim', 'lee'])}`]],
  ['office: buildings with rankings', 2, () => [office, `/erp/titles?size=20&page=${1 + rand(50)}`]],
  ...(agent ? [
    ['agent: whole agency', 10, () => [agent, `/erp/agency?counts=0&size=20&page=${1 + rand(300)}`]],
    ['agent: whole agency search', 5, () => [agent, `/erp/agency?q=${pick(words)}&size=20`]],
    ['agent: own E-Forms', 3, () => [agent, '/erp/deals?size=20']],
  ] : []),
  ['website: results', 14, () => [null, `/public/listings?size=20&page=${1 + rand(100)}&type=${pick(['sale', 'rent'])}${Math.random() < 0.5 ? `&areaIds=${pick(areas)}` : ''}${Math.random() < 0.3 ? '&bedrooms=3%2B&minPrice=200000&maxPrice=900000' : ''}`]],
  ['website: a listing', 10, () => [null, `/public/listings/${pick(publicIds)}`]],
  ['website: suggestions', 6, () => [null, `/public/keywords?q=${pick(words).slice(0, 4)}`]],
  ['website: filter counts', 2, () => [null, pick(['/public/areas', '/public/categories', '/public/titles'])]],
  ...(mine ? [['office: save a listing', 3, () => [office, '/erp/actions/updateListing', { method: 'POST', body: JSON.stringify({ small: true, args: [mine, { askPrice: 400000 + rand(100) * 1000 }] }) }]]] : []),
]
const bag = KINDS.flatMap(([kind, w, make]) => Array.from({ length: w }, () => [kind, make]))

const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0)
async function step(users) {
  const stats = new Map()
  const until = Date.now() + SECONDS * 1000
  await Promise.all(Array.from({ length: users }, async () => {
    while (Date.now() < until) {
      const [kind, make] = pick(bag)
      const [token, path, init] = make()
      const r = await call(token, path, init)
      const s = stats.get(kind) || { ms: [], bad: {} }
      s.ms.push(r.ms)
      if (r.status < 200 || r.status >= 300) s.bad[r.status] = (s.bad[r.status] || 0) + 1
      stats.set(kind, s)
    }
  }))
  const all = [...stats.values()].flatMap(s => s.ms).sort((a, b) => a - b)
  console.log(`\n${users} people at once for ${SECONDS}s: ${all.length} requests (${(all.length / SECONDS).toFixed(0)}/s), median ${pct(all, 0.5).toFixed(0)} ms, 95% under ${pct(all, 0.95).toFixed(0)} ms`)
  console.log(`  ${'kind'.padEnd(34)} ${'n'.padStart(5)} ${'median'.padStart(7)} ${'95%'.padStart(7)} ${'slowest'.padStart(8)}  not ok`)
  for (const [kind, s] of [...stats].sort((a, b) => pct(b[1].ms.sort((x, y) => x - y), 0.95) - pct(a[1].ms.sort((x, y) => x - y), 0.95))) {
    const ms = s.ms.sort((a, b) => a - b)
    console.log(`  ${kind.padEnd(34)} ${String(ms.length).padStart(5)} ${pct(ms, 0.5).toFixed(0).padStart(7)} ${pct(ms, 0.95).toFixed(0).padStart(7)} ${ms.at(-1).toFixed(0).padStart(8)}  ${Object.keys(s.bad).length ? JSON.stringify(s.bad) : ''}`)
  }
}

console.log(`Load test on ${BASE}: ${STEPS.join(', ')} people at once, ${SECONDS}s each.`)
for (const users of STEPS) await step(users)
if (mine) {
  const gone = await call(office, '/erp/actions/deleteListing', { method: 'POST', body: JSON.stringify({ small: true, args: [mine] }) })
  console.log(`\nIts test listing deleted: ${gone.status === 200 ? 'yes' : `no (${gone.status})`}`)
}

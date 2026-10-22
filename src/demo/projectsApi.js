// Browser-only store for Projects while the app runs as a demo. The first time,
// it makes one project for each development found in the ERP's project deals,
// with a few developer incentives timed around today, so there is something
// real to look at. After that, what you add or change is kept in this browser.
import * as J from '../../shared/projects.js'

const KEY = 'ssk-demo-projects-v1'
let memory = null

function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw) } catch { /* memory */ }
  return memory
}
function store(v) {
  memory = v
  try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* memory only */ }
}

const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const monthStart = (today, back = 0) => { const d = new Date(`${today.slice(0, 8)}01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - back); return ymd(d) }
const monthEnd = (today, back = 0) => { const d = new Date(`${monthStart(today, back - 1)}T00:00:00Z`); d.setUTCDate(0); return ymd(d) }
// A steady pseudo-random number from a name, so a project always gets the same size.
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

// Same project names as before → keep the user's edits; otherwise start again.
const signature = names => names.slice().sort().join('|')

function seed(deals, setup, today) {
  const projDeals = deals.filter(d => d.type === 'project')
  const names = [...new Set(projDeals.map(d => d.property.title))]
  const counted = name => J.projectDeals(deals, { name })
  names.sort((a, b) => counted(b).length - counted(a).length)

  let nextId = 1
  const projects = names.map((name, i) => {
    const mine = projDeals.filter(d => d.property.title === name)
    const most = (f) => Object.entries(mine.reduce((t, d) => ({ ...t, [f(d)]: (t[f(d)] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0]?.[0]
    const first = mine.map(d => d.date).sort()[0]
    const prices = mine.map(d => d.price)
    return {
      id: nextId++, name, developer: most(d => d.property.developer),
      location: most(d => d.property.address.split(', ').pop()), category: most(d => d.property.category),
      units: 80 + (hash(name) % 9) * 40, priceFrom: Math.floor(Math.min(...prices) / 10000) * 10000,
      devCommissionPct: Number(most(d => d.feePct)) || Number(setup.dealTypes?.project?.defaultRate) || 2,
      launchedOn: first, status: 'selling',
      payout: i === 0 ? { mode: 'boost', boostPct: 2 }
        : i === 1 ? { mode: 'custom', customTotals: Object.fromEntries(setup.tiers.map(t => {
          const base = (setup.totals || []).find(x => x.branchId === 0 && x.dealType === 'project' && x.tierId === t.id)?.totalPct
          return [t.id, base == null ? '' : Math.min(95, base + 3)]
        })) }
          : { mode: 'setup' },
      incentives: [],
    }
  })

  // Example incentives, timed around today and sized to the sales there are.
  const inc = (p, body) => p.incentives.push({ id: nextId++, ...body })
  const unitsIn = (p, from, to) => J.projectDeals(deals, p).filter(d => d.date >= from && d.date <= to).length
  const [a, b, c, d] = projects
  if (a) inc(a, { name: `${a.name} month-end push`, from: monthStart(today), to: monthEnd(today), kind: 'target', counts: 'company',
    steps: [{ units: 10, amount: 3000 }, { units: 15, amount: 6000 }], paidTo: 'agents', agentPct: '' })
  if (b) {
    const from = monthStart(today, 3), to = monthEnd(today, 1), sold = unitsIn(b, from, to)
    inc(b, { name: 'Quarter target', from, to, kind: 'target', counts: 'company',
      steps: [{ units: Math.max(1, sold - 1), amount: 3000 }, { units: sold + 3, amount: 6000 }], paidTo: 'split', agentPct: 70 })
  }
  if (c) inc(c, { name: 'Early-bird bonus', from: monthStart(today, 1), to: monthEnd(today), kind: 'perUnit', counts: 'company',
    perUnit: 500, paidTo: 'agents', agentPct: '' })
  if (d) inc(d, { name: 'Top agents', from: monthStart(today, 5), to: monthEnd(today), kind: 'target', counts: 'agent',
    steps: [{ units: 1, amount: 500 }, { units: 2, amount: 1500 }], paidTo: 'agents', agentPct: '' })
  if (a) inc(a, { name: 'Next launch bonus', from: monthStart(today, -1), to: monthEnd(today, -2), kind: 'target', counts: 'branch',
    steps: [{ units: 5, amount: 2000 }], paidTo: 'split', agentPct: 80 })

  return { sig: signature(names), nextId, projects }
}

export function getProjects(erpData, setup) {
  if (!erpData) return { projects: [] }
  const names = [...new Set(erpData.deals.filter(d => d.type === 'project').map(d => d.property.title))]
  let s = load()
  if (!s || s.sig !== signature(names)) {
    s = seed(erpData.deals, setup, erpData.asOf)
    store(s)
  }
  return structuredClone(s)
}

const fail = errors => { throw Object.assign(new Error(errors[0]), { errors }) }

export function saveProject(project, tiers = []) {
  const s = load()
  const p = {
    ...project,
    name: String(project.name || '').trim(), developer: String(project.developer || '').trim(),
    location: String(project.location || '').trim(),
    units: project.units === '' || project.units == null ? '' : Number(project.units),
    devCommissionPct: Number(project.devCommissionPct),
  }
  const errors = [...J.validateProject(p), ...J.validateProjectTotals(p, tiers)]
  if (s.projects.some(x => x.id !== p.id && x.name.toLowerCase() === p.name.toLowerCase())) errors.push(`There is already a project called "${p.name}".`)
  if (errors.length) fail(errors)
  if (p.id == null) {
    p.id = s.nextId++
    p.incentives = []
    p.status ||= 'selling'
    s.projects.push(p)
  } else s.projects = s.projects.map(x => (x.id === p.id ? { ...x, ...p } : x))
  store(s)
  return structuredClone(p)
}

export function saveIncentive(projectId, incentive) {
  const s = load()
  const inc = { ...incentive, name: String(incentive.name || '').trim(),
    steps: (incentive.steps || []).filter(x => x.units !== '' || x.amount !== '').map(x => ({ units: Number(x.units), amount: Number(x.amount) })) }
  const errors = J.validateIncentive(inc)
  if (errors.length) fail(errors)
  const p = s.projects.find(x => x.id === projectId)
  if (inc.id == null) { inc.id = s.nextId++; p.incentives.push(inc) } else p.incentives = p.incentives.map(x => (x.id === inc.id ? inc : x))
  store(s)
  return structuredClone(inc)
}

export function deleteIncentive(projectId, incentiveId) {
  const s = load()
  const p = s.projects.find(x => x.id === projectId)
  p.incentives = p.incentives.filter(x => x.id !== incentiveId)
  store(s)
}

import { useEffect, useMemo, useState } from 'react'
import * as P from '../../../shared/payout.js'
import { C, btn, btnPrimary, sel } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { useCan } from '../access.jsx'
import { useList, useRecord, useDebounced } from '../useList.js'
import { DealPicker } from '../pickers.jsx'
import { DEMO, getDealCredit, getDealsHistory } from '../../api.js'
import { tierCredit, payoutForClose } from '../../../shared/erpRules.js'
import { DEAL_STATUS, LANDLORD_STATUS, isAgent, r2 } from '../model.js'
import { Page, Card, SearchBox, DateFilter, DataTable, Who, Pill, Link, Status, Modal, Notice, FormField, TextArea, Toolbar, Select, cols, Stat, mono, tabular, field } from '../ui.jsx'
import { RankBars } from '../charts.jsx'
import { rm, pct, date, monthName, lastMonths, amt } from '../format.js'
import { RoleTag } from './Staff.jsx'
import { useDealProject } from './DealPage.jsx'

// Save rows as a CSV file (opens in Excel).
function downloadCsv(name, head, rows) {
  const esc = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const blob = new Blob([[head, ...rows].map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name })
  a.click()
  URL.revokeObjectURL(a.href)
}
const Download = ({ onClick }) => <button style={{ ...btn, fontSize: 13, padding: '5px 12px' }} onClick={onClick}>Download CSV</button>

const REPORTS = {
  total: ['Agent totals', 'What each person submitted and closed, by date (Total Report).'],
  staff: ['Staff pay summary', 'Each person’s deals, commission and pay this year.'],
  agents: ['Top sellers', 'Who sold the most, by agency fees on submitted E-Forms.'],
  tracker: ['E-Form change log', 'Every change made to an E-Form: who, when, before and after.'],
  summary: ['E-Forms by person', 'Per person: submissions, closings, cases and payouts.'],
  cases: ['Payout calculator', 'Pick a case and type a claim to preview who gets paid what.'],
  landlord: ['Landlord checks', 'Confirm each landlord after a rental case is archived.'],
  buildings: ['Sales by building', 'Full-closed sales and rentals in each building, with its Project Manager and Project Handler (Total Transaction Value).'],
  followups: ['Follow-ups by person', 'Listing follow-ups each person made, by action, and the viewings they booked and hosted.'],
}

export default function Reports({ parts }) {
  const key = REPORTS[parts[1]] ? parts[1] : 'total'
  const [title, sub] = REPORTS[key]
  const Comp = { total: Total, staff: StaffSummary, agents: Agents, tracker: Tracker, summary: Summary, cases: CaseSummary, landlord: Landlord, buildings: Buildings, followups: FollowUps }[key]
  return <Page title={title} sub={sub} help={`${sub}\nNarrow it down with the filters at the top. Download CSV, where shown, opens the report in Excel.`}><Comp /></Page>
}

// Date range filter shared by the reports.
function useRange(m) {
  const [from, setFrom] = useState(`${m.year}-01-01`)
  const [to, setTo] = useState(m.today)
  const ui = <DateFilter plain label="Period" from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b) }} />
  return { from, to, ui, inRange: d => d >= from && d <= to }
}

// Each figure is a count the server adds up over the period (shared/lists.js), never every record.
const LIVE = 'submitted,partial,closed', SENT = 'submitted,partial,closed,cancelled'
const useCounts = (key, params, skip) => useList(key, { counts: '0', ...params }, { pageSize: 1, skip }).counts
const agentsOf = (m, ...maps) => [...new Set(maps.flatMap(x => Object.keys(x || {})))].map(Number).filter(id => m.staff[id] && isAgent(m.staff[id])).map(id => m.staff[id])

function Total() {
  const { m } = useErp()
  const can = useCan()
  const r = useRange(m)
  const period = { from: r.from, to: r.to }
  const noCloses = !can('payouts', 'view')
  const deals = useCounts('deals', { ...period, status: SENT, counts: 'perAgent,clearedPerAgent' })
  const closes = useCounts('closes', { ...period, counts: 'claimPerAgent' }, noCloses)
  const byMonth = useCounts('deals', { counts: 'billedByMonth' })
  const claims = useCounts('closes', { counts: 'claimByMonth' }, noCloses)
  const rows = agentsOf(m, deals.perAgent, closes.claimPerAgent).map(s => {
    const a = deals.perAgent?.[s.id] || { n: 0, sum: 0 }
    return { s, n: a.n, total: a.sum, closing: closes.claimPerAgent?.[s.id] || 0, cleared: deals.clearedPerAgent?.[s.id] || 0 }
  }).filter(x => x.n || x.closing).sort((a, b) => b.total - a.total || a.s.id - b.s.id)
  const months = lastMonths(m.today, 10).reverse().map(mo => {
    const a = byMonth.billedByMonth?.[mo] || { n: 0, sum: 0 }
    return { mo, n: a.n, total: a.sum, closing: claims.claimByMonth?.[mo]?.sum || 0 }
  })
  return (
    <>
      <Card pad={16} style={{ marginBottom: 16 }}>
        <Toolbar>{r.ui}<span style={{ flex: 1 }} /><Download onClick={() => downloadCsv('total-report.csv', ['Staff', 'Name', 'E-Forms', 'Submission Total', 'Cleared', 'Closing Total'], rows.map(x => [x.s.code, x.s.name, x.n, x.total, x.cleared, x.closing]))} /></Toolbar>
        <DataTable rows={rows} rowKey={x => x.s.id} narrowAt={680} columns={[
          { key: 's', label: 'Staff', render: x => <Who name={x.s.short} sub={`${x.s.code} · ${m.branchName(x.s.branchId)}`} to={`staff/${x.s.id}`} size={26} /> },
          { key: 'n', label: 'E-Forms', align: 'right', render: x => x.n },
          { key: 't', label: 'Submission Total', align: 'right', render: x => rm(x.total) },
          { key: 'c', label: 'Cleared', align: 'right', render: x => rm(x.cleared) },
          { key: 'cl', label: 'Closing Total', align: 'right', render: x => <b>{rm(x.closing)}</b> },
        ]} />
      </Card>
      <Card title="By month" pad={16}>
        <DataTable rows={months} rowKey={x => x.mo} narrowAt={560} pageSize={12} columns={[
          { key: 'mo', label: 'Month', render: x => <b>{monthName(x.mo)}</b> },
          { key: 'n', label: 'E-Forms', align: 'right', render: x => x.n },
          { key: 't', label: 'Submission Total', align: 'right', render: x => rm(x.total) },
          { key: 'c', label: 'Closing Total', align: 'right', render: x => rm(x.closing) },
        ]} />
      </Card>
    </>
  )
}

// The current ERP's Total Transaction Value (Project Manager): what closed in
// full in each building in the period, and who leads the building.
function Buildings() {
  const { m } = useErp()
  const r = useRange(m)
  const [q, setQ] = useState('')
  const per = useCounts('deals', { status: 'closed', closedFrom: r.from, closedTo: r.to, counts: 'perBuilding' }).perBuilding || {}
  const rows = Object.entries(per).filter(([id]) => m.titles[id]).map(([id, x]) => ({ t: m.titles[id], ...x }))
    .sort((a, b) => b.saleValue - a.saleValue || b.rentals - a.rentals || a.t.id - b.t.id)
  const shown = rows.filter(x => !q || `${x.t.name} ${x.t.area}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <Card pad={16}>
      <Toolbar>{r.ui}<SearchBox value={q} onChange={setQ} placeholder="Building or area" /><span style={{ flex: 1 }} />
        <Download onClick={() => downloadCsv('sales-by-building.csv', ['Building', 'Area', 'Sales closed', 'Sale value', 'Rentals closed', 'Monthly rent', 'Agency fees', 'Project Manager', 'Project Handler'],
          shown.map(x => [x.t.name, x.t.area, x.sales, x.saleValue, x.rentals, x.rentValue, x.fees, x.t.managerId ? m.staffName(x.t.managerId) : '', x.t.handlerId ? m.staffName(x.t.handlerId) : '']))} /></Toolbar>
      <DataTable rows={shown} rowKey={x => x.t.id} narrowAt={860} empty="Nothing closed in full in these dates" columns={[
        { key: 'b', label: 'Building', render: x => <span><b>{x.t.name}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{x.t.area}</span></span> },
        { key: 's', label: 'Sales closed', align: 'right', render: x => <span>{x.sales}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{rm(x.saleValue)}</span></span> },
        { key: 'r', label: 'Rentals closed', align: 'right', render: x => <span>{x.rentals}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{x.rentals ? `${rm(x.rentValue)}/month` : ''}</span></span> },
        { key: 'f', label: 'Agency fees', align: 'right', render: x => <b>{rm(x.fees)}</b> },
        { key: 'pm', label: 'Project Manager · Handler', render: x => <span style={{ fontSize: 13 }}>{x.t.managerId ? m.staffName(x.t.managerId) : '—'}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{x.t.handlerId ? m.staffName(x.t.handlerId) : 'No handler'}</span></span> },
      ]} />
    </Card>
  )
}

// The current ERP's listing follow-up staff action report, with viewings.
function FollowUps() {
  const { m } = useErp()
  const r = useRange(m)
  const period = { from: r.from, to: r.to }
  const follow = useCounts('listings', { ...period, counts: 'followUpsBy' }).followUpsBy || {}
  const views = useCounts('viewings', { ...period, counts: 'perPerson' }).perPerson || {}
  const empty = { n: {}, total: 0, booked: 0, hosted: 0, done: 0, keen: 0 }
  const rows = [...new Set([...Object.keys(follow), ...Object.keys(views)])].filter(id => m.staff[id])
    .map(id => ({ ...empty, ...follow[id], ...views[id], id: Number(id) }))
    .sort((a, b) => b.total + b.booked - a.total - a.booked || a.id - b.id)
  const ACTIONS = [[0, 'Calls'], [1, 'Viewing'], [2, 'Nego'], [3, 'Closing']]
  return (
    <Card pad={16}>
      <Toolbar>{r.ui}<span style={{ flex: 1 }} />
        <Download onClick={() => downloadCsv('follow-ups-by-person.csv', ['Code', 'Name', ...ACTIONS.map(a => a[1]), 'Follow-ups', 'Viewings booked', 'Viewings hosted', 'Viewed', 'Interested'],
          rows.map(x => [m.staff[x.id].code, m.staff[x.id].name, ...ACTIONS.map(([k]) => x.n[k] || 0), x.total, x.booked, x.hosted, x.done, x.keen]))} /></Toolbar>
      <DataTable rows={rows} rowKey={x => x.id} narrowAt={900} empty="No follow-ups or viewings in these dates" columns={[
        { key: 'who', label: 'Staff', render: x => <Who name={m.staffName(x.id)} sub={m.branchName(m.staff[x.id].branchId)} to={`staff/${x.id}`} size={26} /> },
        ...ACTIONS.map(([k, label]) => ({ key: `a${k}`, label, align: 'right', render: x => x.n[k] || 0 })),
        { key: 'total', label: 'Follow-ups', align: 'right', render: x => <b>{x.total}</b> },
        { key: 'booked', label: 'Viewings booked · hosted', align: 'right', render: x => `${x.booked} · ${x.hosted}` },
        { key: 'keen', label: 'Viewed · interested', align: 'right', render: x => `${x.done} · ${x.keen}` },
      ]} />
    </Card>
  )
}

function StaffSummary() {
  const { m, setup } = useErp()
  const can = useCan()
  const year = { from: `${m.year}-01-01`, to: `${m.year}-12-31` }
  const deals = useCounts('deals', { ...year, status: LIVE, counts: 'perAgent,productSide' })
  const pay = useCounts('payouts', { ...year, counts: 'payByKind' }, !can('payouts', 'view') && !can('salary', 'view')).payByKind || {}
  const standing = useCounts('staff', { kind: 'agent', counts: 'standing' }, !can('staff', 'view')).standing || {}
  const tierOf = s => P.tiersFor(setup, s.branchId).find(t => t.name === standing[s.id]?.tier) || P.tiersFor(setup, s.branchId)[0]
  // Everyone in the viewer's reach (the people the standing count covers).
  const rows = Object.keys(standing).map(id => m.staff[id]).filter(s => s && isAgent(s) && s.status !== 'pending').map(s => ({
    s, tier: tierOf(s), sales: deals.perAgent?.[s.id]?.n || 0, product: deals.productSide?.[s.id] || 0,
    credit: standing[s.id]?.yearly || 0, own: pay[s.id]?.own || 0, incentive: pay[s.id]?.incentive || 0,
  })).sort((a, b) => b.credit - a.credit)
  return (
    <Card pad={16}>
      <Toolbar><span style={{ fontSize: 13, color: C.muted }}>{m.year} so far</span><span style={{ flex: 1 }} />
        <Download onClick={() => downloadCsv(`staff-summary-${m.year}.csv`, ['Code', 'Name', 'Branch', 'Position', 'Sales side', 'Product side', 'Commission', 'Salary', 'Incentives'],
          rows.map(r => [r.s.code, r.s.name, m.branchName(r.s.branchId), P.tierLabel(r.tier), r.sales, r.product, r.credit, r.own, r.incentive]))} /></Toolbar>
      <DataTable rows={rows} rowKey={r => r.s.id} narrowAt={900} columns={[
        { key: 'who', label: 'Staff', render: r => <Who name={r.s.short} to={`staff/${r.s.id}`} sub={m.branchName(r.s.branchId)} size={26} /> },
        { key: 'tier', label: 'Position', render: r => <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}><Pill tone="gray" dot={false}>{r.tier?.name}</Pill><RoleTag code={r.s.role} setup={setup} /></span> },
        { key: 'deals', label: 'Cases (sales · product)', align: 'right', render: r => `${r.sales} · ${r.product}` },
        { key: 'credit', label: 'Commission', align: 'right', render: r => rm(r.credit) },
        { key: 'own', label: 'Salary', align: 'right', render: r => rm(r.own) },
        { key: 'inc', label: 'Incentives', align: 'right', render: r => rm(r.incentive) },
        { key: 'total', label: 'Total Payout', align: 'right', render: r => <b>{rm(r.own + r.incentive)}</b> },
      ]} />
    </Card>
  )
}

function Agents() {
  const { m } = useErp()
  const r = useRange(m)
  const fees = useCounts('deals', { from: r.from, to: r.to, status: LIVE, counts: 'feesPerAgent' }).feesPerAgent || {}
  const rows = agentsOf(m, fees).map(s => ({ s, v: fees[s.id]?.sum || 0 })).filter(x => x.v > 0).sort((a, b) => b.v - a.v || a.s.id - b.s.id).slice(0, 20)
  return (
    <Card pad={16}>
      <Toolbar>{r.ui}</Toolbar>
      <RankBars rows={rows.map((x, i) => ({ key: x.s.id, value: x.v, label: <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
        <b style={{ width: 22, color: C.muted, ...tabular }}>{i + 1}</b><Link to={`staff/${x.s.id}`} style={{ color: C.text }}>{x.s.short}</Link>
        <span style={{ fontSize: 12, color: C.muted }}>{m.branchName(x.s.branchId)}</span></span> }))} />
    </Card>
  )
}

// Every change to the E-Forms in reach, newest first: from the server a page at a time (searched there by
// case No. or user); in the demo from this browser's records, by the same rule.
function Tracker() {
  const { m, scoped } = useErp()
  const [q, setQ] = useState('')
  const typed = useDebounced(q.trim(), DEMO ? 0 : 250)
  const [got, setGot] = useState({ rows: [], total: 0, page: 1, loading: !DEMO })
  const read = page => getDealsHistory({ q: typed, page, size: 25 })
  useEffect(() => {
    if (DEMO) return undefined
    let live = true
    setGot(g => ({ ...g, loading: true }))
    read(1).then(r => { if (live) setGot({ rows: r.rows, total: r.total, page: 1, loading: false }) }, () => { if (live) setGot({ rows: [], total: 0, page: 1, loading: false }) })
    return () => { live = false }
  }, [typed, m]) // eslint-disable-line react-hooks/exhaustive-deps
  const more = () => { setGot(g => ({ ...g, loading: true })); read(got.page + 1).then(r => setGot(g => ({ rows: [...g.rows, ...r.rows], total: r.total, page: g.page + 1, loading: false }))) }
  const local = useMemo(() => {
    if (!DEMO) return null
    const ids = new Set(scoped.deals.map(x => x.id))
    const word = typed.toLowerCase()
    return m.data.audit.filter(a => ids.has(a.dealId) && (!word || `${m.deals[a.dealId]?.code} ${a.by}`.toLowerCase().includes(word))).map(a => ({ ...a, code: m.deals[a.dealId]?.code }))
  }, [scoped, m, typed])
  const rows = DEMO ? local : got.rows
  return (
    <Card pad={16}>
      <Toolbar><SearchBox value={q} onChange={setQ} placeholder="Case No. or user" /></Toolbar>
      <DataTable rows={rows} rowKey={a => a.id ?? `${a.at}-${a.dealId}-${a.field}`} narrowAt={760}
        {...(DEMO ? { pageSize: 25 } : { paged: { total: got.total, sort: '-at', onSort: () => {}, onMore: more, loading: got.loading } })} columns={[
          { key: 'at', label: 'Updated at', nowrap: true, render: a => <span style={{ ...tabular, fontSize: 13 }}>{date(a.at.slice(0, 10))} {a.at.slice(11)}</span> },
          { key: 'by', label: 'Updated by', render: a => <span style={mono}>{a.by}</span> },
          { key: 'case', label: 'Case No.', render: a => <Link to={`deals/${a.dealId}`} style={mono}>{a.code}</Link> },
          { key: 'type', label: 'Type', render: a => a.field },
          { key: 'before', label: 'Before', render: a => <span style={{ color: C.muted }}>{a.before}</span> },
          { key: 'after', label: 'After', render: a => <b>{a.after}</b> },
        ]} />
    </Card>
  )
}

function Summary() {
  const { m, setup } = useErp()
  const can = useCan()
  const r = useRange(m)
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const period = { from: r.from, to: r.to }
  const deals = useCounts('deals', { ...period, ...(type && { type }), ...(status && { status }), counts: 'perPerson' }).perPerson || {}
  const lines = useCounts('payouts', { ...period, counts: 'perPerson' }, !can('payouts', 'view') && !can('salary', 'view')).perPerson || {}
  const closes = useCounts('closes', { ...period, counts: 'perPerson' }, !can('payouts', 'view')).perPerson || {}
  const standing = useCounts('staff', { kind: 'agent', counts: 'standing' }, !can('staff', 'view')).standing || {}
  const tierOf = s => P.tiersFor(setup, s.branchId).find(t => t.name === standing[s.id]?.tier) || P.tiersFor(setup, s.branchId)[0]
  const rows = agentsOf(m, deals).map(s => {
    const d = deals[s.id] || {}
    return { s, tier: tierOf(s), submission: d.submission || 0, price: d.price || 0, closing: closes[s.id]?.closing || 0, cases: d.cases || 0,
      archived: lines[s.id]?.archived || 0, sales: d.sales || 0, rental: d.rental || 0, comm: closes[s.id]?.comm || 0, payout: lines[s.id]?.payout || 0 }
  }).filter(x => x.cases).sort((a, b) => b.submission - a.submission || a.s.id - b.s.id)
  return (
    <Card pad={16}>
      <Toolbar>{r.ui}
        <Select label="Type" value={type} onChange={setType} options={[['', 'Sales and rentals'], ['sale', 'Sales'], ['rental', 'Rental']].map(([value, label]) => ({ value, label }))} />
        <Select label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...Object.entries(DEAL_STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
        <span style={{ flex: 1 }} />
        <Download onClick={() => downloadCsv('eforms-summary.csv', ['Name', 'Position', 'Submission Total', 'Sales/Rent Total', 'Closing Total', 'Total Cases', 'Archived Cases', 'Sales', 'Rental', 'Total Net Commission', 'Total Payout'],
          rows.map(x => [x.s.name, P.tierLabel(x.tier), x.submission, x.price, x.closing, x.cases, x.archived, x.sales, x.rental, x.comm, x.payout]))} />
      </Toolbar>
      <DataTable rows={rows} rowKey={x => x.s.id} narrowAt={1000} columns={[
        { key: 'name', label: 'Name · Position', render: x => <Who name={x.s.short} sub={P.tierLabel(x.tier)} to={`staff/${x.s.id}`} size={26} /> },
        { key: 'sub', label: 'Submission Total', align: 'right', render: x => rm(x.submission) },
        { key: 'price', label: 'Sales/Rent Total', align: 'right', render: x => rm(x.price) },
        { key: 'closing', label: 'Closing Total', align: 'right', render: x => rm(x.closing) },
        { key: 'cases', label: 'Cases (archived)', align: 'right', render: x => `${x.cases} (${x.archived})` },
        { key: 'mix', label: 'Sales · Rental', align: 'right', render: x => `${x.sales} · ${x.rental}` },
        { key: 'comm', label: 'Total Net Commission', align: 'right', render: x => rm(x.comm) },
        { key: 'payout', label: 'Total Payout', align: 'right', render: x => <b>{rm(x.payout)}</b> },
      ]} />
    </Card>
  )
}

// E-Forms Case Summary: pick a case, type a claim, see the payout lines it would make
// (the E-Form from one read, its earners' tier credit from the server, as on the E-Form page).
function CaseSummary() {
  const { m, setup } = useErp()
  const latest = useList('deals', { status: LIVE, sort: '-date', counts: '0' }, { pageSize: 1 }).rows[0]
  const [picked, setPicked] = useState('')
  const id = picked || String(latest?.id || '')
  const deal = useRecord('deals', Number(id) || null).record
  const [claim, setClaim] = useState('')
  const [credit, setCredit] = useState(null)
  useEffect(() => {
    if (!deal || DEMO) return undefined
    let live = true
    setCredit(null)
    getDealCredit(deal.id).then(c => { if (live) setCredit(c) }, () => { if (live) setCredit({}) })
    return () => { live = false }
  }, [deal?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // In the demo, from the records in this browser, by the same rule.
  const creditOf = DEMO ? sid => tierCredit(m.staff[sid], m.data.closes, m.year) : credit && (sid => credit[sid] || { lifetime: 0, yearly: 0 })
  const amount = Number(claim || deal?.money.billed || 0)
  const { project, ready } = useDealProject(deal)
  const preview = useMemo(() => {
    if (!deal || !(amount > 0) || !creditOf || !ready) return null
    const net = r2(deal.money.net * Math.min(amount, deal.money.billed) / deal.money.billed)
    return { net, ...payoutForClose(setup, m.staff, deal, net, creditOf, undefined, project) }
  }, [deal, amount, setup, m, credit, project, ready]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', alignItems: 'start' }}>
      <Card title="Case">
        <div style={{ display: 'grid', gap: 12 }}>
          <DealPicker value={id} onChange={v => { setPicked(String(v || '')); setClaim('') }} statuses={LIVE} />
          {deal && (
            <>
              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
                {deal.property.address}<br />Sale Staff <b style={{ color: C.text }}>{m.staffName(deal.agentId)}</b> · Product Handler <b style={{ color: C.text }}>{deal.holderId != null ? m.staffName(deal.holderId) : '—'}</b><br />
                Claim from owner {rm(deal.money.billed)} · cleared {rm(deal.$?.cleared || 0)} · <Status of={DEAL_STATUS} value={deal.status} />
              </div>
              <FormField label="Claim (RM)" help="What is being closed, SST included. Defaults to the full claim from owner.">
                <input type="number" style={field} value={claim} placeholder={String(deal.money.billed)} onChange={e => setClaim(e.target.value)} />
              </FormField>
            </>
          )}
        </div>
      </Card>
      <Card title="Payout preview" sub={preview ? `Net commission on this claim ${rm(preview.net)}` : 'Type a claim'}>
        {preview && preview.sides.map(sd => (
          <div key={sd.side} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, padding: '4px 0', borderBottom: `1px solid ${C.border}` }}>
              {preview.sides.length > 1 ? (sd.side === 'sales' ? 'Marketing side' : 'Product side') : 'Both sides'} · {rm(sd.base)}
            </div>
            {preview.lines.filter(l => l.side === sd.side).map(l => (
              <div key={`${l.staffId}-${l.role}`} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
                <span style={{ flex: 1, minWidth: 0 }}><Who name={m.staffName(l.staffId)} sub={m.commType(l)} size={24} /></span>
                <span style={{ color: C.muted, ...tabular }}>{pct(l.pct)}</span>
                <b style={{ minWidth: 90, textAlign: 'right', ...tabular }}>{rm(l.amount)}</b>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, color: C.muted }}><span>Company keeps</span><span style={tabular}>{rm(sd.company)}</span></div>
          </div>
        ))}
      </Card>
    </div>
  )
}

function Landlord() {
  const erp = useErp()
  const { m } = erp
  const [status, setStatus] = useState('')
  const [arc, setArc] = useState('')
  const [verify, setVerify] = useState(null)
  const [form, setForm] = useState({ status: 1, remarks: '' })
  const [error, setError] = useState(null)
  // E-Forms with a landlord check, a page at a time; how many by status, and the unverified ones per archive.
  const list = useList('deals', { lvStatus: status || '-1,0,1', ...(arc && { lvArchive: arc }), sort: '-date', counts: 'checks,unverifiedByArchive' }, { pageSize: 25 })
  const checks = list.counts.checks || {}, unverified = list.counts.unverifiedByArchive || {}
  const archives = useList('archives', { sort: '-date', counts: '0' }, { pageSize: 200 }).rows
  const save = async () => {
    setError(null)
    try { await erp.verifyLandlord(verify.id, Number(form.status), form.remarks); setVerify(null) } catch (e) { setError(e.message) }
  }
  return (
    <>
      <div style={{ ...cols(200, 14), marginBottom: 16 }}>
        {[-1, 1, 0].map(s => <Stat key={s} label={LANDLORD_STATUS[s].label} value={checks[s] || 0} tone={LANDLORD_STATUS[s].tone} onClick={() => setStatus(String(s))} />)}
      </div>
      <Card pad={16}>
        <Toolbar>
          <Select label="Archive" value={arc} onChange={setArc} options={[{ value: '', label: 'All archives' }, ...archives.map(a => ({ value: String(a.id), label: `${a.code} (${unverified[a.id] || 0} Unverified)` }))]} />
          <Select label="Verification" value={status} onChange={setStatus} options={[{ value: '', label: 'Select verification status' }, ...Object.entries(LANDLORD_STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
        </Toolbar>
        <DataTable rows={list.rows} paged={{ total: list.total, sort: '-date', onSort: () => {}, onMore: list.more, loading: list.loading }} narrowAt={900} columns={[
          { key: 'form', label: 'Form', render: x => <Link to={`deals/${x.id}`} style={mono}>{x.code}</Link> },
          { key: 'address', label: 'Address', render: x => <span style={{ fontSize: 13 }}>{x.property.address}</span> },
          { key: 'price', label: 'Price (RM)', align: 'right', render: x => amt(x.price) },
          { key: 'ph', label: 'Product Handler', render: x => (x.holderId != null ? m.staffName(x.holderId) : '—') },
          { key: 'landlord', label: 'Landlord', render: x => <span style={{ fontSize: 13 }}>{x.owner.name}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{x.owner.phone}</span></span> },
          { key: 'status', label: 'Verification', render: x => <span><Status of={LANDLORD_STATUS} value={x.landlordCheck.status} />{x.landlordCheck.on && <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{date(x.landlordCheck.on)}</span>}</span> },
          { key: 'remarks', label: 'Remarks', render: x => <span style={{ fontSize: 12.5, color: C.muted }}>{x.landlordCheck.remarks || '—'}</span> },
          { key: 'act', label: '', card: false, render: x => (x.landlordCheck.status === -1
            ? <button style={{ ...btn, fontSize: 13, padding: '5px 10px' }} onClick={() => { setVerify(x); setForm({ status: 1, remarks: '' }) }}>Verify</button>
            : <span style={{ fontSize: 12.5, color: C.ok }}>Done</span>) },
        ]} />
      </Card>
      <Modal open={!!verify} onClose={() => setVerify(null)} title={verify ? `Verify landlord · ${verify.code}` : ''}
        footer={<><button style={btn} onClick={() => setVerify(null)}>Cancel</button><button style={btnPrimary} onClick={save}>Save</button></>}>
        {error && <Notice tone="red">{error}</Notice>}
        {verify && <p style={{ fontSize: 13.5, marginTop: 0 }}>Call <b>{verify.owner.name}</b> ({verify.owner.phone}) and confirm the deal at {verify.property.title}.</p>}
        <div style={{ display: 'grid', gap: 12 }}>
          <FormField label="Status">
            <select style={{ ...sel, width: '100%' }} value={form.status} onChange={e => setForm({ ...form, status: Number(e.target.value) })}>
              <option value={1}>Verified</option><option value={0}>Unable to verify</option>
            </select>
          </FormField>
          <FormField label="Remarks" required={form.status === 0}><TextArea value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} /></FormField>
        </div>
      </Modal>
    </>
  )
}

import { useMemo, useState } from 'react'
import * as P from '../../../shared/payout.js'
import { C, btn, btnPrimary, inp, sel } from '../../styles.js'
import { payoutForClose } from '../../demo/erpSample.js'
import { useErp } from '../ErpContext.jsx'
import { DEAL_STATUS, LANDLORD_STATUS, sum, r2 } from '../model.js'
import { Page, Card, DataTable, Who, Pill, Link, Status, Modal, Notice, FormField, Toolbar, Select, cols, Stat, mono, tabular, field } from '../ui.jsx'
import { RankBars } from '../charts.jsx'
import { rm, pct, date, monthName, lastMonths, amt } from '../format.js'
import { RoleTag } from './Staff.jsx'

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
  tracker: ['Deal change log', 'Every change made to an E-Form: who, when, before and after.'],
  summary: ['Deal activity by person', 'Per person: submissions, closings, cases and payouts.'],
  cases: ['Payout calculator', 'Pick a case and type a claim to preview who gets paid what.'],
  landlord: ['Landlord checks', 'Confirm each landlord after a rental case is archived.'],
}

export default function Reports({ parts }) {
  const key = REPORTS[parts[1]] ? parts[1] : 'total'
  const [title, sub] = REPORTS[key]
  const Comp = { total: Total, staff: StaffSummary, agents: Agents, tracker: Tracker, summary: Summary, cases: CaseSummary, landlord: Landlord }[key]
  return <Page title={title} sub={sub} help={`${sub}\nNarrow it down with the filters at the top. Download CSV, where shown, opens the report in Excel.`}><Comp /></Page>
}

// Date range filter shared by the reports.
function useRange(m) {
  const [from, setFrom] = useState(`${m.year}-01-01`)
  const [to, setTo] = useState(m.today)
  const ui = (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: C.muted, flexWrap: 'wrap' }}>
      From <input type="date" style={inp} value={from} onChange={e => setFrom(e.target.value)} aria-label="From date" />
      to <input type="date" style={inp} value={to} min={from} onChange={e => setTo(e.target.value)} aria-label="To date" />
    </label>
  )
  return { from, to, ui, inRange: d => d >= from && d <= to }
}

function Total() {
  const { m, scoped: d } = useErp()
  const r = useRange(m)
  const rows = d.staff.map(s => {
    const mine = d.deals.filter(x => x.agentId === s.id && x.status !== 'draft' && r.inRange(x.date))
    const closed = d.closes.filter(c => r.inRange(c.date) && m.deals[c.dealId].agentId === s.id)
    return { s, n: mine.length, total: sum(mine, x => x.money.billed), closing: sum(closed, c => c.claim), cleared: sum(mine, x => Math.min(m.cleared(x.id), x.money.billed)) }
  }).filter(x => x.n || x.closing).sort((a, b) => b.total - a.total)
  const months = lastMonths(m.today, 10).reverse().map(mo => {
    const ds = d.deals.filter(x => x.date.startsWith(mo) && x.status !== 'draft')
    return { mo, n: ds.length, total: sum(ds, x => x.money.billed), closing: sum(d.closes.filter(c => c.date.startsWith(mo)), c => c.claim) }
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

function StaffSummary() {
  const { m, scoped: d, setup } = useErp()
  const rows = d.staff.filter(s => s.status !== 'pending').map(s => {
    const deals = m.dealsOf(s.id).filter(x => x.date.startsWith(m.year) && x.status !== 'cancelled' && x.status !== 'draft')
    const lines = (m.payoutsByStaff[s.id] || []).filter(p => p.date.startsWith(m.year))
    return { s, tier: m.tierInfo(s.id).tier, sales: deals.filter(x => x.agentId === s.id).length, product: deals.filter(x => x.holderId === s.id && x.agentId !== s.id).length,
      credit: m.credit(s.id).year, own: sum(lines.filter(p => !p.role), p => p.amount), incentive: sum(lines.filter(p => p.role), p => p.amount) }
  }).sort((a, b) => b.credit - a.credit)
  return (
    <Card pad={16}>
      <Toolbar><span style={{ fontSize: 13, color: C.muted }}>{m.year} so far</span><span style={{ flex: 1 }} />
        <Download onClick={() => downloadCsv(`staff-summary-${m.year}.csv`, ['Code', 'Name', 'Branch', 'Position', 'Sales side', 'Product side', 'Commission', 'Salary', 'Incentives'],
          rows.map(r => [r.s.code, r.s.name, m.branchName(r.s.branchId), P.tierLabel(r.tier), r.sales, r.product, r.credit, r.own, r.incentive]))} /></Toolbar>
      <DataTable rows={rows} rowKey={r => r.s.id} narrowAt={900} columns={[
        { key: 'who', label: 'Staff', render: r => <Who name={r.s.short} to={`staff/${r.s.id}`} sub={m.branchName(r.s.branchId)} size={26} /> },
        { key: 'tier', label: 'Position', render: r => <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}><Pill tone="gray" dot={false}>{r.tier.name}</Pill><RoleTag code={r.s.role} setup={setup} /></span> },
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
  const { m, scoped: d } = useErp()
  const r = useRange(m)
  const rows = d.staff.map(s => ({ s, v: sum(d.deals.filter(x => x.agentId === s.id && x.status !== 'draft' && x.status !== 'cancelled' && r.inRange(x.date)), x => x.fee) }))
    .filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 20)
  return (
    <Card pad={16}>
      <Toolbar>{r.ui}</Toolbar>
      <RankBars rows={rows.map((x, i) => ({ key: x.s.id, value: x.v, label: <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
        <b style={{ width: 22, color: C.muted, ...tabular }}>{i + 1}</b><Link to={`staff/${x.s.id}`} style={{ color: C.text }}>{x.s.short}</Link>
        <span style={{ fontSize: 12, color: C.muted }}>{m.branchName(x.s.branchId)}</span></span> }))} />
    </Card>
  )
}

function Tracker() {
  const { m, scoped: d } = useErp()
  const [q, setQ] = useState('')
  const ids = new Set(d.deals.map(x => x.id))
  const rows = m.data.audit.filter(a => ids.has(a.dealId) && (!q || `${m.deals[a.dealId]?.code} ${a.by}`.toLowerCase().includes(q.toLowerCase())))
  return (
    <Card pad={16}>
      <Toolbar><input style={{ ...inp, width: 220 }} value={q} onChange={e => setQ(e.target.value)} placeholder="Case No. or user" aria-label="Search" /></Toolbar>
      <DataTable rows={rows} rowKey={a => `${a.at}-${a.dealId}-${a.field}`} pageSize={25} narrowAt={760} columns={[
        { key: 'at', label: 'Updated at', nowrap: true, render: a => <span style={{ ...tabular, fontSize: 13 }}>{date(a.at.slice(0, 10))} {a.at.slice(11)}</span> },
        { key: 'by', label: 'Updated by', render: a => <span style={mono}>{a.by}</span> },
        { key: 'case', label: 'Case No.', render: a => <Link to={`deals/${a.dealId}`} style={mono}>{m.deals[a.dealId]?.code}</Link> },
        { key: 'type', label: 'Type', render: a => a.field },
        { key: 'before', label: 'Before', render: a => <span style={{ color: C.muted }}>{a.before}</span> },
        { key: 'after', label: 'After', render: a => <b>{a.after}</b> },
      ]} />
    </Card>
  )
}

function Summary() {
  const { m, scoped: d } = useErp()
  const r = useRange(m)
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const rows = d.staff.map(s => {
    const deals = d.deals.filter(x => (x.agentId === s.id || x.holderId === s.id) && r.inRange(x.date) && (!type || x.type === type) && (!status || x.status === status))
    const lines = (m.payoutsByStaff[s.id] || []).filter(p => r.inRange(p.date))
    const closes = d.closes.filter(c => r.inRange(c.date) && c.sides.some(x => x.staffId === s.id))
    return { s, tier: m.tierInfo(s.id).tier, submission: sum(deals.filter(x => x.status !== 'draft'), x => x.money.billed), price: sum(deals, x => x.price),
      closing: sum(closes, c => c.claim), cases: deals.length, archived: new Set(lines.filter(p => p.archiveId).map(p => p.dealId)).size,
      sales: deals.filter(x => x.type !== 'rental').length, rental: deals.filter(x => x.type === 'rental').length,
      comm: sum(closes.flatMap(c => c.sides.filter(x => x.staffId === s.id)), x => x.base), payout: sum(lines, p => p.amount) }
  }).filter(x => x.cases).sort((a, b) => b.submission - a.submission)
  return (
    <Card pad={16}>
      <Toolbar>{r.ui}
        <Select label="Type" value={type} onChange={setType} options={[['', 'All'], ['sale', 'Sales'], ['rental', 'Rental']].map(([value, label]) => ({ value, label }))} />
        <Select label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All' }, ...Object.entries(DEAL_STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
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

// E-Forms Case Summary: pick a case, type a claim, see the payout lines it would make.
function CaseSummary() {
  const { m, scoped: d, setup } = useErp()
  const open = d.deals.filter(x => x.status !== 'draft' && x.status !== 'cancelled').sort((a, b) => b.date.localeCompare(a.date))
  const [id, setId] = useState(String(open[0]?.id || ''))
  const deal = m.deals[Number(id)]
  const [claim, setClaim] = useState('')
  const amount = Number(claim || deal?.money.billed || 0)
  const preview = useMemo(() => {
    if (!deal || !(amount > 0)) return null
    const net = r2(deal.money.net * Math.min(amount, deal.money.billed) / deal.money.billed)
    return { net, ...payoutForClose(setup, m.staff, deal, net, sid => ({ lifetime: m.tierInfo(sid).lifetime, yearly: m.tierInfo(sid).yearly })) }
  }, [deal, amount, setup, m])
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', alignItems: 'start' }}>
      <Card title="Case">
        <div style={{ display: 'grid', gap: 12 }}>
          <FormField label="E-Form">
            <select style={{ ...sel, width: '100%' }} value={id} onChange={e => { setId(e.target.value); setClaim('') }}>
              {open.map(x => <option key={x.id} value={x.id}>{x.code} · {x.property.title}</option>)}
            </select>
          </FormField>
          {deal && (
            <>
              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
                {deal.property.address}<br />Sale Staff <b style={{ color: C.text }}>{m.staffName(deal.agentId)}</b> · Product Handler <b style={{ color: C.text }}>{deal.holderId != null ? m.staffName(deal.holderId) : '—'}</b><br />
                Claim from owner {rm(deal.money.billed)} · cleared {rm(m.cleared(deal.id))} · <Status of={DEAL_STATUS} value={deal.status} />
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
  const { m, scoped: d } = erp
  const [status, setStatus] = useState('')
  const [arc, setArc] = useState('')
  const [verify, setVerify] = useState(null)
  const [form, setForm] = useState({ status: 1, remarks: '' })
  const [error, setError] = useState(null)
  const cases = d.deals.filter(x => x.landlordCheck && (status === '' || x.landlordCheck.status === Number(status)) && (!arc || x.landlordCheck.archiveId === Number(arc)))
  const pending = d.deals.filter(x => x.landlordCheck?.status === -1)
  const save = async () => {
    setError(null)
    try { await erp.verifyLandlord(verify.id, Number(form.status), form.remarks); setVerify(null) } catch (e) { setError(e.message) }
  }
  return (
    <>
      <div style={{ ...cols(200, 14), marginBottom: 16 }}>
        {[-1, 1, 0].map(s => <Stat key={s} label={LANDLORD_STATUS[s].label} value={d.deals.filter(x => x.landlordCheck?.status === s).length} tone={LANDLORD_STATUS[s].tone} onClick={() => setStatus(String(s))} />)}
      </div>
      <Card pad={16}>
        <Toolbar>
          <Select label="Archive" value={arc} onChange={setArc} options={[{ value: '', label: 'All archives' }, ...[...m.data.archives].reverse().map(a => ({ value: String(a.id), label: `${a.code} (${pending.filter(x => x.landlordCheck.archiveId === a.id).length} Unverified)` }))]} />
          <Select label="Verification" value={status} onChange={setStatus} options={[{ value: '', label: 'Select verification status' }, ...Object.entries(LANDLORD_STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
        </Toolbar>
        <DataTable rows={cases} pageSize={25} narrowAt={900} columns={[
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
          <FormField label="Remarks" required={form.status === 0}><input style={field} value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} /></FormField>
        </div>
      </Modal>
    </>
  )
}

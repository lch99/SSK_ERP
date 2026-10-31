import { useMemo, useState } from 'react'
import * as P from '../../../shared/payout.js'
import { C, btn, btnPrimary } from '../../styles.js'
import { payoutApprovers } from '../../demo/erpSample.js'
import { useErp } from '../ErpContext.jsx'
import { PAYOUT_STATUS, SALARY_STATUS, closeType, group, sum } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, DataTable, Status, Who, Link, Empty, Notice, Modal, FormField, SelectionBar, TextArea, cols, Stat, mono, tabular, small } from '../ui.jsx'
import { COLUMN, PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { FlowBar } from '../flow.jsx'
import { rm, pct, date, amt } from '../format.js'
import { useCan } from '../access.jsx'

// Closed Case: one line per person per closed claim (CASE-…), New → Pending Queries → Ready,
// then requested for salary and archived weekly.
export default function Payouts({ parts }) {
  return <CaseList archived={parts[1] === 'archived'} />
}

const TYPES = ['Full Close', 'Partial Close', 'Balance Close']

function CaseList({ archived }) {
  const erp = useErp()
  const { m, scoped: d } = erp
  const can = useCan()
  // Approvers start on "Approve by case" when something is waiting.
  const [view, setView] = useState(() => (!archived && can('payouts', 'edit') && d.payouts.some(p => !p.archiveId && (p.status === 'new' || p.status === 'queried')) ? 'cases' : 'list'))
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [salary, setSalary] = useState('')
  const [type, setType] = useState('')
  const [side, setSide] = useState('')
  const [bm, setBm] = useState('')
  const [arc, setArc] = useState(() => String(m.data.archives.at(-1)?.id || ''))
  const [picked, setPicked] = useState(new Set())
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)
  const tops = d.staff.filter(s => s.role && s.uplineId == null)

  const lines = useMemo(() => d.payouts.filter(p => (archived ? p.archiveId === Number(arc) : !p.archiveId)), [d.payouts, archived, arc])
  const match = useMemo(() => {
    const words = q.trim().toLowerCase()
    return lines.filter(p => {
      const deal = m.deals[p.dealId]
      return (!status || (status === 'ready' ? p.status === 'approved' || p.status === 'paid' : p.status === status)) &&
        (!salary || (salary === '1' ? !!p.requestId : !p.requestId)) && (!type || closeType(m.closes[p.closeId]) === type) &&
        (!side || p.side === side) && (!bm || m.branchManagerOf(deal.agentId)?.id === Number(bm)) &&
        (!words || [p.code, deal.code, m.staff[p.staffId].name, m.staff[p.staffId].short].join(' ').toLowerCase().includes(words))
    })
  }, [lines, status, salary, type, side, bm, q, m])
  const eligible = d.payouts.filter(p => !p.archiveId && p.requestId && (p.status === 'approved' || p.status === 'paid'))
  const waiting = lines.filter(p => p.status === 'new' || p.status === 'queried')
  const ready = lines.filter(p => p.status === 'approved' && !p.requestId)

  const fb = useFeedback()
  const run = async (done, fn, ...args) => {
    setError(null)
    if (await fb.run(() => fn(...args), done)) { setPicked(new Set()); setAsking(false); setReason('') }
  }
  const archive = async () => {
    const ok = await fb.confirm({ title: `Create archive of ${eligible.length} cases?`,
      body: <>Every Ready case line whose salary is requested ({eligible.length} lines, {rm(sum(eligible, p => p.amount))}) moves to <b>Archived Case</b>. This is done once a week.</>,
      confirmLabel: 'Create archive' })
    if (ok) run(`Archive created · ${eligible.length} cases moved to Archived Case`, erp.archiveCases)
  }
  // Unarchive: the week's lines go back to the Close Case List.
  const unarchive = async () => {
    const a = m.archives[Number(arc)]
    if (!a) return
    const ok = await fb.confirm({ title: `Unarchive ${a.code}?`, confirmLabel: 'Unarchive',
      body: <>Its {a.count} case lines go back to <b>Payouts to approve</b> (as Ready, salary requested). Landlord checks not done yet are dropped.</> })
    if (ok && await fb.run(() => erp.unarchive(a.id), `${a.code} unarchived`)) setArc(String(m.data.archives.filter(x => x.id !== a.id).at(-1)?.id || ''))
  }
  const pickedLines = match.filter(p => picked.has(p.id))
  const filters = [status, salary, type, side, bm].filter(Boolean).length
  const clear = () => { setQ(''); setStatus(''); setSalary(''); setType(''); setSide(''); setBm('') }
  const columns = [
    { key: 'code', label: 'Case ID · Date · Type', sort: p => p.id, render: p => (
      <span style={{ whiteSpace: 'nowrap' }}><b style={mono}>{p.code}</b>
        <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{date(p.date)} · {p.time}</span>
        <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{closeType(m.closes[p.closeId])}</span></span>
    ) },
    { key: 'staff', label: 'Staff · Role · %', sort: p => m.staffName(p.staffId), render: p => (
      <span style={{ display: 'block', minWidth: 190 }}><Who name={m.staffName(p.staffId)} sub={`${m.commType(p)} · ${pct(p.pct)}`} size={24} to={`staff/${p.staffId}`} /></span>
    ) },
    { key: 'form', label: 'Form ID · Sell/Rent · Cash (x / y)', help: COLUMN.payoutForm, sort: p => m.deals[p.dealId].code, render: p => {
      const c = m.closes[p.closeId], deal = m.deals[p.dealId]
      return (
        <span style={{ whiteSpace: 'nowrap' }}><Link to={`deals/${p.dealId}`} style={mono}>{deal.code}</Link>
          <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{rm(deal.price)}</span>
          <span style={{ display: 'block', fontSize: 12, color: C.muted, ...tabular }}>{amt(c.claim)} / {amt(deal.money.billed)}</span></span>
      )
    } },
    { key: 'payout', label: 'Payout · Net Comm.', help: COLUMN.payoutAmount, align: 'right', sort: p => p.amount, render: p => <span style={{ whiteSpace: 'nowrap' }}><b>{rm(p.amount)}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>of {rm(p.base)}</span></span> },
    { key: 'status', label: 'Status', sort: p => p.status, render: p => <Status of={PAYOUT_STATUS} value={p.status} /> },
    { key: 'salary', label: 'Salary Status', help: COLUMN.salaryStatus, render: p => <Status of={SALARY_STATUS} value={m.salaryStatus(p)} /> },
  ]

  return (
    <Page title={archived ? 'Archived payouts' : 'Payouts to approve'} help={archived ? PAGE.archived : PAGE.payouts}
      sub={archived ? 'Weekly archives of Ready, paid case lines.' : <>One line per person paid on each closed case, worked out from Setup. Set them Ready to approve. Ready lines are requested for salary under <Link to="salary/request">Salary</Link>.</>}
      actions={!can('payouts', 'full') ? null : !archived ? <button key="archive" style={{ ...btnPrimary, opacity: eligible.length ? 1 : 0.5 }} disabled={!eligible.length} onClick={archive}
        title={eligible.length ? undefined : 'Nothing to archive: no Ready line has its salary requested yet'}>Create Archive ({eligible.length} Cases)</button>
        : arc && <button key="unarchive" style={btn} onClick={unarchive}>Unarchive this week</button>}>
      {!archived && <FlowBar here="approve" />}
      {!archived && (
        <div style={{ ...cols(220, 14), marginBottom: 16 }}>
          <Stat icon="payouts" tone="amber" label="New and Pending Queries" value={rm(sum(waiting, p => p.amount))} sub={`${waiting.length} line${waiting.length === 1 ? '' : 's'} on ${new Set(waiting.map(p => p.closeId)).size} close${new Set(waiting.map(p => p.closeId)).size === 1 ? '' : 's'}`} onClick={() => { setView('list'); setStatus(status === 'new' ? '' : 'new'); setSalary('') }} on={status === 'new'} />
          <Stat icon="check" tone="blue" label="Ready, salary not requested" value={rm(sum(ready, p => p.amount))} sub={`${new Set(ready.map(p => p.staffId)).size} people`} onClick={() => { setView('list'); const on = status === 'ready' && salary === '0'; setStatus(on ? '' : 'ready'); setSalary(on ? '' : '0') }} on={status === 'ready' && salary === '0'} />
        </div>
      )}
      <Card pad={16}>
        {!archived && <Tabs value={view} onChange={setView} tabs={[{ key: 'cases', label: 'Approve by case', count: new Set(waiting.map(p => p.closeId)).size }, { key: 'list', label: 'All payout lines', count: match.length }]} />}
        {error && <Notice tone="red">{error}</Notice>}
        {view === 'cases' && !archived ? <ApprovalList lines={waiting} erp={erp} /> : (
          <>
            <Toolbar fold onClear={clear}>
              {archived && <Select label="Archive" value={arc} onChange={setArc} options={[...m.data.archives].reverse().map(a => ({ value: String(a.id), label: `${a.code} (${a.count} Cases)` }))} />}
              <SearchBox value={q} onChange={setQ} placeholder="Case ID, form or staff" />
              <Select label="Branch manager" value={bm} onChange={setBm} options={[{ value: '', label: 'All branch managers' }, ...tops.map(s => ({ value: String(s.id), label: `B.M (${s.short})` }))]} />
              <Select label="Status" value={status} onChange={setStatus} options={[['', 'All statuses'], ['new', 'New'], ['queried', 'Pending Queries'], ['ready', 'Ready']].map(([value, label]) => ({ value, label }))} />
              <Select label="Salary" value={salary} onChange={setSalary} options={[['', 'Salary: all'], ['0', 'Not Requested'], ['1', 'Requested']].map(([value, label]) => ({ value, label }))} />
              <Select label="Type" value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...TYPES.map(t => ({ value: t, label: t }))]} />
              <Select label="Claim category" value={side} onChange={setSide} options={[['', 'Sales and Product'], ['sales', 'Sales'], ['listing', 'Product']].map(([value, label]) => ({ value, label }))} />
            </Toolbar>
            <DataTable columns={columns} rows={match} defaultSort={{ key: 'code', dir: 'desc' }} pageSize={25} narrowAt={1000} empty="No case lines here"
              onClear={filters || q ? clear : undefined}
              selection={archived || !can('payouts', 'edit') ? null : { selected: picked, onChange: setPicked, can: p => p.status === 'new' || p.status === 'queried' }} />
            <SelectionBar count={picked.size} summary={rm(sum(pickedLines, p => p.amount))} onClear={() => setPicked(new Set())}>
              <button style={small} onClick={() => setAsking(true)}>Pending Queries…</button>
              {can('payouts', 'full') && <button style={{ ...small, ...btnPrimary, fontSize: 13, padding: '5px 12px' }}
                onClick={() => run(`${picked.size} case line${picked.size === 1 ? '' : 's'} set to Ready`, erp.approvePayouts, [...picked])}>Set Ready</button>}
            </SelectionBar>
          </>
        )}
      </Card>
      <Modal open={asking} onClose={() => setAsking(false)} title={`Pending Queries · ${picked.size} lines`}
        footer={<><button style={btn} onClick={() => setAsking(false)}>Cancel</button>
          <button style={{ ...btnPrimary, opacity: reason.trim() ? 1 : 0.5 }} disabled={!reason.trim()}
            onClick={() => run(`${picked.size} line${picked.size === 1 ? '' : 's'} moved to Pending Queries`, erp.queryPayouts, [...picked], reason)}>Save</button></>}>
        <FormField label="What needs checking?" required><TextArea autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. SPA stamping receipt not uploaded" /></FormField>
      </Modal>
    </Page>
  )
}

// Approvers see one card per close: the case, everyone it pays, and the buttons.
function ApprovalList({ lines, erp }) {
  const { m, setup } = erp
  const can = useCan()
  const approver = can('payouts', 'full')
  const [asking, setAsking] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fb = useFeedback()
  const closes = Object.entries(group(lines, 'closeId')).map(([cid, ls]) => ({ close: m.closes[cid], lines: ls }))
    .sort((a, b) => a.close.date.localeCompare(b.close.date))
  if (!closes.length) return <Empty title="Nothing waiting" text="Every case line here is Ready." />

  const run = async (done, fn, ...args) => {
    setBusy(true); setError(null)
    if (await fb.run(() => fn(...args), done)) { setAsking(null); setReason('') }
    setBusy(false)
  }
  return (
    <div>
      {error && <Notice tone="red">{error}</Notice>}
      <div style={{ display: 'grid', gap: 12 }}>
        {closes.map(({ close, lines: ls }) => {
          const deal = m.deals[close.dealId]
          const total = sum(ls, l => l.amount)
          const needs = payoutApprovers(setup, deal.branchId, total)
          const queried = ls.find(l => l.query)
          // Flag (not block) an approver who is also paid on this close.
          const paidNames = new Set(ls.flatMap(l => [m.staff[l.staffId].name, m.staff[l.staffId].short]))
          const selfPaid = needs.filter(n => paidNames.has(n))
          return (
            <div key={close.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, background: '#fff' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 8 }}>
                <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Link to={`deals/${deal.id}`} style={mono}>{deal.code}</Link>
                    <span style={{ fontSize: 12.5, color: C.muted }}>{P.DEAL_TYPE_LABELS[deal.type]} · {m.branchName(deal.branchId)} · {closeType(close)}</span>
                  </div>
                  <div style={{ fontWeight: 600, marginTop: 2 }}>{deal.property.title}</div>
                  <div style={{ fontSize: 12.5, color: C.muted }}>Closed {date(close.date)} · claim {rm(close.claim)} · net comm. {rm(close.net)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, ...tabular }}>{rm(total)}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>Needs {needs.join(' + ')}</div>
                </div>
              </div>
              {queried && <Notice tone="red"><b>Pending Queries:</b> {queried.query}</Notice>}
              {selfPaid.length > 0 && <Notice tone="amber">{selfPaid.join(' and ')} {selfPaid.length > 1 ? 'are' : 'is'} also paid on this case.</Notice>}
              <div style={{ borderTop: `1px solid ${C.border}` }}>
                {ls.map(l => (
                  <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
                    <span style={{ flex: '1 1 200px', minWidth: 0 }}><Who name={m.staffName(l.staffId)} to={`staff/${l.staffId}`} size={24} sub={m.commType(l)} /></span>
                    <span style={{ fontSize: 12.5, color: C.muted, ...tabular }}>{pct(l.pct)} of {rm(l.base)}</span>
                    <b style={{ minWidth: 92, textAlign: 'right', ...tabular }}>{rm(l.amount)}</b>
                  </div>
                ))}
              </div>
              {asking === close.id ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <TextArea style={{ flex: '1 1 240px', width: 'auto' }} autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="What needs checking? e.g. SPA not uploaded" />
                  <button style={{ ...btnPrimary, opacity: busy || !reason.trim() ? 0.5 : 1 }} disabled={busy || !reason.trim()} onClick={() => run(`${deal.code} moved to Pending Queries`, erp.queryPayouts, ls.map(l => l.id), reason)}>Save query</button>
                  <button style={btn} onClick={() => { setAsking(null); setReason('') }}>Cancel</button>
                </div>
              ) : can('payouts', 'edit') && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {approver && <><button style={small} title="Make Close Case Rerun: work the lines out again on today's tiers and uplines" onClick={async () => {
                    if (await fb.confirm({ title: `Re-run ${deal.code}?`, confirmLabel: 'Confirm Re-Run', body: 'Works these case lines out again on everyone’s tier and upline today (for example after a rank or upline change). They stay New for approval.' }))
                      run(`${deal.code}: case lines re-run`, erp.rerunClose, close.id)
                  }}>Re-run</button>
                  <button style={{ ...small, color: C.err }} onClick={async () => {
                    if (await fb.confirm({ title: `Delete the case lines of ${deal.code}?`, danger: true, confirmLabel: 'Delete', body: <>The {rm(close.claim)} close is undone and the case can be closed again.</> }))
                      run(`${deal.code}: close deleted`, erp.deleteClose, close.id)
                  }}>Delete</button></>}
                  <span style={{ flex: 1 }} />
                  <button style={small} onClick={() => setAsking(close.id)}>{queried ? 'Change query' : 'Pending Queries'}</button>
                  {approver && <button style={{ ...small, ...btnPrimary, padding: '5px 12px', fontSize: 13 }} disabled={busy} onClick={() => run(`${deal.code}: ${ls.length} line${ls.length === 1 ? '' : 's'} set to Ready (${rm(total)})`, erp.approvePayouts, ls.map(l => l.id))}>Set Ready</button>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function lineRole(l, m) {
  const t = !l.role && l.tierId && P.tiersFor(m.setup, m.staff[l.staffId].branchId).find(x => x.id === l.tierId)
  return `${m.commType(l)}${t ? ` · ${t.name}` : ''}`
}

import { useState } from 'react'
import * as P from '../../../shared/payout.js'
import { C, btn, btnPrimary } from '../../styles.js'
import { payoutApprovers } from '../../demo/erpSample.js'
import { useErp } from '../ErpContext.jsx'
import { useList } from '../useList.js'
import { PAYOUT_STATUS, SALARY_STATUS, closeType, sum } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, DataTable, Status, Who, Link, Empty, Notice, Modal, FormField, SelectionBar, TextArea, cols, Stat, mono, tabular, small } from '../ui.jsx'
import { COLUMN, PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { FlowBar } from '../flow.jsx'
import { rm, pct, date, amt } from '../format.js'
import { useCan } from '../access.jsx'

// Closed Case: one line per person per closed claim (CASE-…), New → Pending Queries → Ready,
// then requested for salary and archived weekly. A page at a time (useList).
export default function Payouts({ parts }) {
  return parts[1] === 'archived' ? <Archived /> : <CaseList />
}

const TYPES = [['full', 'Full Close'], ['partial', 'Partial Close'], ['balance', 'Balance Close']]
const WAITING = 'new,queried'
// The Status filter's Ready takes paid lines too.
const STATUSES = { ready: 'approved,paid' }
// What the next weekly archive takes (archiveCases): Ready lines whose salary is requested.
const DUE = { status: 'approved,paid', requested: 'true', archived: 'false', counts: 'due' }
const salaryStatus = p => (!p.requestId ? 'none' : p.$.requestStatus === 'clear' ? 'paid' : 'requested')
const lines = n => `${n} line${n === 1 ? '' : 's'}`

// The weekly archives, newest first; one is shown at a time.
function Archived() {
  const archives = useList('archives', { sort: '-date' }, { pageSize: 200 })
  const [arc, setArc] = useState(null)
  const archive = archives.rows.find(a => a.id === arc) || archives.rows[0] || null
  return <CaseList archive={archive} archives={archives} onArchive={setArc} />
}

// `archives` given: the archived lines of `archive`; otherwise the lines not archived yet.
function CaseList({ archive, archives, onArchive }) {
  const archived = !!archives
  const erp = useErp()
  const { scoped: d } = erp
  const can = useCan()
  const fb = useFeedback()
  const [view, setView] = useState(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [salary, setSalary] = useState('')
  const [type, setType] = useState('')
  const [side, setSide] = useState('')
  const [bm, setBm] = useState('')
  const [sort, setSort] = useState('-date')
  const [picked, setPicked] = useState(() => new Set())
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const tops = d.staff.filter(s => s.role && s.uplineId == null)

  const params = {
    q, sort, counts: 'waiting,ready', status: STATUSES[status] || status, requested: salary && (salary === '1' ? 'true' : 'false'), closeType: type, side, agentTeam: bm,
    // No archive yet (or none at all): nothing.
    ...(archived ? { archiveId: String(archive?.id ?? 0) } : { archived: 'false' }),
  }
  // A tick is for a row on screen: another search or filter starts a new selection.
  const filterSig = JSON.stringify([q, status, salary, type, side, bm, archive?.id])
  const [pickedFor, setPickedFor] = useState(filterSig)
  if (pickedFor !== filterSig) { setPickedFor(filterSig); setPicked(new Set()) }
  const list = useList('payouts', params, { pageSize: 25 })
  const waiting = list.counts.waiting
  const ready = list.counts.ready || { n: 0, sum: 0, distinct: 0 }
  // Approvers start on "Approve by case" when something is waiting.
  if (view == null && waiting) setView(!archived && can('payouts', 'edit') && waiting.n > 0 ? 'cases' : 'list')
  const shown = archived ? 'list' : view ?? (can('payouts', 'edit') ? 'cases' : 'list')

  const run = async (done, fn, ...args) => {
    if (await fb.run(() => fn(...args), done)) { setPicked(new Set()); setAsking(false); setReason('') }
  }
  // Unarchive: the week's lines go back to the Close Case List.
  const unarchive = async () => {
    const ok = await fb.confirm({ title: `Unarchive ${archive.code}?`, confirmLabel: 'Unarchive',
      body: <>Its {archive.count} case lines go back to <b>Payouts to approve</b> (as Ready, salary requested). Landlord checks not done yet are dropped.</> })
    if (ok && await fb.run(() => erp.unarchive(archive.id), `${archive.code} unarchived`)) onArchive(null)
  }
  const pickedLines = list.rows.filter(p => picked.has(p.id))
  const filters = [status, salary, type, side, bm].filter(Boolean).length
  const clear = () => { setQ(''); setStatus(''); setSalary(''); setType(''); setSide(''); setBm('') }
  const columns = [
    { key: 'code', label: 'Case ID · Date · Type', sortKey: 'date', render: p => (
      <span style={{ whiteSpace: 'nowrap' }}><b style={mono}>{p.code}</b>
        <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{date(p.date)} · {p.time}</span>
        <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{p.$.close && closeType(p.$.close)}</span></span>
    ) },
    { key: 'staff', label: 'Staff · Role · %', render: p => (
      <span style={{ display: 'block', minWidth: 190 }}><Who name={erp.m.staffName(p.staffId)} sub={`${erp.m.commType(p)} · ${pct(p.pct)}`} size={24} to={`staff/${p.staffId}`} /></span>
    ) },
    { key: 'form', label: 'Form ID · Sell/Rent · Cash (x / y)', help: COLUMN.payoutForm, render: p => (
      <span style={{ whiteSpace: 'nowrap' }}><Link to={`deals/${p.dealId}`} style={mono}>{p.$.deal?.code}</Link>
        <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{rm(p.$.deal?.price)}</span>
        <span style={{ display: 'block', fontSize: 12, color: C.muted, ...tabular }}>{amt(p.$.close?.claim)} / {amt(p.$.deal?.['money.billed'])}</span></span>
    ) },
    { key: 'payout', label: 'Payout · Net Comm.', help: COLUMN.payoutAmount, align: 'right', sortKey: 'amount', render: p => <span style={{ whiteSpace: 'nowrap' }}><b>{rm(p.amount)}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>of {rm(p.base)}</span></span> },
    { key: 'status', label: 'Status', sortKey: 'status', render: p => <Status of={PAYOUT_STATUS} value={p.status} /> },
    { key: 'salary', label: 'Salary Status', help: COLUMN.salaryStatus, render: p => <Status of={SALARY_STATUS} value={salaryStatus(p)} /> },
  ]

  return (
    <Page title={archived ? 'Archived payouts' : 'Payouts to approve'} help={archived ? PAGE.archived : PAGE.payouts}
      sub={archived ? 'Weekly archives of Ready, paid case lines.' : <>One line per person paid on each closed case, worked out from Setup. Set them Ready to approve. Ready lines are requested for salary under <Link to="salary/request">Salary</Link>.</>}
      actions={!can('payouts', 'full') ? null : !archived ? <ArchiveButton key="archive" run={run} />
        : archive && <button key="unarchive" style={btn} onClick={unarchive}>Unarchive this week</button>}>
      {!archived && <FlowBar here="approve" />}
      {!archived && (
        <div style={{ ...cols(220, 14), marginBottom: 16 }}>
          <Stat icon="payouts" tone="amber" label="New and Pending Queries" value={rm(waiting?.sum || 0)} sub={`${lines(waiting?.n || 0)} on ${waiting?.distinct || 0} close${waiting?.distinct === 1 ? '' : 's'}`}
            onClick={() => { setView('list'); setStatus(status === 'new' ? '' : 'new'); setSalary('') }} on={status === 'new'} />
          <Stat icon="check" tone="blue" label="Ready, salary not requested" value={rm(ready.sum)} sub={`${ready.distinct} ${ready.distinct === 1 ? 'person' : 'people'}`}
            onClick={() => { setView('list'); const on = status === 'ready' && salary === '0'; setStatus(on ? '' : 'ready'); setSalary(on ? '' : '0') }} on={status === 'ready' && salary === '0'} />
        </div>
      )}
      <Card pad={16}>
        {!archived && <Tabs value={shown} onChange={setView} tabs={[{ key: 'cases', label: 'Approve by case', count: waiting?.distinct || 0 }, { key: 'list', label: 'All payout lines', count: list.total }]} />}
        {list.error && <Notice tone="red">{list.error}</Notice>}
        {shown === 'cases' ? <ApprovalList erp={erp} closes={waiting?.distinct || 0} /> : (
          <>
            <Toolbar fold onClear={clear}>
              {archived && <Select label="Archive" value={String(archive?.id ?? '')} onChange={v => onArchive(Number(v))}
                options={archives.rows.length ? archives.rows.map(a => ({ value: String(a.id), label: `${a.code} (${a.count} Cases)` })) : [{ value: '', label: archives.loading ? 'Loading…' : 'No archives yet' }]} />}
              <SearchBox value={q} onChange={setQ} placeholder="Case ID, form or staff" />
              <Select label="Branch manager" value={bm} onChange={setBm} options={[{ value: '', label: 'All branch managers' }, ...tops.map(s => ({ value: String(s.id), label: `B.M (${s.short})` }))]} />
              <Select label="Status" value={status} onChange={setStatus} options={[['', 'All statuses'], ['new', 'New'], ['queried', 'Pending Queries'], ['ready', 'Ready']].map(([value, label]) => ({ value, label }))} />
              <Select label="Salary" value={salary} onChange={setSalary} options={[['', 'Salary: all'], ['0', 'Not Requested'], ['1', 'Requested']].map(([value, label]) => ({ value, label }))} />
              <Select label="Type" value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...TYPES.map(([value, label]) => ({ value, label }))]} />
              <Select label="Claim category" value={side} onChange={setSide} options={[['', 'Sales and Product'], ['sales', 'Sales'], ['listing', 'Product']].map(([value, label]) => ({ value, label }))} />
            </Toolbar>
            <DataTable columns={columns} rows={list.rows} pageSize={25} narrowAt={1000}
              paged={{ total: list.total, sort, onSort: setSort, onMore: list.more, loading: list.loading }}
              empty={list.loading ? 'Loading…' : 'No case lines here'} onClear={filters || q ? clear : undefined}
              selection={archived || !can('payouts', 'edit') ? null : { selected: picked, onChange: setPicked, can: p => p.status === 'new' || p.status === 'queried' }} />
            <SelectionBar count={pickedLines.length} summary={rm(sum(pickedLines, p => p.amount))} onClear={() => setPicked(new Set())}>
              <button style={small} onClick={() => setAsking(true)}>Pending Queries…</button>
              {can('payouts', 'full') && <button style={{ ...small, ...btnPrimary, fontSize: 13, padding: '5px 12px' }}
                onClick={() => run(`${lines(pickedLines.length)} set to Ready`, erp.approvePayouts, pickedLines.map(p => p.id))}>Set Ready</button>}
            </SelectionBar>
          </>
        )}
      </Card>
      <Modal open={asking} onClose={() => setAsking(false)} title={`Pending Queries · ${lines(pickedLines.length)}`}
        footer={<><button style={btn} onClick={() => setAsking(false)}>Cancel</button>
          <button style={{ ...btnPrimary, opacity: reason.trim() ? 1 : 0.5 }} disabled={!reason.trim()}
            onClick={() => run(`${lines(pickedLines.length)} moved to Pending Queries`, erp.queryPayouts, pickedLines.map(p => p.id), reason)}>Save</button></>}>
        <FormField label="What needs checking?" required><TextArea autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. SPA stamping receipt not uploaded" /></FormField>
      </Modal>
    </Page>
  )
}

// Create Archive: every branch's Ready lines whose salary is requested.
function ArchiveButton({ run }) {
  const erp = useErp()
  const fb = useFeedback()
  const due = useList('payouts', DUE, { branch: false, pageSize: 1 }).counts.due || { n: 0, sum: 0 }
  const archive = async () => {
    const ok = await fb.confirm({ title: `Create archive of ${due.n} cases?`,
      body: <>Every Ready case line whose salary is requested ({lines(due.n)}, {rm(due.sum)}) moves to <b>Archived Case</b>. This is done once a week.</>,
      confirmLabel: 'Create archive' })
    if (ok) run(`Archive created · ${due.n} cases moved to Archived Case`, erp.archiveCases)
  }
  return (
    <button style={{ ...btnPrimary, opacity: due.n ? 1 : 0.5 }} disabled={!due.n} onClick={archive}
      title={due.n ? undefined : 'Nothing to archive: no Ready line has its salary requested yet'}>Create Archive ({due.n} Cases)</button>
  )
}

// Approvers see one card per close: the case, everyone it pays, and the buttons.
// The waiting lines come close by close, oldest first; a close cut off at the
// end of a page waits for "Show more", so a card always has all its lines.
function ApprovalList({ erp, closes: count }) {
  const { m, setup } = erp
  const can = useCan()
  const approver = can('payouts', 'full')
  const list = useList('payouts', { status: WAITING, archived: 'false', sort: 'close', counts: '0' }, { pageSize: 200 })
  const [asking, setAsking] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const fb = useFeedback()
  const closes = []
  for (const l of list.rows) {
    if (closes.at(-1)?.close.id !== l.closeId) closes.push({ close: { id: l.closeId, ...l.$.close }, deal: { id: l.dealId, ...l.$.deal }, lines: [] })
    closes.at(-1).lines.push(l)
  }
  const all = list.rows.length >= list.total
  if (!all && closes.length > 1) closes.pop()
  if (list.error) return <Notice tone="red">{list.error}</Notice>
  if (!closes.length) return list.loading ? <Empty title="Loading…" text="" /> : <Empty title="Nothing waiting" text="Every case line here is Ready." />

  const run = async (done, fn, ...args) => {
    setBusy(true)
    if (await fb.run(() => fn(...args), done)) { setAsking(null); setReason('') }
    setBusy(false)
  }
  return (
    <div>
      <div style={{ display: 'grid', gap: 12 }}>
        {closes.map(({ close, deal, lines: ls }) => {
          const total = sum(ls, l => l.amount)
          const needs = payoutApprovers(setup, deal.branchId, total)
          const queried = ls.find(l => l.query)
          // Flag (not block) an approver who is also paid on this close.
          const paidNames = new Set(ls.flatMap(l => [m.staff[l.staffId]?.name, m.staff[l.staffId]?.short]))
          const selfPaid = needs.filter(n => paidNames.has(n))
          return (
            <div key={close.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, background: '#fff' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 8 }}>
                <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Link to={`deals/${deal.id}`} style={mono}>{deal.code}</Link>
                    <span style={{ fontSize: 12.5, color: C.muted }}>{P.DEAL_TYPE_LABELS[deal.type]} · {m.branchName(deal.branchId)} · {closeType(close)}</span>
                  </div>
                  <div style={{ fontWeight: 600, marginTop: 2 }}>{deal['property.title']}</div>
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
      {!all && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 12, fontSize: 13, color: C.muted }}>
          <span style={tabular}>Showing {closes.length} of {count} closes</span>
          <button style={small} disabled={list.loading} onClick={list.more}>{list.loading ? 'Loading…' : 'Show more'}</button>
        </div>
      )}
    </div>
  )
}

export function lineRole(l, m) {
  const t = !l.role && l.tierId && P.tiersFor(m.setup, m.staff[l.staffId].branchId).find(x => x.id === l.tierId)
  return `${m.commType(l)}${t ? ` · ${t.name}` : ''}`
}

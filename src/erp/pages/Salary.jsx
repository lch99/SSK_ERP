import { useState } from 'react'
import * as P from '../../../shared/payout.js'
import { C, btn, btnPrimary } from '../../styles.js'
import { useNarrow } from '../../setup/useNarrow.js'
import { nextPayDate } from '../../demo/erpSample.js'
import { useErp } from '../ErpContext.jsx'
import { useList, useRecord } from '../useList.js'
import { REQUEST_STATUS, sum } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, DataTable, Status, Who, Link, Drawer, Notice, Empty, Stat, SelectionBar, TextArea, cols, go, mono, tabular, small, useRecordNav } from '../ui.jsx'
import { PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { FlowBar } from '../flow.jsx'
import { rm, pct, date, maskAcc, maskIc } from '../format.js'
import { useCan } from '../access.jsx'

// Salary (own case lines) and Incentives (upline lines): each person requests
// their Ready lines, accounts pays them on the Setup pay day. A page at a time (useList).
export default function Salary({ parts }) {
  if (parts[1] === 'request') return <RequestList kind="salary" />
  if (parts[1] === 'incentives') return <RequestList kind="incentives" />
  if (parts[1] === 'creator') return <CreatorFees />
  return <AllList openId={Number(parts[1]) || null} />
}

const KIND = { salary: 'Salary', incentives: 'Incentives' }
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
// What waits for each kind, from the payout lines (by the earner's branch): Ready and stacked.
const WAITING = 'salaryReady,incentivesReady,salaryStacked,incentivesStacked'
const none = { n: 0, sum: 0, distinct: 0 }

// The people with Ready lines of this kind not requested yet, a page at a time.
function RequestList({ kind }) {
  const erp = useErp()
  const { m, setup } = erp
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('name')
  const [picked, setPicked] = useState(() => new Set())
  // A tick is for a row on screen: another search starts a new selection.
  const [pickedFor, setPickedFor] = useState(q)
  if (pickedFor !== q) { setPickedFor(q); setPicked(new Set()) }
  const people = useList('payees', { ready: kind, q, sort }, { pageSize: 50 })
  const totals = useList('payouts', { counts: WAITING }, { branch: 'staffBranch', pageSize: 1 }).counts
  const ready = totals[`${kind}Ready`] || none
  // Lines agents stacked wait for them to claim, so they are not requested here.
  const stacked = totals[`${kind}Stacked`] || none
  // The other kind waiting too: say so, with a link, since the flow counts both.
  const other = kind === 'incentives' ? 'salary' : 'incentives'
  const otherPeople = totals[`${other}Ready`]?.distinct || 0
  const amountOf = r => r.$[kind]
  const payOn = nextPayDate(setup.approvals, m.today)
  const fb = useFeedback()
  const create = async ids => {
    const rows = people.rows.filter(r => ids.includes(r.id))
    const who = ids.length === 1 ? rows[0]?.short : `${ids.length} people`
    const ok = await fb.confirm({ title: `Create ${KIND[kind]} Request for ${who}?`,
      body: <>{rm(sum(rows, amountOf))} in Ready lines goes into the request. It is paid on the next pay day, <b>{date(payOn)}</b>.</>, confirmLabel: 'Create request' })
    if (!ok) return
    if (await fb.run(() => erp.createRequests(ids, kind), `${KIND[kind]} Request created for ${who} · paid on ${date(payOn)}`)) setPicked(new Set())
  }
  const pickedRows = people.rows.filter(r => picked.has(r.id))
  const columns = [
    { key: 'staff', label: 'Staff', sortKey: 'name', render: r => <Who name={r.short} sub={`${r.code} · ${m.branchName(r.branchId)}`} to={`staff/${r.id}`} size={28} /> },
    { key: 'bank', label: 'Bank Account', render: r => <span>{r.bank}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{maskAcc(r.account)}</span></span> },
    { key: 'lines', label: 'Ready lines', align: 'right', render: r => r.$[`${kind}Lines`] },
    { key: 'amount', label: 'Amount', align: 'right', render: r => <b>{rm(amountOf(r))}</b> },
    { key: 'go', label: '', card: false, render: r => <button style={{ ...small, whiteSpace: 'nowrap' }} onClick={e => { e.stopPropagation(); create([r.id]) }}>Request</button> },
  ]
  return (
    <Page title={`Request ${KIND[kind].toLowerCase()}`} help={kind === 'incentives' ? PAGE.incentivesRequest : PAGE.salaryRequest}
      sub={<>Staff with Ready {kind === 'incentives' ? 'upline incentive' : 'salary'} lines that are not requested yet. Requests are paid on the next pay day ({date(payOn)}).</>}
      actions={<button style={{ ...btnPrimary, opacity: pickedRows.length ? 1 : 0.5 }} disabled={!pickedRows.length} onClick={() => create(pickedRows.map(r => r.id))}
        title={pickedRows.length ? undefined : 'Tick the people to request for first'}>Create {KIND[kind]} Request ({pickedRows.length} items)</button>}>
      <FlowBar here="request" />
      {otherPeople > 0 && <Notice tone="blue">{otherPeople} {otherPeople === 1 ? 'person also has' : 'people also have'} Ready {other === 'salary' ? 'salary' : 'upline incentive'} lines. <Link to={`salary/${other === 'salary' ? 'request' : 'incentives'}`}>Request {other}</Link></Notice>}
      <div style={{ ...cols(220, 14), marginBottom: 16 }}>
        <Stat icon="payRuns" tone="blue" label="Ready, not requested" value={rm(ready.sum)} sub={`${plural(ready.distinct, 'person', 'people')} · ${plural(ready.n, 'line')}`} />
        <Stat icon="clock" tone="gray" label="Next pay day" value={date(payOn)} sub={P.describeApprovals(setup.approvals).split(' · ')[1] || 'From Setup'} />
        {stacked.n > 0 && <Stat icon="wallet" tone="gray" label="Stacked by agents" value={rm(stacked.sum)}
          sub={`${plural(stacked.distinct, 'agent')} keeping it for later. They claim it themselves.`} />}
      </div>
      <Card pad={16}>
        <Toolbar><SearchBox value={q} onChange={setQ} placeholder="Name or staff code" /></Toolbar>
        {people.error && <Notice tone="red">{people.error}</Notice>}
        <DataTable columns={columns} rows={people.rows} pageSize={50} narrowAt={720}
          paged={{ total: people.total, sort, onSort: setSort, onMore: people.more, loading: people.loading }}
          empty={people.loading ? 'Loading…' : q ? `Nobody with Ready ${kind} lines matches “${q}”` : `Nobody has Ready ${kind} lines waiting`} onClear={q ? () => setQ('') : undefined}
          selection={{ selected: picked, onChange: setPicked }} />
        <SelectionBar count={pickedRows.length} summary={rm(sum(pickedRows, amountOf))} onClear={() => setPicked(new Set())}>
          <button style={{ ...small, ...btnPrimary, fontSize: 13, padding: '5px 12px' }} onClick={() => create(pickedRows.map(r => r.id))}>Create {KIND[kind]} Request</button>
        </SelectionBar>
      </Card>
    </Page>
  )
}

function CreatorFees() {
  return (
    <Page title="Request creator fees" help={PAGE.creator} sub="Creator fees pay the agent who created a listing out of the Product side.">
      <Card>
        <Empty title="No creator fees yet" text="The current ERP takes a 20% creator pool from the Product Handler's share. Creator fees aren't part of Setup yet, so none are worked out. Confirm the rule with the business, then add it to Setup." />
      </Card>
    </Page>
  )
}

const TABS = ['new', 'ready', 'clear', 'invalid', 'all']

// A request's net pay: its lines' gross less withholding tax, unless the person is exempt.
const netOf = (r, setup) => P.payslipTotals([r.$.gross], setup.dealTypes.whtPct, r.$.staff?.whtExempt).net

// One request's slip: the request, its payee, its lines and totals (as m.slip gives them).
// Its lines come in one read (a request holds one person's lines for one pay day).
function useSlip(id) {
  const { setup } = useErp()
  const { record: request, loading } = useRecord('requests', id)
  const lines = useList('payouts', { requestId: id ?? 0, sort: 'date' }, { branch: false, pageSize: 200 })
  if (!request) return { slip: null, loading }
  const totals = P.payslipTotals([request.$.gross], setup.dealTypes.whtPct, request.$.staff?.whtExempt)
  return { slip: { request, staff: request.$.staff || {}, lines: lines.rows, more: lines.total - lines.rows.length, ...totals }, loading }
}

function AllList({ openId }) {
  const { m, setup } = useErp()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('-date')
  const [status, setStatus] = useState('new')
  const [chosen, setChosen] = useState(false)
  const list = useList('requests', { q, sort, status: status === 'all' ? '' : status, counts: 'status,unpaid,paidThisYear' })
  const byStatus = list.counts.status
  // New requests first, when there are any.
  if (!chosen && byStatus) { setChosen(true); if (!byStatus.new) setStatus('all') }
  const pick = k => { setChosen(true); setStatus(k) }
  const { slip: open, loading: opening } = useSlip(openId)
  const { onOrder, nav } = useRecordNav(openId, id => `salary/${id}`)
  const unpaid = list.counts.unpaid || { n: 0, net: 0 }
  const year = list.counts.paidThisYear || { n: 0, net: 0, wht: 0 }
  const columns = [
    { key: 'date', label: 'Date', nowrap: true, sortKey: 'date', render: r => date(r.date) },
    { key: 'staff', label: 'Staff', render: r => <Who name={r.$.staff?.short || r.$.staff?.name} sub={r.$.staff?.code} size={26} /> },
    { key: 'bank', label: 'Bank Account', render: r => <span>{r.$.staff?.bank}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{maskAcc(r.$.staff?.account)}</span></span> },
    { key: 'type', label: 'Type', render: r => KIND[r.kind] },
    { key: 'amount', label: 'Amount', align: 'right', render: r => <b>{rm(netOf(r, setup))}</b> },
    { key: 'status', label: 'Status', sortKey: 'status', render: r => <Status of={REQUEST_STATUS} value={r.status} /> },
    { key: 'reason', label: 'Reasons', render: r => <span style={{ fontSize: 12.5, color: r.remark ? C.err : C.muted }}>{r.remark || '—'}</span> },
    { key: 'code', label: 'Salary ID', sortKey: 'code', render: r => <b style={mono}>{r.code}</b> },
  ]
  return (
    <Page title="Pay requests" help={PAGE.payRequests} sub="Salary and incentive requests (S.A.P list). Payment Clear pays the case lines in the request.">
      <FlowBar here="pay" />
      <div style={{ ...cols(220, 14), marginBottom: 16 }}>
        <Stat icon="payRuns" tone="amber" label="New Request and Payment Ready" value={rm(unpaid.net)} sub={plural(unpaid.n, 'request')} onClick={() => pick('ready')} on={status === 'ready'} />
        <Stat icon="check" tone="green" label={`Payment Clear in ${m.year}`} value={rm(year.net)} sub={`Tax withheld ${rm(year.wht)}`} onClick={() => pick('clear')} on={status === 'clear'} />
      </div>
      <Card pad={16}>
        <Tabs value={status} onChange={pick} tabs={TABS.map(k => ({ key: k, label: k === 'all' ? 'All List' : REQUEST_STATUS[k].label,
          count: k === 'all' ? Object.values(byStatus || {}).reduce((t, n) => t + n, 0) : byStatus?.[k] || 0 }))} />
        <Toolbar><SearchBox value={q} onChange={setQ} placeholder="Salary ID or staff" /></Toolbar>
        {list.error && <Notice tone="red">{list.error}</Notice>}
        <DataTable columns={columns} rows={list.rows} onRow={r => go(`salary/${r.id}`)} pageSize={20} narrowAt={940}
          paged={{ total: list.total, sort, onSort: setSort, onMore: list.more, loading: list.loading }}
          empty={list.loading ? 'Loading…' : q ? `No requests match “${q}”` : 'No requests here'} onClear={q ? () => setQ('') : undefined} onOrder={onOrder} />
      </Card>
      <Drawer open={openId != null} onClose={() => go('salary')} width={760} title={open ? `${KIND[open.request.kind]} · ${open.staff.short}` : opening ? 'Loading…' : 'Not found'} sub={open?.request.code}
        nav={nav} footer={open && <RequestActions key={open.request.id} slip={open} next={nav?.next} />}>
        {!open && !opening && <Notice tone="amber">This request was not found, or it is not one you can see.</Notice>}
        {open && <Slip slip={open} />}
      </Drawer>
    </Page>
  )
}

function RequestActions({ slip, next }) {
  const erp = useErp()
  const fb = useFeedback()
  const can = useCan()
  const r = slip.request
  const [asking, setAsking] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const set = async (status, remark) => {
    setBusy(true)
    const ok = await fb.run(() => erp.setRequestStatus(r.id, status, remark), `${r.code}: ${REQUEST_STATUS[status].label}${status === 'clear' ? ` · ${rm(slip.net)} paid to ${slip.staff.short}` : ''}`,
      next ? { action: { label: 'Next', onClick: next } } : undefined)
    if (ok) setAsking(false)
    setBusy(false)
  }
  if (r.status === 'clear') return <span style={{ fontSize: 13, color: C.muted, flex: 1 }}>Payment Clear on {date(r.paidOn)}.</span>
  if (!can('salary', 'full')) return <span style={{ fontSize: 13, color: C.muted, flex: 1 }}>{r.status === 'invalid' ? 'Sent back: see the reason above.' : 'Waiting for Accounts to pay it.'}</span>
  if (asking) {
    return (
      <>
        <TextArea style={{ flex: '1 1 220px', width: 'auto' }} autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="Reason, e.g. claim form not signed" />
        <button style={btn} onClick={() => setAsking(false)}>Cancel</button>
        <button style={btnPrimary} disabled={busy || !text.trim()} onClick={() => set('invalid', text)}>Document Not Valid</button>
      </>
    )
  }
  const remove = async () => {
    if (await fb.confirm({ title: 'Confirm to delete this salary case?', body: <>{r.code} is removed. Its {slip.lines.length} case line{slip.lines.length === 1 ? '' : 's'} go back to Salary Not-Requested, so they can be requested again.</>, confirmLabel: 'Delete', danger: true })
      && await fb.run(() => erp.deleteSalaryRequest(r.id), `${r.code} deleted`)) go('salary')
  }
  return (
    <>
      <button style={{ ...btn, color: C.err }} onClick={remove}>Delete</button>
      <span style={{ flex: 1 }} />
      <button style={btn} onClick={() => setAsking(true)}>Document Not Valid…</button>
      {r.status !== 'ready' && <button style={btn} disabled={busy} onClick={() => set('ready')}>Payment Ready</button>}
      <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => set('clear')}>Payment Clear</button>
    </>
  )
}

// The salary slip, laid out like the current printout (SAL-YYYY-MM-NNNNN).
// slip: useSlip(id).slip; each line carries its E-Form as $.deal.
function Slip({ slip }) {
  const { m, setup } = useErp()
  const { staff: s, request: r } = slip
  const co = setup.company
  const [ref, narrow] = useNarrow(560)
  const cell = { padding: '7px 6px', borderBottom: `1px solid ${C.border}`, fontSize: 12, verticalAlign: 'top' }
  return (
    <div ref={ref} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: narrow ? 14 : 22 }}>
      {r.remark && <Notice tone="red"><b>Document Not Valid:</b> {r.remark}</Notice>}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', borderBottom: `2px solid ${C.primary}`, paddingBottom: 14, marginBottom: 14 }}>
        <div style={{ flex: '1 1 260px' }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{co.name}</div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{co.regNo} · Licence {co.licenceNo}<br />{co.address}</div>
        </div>
        <div style={{ textAlign: narrow ? 'left' : 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.primary, letterSpacing: 0.6, textTransform: 'uppercase' }}>{KIND[r.kind]} slip</div>
          <div style={{ ...mono, fontWeight: 700, marginTop: 4 }}>{r.code}</div>
          <div style={{ fontSize: 12, color: C.muted }}>{r.status === 'clear' ? `Paid ${date(r.paidOn)}` : `Pay day ${date(r.payOn)}`}</div>
          <div style={{ marginTop: 4 }}><Status of={REQUEST_STATUS} value={r.status} /></div>
        </div>
      </div>
      <div style={{ ...cols(180, 10), marginBottom: 14, fontSize: 13 }}>
        <div><div style={{ color: C.muted, fontSize: 11.5, fontWeight: 600 }}>PAYEE</div><b>{s.name}</b><div style={{ color: C.muted }}>IC {maskIc(s.ic)} · {s.renNo}</div></div>
        <div><div style={{ color: C.muted, fontSize: 11.5, fontWeight: 600 }}>BANK</div>{s.bank}<div style={{ color: C.muted }}>Account {maskAcc(s.account)}</div></div>
        <div><div style={{ color: C.muted, fontSize: 11.5, fontWeight: 600 }}>CONTACT</div>{s.phone}<div style={{ color: C.muted }}>{s.email}</div></div>
      </div>
      {narrow ? (
        <div style={{ borderTop: `1px solid ${C.border}` }}>
          {slip.lines.map(l => {
            const deal = l.$.deal || {}
            return (
              <div key={l.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12.5 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link to={`deals/${l.dealId}`} style={mono}>{deal.code}</Link> <span style={{ color: C.muted }}>· {date(l.date, { short: true })}</span>
                  <div>{deal['property.title']}</div>
                  <div style={{ color: C.muted }}>{m.commType(l)} · {pct(l.pct)} of {rm(l.base)}</div>
                </div>
                <b style={{ whiteSpace: 'nowrap', ...tabular }}>{rm(l.amount)}</b>
              </div>
            )
          })}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['Case Date', 'Document Code', 'Property Address', 'Sale Staff', 'Product Handler', 'Comm. Type', 'Comm %', 'Net Comm.', KIND[r.kind]].map((h, i) => (
              <th key={h} style={{ ...cell, fontSize: 12, color: C.muted, textAlign: i >= 6 ? 'right' : 'left', fontWeight: 600 }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {slip.lines.map(l => {
              const deal = l.$.deal || {}
              return (
                <tr key={l.id}>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>{date(l.date, { short: true })}</td>
                  <td style={cell}><Link to={`deals/${l.dealId}`} style={{ ...mono, fontSize: 12 }}>{deal.code}</Link></td>
                  <td style={cell}>{deal['property.title']}</td>
                  <td style={cell}>{m.staffName(deal.agentId)}</td>
                  <td style={cell}>{deal.holderId != null ? m.staffName(deal.holderId) : '—'}</td>
                  <td style={cell}>{m.commType(l)}</td>
                  <td style={{ ...cell, textAlign: 'right', ...tabular }}>{pct(l.pct)}</td>
                  <td style={{ ...cell, textAlign: 'right', ...tabular }}>{rm(l.base)}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 600, ...tabular }}>{rm(l.amount)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {slip.more > 0 && <p style={{ fontSize: 12, color: C.muted, margin: '8px 0 0' }}>And {plural(slip.more, 'more line')}: the totals count them all.</p>}
      <div style={{ marginLeft: 'auto', maxWidth: 300, marginTop: 12, fontSize: 13.5 }}>
        {[['Sub-total', rm(slip.gross)], [s.whtExempt ? 'Withholding tax (exempt)' : `Withholding tax ${setup.dealTypes.whtPct}%`, `− ${rm(slip.wht)}`]].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span style={{ color: C.muted }}>{k}</span><span style={tabular}>{v}</span></div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginTop: 4, borderTop: `2px solid ${C.text}`, fontWeight: 700, fontSize: 15 }}>
          <span>Net pay</span><span style={tabular}>{rm(slip.net)}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 30, marginTop: 30, flexWrap: 'wrap', fontSize: 12, color: C.muted }}>
        {['Prepared by', 'Approved by', 'Received by'].map(x => <div key={x} style={{ flex: '1 1 140px', borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>{x}</div>)}
      </div>
    </div>
  )
}

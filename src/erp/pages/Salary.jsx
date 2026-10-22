import { useMemo, useState } from 'react'
import * as P from '../../../shared/payout.js'
import { C, btn, btnPrimary, inp } from '../../styles.js'
import { useNarrow } from '../../setup/useNarrow.js'
import { nextPayDate } from '../../demo/erpSample.js'
import { useErp } from '../ErpContext.jsx'
import { REQUEST_STATUS, group, sum } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, DataTable, Status, Who, Link, Drawer, Notice, Empty, Stat, SelectionBar, cols, go, mono, tabular, small, useRecordNav } from '../ui.jsx'
import { PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { FlowBar } from '../flow.jsx'
import { rm, pct, date, maskAcc, maskIc } from '../format.js'

// Salary (own case lines) and Incentives (upline lines): each person requests
// their Ready lines, accounts pays them on the Setup pay day.
export default function Salary({ parts }) {
  if (parts[1] === 'request') return <RequestList kind="salary" />
  if (parts[1] === 'incentives') return <RequestList kind="incentives" />
  if (parts[1] === 'creator') return <CreatorFees />
  return <AllList openId={Number(parts[1]) || null} />
}

const KIND = { salary: 'Salary', incentives: 'Incentives' }

function RequestList({ kind }) {
  const erp = useErp()
  const { m, scoped: d, setup } = erp
  const [picked, setPicked] = useState(new Set())
  const [error, setError] = useState(null)
  const ready = d.payouts.filter(p => p.status === 'approved' && !p.requestId && (kind === 'incentives' ? p.role : !p.role))
  // The other kind waiting too: say so, with a link, since the flow counts both.
  const other = kind === 'incentives' ? 'salary' : 'incentives'
  const otherPeople = new Set(d.payouts.filter(p => p.status === 'approved' && !p.requestId && (kind === 'incentives' ? !p.role : p.role)).map(p => p.staffId)).size
  const rows = Object.entries(group(ready, 'staffId')).map(([sid, ls]) => ({ staff: m.staff[sid], lines: ls, amount: sum(ls, l => l.amount) }))
    .sort((a, b) => a.staff.short.localeCompare(b.staff.short))
  const payOn = nextPayDate(setup.approvals, m.today)
  const fb = useFeedback()
  const create = async ids => {
    setError(null)
    const who = ids.length === 1 ? m.staff[ids[0]].short : `${ids.length} people`
    const total = sum(rows.filter(r => ids.includes(r.staff.id)), r => r.amount)
    const ok = await fb.confirm({ title: `Create ${KIND[kind]} Request for ${who}?`,
      body: <>{rm(total)} in Ready lines goes into the request. It is paid on the next pay day, <b>{date(payOn)}</b>.</>, confirmLabel: 'Create request' })
    if (!ok) return
    if (await fb.run(() => erp.createRequests(ids, kind), `${KIND[kind]} Request created for ${who} · paid on ${date(payOn)}`)) setPicked(new Set())
  }
  const pickedTotal = sum(rows.filter(r => picked.has(r.staff.id)), r => r.amount)
  const columns = [
    { key: 'staff', label: 'Staff', render: r => <Who name={r.staff.short} sub={`${r.staff.code} · ${m.branchName(r.staff.branchId)}`} to={`staff/${r.staff.id}`} size={28} /> },
    { key: 'bank', label: 'Bank Account', render: r => <span>{r.staff.bank}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{maskAcc(r.staff.account)}</span></span> },
    { key: 'lines', label: 'Ready lines', align: 'right', render: r => r.lines.length },
    { key: 'amount', label: 'Amount', align: 'right', render: r => <b>{rm(r.amount)}</b> },
    { key: 'go', label: '', card: false, render: r => <button style={{ ...small, whiteSpace: 'nowrap' }} onClick={e => { e.stopPropagation(); create([r.staff.id]) }}>Request</button> },
  ]
  return (
    <Page title={`Request ${KIND[kind].toLowerCase()}`} help={kind === 'incentives' ? PAGE.incentivesRequest : PAGE.salaryRequest}
      sub={<>Staff with Ready {kind === 'incentives' ? 'upline incentive' : 'salary'} lines that are not requested yet. Requests are paid on the next pay day ({date(payOn)}).</>}
      actions={<button style={{ ...btnPrimary, opacity: picked.size ? 1 : 0.5 }} disabled={!picked.size} onClick={() => create([...picked])}
        title={picked.size ? undefined : 'Tick the people to request for first'}>Create {KIND[kind]} Request ({picked.size} items)</button>}>
      <FlowBar here="request" />
      {error && <Notice tone="red">{error}</Notice>}
      {otherPeople > 0 && <Notice tone="blue">{otherPeople} {otherPeople === 1 ? 'person also has' : 'people also have'} Ready {other === 'salary' ? 'salary' : 'upline incentive'} lines. <Link to={`salary/${other === 'salary' ? 'request' : 'incentives'}`}>Request {other}</Link></Notice>}
      <div style={{ ...cols(220, 14), marginBottom: 16 }}>
        <Stat icon="payRuns" tone="blue" label={`Ready, not requested`} value={rm(sum(rows, r => r.amount))} sub={`${rows.length} ${rows.length === 1 ? 'person' : 'people'} · ${sum(rows, r => r.lines.length)} line${sum(rows, r => r.lines.length) === 1 ? '' : 's'}`} />
        <Stat icon="clock" tone="gray" label="Next pay day" value={date(payOn)} sub={P.describeApprovals(setup.approvals).split(' · ')[1] || 'From Setup'} />
      </div>
      <Card pad={16}>
        <DataTable columns={columns} rows={rows} rowKey={r => r.staff.id} narrowAt={720} empty={`Nobody has Ready ${kind} lines waiting`}
          selection={{ selected: picked, onChange: setPicked }} />
        <SelectionBar count={picked.size} summary={rm(pickedTotal)} onClear={() => setPicked(new Set())}>
          <button style={{ ...small, ...btnPrimary, fontSize: 13, padding: '5px 12px' }} onClick={() => create([...picked])}>Create {KIND[kind]} Request</button>
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

function AllList({ openId }) {
  const { m, scoped: d } = useErp()
  const [tab, setTab] = useState(() => (d.requests.some(r => r.status === 'new') ? 'new' : 'all'))
  const [q, setQ] = useState('')
  const open = openId && m.requests[openId] ? m.slip(openId) : null
  const match = useMemo(() => {
    const words = q.trim().toLowerCase()
    return d.requests.filter(r => !words || [r.code, m.staff[r.staffId].name, m.staff[r.staffId].short].join(' ').toLowerCase().includes(words))
  }, [d.requests, q, m])
  const rows = tab === 'all' ? match : match.filter(r => r.status === tab)
  const { onOrder, nav } = useRecordNav(open?.request.id, id => `salary/${id}`)
  const unpaid = d.requests.filter(r => r.status === 'new' || r.status === 'ready')
  const year = d.requests.filter(r => r.status === 'clear' && r.paidOn?.startsWith(m.year))
  const columns = [
    { key: 'date', label: 'Date', nowrap: true, sort: r => r.date, render: r => date(r.date) },
    { key: 'staff', label: 'Staff', sort: r => m.staffName(r.staffId), render: r => <Who name={m.staffName(r.staffId)} sub={m.staff[r.staffId].code} size={26} /> },
    { key: 'bank', label: 'Bank Account', render: r => <span>{m.staff[r.staffId].bank}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{maskAcc(m.staff[r.staffId].account)}</span></span> },
    { key: 'type', label: 'Type', render: r => KIND[r.kind] },
    { key: 'amount', label: 'Amount', align: 'right', render: r => <b>{rm(m.slip(r.id).net)}</b> },
    { key: 'status', label: 'Status', sort: r => r.status, render: r => <Status of={REQUEST_STATUS} value={r.status} /> },
    { key: 'reason', label: 'Reasons', render: r => <span style={{ fontSize: 12.5, color: r.remark ? C.err : C.muted }}>{r.remark || '—'}</span> },
    { key: 'code', label: 'Salary ID', sort: r => r.id, render: r => <b style={mono}>{r.code}</b> },
  ]
  return (
    <Page title="Pay requests" help={PAGE.payRequests} sub="Salary and incentive requests (S.A.P list). Payment Clear pays the case lines in the request.">
      <FlowBar here="pay" />
      <div style={{ ...cols(220, 14), marginBottom: 16 }}>
        <Stat icon="payRuns" tone="amber" label="New Request and Payment Ready" value={rm(sum(unpaid, r => m.slip(r.id).net))} sub={`${unpaid.length} requests`} onClick={() => setTab('ready')} on={tab === 'ready'} />
        <Stat icon="check" tone="green" label={`Payment Clear in ${m.year}`} value={rm(sum(year, r => m.slip(r.id).net))} sub={`Tax withheld ${rm(sum(year, r => m.slip(r.id).wht))}`} onClick={() => setTab('clear')} on={tab === 'clear'} />
      </div>
      <Card pad={16}>
        <Tabs value={tab} onChange={setTab} tabs={TABS.map(k => ({ key: k, label: k === 'all' ? 'All List' : REQUEST_STATUS[k].label, count: k === 'all' ? match.length : match.filter(r => r.status === k).length }))} />
        <Toolbar><SearchBox value={q} onChange={setQ} placeholder="Salary ID or staff" /></Toolbar>
        <DataTable columns={columns} rows={rows} onRow={r => go(`salary/${r.id}`)} defaultSort={{ key: 'code', dir: 'desc' }} pageSize={20} narrowAt={940}
          empty={q ? `No requests match “${q}”` : 'No requests here'} onClear={q ? () => setQ('') : undefined} onOrder={onOrder} />
      </Card>
      <Drawer open={!!open} onClose={() => go('salary')} width={760} title={open ? `${KIND[open.request.kind]} · ${open.staff.short}` : ''} sub={open?.request.code}
        nav={nav} footer={open && <RequestActions key={open.request.id} slip={open} next={nav?.next} />}>
        {open && <Slip slip={open} />}
      </Drawer>
    </Page>
  )
}

function RequestActions({ slip, next }) {
  const erp = useErp()
  const fb = useFeedback()
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
  if (asking) {
    return (
      <>
        <input style={{ ...inp, flex: '1 1 220px' }} autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="Reason, e.g. claim form not signed" />
        <button style={btn} onClick={() => setAsking(false)}>Cancel</button>
        <button style={btnPrimary} disabled={busy || !text.trim()} onClick={() => set('invalid', text)}>Document Not Valid</button>
      </>
    )
  }
  return (
    <>
      <button style={btn} onClick={() => setAsking(true)}>Document Not Valid…</button>
      {r.status !== 'ready' && <button style={btn} disabled={busy} onClick={() => set('ready')}>Payment Ready</button>}
      <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => set('clear')}>Payment Clear</button>
    </>
  )
}

// The salary slip, laid out like the current printout (SAL-YYYY-MM-NNNNN).
export function Slip({ slip }) {
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
            const deal = m.deals[l.dealId]
            return (
              <div key={l.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12.5 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link to={`deals/${deal.id}`} style={mono}>{deal.code}</Link> <span style={{ color: C.muted }}>· {date(l.date, { short: true })}</span>
                  <div>{deal.property.title}</div>
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
              <th key={h} style={{ ...cell, fontSize: 11, color: C.muted, textAlign: i >= 6 ? 'right' : 'left', fontWeight: 600 }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {slip.lines.map(l => {
              const deal = m.deals[l.dealId]
              return (
                <tr key={l.id}>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>{date(l.date, { short: true })}</td>
                  <td style={cell}><Link to={`deals/${deal.id}`} style={{ ...mono, fontSize: 11.5 }}>{deal.code}</Link></td>
                  <td style={cell}>{deal.property.title}</td>
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

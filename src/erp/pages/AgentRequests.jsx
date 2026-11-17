import { useState } from 'react'
import { C } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { useList } from '../useList.js'
import { AGENT_REQUEST_STATUS } from '../model.js'
import { Page, Card, Toolbar, SearchBox, Select, DataTable, Status, Pill, Who, Menu, Stat, Notice, cols, go, mono } from '../ui.jsx'
import { PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { date, ago } from '../format.js'
import { useAccess, useGate } from '../access.jsx'

// ── Co-Agent requests: agents who asked through the website to partner with us ──
// The website's "SubSaleKing Co-Agent" form (Advertise › I'm a Real Estate Negotiator): name, e-mail, phone and
// whether they are registered with BOVAEA. A page at a time (useList); the search finds the ticket, name, e-mail or phone.
export function AgentRequests() {
  const erp = useErp()
  const gate = useGate()
  const me = useAccess()?.who?.staffId ?? null
  const { m } = erp
  const [status, setStatus] = useState('')
  const [registered, setRegistered] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('-date')
  const list = useList('agentRequests', { q, status, registered, sort })
  const byStatus = list.counts.status || {}
  const fb = useFeedback()
  const set = (r, s) => fb.run(() => erp.setAgentRequest(r.id, s, { by: me }), `${r.ticket} set to ${AGENT_REQUEST_STATUS[s].label}`)
  const columns = [
    { key: 'ticket', label: 'Ticket Id', render: r => <b style={mono}>{r.ticket}</b> },
    { key: 'date', label: 'Date', nowrap: true, sortKey: 'date', render: r => <span>{date(r.date)}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{ago(r.date, m.today)}</span></span> },
    { key: 'from', label: 'From', render: r => (
      <span><Who name={r.name} sub={r.phone} size={26} />{r.email && <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 2, overflowWrap: 'anywhere' }}>{r.email}</span>}</span>
    ) },
    { key: 'registered', label: 'BOVAEA', render: r => (r.registered ? <Pill tone="green">Registered</Pill> : <Pill tone="gray">Not registered</Pill>) },
    { key: 'handled', label: 'Handled by', render: r => (r.handledBy ? m.staffName(r.handledBy) : <span style={{ color: C.muted }}>Not yet</span>) },
    { key: 'status', label: 'Status', render: r => <Status of={AGENT_REQUEST_STATUS} value={r.status} /> },
    { key: 'actions', label: '', render: r => (
      <Menu quiet items={[
        { label: 'Contacted', icon: 'clock', disabled: r.status === 1, why: 'Set already', onClick: () => set(r, 1) },
        { label: 'Joined', icon: 'check', disabled: r.status === 2, why: 'Set already', onClick: () => set(r, 2) },
        { label: 'Add an agent', icon: 'plus', onClick: () => go('staff/new') },
        '-',
        { label: 'Not joining', icon: 'close', disabled: r.status === -1, why: 'Set already', onClick: () => set(r, -1) },
        { label: 'Invalid', icon: 'ban', danger: true, disabled: r.status === -2, why: 'Marked invalid already', onClick: () => set(r, -2) },
      ].map(i => (i?.label ? gate(i, 'staff') : i))} />
    ) },
  ]
  return (
    <Page title="Co-Agent requests" help={PAGE.agentRequests} sub="Agents who asked through the SubSaleKing website to partner with us. Call them, then add those who join.">
      <div style={{ ...cols(200, 14), marginBottom: 16 }}>
        {[0, 1, 2].map(s => <Stat key={s} label={AGENT_REQUEST_STATUS[s].label} value={byStatus[s] || 0} tone={AGENT_REQUEST_STATUS[s].tone} onClick={() => setStatus(String(s))} on={status === String(s)} />)}
      </div>
      <Card pad={16}>
        <Toolbar>
          <SearchBox value={q} onChange={setQ} placeholder="Ticket Id, name, e-mail or phone" />
          <Select label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...Object.entries(AGENT_REQUEST_STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
          <Select label="BOVAEA" value={registered} onChange={setRegistered} options={[{ value: '', label: 'Registered or not' }, { value: 'true', label: 'Registered' }, { value: 'false', label: 'Not registered' }]} />
        </Toolbar>
        {list.error && <Notice tone="red">{list.error}</Notice>}
        <DataTable columns={columns} rows={list.rows} rowKey={r => r.id} narrowAt={900} paged={{ total: list.total, sort, onSort: setSort, onMore: list.more, loading: list.loading }}
          empty={list.loading ? 'Loading…' : q ? `No Co-Agent requests match “${q}”` : 'No Co-Agent requests yet'}
          onClear={q || status || registered ? () => { setQ(''); setStatus(''); setRegistered('') } : undefined} />
      </Card>
    </Page>
  )
}

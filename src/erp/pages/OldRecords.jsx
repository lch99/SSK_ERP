import { useState } from 'react'
import { C, btn } from '../../styles.js'
import { useList, useListDownload } from '../useList.js'
import { DEAL_STATUS } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, DataTable, Status, Who, Notice, Stat, cols, mono } from '../ui.jsx'
import { PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { rm, date } from '../format.js'

// Old records from the first system (V1): the pre-Ver2 E-Forms and the yearly
// Overide summaries (2016–2019). Kept read only, so nothing is lost when the
// old ERP is switched off; new work happens in the pages above. Each is a
// list of the viewer's reach (their own and their downline's, or their branch),
// a page at a time (useList), whatever branch the top bar shows.
const download = { ...btn, fontSize: 13, padding: '5px 12px' }
const staffOf = r => r.$.staff?.short || r.$.staff?.name || '—'

export default function OldRecords() {
  const [tab, setTab] = useState('eforms')
  // Only the counts, for the tabs.
  const eforms = useList('v1Eforms', { counts: 'all' }, { branch: false, pageSize: 1 }).counts.all
  const years = useList('v1Overrides', { counts: 'years' }, { branch: false, pageSize: 1 }).counts.years
  return (
    <Page title="Old records (V1)" help={PAGE.oldRecords} sub="E-Forms and Overide summaries from the first system, before Ver 2. Read only.">
      <Notice tone="blue">These came over from the old ERP ("Show more" menu). They don't pay anyone again and can't be changed. Look up an old case here, or download it for Excel.</Notice>
      <Card pad={16}>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'eforms', label: 'E-Forms (Old)', count: eforms?.n || 0 },
          { key: 'overide', label: 'Overide Summary', count: Object.values(years || {}).reduce((t, n) => t + n, 0) }]} />
        {tab === 'eforms' ? <OldEForms all={eforms} /> : <Overides years={years} />}
      </Card>
    </Page>
  )
}

function OldEForms({ all }) {
  const fb = useFeedback()
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [year, setYear] = useState('')
  const [sort, setSort] = useState('-date')
  const params = { q, type, status, sort, ...(year && { from: `${year}-01-01`, to: `${year}-12-31` }) }
  const list = useList('v1Eforms', { ...params, counts: '0' }, { branch: false })
  const saveExcel = useListDownload('v1Eforms')
  const first = Number(all?.range?.min?.slice(0, 4)), last = Number(all?.range?.max?.slice(0, 4))
  const years = first ? Array.from({ length: last - first + 1 }, (_, i) => String(last - i)) : []
  const filters = [type, status, year].filter(Boolean).length
  const clear = () => { setQ(''); setType(''); setStatus(''); setYear('') }
  return (
    <>
      <div style={{ ...cols(180, 12), marginBottom: 14 }}>
        <Stat label="Old E-Forms" value={all?.n ?? '…'} sub={first ? `${first}–${last}` : ''} />
        <Stat label="Closed (full and partial)" value={rm(all?.sum || 0)} tone="green" />
      </div>
      <Toolbar fold onClear={clear}>
        <SearchBox value={q} onChange={setQ} placeholder="Case number, address or staff" />
        <Select label="Year" value={year} onChange={setYear} options={[{ value: '', label: 'All years' }, ...years.map(y => ({ value: y, label: y }))]} />
        <Select label="Type" value={type} onChange={setType} options={[['', 'Sales and rental'], ['sale', 'Sales'], ['rental', 'Rental']].map(([value, label]) => ({ value, label }))} />
        <Select label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...['submitted', 'cancelled', 'closed', 'partial'].map(s => ({ value: s, label: DEAL_STATUS[s].label }))]} />
        <span style={{ flex: 1 }} />
        <button style={download} disabled={!list.total} onClick={() => fb.run(() => saveExcel(params))}>Download Excel</button>
      </Toolbar>
      {list.error && <Notice tone="red">{list.error}</Notice>}
      <DataTable rows={list.rows} pageSize={20} narrowAt={860} paged={{ total: list.total, sort, onSort: setSort, onMore: list.more, loading: list.loading }}
        empty={list.loading ? 'Loading…' : 'No old E-Forms match'} onClear={filters || q ? clear : undefined} columns={[
          { key: 'code', label: 'Code · Date', sortKey: 'date', render: r => <span><b style={{ ...mono, color: C.primaryDark }}>{r.code}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{date(r.date)}</span></span> },
          { key: 'staff', label: 'Sale Staff', render: r => <Who name={staffOf(r)} size={24} sub={r.type === 'sale' ? 'Sales' : 'Rental'} /> },
          { key: 'address', label: 'Address', render: r => <span style={{ fontSize: 13 }}>{r.address}</span> },
          { key: 'price', label: 'Sell/Rent Price', align: 'right', sortKey: 'price', render: r => rm(r.price) },
          { key: 'total', label: 'Total · Closing', align: 'right', sortKey: 'total', render: r => <span>{rm(r.total)}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{rm(r.closing)}</span></span> },
          { key: 'status', label: 'Status', sortKey: 'status', render: r => <Status of={DEAL_STATUS} value={r.status} /> },
        ]} />
    </>
  )
}

function Overides({ years: counted }) {
  const fb = useFeedback()
  const years = Object.keys(counted || {}).sort().reverse()
  const [picked, setPicked] = useState('')
  const year = picked || years[0] || ''
  const [sort, setSort] = useState('-override')
  const params = { year: year || 'none', sort }
  const list = useList('v1Overrides', { ...params, counts: 'override,sales' }, { branch: false })
  const saveExcel = useListDownload('v1Overrides')
  const { override = { sum: 0 }, sales = { sum: 0 } } = list.counts
  return (
    <>
      <Toolbar>
        <Select label="Overide Summary" value={year} onChange={setPicked} options={years.map(y => ({ value: y, label: `Overide Summary ${y}` }))} />
        <span style={{ flex: 1 }} />
        <button style={download} disabled={!list.total} onClick={() => fb.run(() => saveExcel(params))}>Download Excel</button>
      </Toolbar>
      {list.error && <Notice tone="red">{list.error}</Notice>}
      <DataTable rows={list.rows} pageSize={20} narrowAt={600} paged={{ total: list.total, sort, onSort: setSort, onMore: list.more, loading: list.loading }}
        empty={list.loading ? 'Loading…' : 'No overides that year'} columns={[
          { key: 'staff', label: 'Leader', render: r => <Who name={staffOf(r)} size={24} sub={r.$.staff?.code} /> },
          { key: 'cases', label: 'Cases', align: 'right', sortKey: 'cases', render: r => r.cases },
          { key: 'sales', label: 'Team Sales', align: 'right', sortKey: 'sales', render: r => rm(r.sales) },
          { key: 'override', label: 'Overide', align: 'right', sortKey: 'override', render: r => <b>{rm(r.override)}</b> },
        ]} />
      <p style={{ fontSize: 12.5, color: C.muted, margin: '10px 0 0' }}>Total {year}: <b>{rm(override.sum)}</b> in overides on {rm(sales.sum)} of team sales.</p>
    </>
  )
}

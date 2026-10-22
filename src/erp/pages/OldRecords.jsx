import { useMemo, useState } from 'react'
import { C, btn } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { DEAL_STATUS, sum } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, DataTable, Status, Who, Notice, Stat, cols, mono } from '../ui.jsx'
import { PAGE } from '../help.js'
import { rm, date } from '../format.js'

// Old records from the first system (V1): the pre-Ver2 E-Forms and the yearly
// Overide summaries (2016–2019). Kept read only, so nothing is lost when the
// old ERP is switched off; new work happens in the pages above.
const csv = (name, head, rows) => {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const blob = new Blob([[head, ...rows].map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name })
  a.click()
  URL.revokeObjectURL(a.href)
}
const download = { ...btn, fontSize: 13, padding: '5px 12px' }

export default function OldRecords() {
  const { m } = useErp()
  const v1 = m.data.v1 || { eforms: [], overrides: [] }
  const [tab, setTab] = useState('eforms')
  return (
    <Page title="Old records (V1)" help={PAGE.oldRecords} sub="E-Forms and Overide summaries from the first system, before Ver 2. Read only.">
      <Notice tone="blue">These came over from the old ERP ("Show more" menu). They don't pay anyone again and can't be changed. Look up an old case here, or download it for Excel.</Notice>
      <Card pad={16}>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'eforms', label: 'E-Forms (Old)', count: v1.eforms.length }, { key: 'overide', label: 'Overide Summary', count: v1.overrides.length }]} />
        {tab === 'eforms' ? <OldEForms rows={v1.eforms} m={m} /> : <Overides rows={v1.overrides} m={m} />}
      </Card>
    </Page>
  )
}

function OldEForms({ rows, m }) {
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [year, setYear] = useState('')
  const years = [...new Set(rows.map(r => r.date.slice(0, 4)))].sort().reverse()
  const match = useMemo(() => {
    const words = q.trim().toLowerCase()
    return rows.filter(r => (!type || r.type === type) && (!status || r.status === status) && (!year || r.date.startsWith(year)) &&
      (!words || [r.code, r.address, m.staffName(r.staffId)].join(' ').toLowerCase().includes(words)))
  }, [rows, q, type, status, year, m])
  const filters = [type, status, year].filter(Boolean).length
  const clear = () => { setQ(''); setType(''); setStatus(''); setYear('') }
  return (
    <>
      <div style={{ ...cols(180, 12), marginBottom: 14 }}>
        <Stat label="Old E-Forms" value={rows.length} sub={`${years.at(-1) || ''}–${years[0] || ''}`} />
        <Stat label="Closed (full and partial)" value={rm(sum(rows, r => r.closing))} tone="green" />
      </div>
      <Toolbar fold active={filters} onClear={clear}>
        <SearchBox value={q} onChange={setQ} placeholder="Case number, address or staff" />
        <Select label="Year" value={year} onChange={setYear} options={[{ value: '', label: 'All years' }, ...years.map(y => ({ value: y, label: y }))]} />
        <Select label="Type" value={type} onChange={setType} options={[['', 'Sales and rental'], ['sale', 'Sales'], ['rental', 'Rental']].map(([value, label]) => ({ value, label }))} />
        <Select label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...['submitted', 'cancelled', 'closed', 'partial'].map(s => ({ value: s, label: DEAL_STATUS[s].label }))]} />
        <span style={{ flex: 1 }} />
        <button style={download} onClick={() => csv('old-eforms.csv', ['Code', 'Date', 'Type', 'Staff', 'Address', 'Price', 'Total', 'Closing Total', 'Status'],
          match.map(r => [r.code, r.date, r.type, m.staffName(r.staffId), r.address, r.price, r.total, r.closing, DEAL_STATUS[r.status].label]))}>Download CSV</button>
      </Toolbar>
      <DataTable rows={match} pageSize={20} narrowAt={860} defaultSort={{ key: 'code', dir: 'desc' }} empty="No old E-Forms match" onClear={filters || q ? clear : undefined} columns={[
        { key: 'code', label: 'Code · Date', sort: r => r.date, render: r => <span><b style={{ ...mono, color: C.primaryDark }}>{r.code}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{date(r.date)}</span></span> },
        { key: 'staff', label: 'Sale Staff', sort: r => m.staffName(r.staffId), render: r => <Who name={m.staffName(r.staffId)} size={24} sub={r.type === 'sale' ? 'Sales' : 'Rental'} /> },
        { key: 'address', label: 'Address', render: r => <span style={{ fontSize: 13 }}>{r.address}</span> },
        { key: 'price', label: 'Sell/Rent Price', align: 'right', sort: r => r.price, render: r => rm(r.price) },
        { key: 'total', label: 'Total · Closing', align: 'right', sort: r => r.total, render: r => <span>{rm(r.total)}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{rm(r.closing)}</span></span> },
        { key: 'status', label: 'Status', sort: r => r.status, render: r => <Status of={DEAL_STATUS} value={r.status} /> },
      ]} />
    </>
  )
}

function Overides({ rows, m }) {
  const years = [...new Set(rows.map(r => r.year))].sort().reverse()
  const [year, setYear] = useState(String(years[0] || ''))
  const shown = rows.filter(r => String(r.year) === year)
  return (
    <>
      <Toolbar>
        <Select label="Overide Summary" value={year} onChange={setYear} options={years.map(y => ({ value: String(y), label: `Overide Summary ${y}` }))} />
        <span style={{ flex: 1 }} />
        <button style={download} onClick={() => csv(`overide-summary-${year}.csv`, ['Staff', 'Cases', 'Team Sales', 'Overide'], shown.map(r => [m.staffName(r.staffId), r.cases, r.sales, r.override]))}>Download CSV</button>
      </Toolbar>
      <DataTable rows={shown} narrowAt={600} defaultSort={{ key: 'override', dir: 'desc' }} empty="No overides that year" columns={[
        { key: 'staff', label: 'Leader', sort: r => m.staffName(r.staffId), render: r => <Who name={m.staffName(r.staffId)} size={24} sub={m.staff[r.staffId]?.code} /> },
        { key: 'cases', label: 'Cases', align: 'right', sort: r => r.cases, render: r => r.cases },
        { key: 'sales', label: 'Team Sales', align: 'right', sort: r => r.sales, render: r => rm(r.sales) },
        { key: 'override', label: 'Overide', align: 'right', sort: r => r.override, render: r => <b>{rm(r.override)}</b> },
      ]} />
      <p style={{ fontSize: 12.5, color: C.muted, margin: '10px 0 0' }}>Total {year}: <b>{rm(sum(shown, r => r.override))}</b> in overides on {rm(sum(shown, r => r.sales))} of team sales.</p>
    </>
  )
}

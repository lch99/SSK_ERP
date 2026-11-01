import { useState } from 'react'
import { useErp } from './ErpContext.jsx'
import { useList, useRecord } from './useList.js'
import { Select } from './ui.jsx'

// Pickers over long lists: they search the server (or the demo's records) as
// you type, instead of listing every record.

// An E-Form, by code, title or address. `statuses` limits the choice (the
// chosen one always shows, whatever its status); `placeholder` is the empty choice.
export function DealPicker({ value, onChange, statuses = 'submitted,partial,closed', placeholder = 'Please select one.', label = 'E-Form' }) {
  const { m } = useErp()
  const [q, setQ] = useState('')
  const list = useList('deals', { q, status: statuses, sort: '-date' }, { pageSize: 30 })
  const chosen = useRecord('deals', Number(value) || null).record
  // The chosen one stays in the list until something is typed.
  const rows = chosen && !q.trim() && !list.rows.some(x => x.id === chosen.id) ? [chosen, ...list.rows] : list.rows
  const options = [
    ...(placeholder ? [{ value: '', label: placeholder }] : []),
    ...rows.map(x => ({ value: String(x.id), label: `${x.code} · ${x.property.title} · ${m.staffName(x.agentId)}` })),
  ]
  // onChange(id, the E-Form record) — its code for a "review changes" line.
  return <Select block plain label={label} value={value} onChange={v => onChange(v, rows.find(x => String(x.id) === v))} options={options} onSearch={setQ}
    more={Math.max(0, list.total - list.rows.length)} loading={list.loading || list.searching} />
}

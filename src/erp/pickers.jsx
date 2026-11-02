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

// An area by name (the name is the value), from the active areas, searched as you type.
export function AreaSelect({ value, onChange, label = 'Area', all, block, plain }) {
  const [q, setQ] = useState('')
  const list = useList('areas', { q, status: '0', sort: 'name', counts: '0' }, { pageSize: 50, branch: false })
  const names = list.rows.map(a => a.name)
  // The chosen one stays in the list until something is typed.
  const shown = value && !q.trim() && !names.includes(value) ? [value, ...names] : names
  const options = [...(all ? [{ value: '', label: all }] : []), ...shown.map(n => ({ value: n, label: n }))]
  return <Select block={block} plain={plain} label={label} value={value} onChange={onChange} options={options} onSearch={setQ}
    more={Math.max(0, list.total - list.rows.length)} loading={list.loading || list.searching} />
}

// An active building (title) to file listings under, other than `not`; those in `area` first.
export function TitlePicker({ value, onChange, area, not, placeholder = 'Select title' }) {
  const [q, setQ] = useState('')
  const list = useList('titles', { q, status: '0', sort: 'name', counts: '0' }, { pageSize: 50, branch: false })
  const rows = list.rows.filter(t => t.id !== not).sort((a, b) => (b.area === area) - (a.area === area))
  return <Select block plain label="Title" value={value} onChange={onChange} onSearch={setQ}
    options={[{ value: '', label: placeholder }, ...rows.map(t => ({ value: String(t.id), label: `${t.name} (${t.area})` }))]}
    more={Math.max(0, list.total - list.rows.length)} loading={list.loading || list.searching} />
}

// A listing on the market in the whole agency, free for this E-Form (`dealId`; none on it yet, or
// aborted), by code, title or holder. `chosen`: the listing picked, which stays in the list.
export function ListingPicker({ value, onChange, type, dealId, chosen }) {
  const { m } = useErp()
  const [q, setQ] = useState('')
  const list = useList('agency', { q, type, status: 'active', freeFor: dealId || 0, sort: '-created', counts: '0' }, { branch: false, pageSize: 30 })
  const rows = chosen && !q.trim() && !list.rows.some(x => x.id === chosen.id) ? [chosen, ...list.rows] : list.rows
  return <Select block plain label="Listing" value={value} onChange={v => onChange(v, rows.find(x => String(x.id) === v) || null)} onSearch={setQ}
    options={[{ value: '', label: 'Select the listing' }, ...rows.map(l => ({ value: String(l.id), label: `${l.code} · ${l.title}, ${l.area} · RM ${Number(l.askPrice || 0).toLocaleString('en-MY')} · ${m.staffName(l.holderId)}` }))]}
    more={Math.max(0, list.total - list.rows.length)} loading={list.loading || list.searching} />
}

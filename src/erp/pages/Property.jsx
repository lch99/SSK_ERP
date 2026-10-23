import { useMemo, useState } from 'react'
import { C, btn, btnPrimary, inp } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { VENDOR_STATUS, TITLE_STATUS, AREA_STATUS, LISTING_CATEGORY } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, DataTable, Status, Who, Link, Menu, Stat, Modal, FormField, TextArea, Notice, SelectionBar, cols, go, mono, small, field } from '../ui.jsx'
import { CARD, PAGE } from '../help.js'
import { STATES } from './options.js'
import { useFeedback } from '../feedback.jsx'
import { rm0, date, ago } from '../format.js'
import Icon from '../Icon.jsx'
import { useCan, useGate } from '../access.jsx'

// ── Vendor Requests: owners who asked us (through the public site) to list ──
export function VendorRequests() {
  const erp = useErp()
  const gate = useGate()
  const { m, scoped: d } = erp
  const [status, setStatus] = useState('')
  const [ticket, setTicket] = useState('')
  const [phone, setPhone] = useState('')
  const rows = d.vendorRequests.filter(v => (status === '' || v.status === Number(status)) && (!ticket || v.ticket.includes(ticket.toUpperCase())) &&
    (!phone || v.phone.replace(/\D/g, '').includes(phone.replace(/\D/g, ''))))
  const fb = useFeedback()
  const set = (v, s) => fb.run(() => erp.setVendorRequest(v.id, s), `${v.ticket} set to ${VENDOR_STATUS[s].label}`)
  const columns = [
    { key: 'ticket', label: 'Ticket Id', render: v => <b style={mono}>{v.ticket}</b> },
    { key: 'date', label: 'Date', nowrap: true, sort: v => v.date, render: v => <span>{date(v.date)}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{ago(v.date, m.today)}</span></span> },
    { key: 'from', label: 'From', render: v => <Who name={v.name} sub={v.phone} size={26} /> },
    { key: 'info', label: 'Property Info', render: v => (
      <span style={{ fontSize: 13 }}>{v.category} at {v.area}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>For {v.forType} · asking {rm0(v.price)}{v.forType === 'Rent' ? '/month' : ''}</span></span>
    ) },
    { key: 'handled', label: 'Handled by', render: v => (v.handledBy ? m.staffName(v.handledBy) : <span style={{ color: C.muted }}>Not assigned</span>) },
    { key: 'status', label: 'Status', render: v => <span>{<Status of={VENDOR_STATUS} value={v.status} />}{v.listingId && <span style={{ display: 'block', fontSize: 12 }}><Link to={`listings/${v.listingId}`} style={mono}>{m.listings[v.listingId]?.code}</Link></span>}</span> },
    { key: 'actions', label: '', render: v => (
      <Menu quiet items={[
        { label: 'Ongoing Follow-Up', icon: 'clock', disabled: v.status === 1, why: 'Already on follow-up', onClick: () => set(v, 1) },
        { label: 'Create Listing', icon: 'plus', disabled: v.status === 2, why: 'Listing created already', onClick: () => go(`listing-new?vr=${v.id}`) },
        '-',
        { label: 'Cancelled', icon: 'close', disabled: v.status === -1, why: 'Cancelled already', onClick: () => set(v, -1) },
        { label: 'Invalid', icon: 'ban', danger: true, disabled: v.status === -2, why: 'Marked invalid already', onClick: () => set(v, -2) },
      ].map(i => (i?.label ? gate(i, 'listings') : i))} />
    ) },
  ]
  return (
    <Page title="Owner requests" help={PAGE.vendor} sub="Owners (vendors) who asked us to list their property through the SubSaleKing site. Follow up, then create the listing.">
      <div style={{ ...cols(200, 14), marginBottom: 16 }}>
        {[0, 1, 2].map(s => <Stat key={s} label={VENDOR_STATUS[s].label} value={d.vendorRequests.filter(v => v.status === s).length} tone={VENDOR_STATUS[s].tone} onClick={() => setStatus(String(s))} />)}
      </div>
      <Card pad={16}>
        <Toolbar>
          <input style={{ ...inp, width: 160 }} value={ticket} onChange={e => setTicket(e.target.value)} placeholder="Ticket Id" aria-label="Ticket Id" />
          <input style={{ ...inp, width: 160 }} value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" aria-label="Phone" />
          <Select label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All' }, ...Object.entries(VENDOR_STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
        </Toolbar>
        <DataTable columns={columns} rows={rows} rowKey={v => v.id} defaultSort={{ key: 'date', dir: 'desc' }} narrowAt={900} empty="No vendor requests" />
      </Card>
    </Page>
  )
}

// ── Appointment: viewings booked from listing follow-ups ──
export function Appointments() {
  const { m, scoped: d } = useErp()
  const [tab, setTab] = useState('upcoming')
  const all = d.listings.flatMap(l => l.followUps.filter(f => f.appointment).map((f, i) => ({ id: `${l.id}-${i}`, l, f, at: `${f.appointment.date} ${f.appointment.time}` })))
  const rows = all.filter(a => (tab === 'upcoming' ? a.f.appointment.date >= m.today : a.f.appointment.date < m.today))
  const columns = [
    { key: 'at', label: 'Date · Time', sort: a => a.at, nowrap: true, render: a => <span><b>{date(a.f.appointment.date)}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{a.f.appointment.time}</span></span> },
    { key: 'listing', label: 'Listing', render: a => <span><Link to={`listings/${a.l.id}`} style={mono}>{a.l.code}</Link><span style={{ display: 'block', fontSize: 12.5 }}>{a.l.title}, {a.l.area}</span></span> },
    { key: 'agent', label: 'Agent', render: a => m.staffName(a.f.by) },
    { key: 'owner', label: 'Owner', render: a => <span style={{ fontSize: 13 }}>{a.l.owner.name}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{a.l.owner.phone}</span></span> },
    { key: 'remark', label: 'Remark', render: a => <span style={{ fontSize: 12.5, color: C.muted }}>{a.f.remark}</span> },
  ]
  return (
    <Page title="Viewings" help={PAGE.appointments} sub="Viewings booked from listing follow-ups.">
      <Card pad={16}>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'upcoming', label: 'Upcoming', count: all.filter(a => a.f.appointment.date >= m.today).length }, { key: 'past', label: 'Past', count: all.filter(a => a.f.appointment.date < m.today).length }]} />
        <DataTable columns={columns} rows={rows} defaultSort={{ key: 'at', dir: tab === 'upcoming' ? 'asc' : 'desc' }} narrowAt={820} empty="No appointments" />
      </Card>
    </Page>
  )
}

// ── Check Enquiry: messages from the website and app, with star and trash ──
export function Enquiries() {
  const erp = useErp()
  const editable = useCan()('listings', 'edit')
  const { m, scoped: d } = erp
  const [tab, setTab] = useState('inbox')
  const pick = { inbox: e => !e.trashed, star: e => e.starred && !e.trashed, trash: e => e.trashed }
  const rows = d.enquiries.filter(pick[tab])
  const fb = useFeedback()
  // Star and trash save at once; trash can be undone from the toast.
  const upd = (e, f) => fb.run(() => erp.updateEnquiry(e.id, f),
    'trashed' in f ? (f.trashed ? `Enquiry from ${e.name} moved to Trash` : `Enquiry from ${e.name} restored`) : (f.starred ? 'Starred' : 'Star removed'),
    'trashed' in f ? { action: { label: 'Undo', onClick: () => erp.updateEnquiry(e.id, { trashed: !f.trashed }) } } : undefined)
  const columns = [
    { key: 'date', label: 'Date', nowrap: true, sort: e => e.date, render: e => <span>{date(e.date)}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{e.via}</span></span> },
    { key: 'from', label: 'From', render: e => <Who name={e.name} sub={e.phone} size={26} /> },
    { key: 'listing', label: 'Listing', render: e => <span><Link to={`listings/${e.listingId}`} style={mono}>{m.listings[e.listingId]?.code}</Link><span style={{ display: 'block', fontSize: 12.5 }}>{m.listings[e.listingId]?.title}</span></span> },
    { key: 'msg', label: 'Message', render: e => <span style={{ fontSize: 13 }}>{e.message}</span> },
    { key: 'holder', label: 'Product Handler', render: e => m.staffName(m.listings[e.listingId]?.holderId) },
    { key: 'actions', label: '', render: e => editable && (
      <span style={{ display: 'inline-flex', gap: 6 }}>
        <button style={{ ...small, color: e.starred ? '#c98500' : C.muted }} aria-label={e.starred ? 'Unstar' : 'Star'} onClick={() => upd(e, { starred: !e.starred })}><Icon name="star" size={15} /></button>
        <button style={{ ...small, color: C.muted }} aria-label={e.trashed ? 'Restore' : 'Move to trash'} onClick={() => upd(e, { trashed: !e.trashed })}><Icon name={e.trashed ? 'refresh' : 'trash'} size={15} /></button>
      </span>
    ) },
  ]
  return (
    <Page title="Enquiries" help={PAGE.enquiries} sub="Enquiries on listings from the SubSaleKing website and app.">
      <Card pad={16}>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'inbox', label: 'Enquiry List', count: d.enquiries.filter(pick.inbox).length }, { key: 'star', label: 'Starred', count: d.enquiries.filter(pick.star).length }, { key: 'trash', label: 'Trash', count: d.enquiries.filter(pick.trash).length }]} />
        <DataTable columns={columns} rows={rows} defaultSort={{ key: 'date', dir: 'desc' }} narrowAt={900} empty="No enquiries here" />
      </Card>
    </Page>
  )
}

// ── Title Management: buildings and housing areas, with the request queue ──
const grid2 = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(200px, 100%), 1fr))' }

export function Titles() {
  const erp = useErp()
  const manage = useCan()('listings', 'full')
  const { m, scoped: d } = erp
  const fb = useFeedback()
  const [tab, setTab] = useState('list')
  const [q, setQ] = useState('')
  const [cate, setCate] = useState('')
  const [area, setArea] = useState('')
  const [picked, setPicked] = useState(new Set())
  const [edit, setEdit] = useState(null)          // the title form, or null
  const [removing, setRemoving] = useState(null)  // { title, to }
  const [error, setError] = useState(null)
  const counts = useMemo(() => {
    const c = {}
    for (const l of m.data.listings) c[l.titleId] = (c[l.titleId] || 0) + 1
    return c
  }, [m])
  const inTab = t => (tab === 'list' ? t.status === 0 || t.status === 3 : t.status === 1 || t.status === 2)
  const rows = d.titles.filter(t => inTab(t) && (!cate || t.category === Number(cate)) && (!area || t.area === area) &&
    (!q || `${t.name} ${t.area}`.toLowerCase().includes(q.toLowerCase())))
  const areaNames = [...new Set(m.data.areas.filter(a => a.status === 0).map(a => a.name))].sort()
  const staff = m.data.staff.filter(s => s.status === 'active').sort((a, b) => a.short.localeCompare(b.short))
  const people = first => [{ value: '', label: first }, ...staff.map(s => ({ value: String(s.id), label: `${s.short} (${s.code})` }))]
  const setStatus = (ids, status, done) => fb.run(() => erp.setTitleStatus(ids, status), done).then(ok => ok && setPicked(new Set()))
  const save = async () => {
    setError(null)
    try { await erp.saveTitle(edit); fb.toast(edit.id ? `${edit.name} saved` : `${edit.name} added to the database`); setEdit(null) } catch (e) { setError(e.message) }
  }
  const remove = async () => {
    setError(null)
    try { await erp.deleteTitle(removing.title.id, removing.to); fb.toast(`${removing.title.name} deleted`); setRemoving(null) } catch (e) { setError(e.message) }
  }
  const startEdit = t => { setError(null); setEdit(t ? { id: t.id, name: t.name, area: t.area, category: String(t.category), handlerId: t.handlerId ? String(t.handlerId) : '', managerId: t.managerId ? String(t.managerId) : '', remark: t.remark || '' }
    : { name: '', area: areaNames[0] || '', category: '2', handlerId: '', managerId: '', remark: '' }) }
  const columns = [
    { key: 'name', label: 'Title', sort: t => t.name, render: t => <span><b>{t.name}</b>{t.remark && <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{t.remark}</span>}</span> },
    { key: 'cate', label: 'Category', render: t => LISTING_CATEGORY[t.category] },
    { key: 'area', label: 'Area · State', sort: t => t.area, render: t => <span>{t.area}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{t.state}</span></span> },
    tab === 'list'
      ? { key: 'handler', label: 'Manager · Handler', render: t => <span style={{ fontSize: 13 }}>{t.managerId ? m.staffName(t.managerId) : '—'}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{t.handlerId ? m.staffName(t.handlerId) : 'No handler'}</span></span> }
      : { key: 'by', label: 'Create By', render: t => <span style={{ fontSize: 13 }}>{m.staffName(t.requestedBy)}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{t.requestedOn ? date(t.requestedOn) : ''}</span></span> },
    { key: 'count', label: 'Listings', align: 'right', sort: t => counts[t.id] || 0, render: t => counts[t.id] || 0 },
    { key: 'status', label: 'Status', render: t => <Status of={TITLE_STATUS} value={t.status} /> },
    { key: 'actions', label: '', card: false, render: t => manage && (
      <Menu quiet items={tab === 'list' ? [
        { label: 'Edit Title', icon: 'edit', onClick: () => startEdit(t) },
        t.status === 0 ? { label: 'Disable Title', icon: 'ban', onClick: () => setStatus([t.id], 3, `${t.name} disabled`) } : { label: 'Enable Title', icon: 'check', onClick: () => setStatus([t.id], 0, `${t.name} enabled`) },
        '-',
        { label: 'Delete Title', icon: 'trash', danger: true, onClick: () => { setError(null); setRemoving({ title: t, to: '' }) } },
      ] : [
        { label: 'Approve', icon: 'check', disabled: t.status === 0, onClick: () => setStatus([t.id], 0, `${t.name} approved`) },
        { label: 'Reject', icon: 'ban', danger: true, disabled: t.status === 2, why: 'Rejected already', onClick: () => setStatus([t.id], 2, `${t.name} rejected`) },
        { label: 'Edit request', icon: 'edit', onClick: () => startEdit(t) },
      ]} />
    ) },
  ]
  const replacements = removing ? m.data.titles.filter(t => t.status === 0 && t.id !== removing.title.id && t.area === removing.title.area) : []
  const otherReplacements = removing ? m.data.titles.filter(t => t.status === 0 && t.id !== removing.title.id && t.area !== removing.title.area) : []
  return (
    <Page title="Buildings & estates" help={PAGE.titles} sub="Buildings and housing estates that listings are filed under. Agents request new titles; admins approve them."
      actions={manage && <button style={btnPrimary} onClick={() => startEdit(null)}>Create New Title</button>}>
      <Card pad={16}>
        <Tabs value={tab} onChange={v => { setTab(v); setPicked(new Set()) }} tabs={[{ key: 'list', label: 'Titles', count: d.titles.filter(t => t.status === 0 || t.status === 3).length },
          { key: 'requests', label: 'Title Requests', count: d.titles.filter(t => t.status === 1).length }]} />
        <Toolbar fold active={[cate, area].filter(Boolean).length} onClear={() => { setQ(''); setCate(''); setArea('') }}>
          <SearchBox value={q} onChange={setQ} placeholder="Title or area" />
          <Select label="Area" value={area} onChange={setArea} options={[{ value: '', label: 'All areas' }, ...areaNames.map(a => ({ value: a, label: a }))]} />
          <Select label="Category" value={cate} onChange={setCate} options={[{ value: '', label: 'All categories' }, ...Object.entries(LISTING_CATEGORY).map(([value, label]) => ({ value, label }))]} />
        </Toolbar>
        {tab === 'requests' && <p style={{ fontSize: 13, color: C.muted, margin: '0 0 10px' }}>{CARD.titleRequests} Tick several to approve them at once.</p>}
        <DataTable columns={columns} rows={rows} defaultSort={{ key: tab === 'list' ? 'count' : 'name', dir: 'desc' }} narrowAt={820} empty="No titles here"
          selection={tab === 'requests' && manage ? { selected: picked, onChange: setPicked, can: t => t.status === 1 } : null} />
        <SelectionBar count={picked.size} onClear={() => setPicked(new Set())}>
          <button style={small} onClick={() => setStatus([...picked], 2, `${picked.size} request${picked.size > 1 ? 's' : ''} rejected`)}>Reject</button>
          <button style={{ ...small, ...btnPrimary, fontSize: 13, padding: '5px 12px' }} onClick={() => setStatus([...picked], 0, `${picked.size} title${picked.size > 1 ? 's' : ''} approved`)}>Approve</button>
        </SelectionBar>
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit Title · ${edit.name}` : 'Add New Title to Database'} width={560}
        footer={<><button style={btn} onClick={() => setEdit(null)}>Cancel</button><button style={btnPrimary} onClick={save}>{edit?.id ? 'Save' : 'Create'}</button></>}>
        {error && <Notice tone="red">{error}</Notice>}
        {edit && (
          <div style={grid2}>
            <FormField label="Title name" required wide><input style={field} value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Residensi Harmoni" autoFocus /></FormField>
            <FormField label="Area" required><Select block plain label="Area" value={edit.area} onChange={v => setEdit({ ...edit, area: v })} options={areaNames.map(a => ({ value: a, label: a }))} /></FormField>
            <FormField label="Category"><Select block plain label="Category" value={edit.category} onChange={v => setEdit({ ...edit, category: v })} options={Object.entries(LISTING_CATEGORY).map(([value, label]) => ({ value, label }))} /></FormField>
            <FormField label="Title Manager"><Select block plain label="Manager" value={edit.managerId} onChange={v => setEdit({ ...edit, managerId: v })} options={people('No manager')} /></FormField>
            <FormField label="Title Handler (Project Handler)" help="New listings under this title get them as project handler"><Select block plain label="Handler" value={edit.handlerId} onChange={v => setEdit({ ...edit, handlerId: v })} options={people('No handler')} /></FormField>
            <FormField label="Remark" wide><TextArea value={edit.remark} onChange={e => setEdit({ ...edit, remark: e.target.value })} /></FormField>
          </div>
        )}
      </Modal>
      <Modal open={!!removing} onClose={() => setRemoving(null)} title={removing ? `Delete Title · ${removing.title.name}` : ''}
        footer={<><button style={btn} onClick={() => setRemoving(null)}>Cancel</button><button style={{ ...btn, background: C.err, borderColor: C.err, color: '#fff' }} onClick={remove}>Delete</button></>}>
        {error && <Notice tone="red">{error}</Notice>}
        {removing && (counts[removing.title.id] ? (
          <>
            <p style={{ fontSize: 13.5, marginTop: 0 }}><b>{counts[removing.title.id]} listing{counts[removing.title.id] > 1 ? 's are' : ' is'}</b> filed under {removing.title.name}. Pick the title to move {counts[removing.title.id] > 1 ? 'them' : 'it'} to.</p>
            <FormField label="Replacement title" required>
              <Select block plain label="Replacement" value={removing.to} onChange={v => setRemoving({ ...removing, to: v })}
                options={[{ value: '', label: 'Select title' }, ...[...replacements, ...otherReplacements].map(t => ({ value: String(t.id), label: `${t.name} (${t.area})` }))]} />
            </FormField>
          </>
        ) : <p style={{ fontSize: 13.5, margin: 0 }}>No listings use this title. It will be removed.</p>)}
      </Modal>
    </Page>
  )
}

// ── Area Management ──
export function Areas() {
  const erp = useErp()
  const manage = useCan()('listings', 'full')
  const { m, scoped: d, setup } = erp
  const fb = useFeedback()
  const [tab, setTab] = useState('list')
  const [q, setQ] = useState('')
  const [state, setState] = useState('')
  const [edit, setEdit] = useState(null)
  const [error, setError] = useState(null)
  const counts = {}
  for (const l of m.data.listings) counts[l.area] = (counts[l.area] || 0) + 1
  const rows = d.areas.filter(a => (tab === 'list' ? a.status !== 2 : a.status === 2) && (!state || a.state === state) && (!q || a.name.toLowerCase().includes(q.toLowerCase())))
  const states = [...new Set(m.data.areas.map(a => a.state))].sort()
  const leaders = m.data.staff.filter(s => s.status === 'active').sort((a, b) => (b.role ? 1 : 0) - (a.role ? 1 : 0) || a.short.localeCompare(b.short))
  const save = async () => {
    setError(null)
    try { await erp.saveArea(edit); fb.toast(edit.id ? `${edit.name} saved` : `${edit.name} added`); setEdit(null) } catch (e) { setError(e.message) }
  }
  const remove = async a => {
    if (await fb.confirm({ title: `Delete ${a.name}?`, body: 'The area is removed from the list.', confirmLabel: 'Delete', danger: true })) fb.run(() => erp.deleteArea(a.id), `${a.name} deleted`)
  }
  const startEdit = a => { setError(null); setEdit(a ? { id: a.id, name: a.name, state: a.state, branchId: String(a.branchId), managerId: a.managerId ? String(a.managerId) : '' }
    : { name: '', state: states[0] || 'Selangor', branchId: String(setup.branches[0]?.id || ''), managerId: '' }) }
  const columns = [
    { key: 'name', label: 'Name', sort: a => a.name, render: a => <b>{a.name}</b> },
    { key: 'state', label: 'State', render: a => a.state },
    { key: 'branch', label: 'Branch', render: a => m.branchName(a.branchId) },
    tab === 'list' ? { key: 'manager', label: 'Area Manager', render: a => (a.managerId ? m.staffName(a.managerId) : <span style={{ color: C.muted }}>No manager</span>) }
      : { key: 'by', label: 'Requested by', render: a => <span>{m.staffName(a.requestedBy)}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{a.requestedOn ? date(a.requestedOn) : ''}</span></span> },
    { key: 'count', label: 'Listings', align: 'right', sort: a => counts[a.name] || 0, render: a => counts[a.name] || 0 },
    { key: 'status', label: 'Status', render: a => <Status of={AREA_STATUS} value={a.status} /> },
    { key: 'actions', label: '', card: false, render: a => manage && (
      <Menu quiet items={tab === 'list' ? [
        { label: 'Edit Area', icon: 'edit', onClick: () => startEdit(a) },
        a.status === 0 ? { label: 'Disable Area', icon: 'ban', onClick: () => fb.run(() => erp.setAreaStatus(a.id, 1), `${a.name} disabled`) }
          : { label: 'Enable Area', icon: 'check', onClick: () => fb.run(() => erp.setAreaStatus(a.id, 0), `${a.name} enabled`) },
        '-',
        { label: 'Delete Area', icon: 'trash', danger: true, onClick: () => remove(a) },
      ] : [
        { label: 'Approve', icon: 'check', onClick: () => fb.run(() => erp.setAreaStatus(a.id, 0), `${a.name} approved`) },
        { label: 'Edit request', icon: 'edit', onClick: () => startEdit(a) },
        { label: 'Reject', icon: 'ban', danger: true, onClick: () => fb.run(() => erp.deleteArea(a.id), `${a.name} rejected`) },
      ]} />
    ) },
  ]
  return (
    <Page title="Areas" help={PAGE.areas} sub="Areas listings and titles belong to, and who manages each." actions={manage && <button style={btnPrimary} onClick={() => startEdit(null)}>Add Area</button>}>
      <Card pad={16}>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'list', label: 'Areas', count: d.areas.filter(a => a.status !== 2).length }, { key: 'requests', label: 'Area Requests', count: d.areas.filter(a => a.status === 2).length }]} />
        <Toolbar>
          <SearchBox value={q} onChange={setQ} placeholder="Area name" />
          <Select label="State" value={state} onChange={setState} options={[{ value: '', label: 'All states' }, ...states.map(x => ({ value: x, label: x }))]} />
        </Toolbar>
        {tab === 'requests' && <p style={{ fontSize: 13, color: C.muted, margin: '0 0 10px' }}>{CARD.areaRequests}</p>}
        <DataTable columns={columns} rows={rows} defaultSort={{ key: 'count', dir: 'desc' }} narrowAt={720} empty={tab === 'requests' ? 'No area requests waiting' : 'No areas match'} />
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit Area · ${edit.name}` : 'Add Area'}
        footer={<><button style={btn} onClick={() => setEdit(null)}>Cancel</button><button style={btnPrimary} onClick={save}>{edit?.id ? 'Save' : 'Add'}</button></>}>
        {error && <Notice tone="red">{error}</Notice>}
        {edit && (
          <div style={grid2}>
            <FormField label="Area name" required wide><input style={field} value={edit.name} autoFocus onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Taman Desa" /></FormField>
            <FormField label="State"><Select block plain label="State" value={edit.state} onChange={v => setEdit({ ...edit, state: v })} options={[...new Set([...states, ...STATES])].map(x => ({ value: x, label: x }))} /></FormField>
            <FormField label="Branch"><Select block plain label="Branch" value={edit.branchId} onChange={v => setEdit({ ...edit, branchId: v })} options={setup.branches.map(b => ({ value: String(b.id), label: b.name }))} /></FormField>
            <FormField label="Area Manager" wide><Select block plain label="Manager" value={edit.managerId} onChange={v => setEdit({ ...edit, managerId: v })}
              options={[{ value: '', label: 'No manager' }, ...leaders.map(s => ({ value: String(s.id), label: `${s.short}${s.role ? ` (${s.role})` : ''} ${s.code}` }))]} /></FormField>
          </div>
        )}
      </Modal>
    </Page>
  )
}

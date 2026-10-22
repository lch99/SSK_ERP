import { useMemo, useState } from 'react'
import { C, inp } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { VENDOR_STATUS, TITLE_STATUS, LISTING_CATEGORY } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, DataTable, Status, Who, Link, Menu, Stat, cols, go, mono, small } from '../ui.jsx'
import { PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { rm0, date, ago } from '../format.js'
import Icon from '../Icon.jsx'

// ── Vendor Requests: owners who asked us (through the public site) to list ──
export function VendorRequests() {
  const erp = useErp()
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
        { label: 'Create Listing', icon: 'plus', disabled: v.status === 2, why: 'Listing created already', onClick: () => { set(v, 2); go('listing-new') } },
        '-',
        { label: 'Cancelled', icon: 'close', disabled: v.status === -1, why: 'Cancelled already', onClick: () => set(v, -1) },
        { label: 'Invalid', icon: 'ban', danger: true, disabled: v.status === -2, why: 'Marked invalid already', onClick: () => set(v, -2) },
      ]} />
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
    { key: 'actions', label: '', render: e => (
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
export function Titles() {
  const { m, scoped: d } = useErp()
  const [tab, setTab] = useState('list')
  const [q, setQ] = useState('')
  const [cate, setCate] = useState('')
  const counts = useMemo(() => {
    const c = {}
    for (const l of m.data.listings) c[l.titleId] = (c[l.titleId] || 0) + 1
    return c
  }, [m])
  const rows = d.titles.filter(t => (tab === 'list' ? t.status === 0 : t.status !== 0) && (!cate || t.category === Number(cate)) &&
    (!q || `${t.name} ${t.area}`.toLowerCase().includes(q.toLowerCase())))
  const columns = [
    { key: 'name', label: 'Title', sort: t => t.name, render: t => <b>{t.name}</b> },
    { key: 'cate', label: 'Category', render: t => LISTING_CATEGORY[t.category] },
    { key: 'area', label: 'Area · State', sort: t => t.area, render: t => <span>{t.area}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{t.state}</span></span> },
    { key: 'handler', label: tab === 'list' ? 'Project Handler' : 'Requested by', render: t => m.staffName(tab === 'list' ? t.handlerId : t.requestedBy) },
    { key: 'count', label: tab === 'list' ? 'Listings' : 'Requested', align: 'right', sort: t => counts[t.id] || 0, render: t => (tab === 'list' ? counts[t.id] || 0 : date(t.requestedOn)) },
    { key: 'status', label: 'Status', render: t => <Status of={TITLE_STATUS} value={t.status} /> },
  ]
  return (
    <Page title="Buildings & estates" help={PAGE.titles} sub="Buildings and housing estates that listings are filed under. Agents request new titles; admins approve them.">
      <Card pad={16}>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'list', label: 'Titles', count: d.titles.filter(t => t.status === 0).length }, { key: 'requests', label: 'Title Requests', count: d.titles.filter(t => t.status !== 0).length }]} />
        <Toolbar>
          <SearchBox value={q} onChange={setQ} placeholder="Title or area" />
          <Select label="Category" value={cate} onChange={setCate} options={[{ value: '', label: 'All categories' }, ...Object.entries(LISTING_CATEGORY).map(([value, label]) => ({ value, label }))]} />
        </Toolbar>
        <DataTable columns={columns} rows={rows} defaultSort={{ key: tab === 'list' ? 'count' : 'name', dir: 'desc' }} narrowAt={760} empty="No titles here" />
      </Card>
    </Page>
  )
}

// ── Area Management ──
export function Areas() {
  const { m, scoped: d } = useErp()
  const counts = {}
  for (const l of m.data.listings) counts[l.area] = (counts[l.area] || 0) + 1
  const columns = [
    { key: 'name', label: 'Name', sort: a => a.name, render: a => <b>{a.name}</b> },
    { key: 'state', label: 'State', render: a => a.state },
    { key: 'branch', label: 'Branch', render: a => m.branchName(a.branchId) },
    { key: 'manager', label: 'Manager', render: a => m.staffName(a.managerId) },
    { key: 'count', label: 'Listings', align: 'right', sort: a => counts[a.name] || 0, render: a => counts[a.name] || 0 },
    { key: 'status', label: 'Status', render: a => <Status of={{ 0: { label: 'Approved', tone: 'green' }, 1: { label: 'Disabled', tone: 'gray' } }} value={a.status} /> },
  ]
  return (
    <Page title="Areas" help={PAGE.areas} sub="Areas listings and titles belong to, and who manages each.">
      <Card pad={16}><DataTable columns={columns} rows={d.areas} defaultSort={{ key: 'count', dir: 'desc' }} narrowAt={680} /></Card>
    </Page>
  )
}


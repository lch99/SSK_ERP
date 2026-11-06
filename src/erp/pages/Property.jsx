import { useState } from 'react'
import * as L from '../../../shared/listings.js'
import { C, btn, btnPrimary } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { useList } from '../useList.js'
import { AreaSelect, TitlePicker, StaffPicker } from '../pickers.jsx'
import { VENDOR_STATUS, TITLE_STATUS, AREA_STATUS, LISTING_CATEGORY } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, DataTable, Status, Pill, Who, Link, Menu, Stat, Modal, FormField, TextArea, Notice, SelectionBar, cols, go, mono, small, field } from '../ui.jsx'
import { CARD, COLUMN, PAGE } from '../help.js'
import { STATES } from './options.js'
import { useFeedback } from '../feedback.jsx'
import { rm0, rmShort, date, ago } from '../format.js'
import Icon from '../Icon.jsx'
import { useCan, useGate } from '../access.jsx'
import { FavStar } from '../listingLife.jsx'

// ── Vendor Requests: owners who asked us (through the public site) to list ──
// A page at a time (useList); one search for the ticket id, the owner or their phone number (by its digits).
export function VendorRequests() {
  const erp = useErp()
  const gate = useGate()
  const { m } = erp
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('-date')
  const list = useList('vendorRequests', { q, status, sort })
  const byStatus = list.counts.status || {}
  const fb = useFeedback()
  const set = (v, s) => fb.run(() => erp.setVendorRequest(v.id, s), `${v.ticket} set to ${VENDOR_STATUS[s].label}`)
  const columns = [
    { key: 'ticket', label: 'Ticket Id', render: v => <b style={mono}>{v.ticket}</b> },
    { key: 'date', label: 'Date', nowrap: true, sortKey: 'date', render: v => <span>{date(v.date)}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{ago(v.date, m.today)}</span></span> },
    { key: 'from', label: 'From', render: v => <Who name={v.name} sub={v.phone} size={26} /> },
    { key: 'info', label: 'Property Info', render: v => (
      <span style={{ fontSize: 13 }}>{v.category} at {v.area}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>For {v.forType} · asking {rm0(v.price)}{v.forType === 'Rent' ? '/month' : ''}</span></span>
    ) },
    { key: 'handled', label: 'Handled by', render: v => (v.handledBy ? m.staffName(v.handledBy) : <span style={{ color: C.muted }}>Not assigned</span>) },
    { key: 'status', label: 'Status', render: v => <span>{<Status of={VENDOR_STATUS} value={v.status} />}{v.listingId && <span style={{ display: 'block', fontSize: 12 }}><Link to={`listings/${v.listingId}`} style={mono}>{v.$.listingCode}</Link></span>}</span> },
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
        {[0, 1, 2].map(s => <Stat key={s} label={VENDOR_STATUS[s].label} value={byStatus[s] || 0} tone={VENDOR_STATUS[s].tone} onClick={() => setStatus(String(s))} on={status === String(s)} />)}
      </div>
      <Card pad={16}>
        <Toolbar>
          <SearchBox value={q} onChange={setQ} placeholder="Ticket Id, owner or phone" />
          <Select label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...Object.entries(VENDOR_STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
        </Toolbar>
        {list.error && <Notice tone="red">{list.error}</Notice>}
        <DataTable columns={columns} rows={list.rows} rowKey={v => v.id} narrowAt={900} paged={{ total: list.total, sort, onSort: setSort, onMore: list.more, loading: list.loading }}
          empty={list.loading ? 'Loading…' : q ? `No owner requests match “${q}”` : 'No vendor requests'} onClear={q || status ? () => { setQ(''); setStatus('') } : undefined} />
      </Card>
    </Page>
  )
}

// ── Check Enquiry: messages from the website and app, with star and trash ──
// A page at a time (useList): each tab is a filter, counted by the server.
const ENQUIRY_TABS = { inbox: { trashed: 'false' }, star: { starred: 'true', trashed: 'false' }, trash: { trashed: 'true' } }
export function Enquiries() {
  const erp = useErp()
  const editable = useCan()('listings', 'edit')
  const { m } = erp
  const [tab, setTab] = useState('inbox')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('-date')
  const list = useList('enquiries', { q, sort, ...ENQUIRY_TABS[tab] })
  const fb = useFeedback()
  // Star and trash save at once; trash can be undone from the toast.
  const upd = (e, f) => fb.run(() => erp.updateEnquiry(e.id, f),
    'trashed' in f ? (f.trashed ? `Enquiry from ${e.name} moved to Trash` : `Enquiry from ${e.name} restored`) : (f.starred ? 'Starred' : 'Star removed'),
    'trashed' in f ? { action: { label: 'Undo', onClick: () => erp.updateEnquiry(e.id, { trashed: !f.trashed }) } } : undefined)
  const columns = [
    { key: 'date', label: 'Date', nowrap: true, sortKey: 'date', render: e => <span>{date(e.date)}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{e.via}</span></span> },
    { key: 'from', label: 'From', render: e => <Who name={e.name} sub={e.phone} size={26} /> },
    { key: 'listing', label: 'Listing', render: e => <span><Link to={`listings/${e.listingId}`} style={mono}>{e.$.listing?.code}</Link><span style={{ display: 'block', fontSize: 12.5 }}>{e.$.listing?.title}</span></span> },
    { key: 'msg', label: 'Message', render: e => <span style={{ fontSize: 13 }}>{e.message}</span> },
    { key: 'holder', label: 'Product Handler', render: e => m.staffName(e.$.listing?.holderId) },
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
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'inbox', label: 'Enquiry List', count: list.counts.inbox?.n || 0 }, { key: 'star', label: 'Starred', count: list.counts.star?.n || 0 }, { key: 'trash', label: 'Trash', count: list.counts.trash?.n || 0 }]} />
        <Toolbar><SearchBox value={q} onChange={setQ} placeholder="Name, phone or message" /></Toolbar>
        {list.error && <Notice tone="red">{list.error}</Notice>}
        <DataTable columns={columns} rows={list.rows} narrowAt={900} paged={{ total: list.total, sort, onSort: setSort, onMore: list.more, loading: list.loading }}
          empty={list.loading ? 'Loading…' : q ? `No enquiries match “${q}”` : 'No enquiries here'} onClear={q ? () => setQ('') : undefined} />
      </Card>
    </Page>
  )
}

// ── Title Management: buildings and housing areas, with the request queue ──
const grid2 = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(200px, 100%), 1fr))' }

// A page at a time (useList): each title carries how many listings it has and its leads' rankings.
const TITLE_TABS = { list: { status: '0,3', sort: '-listings' }, requests: { status: '1,2', sort: '-requestedOn' } }
export function Titles() {
  const erp = useErp()
  const manage = useCan()('listings', 'full')
  const { m } = erp
  const fb = useFeedback()
  const [tab, setTab] = useState('list')
  const [q, setQ] = useState('')
  const [cate, setCate] = useState('')
  const [area, setArea] = useState('')
  const [sort, setSort] = useState(null)
  const [picked, setPicked] = useState(new Set())
  const [edit, setEdit] = useState(null)          // the title form, or null
  const [removing, setRemoving] = useState(null)  // { title, to }
  const [error, setError] = useState(null)
  const order = sort || TITLE_TABS[tab].sort
  const list = useList('titles', { q, category: cate, area, status: TITLE_TABS[tab].status, sort: order })
  const byStatus = list.counts.status || {}
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
    : { name: '', area: '', category: '2', handlerId: '', managerId: '', remark: '' }) }
  const columns = [
    { key: 'name', label: 'Title', sortKey: 'name', render: t => (
      <span style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {tab === 'list' && <FavStar kind="titles" id={t.id} size={14} />}
        <span><b>{t.name}</b>{t.remark && <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{t.remark}</span>}</span>
      </span>
    ) },
    { key: 'cate', label: 'Category', render: t => LISTING_CATEGORY[t.category] },
    { key: 'area', label: 'Area · State', sortKey: 'area', render: t => <span>{t.area}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{t.state}</span></span> },
    tab === 'list'
      ? { key: 'handler', label: 'Project Manager · Project Handler', help: COLUMN.buildingLeads, render: t => <Leads t={t} ranking={t.$.ranking} m={m} /> }
      : { key: 'by', label: 'Create By', render: t => <span style={{ fontSize: 13 }}>{m.staffName(t.requestedBy)}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{t.requestedOn ? date(t.requestedOn) : ''}</span></span> },
    { key: 'count', label: 'Listings', align: 'right', sortKey: 'listings', render: t => t.$.listings },
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
  const recheck = async () => {
    const st = await fb.run(() => erp.recheckBuildingLeads())
    if (st) { const n = st.data.runs?.leads?.changed || 0; fb.toast(n ? `${n} building lead${n > 1 ? 's' : ''} changed; each new lead is told` : 'Checked every building: no lead changes') }
  }
  const listed = removing?.title.$.listings || 0
  return (
    <Page title="Buildings & estates" help={PAGE.titles} sub="Buildings and housing estates that listings are filed under. Agents request new titles; admins approve them."
      actions={manage && <><button style={btn} onClick={recheck} title="Hand each building to the product handler the rules pick">Re-check leads</button><button style={btnPrimary} onClick={() => startEdit(null)}>Create New Title</button></>}>
      <Card pad={16}>
        <Tabs value={tab} onChange={v => { setTab(v); setSort(null); setPicked(new Set()) }} tabs={[{ key: 'list', label: 'Titles', count: (byStatus[0] || 0) + (byStatus[3] || 0) },
          { key: 'requests', label: 'Title Requests', count: byStatus[1] || 0 }]} />
        <Toolbar fold onClear={() => { setQ(''); setCate(''); setArea('') }}>
          <SearchBox value={q} onChange={setQ} placeholder="Title or area" />
          <AreaSelect value={area} onChange={setArea} all="All areas" />
          <Select label="Category" value={cate} onChange={setCate} options={[{ value: '', label: 'All categories' }, ...Object.entries(LISTING_CATEGORY).map(([value, label]) => ({ value, label }))]} />
        </Toolbar>
        {tab === 'requests' && <p style={{ fontSize: 13, color: C.muted, margin: '0 0 10px' }}>{CARD.titleRequests} Tick several to approve them at once.</p>}
        {list.error && <Notice tone="red">{list.error}</Notice>}
        <DataTable columns={columns} rows={list.rows} narrowAt={820} paged={{ total: list.total, sort: order, onSort: setSort, onMore: list.more, loading: list.loading }}
          empty={list.loading ? 'Loading…' : 'No titles here'} onClear={q || cate || area ? () => { setQ(''); setCate(''); setArea('') } : undefined}
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
            <FormField label="Area" required><AreaSelect block plain value={edit.area} onChange={v => setEdit({ ...edit, area: v })} all="Select area" /></FormField>
            <FormField label="Category"><Select block plain label="Category" value={edit.category} onChange={v => setEdit({ ...edit, category: v })} options={Object.entries(LISTING_CATEGORY).map(([value, label]) => ({ value, label }))} /></FormField>
            <FormField label="Project Manager (sales)" help={`Taken over by whoever passes ${rmShort(L.LISTING_RULES.projectManager.win)} in full-closed sales here`}><StaffPicker block plain label="Manager" value={edit.managerId} onChange={v => setEdit({ ...edit, managerId: v })} filters={{ status: 'active' }} branch={false} all="No manager" show={s => `${s.short} (${s.code})`} /></FormField>
            <FormField label="Project Handler (rentals)" help={`Taken over by whoever holds the key to ${L.LISTING_RULES.projectHandler.win}+ rentals here`}><StaffPicker block plain label="Handler" value={edit.handlerId} onChange={v => setEdit({ ...edit, handlerId: v })} filters={{ status: 'active' }} branch={false} all="No handler" show={s => `${s.short} (${s.code})`} /></FormField>
            <FormField label="Remark" wide><TextArea value={edit.remark} onChange={e => setEdit({ ...edit, remark: e.target.value })} /></FormField>
          </div>
        )}
      </Modal>
      <Modal open={!!removing} onClose={() => setRemoving(null)} title={removing ? `Delete Title · ${removing.title.name}` : ''}
        footer={<><button style={btn} onClick={() => setRemoving(null)}>Cancel</button><button style={{ ...btn, background: C.err, borderColor: C.err, color: '#fff' }} onClick={remove}>Delete</button></>}>
        {error && <Notice tone="red">{error}</Notice>}
        {removing && (listed ? (
          <>
            <p style={{ fontSize: 13.5, marginTop: 0 }}><b>{listed} listing{listed > 1 ? 's are' : ' is'}</b> filed under {removing.title.name}. Pick the title to move {listed > 1 ? 'them' : 'it'} to.</p>
            <FormField label="Replacement title" required>
              <TitlePicker value={removing.to} onChange={v => setRemoving({ ...removing, to: v })} area={removing.title.area} not={removing.title.id} />
            </FormField>
          </>
        ) : <p style={{ fontSize: 13.5, margin: 0 }}>No listings use this title. It will be removed.</p>)}
      </Modal>
    </Page>
  )
}

// A building's two leads, each with how far the top product handler is from
// taking over (or that the post is theirs for good).
function Leads({ t, ranking, m }) {
  const line = (kind, id, permanent, rule, unit, goal) => {
    const top = ranking?.[kind]?.[0]
    const challenger = top && top.staffId !== id ? top : null
    const own = ranking?.[kind]?.find(r => r.staffId === id)
    return (
      <span style={{ display: 'block', fontSize: 13 }}>
        <span style={{ color: C.muted, fontSize: 12 }}>{kind === 'sale' ? 'PM ' : 'PH '}</span>{id ? m.staffName(id) : '—'}
        {permanent && <Pill tone="violet" dot={false} style={{ fontSize: 10.5, marginLeft: 6 }}>For good</Pill>}
        <span style={{ display: 'block', fontSize: 12, color: C.muted }}>
          {permanent ? `Passed ${goal(rule.keep)}` : challenger ? `${m.staffName(challenger.staffId)} leads with ${unit(challenger.n)} of ${goal(rule.win)}` : own ? `${unit(own.n)} of ${goal(rule.win)} to keep it` : 'Nobody close yet'}
        </span>
      </span>
    )
  }
  return (
    <span style={{ display: 'grid', gap: 4 }}>
      {line('sale', t.managerId, t.managerPermanent, L.LISTING_RULES.projectManager, rmShort, rmShort)}
      {line('rental', t.handlerId, t.handlerPermanent, L.LISTING_RULES.projectHandler, n => `${n} key${n === 1 ? '' : 's'}`, n => `${n} keys`)}
    </span>
  )
}

// ── Area Management ──
// A page at a time (useList): each area carries how many listings have its name.
export function Areas() {
  const erp = useErp()
  const manage = useCan()('listings', 'full')
  const { m, setup } = erp
  const fb = useFeedback()
  const [tab, setTab] = useState('list')
  const [q, setQ] = useState('')
  const [state, setState] = useState('')
  const [sort, setSort] = useState('-listings')
  const [edit, setEdit] = useState(null)
  const [error, setError] = useState(null)
  const list = useList('areas', { q, state, sort, status: tab === 'list' ? '0,1' : '2' })
  const byStatus = list.counts.status || {}
  const states = Object.keys(list.counts.state || {}).sort()
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
    { key: 'name', label: 'Name', sortKey: 'name', render: a => <b>{a.name}</b> },
    { key: 'state', label: 'State', render: a => a.state },
    { key: 'branch', label: 'Branch', render: a => m.branchName(a.branchId) },
    tab === 'list' ? { key: 'manager', label: 'Area Manager', render: a => (a.managerId ? m.staffName(a.managerId) : <span style={{ color: C.muted }}>No manager</span>) }
      : { key: 'by', label: 'Requested by', render: a => <span>{m.staffName(a.requestedBy)}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{a.requestedOn ? date(a.requestedOn) : ''}</span></span> },
    { key: 'count', label: 'Listings', align: 'right', sortKey: 'listings', render: a => a.$.listings },
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
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'list', label: 'Areas', count: (byStatus[0] || 0) + (byStatus[1] || 0) }, { key: 'requests', label: 'Area Requests', count: byStatus[2] || 0 }]} />
        <Toolbar>
          <SearchBox value={q} onChange={setQ} placeholder="Area name" />
          <Select label="State" value={state} onChange={setState} options={[{ value: '', label: 'All states' }, ...states.map(x => ({ value: x, label: x }))]} />
        </Toolbar>
        {tab === 'requests' && <p style={{ fontSize: 13, color: C.muted, margin: '0 0 10px' }}>{CARD.areaRequests}</p>}
        {list.error && <Notice tone="red">{list.error}</Notice>}
        <DataTable columns={columns} rows={list.rows} narrowAt={720} paged={{ total: list.total, sort, onSort: setSort, onMore: list.more, loading: list.loading }}
          empty={list.loading ? 'Loading…' : tab === 'requests' ? 'No area requests waiting' : 'No areas match'} onClear={q || state ? () => { setQ(''); setState('') } : undefined} />
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit Area · ${edit.name}` : 'Add Area'}
        footer={<><button style={btn} onClick={() => setEdit(null)}>Cancel</button><button style={btnPrimary} onClick={save}>{edit?.id ? 'Save' : 'Add'}</button></>}>
        {error && <Notice tone="red">{error}</Notice>}
        {edit && (
          <div style={grid2}>
            <FormField label="Area name" required wide><input style={field} value={edit.name} autoFocus onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Taman Desa" /></FormField>
            <FormField label="State"><Select block plain label="State" value={edit.state} onChange={v => setEdit({ ...edit, state: v })} options={[...new Set([...states, ...STATES])].map(x => ({ value: x, label: x }))} /></FormField>
            <FormField label="Branch"><Select block plain label="Branch" value={edit.branchId} onChange={v => setEdit({ ...edit, branchId: v })} options={setup.branches.map(b => ({ value: String(b.id), label: b.name }))} /></FormField>
            <FormField label="Area Manager" wide><StaffPicker block plain label="Manager" value={edit.managerId} onChange={v => setEdit({ ...edit, managerId: v })} filters={{ status: 'active' }} branch={false}
              all="No manager" show={s => `${s.short}${s.role ? ` (${s.role})` : ''} ${s.code}`} /></FormField>
          </div>
        )}
      </Modal>
    </Page>
  )
}

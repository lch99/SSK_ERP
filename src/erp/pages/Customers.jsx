import { useMemo, useState } from 'react'
import { C, btn, btnPrimary, sel } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { CUSTOMER_TRACK, CUSTOMER_ACTION, CUSTOMER_FROM } from '../model.js'
import { Page, Card, Toolbar, SearchBox, Select, DataTable, Status, Who, Link, Drawer, KV, Block, Stat, Notice, FormField, TextArea, Modal, cols, go, mono, field, useRecordNav } from '../ui.jsx'
import { PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { rm0, date, ago } from '../format.js'
import { localToday, FOLLOW_UP_ACTIONS } from '../../demo/erpSample.js'
import { useCan } from '../access.jsx'
import { useReview, missing, needText, markGaps } from '../review.jsx'

// Customer Database: leads, with the current ERP's Action and Status per row.
export default function Customers({ parts }) {
  if (parts[1] === 'new') return <AddName />
  return <NameList openId={Number(parts[1]) || null} />
}

function NameList({ openId }) {
  const erp = useErp()
  const editable = useCan()('customers', 'edit')
  const { m, scoped: d } = erp
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [who, setWho] = useState('')
  const [action, setAction] = useState('')
  const [track, setTrack] = useState('')
  const open = openId ? d.customers.find(c => c.id === openId) : null
  const last = c => c.followUps[c.followUps.length - 1]?.date || c.date

  const rows = useMemo(() => {
    const words = q.trim().toLowerCase()
    return d.customers.filter(c => (!type || c.type === type) && (!who || c.ownerId === Number(who)) && (action === '' || c.action === Number(action)) &&
      (track === '' || c.track === Number(track)) && (!words || [c.name, c.phone, c.area, c.remarks].join(' ').toLowerCase().includes(words)))
  }, [d.customers, q, type, who, action, track])
  const people = d.staff.filter(s => s.status === 'active').sort((a, b) => a.short.localeCompare(b.short))
  const fb = useFeedback()
  // Action and Status save as soon as they change; the toast says so.
  const save = (c, fields) => fb.run(() => erp.updateCustomer(c.id, fields),
    `${c.name}: ${'action' in fields ? `Action set to ${CUSTOMER_ACTION[fields.action]}` : `Status set to ${CUSTOMER_TRACK[fields.track].label}`}`)
  const inline = { ...sel, fontSize: 12.5, padding: '3px 4px', maxWidth: 150 }
  const { onOrder, nav } = useRecordNav(open?.id, id => `customers/${id}`)
  const filters = [type, who, action, track].filter(x => x !== '').length
  const clear = () => { setQ(''); setType(''); setWho(''); setAction(''); setTrack('') }

  const columns = [
    { key: 'date', label: 'Date', nowrap: true, sort: c => c.date, render: c => date(c.date) },
    { key: 'name', label: 'Name · Phone', sort: c => c.name, render: c => <Who name={c.name} sub={c.phone} size={26} /> },
    { key: 'type', label: 'Type · Area', sort: c => c.type, render: c => <span>{c.type}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{c.area}</span></span> },
    { key: 'from', label: 'From Where', render: c => CUSTOMER_FROM[c.from] || c.from },
    { key: 'budget', label: 'Min. · Max. Budget', align: 'right', sort: c => c.budgetMin, render: c => <span style={{ fontSize: 13 }}>{rm0(c.budgetMin)}<span style={{ display: 'block', color: C.muted }}>{rm0(c.budgetMax)}</span></span> },
    { key: 'action', label: 'Action', render: c => (
      <select style={inline} disabled={!editable} value={c.action} aria-label="Action" onClick={e => e.stopPropagation()} onChange={e => save(c, { action: e.target.value })}>
        {Object.entries(CUSTOMER_ACTION).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    ) },
    { key: 'track', label: 'Status', render: c => (
      <select style={inline} disabled={!editable} value={c.track} aria-label="Status" onClick={e => e.stopPropagation()} onChange={e => save(c, { track: e.target.value })}>
        {Object.entries(CUSTOMER_TRACK).map(([v, t]) => <option key={v} value={v}>{t.label}</option>)}
      </select>
    ) },
    { key: 'remarks', label: 'Remarks', render: c => <span style={{ fontSize: 12.5, color: C.muted }}>{c.remarks || '—'}</span> },
  ]
  return (
    <Page title="Customers" help={PAGE.customers} sub="Buyers and tenants the team is working with. Action and Status save as soon as they are changed."
      actions={editable && <button style={btnPrimary} onClick={() => go('customers/new')}>Add customer</button>}>
      <div style={{ ...cols(200, 14), marginBottom: 16 }}>
        <Stat icon="customers" tone="green" label="Active" value={d.customers.filter(c => c.track === 0).length} sub={`${d.customers.filter(c => c.track === 0 && c.action === 0).length} on Admin Follow-Up`} onClick={() => setTrack(track === '0' ? '' : '0')} on={track === '0'} />
        <Stat icon="check" tone="blue" label="Closing" value={d.customers.filter(c => c.track === 1).length} sub="Signed an offer through us" onClick={() => setTrack(track === '1' ? '' : '1')} on={track === '1'} />
        <Stat icon="close" tone="gray" label="By Other" value={d.customers.filter(c => c.track === 2).length} sub="Bought or rented elsewhere" onClick={() => setTrack(track === '2' ? '' : '2')} on={track === '2'} />
      </div>
      <Card pad={16}>
        <Toolbar fold active={filters} onClear={clear}>
          <SearchBox value={q} onChange={setQ} placeholder="Keywords: name, phone, area" />
          <Select label="Staff" value={who} onChange={setWho} options={[{ value: '', label: 'Select staff profile to view' }, ...people.map(s => ({ value: String(s.id), label: `${s.short} ${s.code}` }))]} />
          <Select label="Type" value={type} onChange={setType} options={[['', 'Select Type'], ['Rent', 'Rent'], ['Sale', 'Sale']].map(([value, label]) => ({ value, label }))} />
          <Select label="Action" value={action} onChange={setAction} options={[{ value: '', label: 'Action' }, ...Object.entries(CUSTOMER_ACTION).map(([value, label]) => ({ value, label }))]} />
          <Select label="Status" value={track} onChange={setTrack} options={[{ value: '', label: 'Status' }, ...Object.entries(CUSTOMER_TRACK).map(([value, t]) => ({ value, label: t.label }))]} />
        </Toolbar>
        <DataTable columns={columns} rows={rows} onRow={c => go(`customers/${c.id}`)} defaultSort={{ key: 'date', dir: 'desc' }} pageSize={25} narrowAt={980}
          empty="No names match" onClear={filters || q ? clear : undefined} onOrder={onOrder} />
      </Card>
      <Drawer open={!!open} onClose={() => go('customers')} title={open?.name} sub={open ? `#${open.code} · since ${date(open.date)} · last contact ${ago(last(open), m.today)}` : ''} nav={nav}>
        {open && <Details key={open.id} c={open} erp={erp} />}
      </Drawer>
    </Page>
  )
}

function Details({ c, erp }) {
  const { m } = erp
  const fb = useFeedback()
  const editable = useCan()('customers', 'edit')
  const [remarks, setRemarks] = useState(c.remarks || '')
  const [edit, setEdit] = useState(null)
  const [fu, setFu] = useState(null)
  const [error, setError] = useState(null)
  const people = m.data.staff.filter(s => s.status === 'active' || s.id === c.ownerId).sort((a, b) => a.short.localeCompare(b.short))
  const saveEdit = async () => {
    setError(null)
    try { await erp.updateCustomer(c.id, edit); fb.toast(`${edit.name} saved`); setEdit(null) } catch (e) { setError(e.message) }
  }
  const saveFu = async () => {
    setError(null)
    try { await erp.addCustomerFollowUp(c.id, fu); fb.toast('Follow-up saved'); setFu(null) } catch (e) { setError(e.message) }
  }
  const grid = { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(180px, 100%), 1fr))' }
  return (
    <>
      <Block title="Customer" right={<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Status of={CUSTOMER_TRACK} value={c.track} />
        {editable && <button style={{ ...btn, fontSize: 12.5, padding: '3px 10px' }} onClick={() => { setError(null); setEdit({ date: c.date, name: c.name, phone: c.phone, area: c.area, type: c.type, from: c.from,
          budgetMin: c.budgetMin, budgetMax: c.budgetMax, ownerId: String(c.ownerId) }) }}>Edit</button>}</span>}>
        <KV min={160} items={[
          ['Type', c.type], ['Area', c.area], ['Min. Budget', rm0(c.budgetMin)], ['Max. Budget', rm0(c.budgetMax)],
          ['Phone', c.phone], ['From Where', CUSTOMER_FROM[c.from] || c.from], ['Action', CUSTOMER_ACTION[c.action]],
          ['Staff', <Link to={`staff/${c.ownerId}`}>{m.staffName(c.ownerId)}</Link>],
          c.dealId && ['E-Form', <Link to={`deals/${c.dealId}`} style={mono}>{m.deals[c.dealId]?.code}</Link>],
        ]} />
      </Block>
      <Block title="Remarks">
        {!editable ? <p style={{ margin: 0, fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{c.remarks || <span style={{ color: C.muted }}>No remarks.</span>}</p> : <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <TextArea style={{ flex: '1 1 220px', width: 'auto' }} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="e.g. Wants a corner lot, viewing on Saturday"
            onSubmit={() => { if (remarks !== (c.remarks || '')) fb.run(() => erp.updateCustomer(c.id, { remarks }), 'Remarks saved') }} />
          <button style={btn} disabled={remarks === (c.remarks || '')} onClick={() => fb.run(() => erp.updateCustomer(c.id, { remarks }), 'Remarks saved')}>Save</button>
        </div>}
      </Block>
      <Block title="Follow-up History" right={editable && <button style={{ ...btn, fontSize: 12.5, padding: '3px 10px' }} onClick={() => { setError(null); setFu({ date: m.today, action: FOLLOW_UP_ACTIONS[0], property: '', price: '', listingId: '', remark: '' }) }}>Add follow-up</button>}>
        {!c.followUps.length ? <p style={{ margin: 0, color: C.muted, fontSize: 13.5 }}>No follow-ups yet.</p> : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {[...c.followUps].reverse().map((f, i) => (
              <li key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 12, color: C.muted, width: 52, flexShrink: 0 }}>{date(f.date, { short: true })}</span>
                <span style={{ flex: 1, fontSize: 13.5 }}><b>{f.action}</b> · {f.note}
                  {(f.property || f.listingId || f.price) && <span style={{ display: 'block', fontSize: 12, color: C.muted }}>
                    {[f.property, f.price ? rm0(f.price) : null].filter(Boolean).join(' · ')}{f.listingId && m.listings[f.listingId] ? <> · <Link to={`listings/${f.listingId}`} style={mono}>{m.listings[f.listingId].code}</Link></> : null}</span>}</span>
              </li>
            ))}
          </ol>
        )}
      </Block>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Edit ${c.name}`} width={560}
        footer={<><button style={btn} onClick={() => setEdit(null)}>Cancel</button><button style={btnPrimary} onClick={saveEdit}>Save</button></>}>
        {error && <Notice tone="red">{error}</Notice>}
        {edit && (
          <div style={grid}>
            <FormField label="Date"><input type="date" style={field} value={edit.date} onChange={e => setEdit({ ...edit, date: e.target.value })} /></FormField>
            <FormField label="Name" required><input style={field} value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></FormField>
            <FormField label="Phone" required><input style={field} type="tel" value={edit.phone} onChange={e => setEdit({ ...edit, phone: e.target.value })} /></FormField>
            <FormField label="Area"><input style={field} value={edit.area} onChange={e => setEdit({ ...edit, area: e.target.value })} /></FormField>
            <FormField label="Type"><Select block plain label="Type" value={edit.type} onChange={v => setEdit({ ...edit, type: v })} options={['Rent', 'Sale'].map(v => ({ value: v, label: v }))} /></FormField>
            <FormField label="From Where"><Select block plain label="From Where" value={edit.from} onChange={v => setEdit({ ...edit, from: v })} options={Object.entries(CUSTOMER_FROM).map(([value, label]) => ({ value, label }))} /></FormField>
            <FormField label="Min. Budget (RM)"><input type="number" style={field} value={edit.budgetMin} onChange={e => setEdit({ ...edit, budgetMin: e.target.value })} /></FormField>
            <FormField label="Max. Budget (RM)"><input type="number" style={field} value={edit.budgetMax} onChange={e => setEdit({ ...edit, budgetMax: e.target.value })} /></FormField>
            <FormField label="Staff"><Select block plain label="Staff" value={edit.ownerId} onChange={v => setEdit({ ...edit, ownerId: v })} options={people.map(s => ({ value: String(s.id), label: `${s.short} ${s.code}` }))} /></FormField>
          </div>
        )}
      </Modal>
      <Modal open={!!fu} onClose={() => setFu(null)} title={`Follow-up · ${c.name}`} width={540}
        footer={<><button style={btn} onClick={() => setFu(null)}>Cancel</button><button style={btnPrimary} onClick={saveFu}>Save</button></>}>
        {error && <Notice tone="red">{error}</Notice>}
        {fu && (
          <div style={grid}>
            <FormField label="Update Date"><input type="date" style={field} value={fu.date} max={m.today} onChange={e => setFu({ ...fu, date: e.target.value })} /></FormField>
            <FormField label="Action"><Select block plain label="Action" value={fu.action} onChange={v => setFu({ ...fu, action: v })} options={[0, 1, 2, 3].map(k => ({ value: FOLLOW_UP_ACTIONS[k], label: FOLLOW_UP_ACTIONS[k] }))} /></FormField>
            <FormField label="Property Name"><input style={field} value={fu.property} onChange={e => setFu({ ...fu, property: e.target.value })} /></FormField>
            <FormField label="Price (RM)"><input type="number" style={field} value={fu.price} onChange={e => setFu({ ...fu, price: e.target.value })} /></FormField>
            <FormField label="List ID" help="The listing shown, e.g. LIST-122345"><input style={field} value={fu.listingId} onChange={e => setFu({ ...fu, listingId: e.target.value })} /></FormField>
            <FormField label="Remarks" wide><TextArea value={fu.remark} onChange={e => setFu({ ...fu, remark: e.target.value })} /></FormField>
          </div>
        )}
      </Modal>
    </>
  )
}

// Add New Name: the current entry form.
function AddName() {
  const erp = useErp()
  const { m, scoped: d } = erp
  const [f, setF] = useState({ date: localToday(), type: 'Sale', from: 'iProperty', ownerId: String(d.staff.find(s => s.status === 'active')?.id || '') })
  const [error, setError] = useState(null)
  const fb = useFeedback()
  const review = useReview()
  const set = k => e => setF({ ...f, [k]: e.target.value })
  // Before adding: the customer as saved, and anyone already on file with the same phone.
  async function preview() {
    const gaps = missing([['Name', f.name], ['Phone', f.phone]])
    if (gaps.length) { setError(needText(gaps)); if (!markGaps(gaps)) window.scrollTo({ top: 0, behavior: 'smooth' }); return false }
    const digits = String(f.phone).replace(/\D/g, '')
    const same = m.data.customers.filter(c => digits.length >= 7 && String(c.phone || '').replace(/\D/g, '') === digits)
    const budget = [f.budgetMin, f.budgetMax].some(v => Number(v) > 0) ? `${Number(f.budgetMin) > 0 ? rm0(f.budgetMin) : '—'} to ${Number(f.budgetMax) > 0 ? rm0(f.budgetMax) : '—'}` : ''
    return review({
      title: 'Preview the customer', confirmLabel: 'Add customer',
      intro: `They go into the Customer Database for ${m.staffName(Number(f.ownerId))} to follow up.`,
      warnings: [same.length > 0 && `Already in the Customer Database with this phone: ${same.map(c => `${c.name} (${m.staffName(c.ownerId)})`).join(', ')}. Add them again only if this is a different person.`],
      sections: [{ title: 'Customer', rows: [['Name', f.name], ['Phone', f.phone], ['Looking to', f.type === 'Rent' ? 'Rent' : 'Buy'], ['Area', f.area], ['Budget', budget],
        ['From Where', f.from === 'others' ? f.fromOther || 'Others' : CUSTOMER_FROM[f.from]], ['Date', date(f.date)], ['Staff', m.staffName(Number(f.ownerId))], ['Remarks', f.remarks]] }],
    })
  }
  async function save() {
    setError(null)
    if (!await preview()) return
    try { await erp.addCustomer(f); fb.toast(`${f.name} added to the Customer Database`); go('customers') } catch (e) { setError(e.message); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  }
  const people = d.staff.filter(s => s.status === 'active').sort((a, b) => a.short.localeCompare(b.short))
  return (
    <Page title="Add a customer" help={PAGE.customerNew} back={{ to: 'customers', label: 'Customers' }}>
      <Card>
        {error && <Notice tone="red">{error}</Notice>}
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))' }}>
          <FormField label="Date"><input type="date" style={field} value={f.date} onChange={set('date')} /></FormField>
          <FormField label="Name" required><input style={field} value={f.name || ''} onChange={set('name')} autoFocus placeholder="e.g. Tan Mei Ling" /></FormField>
          <FormField label="Phone" required><input style={field} type="tel" inputMode="tel" value={f.phone || ''} onChange={set('phone')} placeholder="e.g. 012-345 6789" /></FormField>
          <FormField label="Area"><input style={field} value={f.area || ''} onChange={set('area')} /></FormField>
          <FormField label="Type">
            <select style={{ ...sel, width: '100%' }} value={f.type} onChange={set('type')}><option value="Rent">Rent</option><option value="Sale">Sale</option></select>
          </FormField>
          <FormField label="From Where">
            <select style={{ ...sel, width: '100%' }} value={f.from} onChange={set('from')}>{Object.entries(CUSTOMER_FROM).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </FormField>
          {f.from === 'others' && <FormField label="Other source"><input style={field} value={f.fromOther || ''} onChange={set('fromOther')} /></FormField>}
          <FormField label="Min. Budget (RM)"><input type="number" style={field} value={f.budgetMin || ''} onChange={set('budgetMin')} /></FormField>
          <FormField label="Max. Budget (RM)"><input type="number" style={field} value={f.budgetMax || ''} onChange={set('budgetMax')} /></FormField>
          <FormField label="Staff">
            <Select block plain label="Staff" value={f.ownerId} onChange={v => setF({ ...f, ownerId: v })} options={people.map(s => ({ value: String(s.id), label: `${s.short} ${s.code}` }))} />
          </FormField>
          <FormField label="Remarks" wide><TextArea value={f.remarks || ''} onChange={set('remarks')} /></FormField>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <button style={btnPrimary} onClick={save}>Preview &amp; add</button>
          <button style={btn} onClick={() => go('customers')}>Cancel</button>
        </div>
      </Card>
    </Page>
  )
}

import { useState } from 'react'
import { C, btn, btnPrimary } from '../../styles.js'
import { LISTING_SETTINGS, FOLLOW_UP_ACTIONS } from '../../demo/erpSample.js'
import { useErp } from '../ErpContext.jsx'
import { Menu, Modal, FormField, FileInput, TextArea, Select, Notice, go, field, small } from '../ui.jsx'
import { useFeedback } from '../feedback.jsx'
import { rm0 } from '../format.js'
import Icon from '../Icon.jsx'

// Everything the current ERP lets you do to a listing, from its row or its
// details: edit, Update Tracking, Listing Settings, Follow-up (with an
// appointment), Share (users, PM, 3 co-product handlers), Album, Marketing
// Tools and Delete. `quiet` for table rows.
export const PORTALS = ['iProperty', 'PropertyGuru', 'Mudah.my']
const TRACKING = [['active', 'Active'], ['rented', 'Rent Out'], ['invalid', 'Not Valid'], ['sold_other', 'Sold By Other']]
const grid = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(190px, 100%), 1fr))' }
export const photosOf = l => l.photoSet || Array.from({ length: l.photos || 0 }, (_, i) => ({ id: i + 1, name: `Photo ${i + 1}`, published: true, cover: i === 0 }))

export default function ListingActions({ l, quiet }) {
  const erp = useErp()
  const { m } = erp
  const fb = useFeedback()
  const [dialog, setDialog] = useState(null)
  const [f, setF] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const staff = m.data.staff.filter(s => s.status !== 'inactive').sort((a, b) => a.short.localeCompare(b.short))
  const staffOptions = first => [{ value: '', label: first }, ...staff.map(s => ({ value: String(s.id), label: `${s.short} (${s.code})` }))]
  const openWith = (name, start) => { setError(null); setF(start); setDialog(name) }
  const close = () => setDialog(null)
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }))
  const save = async (fn, done) => {
    setBusy(true); setError(null)
    try { await fn(); setDialog(null); fb.toast(done) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const footer = (label, onClick, danger) => <><button style={btn} onClick={close}>Cancel</button>
    <button style={{ ...(danger ? { ...btn, background: C.err, borderColor: C.err, color: '#fff' } : btnPrimary), opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={onClick}>{label}</button></>
  const remove = async () => {
    const ok = await fb.confirm({ title: `Delete ${l.code}?`, body: 'Are you sure you want to delete this listing? Its enquiries go too. This cannot be undone.', confirmLabel: 'Delete', danger: true })
    if (ok && await fb.run(() => erp.deleteListing(l.id), `${l.code} deleted`)) go('listings')
  }
  const photos = f.photos || []

  return (
    <>
      <Menu quiet={quiet} label="Actions" items={[
        { section: l.code },
        { label: 'Edit listing', icon: 'edit', onClick: () => openWith('edit', { askPrice: l.askPrice, bestPrice: l.bestPrice, marketValue: l.marketValue ?? '', commission: l.commission ?? '',
          beds: l.beds, baths: l.baths, builtUp: l.builtUp, tenure: l.tenure, furnishing: l.furnishing, description: l.description || '', remarks: l.remarks || '',
          ownerName: l.owner.name, ownerPhone: l.owner.phone }) },
        { label: 'Change Listing Owner', icon: 'staff', sub: `Now ${m.staffName(l.holderId)}`, onClick: () => openWith('owner', { holderId: String(l.holderId) }) },
        { label: 'Update Listing Tracking', icon: 'refresh', onClick: () => openWith('track', { status: TRACKING.some(([k]) => k === l.status) ? l.status : 'active', trackingPrice: l.trackingPrice ?? '' }) },
        { label: 'Listing Settings', icon: 'setup', onClick: () => openWith('settings', { flags: [...l.flags] }) },
        { label: 'Follow-up', icon: 'clock', onClick: () => openWith('follow', { date: m.today, action: '0', by: String(l.holderId), remark: '', appointmentDate: '', appointmentTime: '' }) },
        '-',
        { label: 'Share', icon: 'share', sub: (l.share?.coPh || []).length ? `${l.share.coPh.length} co-product handler${l.share.coPh.length > 1 ? 's' : ''}` : null,
          onClick: () => openWith('share', { users: (l.share?.users || []).map(String), pmId: l.share?.pmId ? String(l.share.pmId) : '',
            coPh: [0, 1, 2].map(i => ({ staffId: l.share?.coPh?.[i]?.staffId ? String(l.share.coPh[i].staffId) : '', until: l.share?.coPh?.[i]?.until || '' })), add: '' }) },
        { label: 'Album', icon: 'image', hint: String(l.photos || 0), onClick: () => openWith('album', { photos: photosOf(l).map(p => ({ ...p })), picked: [] }) },
        { label: 'Marketing Tools', icon: 'eye', onClick: () => openWith('marketing', { portals: [...(l.portals || [])], marketingRemarks: l.marketingRemarks || '', remarksPrivate: l.remarksPrivate !== false }) },
        '-',
        { label: 'Delete listing', icon: 'trash', danger: true, disabled: !!l.dealId, why: 'It has an E-Form. Set it Not Valid instead.', onClick: remove },
      ]} />

      <Modal open={dialog === 'edit'} onClose={close} title={`Edit ${l.code}`} width={620}
        footer={footer('Save & Publish', () => save(() => erp.updateListing(l.id, { askPrice: f.askPrice, bestPrice: f.bestPrice, marketValue: f.marketValue, commission: f.commission,
          beds: f.beds, baths: f.baths, builtUp: f.builtUp, tenure: f.tenure, furnishing: f.furnishing, description: f.description, remarks: f.remarks,
          owner: { name: f.ownerName, phone: f.ownerPhone } }), `${l.code} saved`))}>
        {error && <Notice tone="red">{error}</Notice>}
        <div style={grid}>
          <FormField label="Ad Price (RM)" required><input style={field} type="number" min="0" value={f.askPrice ?? ''} onChange={set('askPrice')} /></FormField>
          <FormField label="Best Price (RM)"><input style={field} type="number" min="0" value={f.bestPrice ?? ''} onChange={set('bestPrice')} /></FormField>
          <FormField label="Market Value (RM)"><input style={field} type="number" min="0" value={f.marketValue ?? ''} onChange={set('marketValue')} /></FormField>
          <FormField label="Commission (%)"><input style={field} type="number" min="0" step="0.25" value={f.commission ?? ''} onChange={set('commission')} /></FormField>
          <FormField label="Built-up (sq ft)"><input style={field} type="number" min="0" value={f.builtUp ?? ''} onChange={set('builtUp')} /></FormField>
          <FormField label="Bedrooms"><input style={field} type="number" min="0" value={f.beds ?? ''} onChange={set('beds')} /></FormField>
          <FormField label="Bathrooms"><input style={field} type="number" min="0" value={f.baths ?? ''} onChange={set('baths')} /></FormField>
          <FormField label="Tenure"><Select block plain label="Tenure" value={f.tenure} onChange={v => setF(x => ({ ...x, tenure: v }))} options={['Freehold', 'Leasehold'].map(t => ({ value: t, label: t }))} /></FormField>
          <FormField label="Furnishing"><Select block plain label="Furnishing" value={f.furnishing} onChange={v => setF(x => ({ ...x, furnishing: v }))} options={['Unfurnished', 'Partly furnished', 'Fully furnished'].map(t => ({ value: t, label: t }))} /></FormField>
          <FormField label="Owner Name" required><input style={field} value={f.ownerName || ''} onChange={set('ownerName')} /></FormField>
          <FormField label="Owner Contact" required help="e.g. 012-3456789"><input style={field} type="tel" value={f.ownerPhone || ''} onChange={set('ownerPhone')} /></FormField>
          <FormField label="Full Descriptions" wide><TextArea rows={3} value={f.description || ''} onChange={set('description')} /></FormField>
          <FormField label="Personal Use Remarks" wide help="This won't show on public."><TextArea value={f.remarks || ''} onChange={set('remarks')} /></FormField>
        </div>
      </Modal>

      <Modal open={dialog === 'owner'} onClose={close} title={`Change Listing Owner · ${l.code}`}
        footer={footer('Save', () => save(() => erp.updateListing(l.id, { holderId: f.holderId }), `${l.code} now belongs to ${m.staffName(Number(f.holderId))}`))}>
        {error && <Notice tone="red">{error}</Notice>}
        <p style={{ fontSize: 13.5, marginTop: 0 }}>The listing owner is the product handler: they get the Product side of the commission on new E-Forms.</p>
        <FormField label="Listing owner (product handler)"><Select block plain label="Owner" value={f.holderId} onChange={v => setF(x => ({ ...x, holderId: v }))} options={staffOptions('Select staff')} /></FormField>
      </Modal>

      <Modal open={dialog === 'track'} onClose={close} title={`Update Listing Tracking · ${l.code}`}
        footer={footer('Save', () => save(() => erp.updateListing(l.id, { status: f.status, trackingPrice: f.trackingPrice }), `${l.code} tracking updated`))}>
        {error && <Notice tone="red">{error}</Notice>}
        <div style={{ display: 'grid', gap: 12 }}>
          <FormField label="Status">
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', paddingTop: 4 }}>
              {TRACKING.map(([k, label]) => <label key={k} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 14 }}><input type="radio" checked={f.status === k} onChange={() => setF(x => ({ ...x, status: k }))} style={{ accentColor: C.primary }} />{label}</label>)}
            </div>
          </FormField>
          {f.status !== 'active' && <FormField label="Price it went for (RM)" help="If known"><input style={field} type="number" min="0" value={f.trackingPrice ?? ''} onChange={set('trackingPrice')} /></FormField>}
        </div>
      </Modal>

      <Modal open={dialog === 'settings'} onClose={close} title={`Listing Settings · ${l.code}`}
        footer={footer('Save', () => save(() => erp.updateListing(l.id, { flags: f.flags }), `${l.code} settings saved`))}>
        {error && <Notice tone="red">{error}</Notice>}
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(min(180px, 100%), 1fr))' }}>
          {LISTING_SETTINGS.map(flag => (
            <label key={flag} style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
              <input type="checkbox" checked={(f.flags || []).includes(flag)} style={{ accentColor: C.primary }}
                onChange={() => setF(x => ({ ...x, flags: x.flags.includes(flag) ? x.flags.filter(y => y !== flag) : [...x.flags, flag] }))} />{flag}
            </label>
          ))}
        </div>
      </Modal>

      <Modal open={dialog === 'follow'} onClose={close} title={`Listing Follow-up · ${l.code}`} width={560}
        footer={footer('Save', () => save(() => erp.addListingFollowUp(l.id, f), f.appointmentDate ? 'Follow-up saved · the appointment is under Viewings' : 'Follow-up saved'))}>
        {error && <Notice tone="red">{error}</Notice>}
        <div style={grid}>
          <FormField label="Date"><input type="date" style={field} value={f.date || ''} max={m.today} onChange={set('date')} /></FormField>
          <FormField label="Action"><Select block plain label="Action" value={f.action} onChange={v => setF(x => ({ ...x, action: v }))} options={[0, 1, 2, 3].map(k => ({ value: String(k), label: FOLLOW_UP_ACTIONS[k] }))} /></FormField>
          <FormField label="Agent"><Select block plain label="Agent" value={f.by} onChange={v => setF(x => ({ ...x, by: v }))} options={staffOptions('Select agent')} /></FormField>
          <FormField label="Appointment date" help="For a viewing"><input type="date" style={field} value={f.appointmentDate || ''} min={m.today} onChange={set('appointmentDate')} /></FormField>
          <FormField label="Appointment time"><input type="time" style={field} value={f.appointmentTime || ''} onChange={set('appointmentTime')} /></FormField>
          <FormField label="Remarks" wide><TextArea value={f.remark || ''} onChange={set('remark')} placeholder="e.g. Owner open to nego, viewing with buyer on Saturday" /></FormField>
        </div>
      </Modal>

      <Modal open={dialog === 'share'} onClose={close} title={`View Share Listing Settings · ${l.code}`} width={600}
        footer={footer('Save', () => save(() => erp.updateListing(l.id, { share: { users: f.users.map(Number), pmId: f.pmId ? Number(f.pmId) : null,
          coPh: f.coPh.filter(c => c.staffId).map(c => ({ staffId: Number(c.staffId), until: c.until || null })) } }), `${l.code} sharing saved`))}>
        {error && <Notice tone="red">{error}</Notice>}
        <div style={{ display: 'grid', gap: 14 }}>
          <FormField label="Share to users" help="They can see and market this listing">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {(f.users || []).map(u => (
                <span key={u} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 13, background: C.grayBg, borderRadius: 999, padding: '3px 6px 3px 10px' }}>
                  {m.staffName(Number(u))}<button type="button" aria-label="Remove" onClick={() => setF(x => ({ ...x, users: x.users.filter(y => y !== u) }))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.muted, display: 'inline-flex' }}><Icon name="close" size={13} /></button>
                </span>
              ))}
              {!(f.users || []).length && <span style={{ fontSize: 13, color: C.muted }}>Not shared with anyone yet.</span>}
            </div>
            <Select block plain label="Add user" value="" onChange={v => v && setF(x => ({ ...x, users: x.users.includes(v) ? x.users : [...x.users, v] }))} options={staffOptions('+ Add a user')} />
          </FormField>
          <FormField label="Project Manager (PM)"><Select block plain label="PM" value={f.pmId} onChange={v => setF(x => ({ ...x, pmId: v }))} options={staffOptions('No PM')} /></FormField>
          {(f.coPh || []).map((c, i) => (
            <div key={i} style={grid}>
              <FormField label={`Co-Product Handler slot ${i + 1}`}><Select block plain label="Co-PH" value={c.staffId} onChange={v => setF(x => ({ ...x, coPh: x.coPh.map((y, j) => (j === i ? { ...y, staffId: v } : y)) }))} options={staffOptions('Empty slot')} /></FormField>
              <FormField label="Valid until"><input type="date" style={field} value={c.until} min={m.today} onChange={e => setF(x => ({ ...x, coPh: x.coPh.map((y, j) => (j === i ? { ...y, until: e.target.value } : y)) }))} /></FormField>
            </div>
          ))}
        </div>
      </Modal>

      <Modal open={dialog === 'album'} onClose={close} title={`Album · ${l.code}`} width={680}
        footer={footer('Save', () => save(() => erp.updateListing(l.id, { photoSet: photos }), `${l.code} photos saved`))}>
        {error && <Notice tone="red">{error}</Notice>}
        <FormField label="Upload photos" help="Up to 10 at a time"><FileInput kind="photo" onChange={files => setF(x => {
          const next = x.photos.length ? Math.max(...x.photos.map(p => p.id)) + 1 : 1
          return { ...x, photos: [...x.photos.filter(p => !p.fresh), ...files.map((file, i) => ({ id: next + i, name: file.name, published: true, cover: !x.photos.length && i === 0, fresh: true }))] }
        })} /></FormField>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '14px 0 10px', fontSize: 13 }}>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={photos.length > 0 && f.picked.length === photos.length} onChange={e => setF(x => ({ ...x, picked: e.target.checked ? x.photos.map(p => p.id) : [] }))} style={{ accentColor: C.primary }} />Select all
          </label>
          <span style={{ flex: 1 }} />
          {f.picked?.length > 0 && <>
            <button style={small} onClick={() => setF(x => ({ ...x, photos: x.photos.map(p => (x.picked.includes(p.id) ? { ...p, published: true } : p)) }))}>Publish</button>
            <button style={small} onClick={() => setF(x => ({ ...x, photos: x.photos.map(p => (x.picked.includes(p.id) ? { ...p, published: false } : p)) }))}>Unpublish</button>
            <button style={{ ...small, color: C.err }} onClick={() => setF(x => ({ ...x, photos: x.photos.filter(p => !x.picked.includes(p.id)), picked: [] }))}>Delete {f.picked.length}</button>
          </>}
        </div>
        {!photos.length ? <p style={{ color: C.muted, fontSize: 13.5, margin: 0 }}>No photos yet.</p> : (
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(140px, 100%), 1fr))' }}>
            {photos.map(p => (
              <div key={p.id} style={{ border: `1px solid ${p.cover ? C.primary : C.border}`, borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                <div style={{ height: 84, background: `linear-gradient(135deg, #e3edfb, #f7c4d1)`, display: 'grid', placeItems: 'center', color: 'rgba(29,35,48,.4)', position: 'relative', opacity: p.published ? 1 : 0.45 }}>
                  <Icon name="image" size={26} />
                  <input type="checkbox" aria-label={`Select ${p.name}`} checked={f.picked.includes(p.id)} onChange={() => setF(x => ({ ...x, picked: x.picked.includes(p.id) ? x.picked.filter(y => y !== p.id) : [...x.picked, p.id] }))}
                    style={{ position: 'absolute', top: 6, left: 6, accentColor: C.primary }} />
                  {p.cover && <span style={{ position: 'absolute', top: 6, right: 6, fontSize: 10.5, fontWeight: 700, background: C.primary, color: '#fff', borderRadius: 4, padding: '1px 5px' }}>Cover</span>}
                </div>
                <div style={{ padding: '6px 8px', fontSize: 12 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{p.name}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    <button style={{ ...small, fontSize: 11.5, padding: '2px 6px' }} onClick={() => setF(x => ({ ...x, photos: x.photos.map(y => (y.id === p.id ? { ...y, published: !y.published } : y)) }))}>{p.published ? 'Unpublish' : 'Publish'}</button>
                    {!p.cover && <button style={{ ...small, fontSize: 11.5, padding: '2px 6px' }} onClick={() => setF(x => ({ ...x, photos: x.photos.map(y => ({ ...y, cover: y.id === p.id })) }))}>Set cover</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <p style={{ fontSize: 12.5, color: C.muted, margin: '10px 0 0' }}>Published photos show on the SubSaleKing site. Unpublished ones stay private. (Demo: the photos themselves are not stored.)</p>
      </Modal>

      <Modal open={dialog === 'marketing'} onClose={close} title={`Manage Marketing Tools · ${l.code}`} width={560}
        footer={footer('Save', () => save(() => erp.updateListing(l.id, { portals: f.portals, marketingRemarks: f.marketingRemarks, remarksPrivate: f.remarksPrivate }), `${l.code} marketing saved`))}>
        {error && <Notice tone="red">{error}</Notice>}
        <div style={{ display: 'grid', gap: 14 }}>
          <FormField label="Advertised on">
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', paddingTop: 4 }}>
              {PORTALS.map(p => (
                <label key={p} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
                  <input type="checkbox" checked={f.portals?.includes(p)} onChange={() => setF(x => ({ ...x, portals: x.portals.includes(p) ? x.portals.filter(y => y !== p) : [...x.portals, p] }))} style={{ accentColor: C.primary }} />{p}
                </label>
              ))}
            </div>
          </FormField>
          <FormField label="Marketing remarks" help="Notes for the team marketing this listing">
            <TextArea rows={3} value={f.marketingRemarks || ''} onChange={set('marketingRemarks')} />
          </FormField>
          <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <input type="checkbox" checked={!!f.remarksPrivate} onChange={e => setF(x => ({ ...x, remarksPrivate: e.target.checked }))} style={{ accentColor: C.primary }} />
            Private (only the listing owner sees the remarks). Untick for Less Private (shared users see them too).
          </label>
          <FormField label="WhatsApp / SMS share text">
            <TextArea rows={3} readOnly value={`${l.title}, ${l.area}\n${l.type === 'sale' ? 'For sale' : 'For rent'} ${rm0(l.askPrice)}${l.type === 'rental' ? '/month' : ''} · ${l.beds ? `${l.beds} bed · ` : ''}${l.builtUp} sq ft\nhttps://www.subsaleking.com/listings/${l.code.toLowerCase()}`} />
          </FormField>
        </div>
      </Modal>
    </>
  )
}

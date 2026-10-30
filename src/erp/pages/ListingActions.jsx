import { useState } from 'react'
import { C, btn, btnPrimary } from '../../styles.js'
import { LISTING_SETTINGS, FOLLOW_UP_ACTIONS } from '../../demo/erpSample.js'
import { useErp } from '../ErpContext.jsx'
import { isAgent } from '../model.js'
import { Menu, Modal, FormField, FileInput, TextArea, Select, Notice, go, field, small } from '../ui.jsx'
import { useFeedback } from '../feedback.jsx'
import { rm } from '../format.js'
import { Review, changedRows, missing, needText, markGaps } from '../review.jsx'
import ListingPreview from './ListingPreview.jsx'
import Icon from '../Icon.jsx'
import { useGate } from '../access.jsx'
import { UPLOADS } from '../../../shared/files.js'
import { Photo, coverOf, savePreviews } from '../photos.jsx'

// Everything the current ERP lets you do to a listing, from its row or its
// details: edit, Update Tracking, Listing Settings, Follow-up (with an
// appointment), Share (users, PM, 3 co-product handlers), Album (photos and
// videos) and Delete. `quiet` for table rows. The current ERP's Marketing
// Tools (portals, marketing remarks, share text) are left out until there is
// a portal integration (the user's call, 2026-10-28).
const TRACKING = [['active', 'Active'], ['rented', 'Rent Out'], ['invalid', 'Not Valid'], ['sold_other', 'Sold By Other']]
const grid = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(190px, 100%), 1fr))' }
export const photosOf = l => l.photoSet || Array.from({ length: l.photos || 0 }, (_, i) => ({ id: i + 1, name: `Photo ${i + 1}`, published: true, cover: i === 0 }))
// Videos of the house and its surroundings: a walk-through, the facilities, the neighbourhood.
export const videosOf = l => l.videoSet || Array.from({ length: l.videos || 0 }, (_, i) => ({ id: i + 1, name: `Video ${i + 1}`, published: true }))
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
// e.g. "12 photos · 1 video"; empty when there are neither.
export const mediaCount = l => [l.photos > 0 && plural(l.photos, 'photo'), l.videos > 0 && plural(l.videos, 'video')].filter(Boolean).join(' · ')
const MAX_VIDEOS = UPLOADS.listingVideo.maxFiles
const keyOf = p => `${p.type}-${p.id}`
// The first photo is the cover when none is picked (or the cover was deleted).
const withCover = list => {
  const first = list.findIndex(p => p.type === 'photo')
  return first < 0 || list.some(p => p.cover) ? list : list.map((p, i) => (i === first ? { ...p, cover: true } : p))
}

export default function ListingActions({ l, quiet }) {
  const erp = useErp()
  const gate = useGate()
  const { m } = erp
  const fb = useFeedback()
  const [dialog, setDialog] = useState(null)
  const [f, setF] = useState({})
  const [start, setStart] = useState({})     // the values the dialog opened with, to show what changed
  const [step, setStep] = useState('form')   // Edit listing: 'form', then 'review' before saving
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const staff = m.data.staff.filter(s => s.status !== 'inactive').sort((a, b) => a.short.localeCompare(b.short))
  const staffOptions = first => [{ value: '', label: first }, ...staff.map(s => ({ value: String(s.id), label: `${s.short} (${s.code})` }))]
  // Owners and co-product handlers of a listing are agents.
  const agentOptions = first => [{ value: '', label: first }, ...staff.filter(isAgent).map(s => ({ value: String(s.id), label: `${s.short} (${s.code})` }))]
  const openWith = (name, values) => { setError(null); setF(values); setStart(values); setStep('form'); setDialog(name) }
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
  // Album: photos and videos in one list, told apart by `type`; `fresh` ones were picked in this dialog.
  const media = f.media || []
  const shown = [...media.filter(p => p.type === 'photo'), ...media.filter(p => p.type === 'video')]
  const savedVideos = media.filter(p => p.type === 'video' && !p.fresh).length
  const extraVideos = media.filter(p => p.type === 'video').length - MAX_VIDEOS
  const addFiles = type => files => setF(x => {
    const kept = x.media.filter(p => !(p.fresh && p.type === type))
    const ids = kept.filter(p => p.type === type).map(p => p.id)
    const next = ids.length ? Math.max(...ids) + 1 : 1
    // Picked photos keep their File until saving, so the tiles can show them.
    return { ...x, media: withCover([...kept, ...files.map((file, i) => ({ type, id: next + i, name: file.name, published: true, fresh: true, ...(type === 'photo' && { file }) }))]) }
  })
  const setPicked = change => setF(x => ({ ...x, media: x.media.map(p => (x.picked.includes(keyOf(p)) ? { ...p, ...change } : p)) }))
  const setOne = (key, change) => setF(x => ({ ...x, media: x.media.map(p => (keyOf(p) === key ? { ...p, ...change } : p)) }))
  const stored = type => media.filter(p => p.type === type).map(p => ({ id: p.id, name: p.name, published: p.published, ...(type === 'photo' && { cover: !!p.cover, ...(p.preview && { preview: p.preview }) }) }))
  // Newly picked photos are shrunk to small previews (photos.jsx) as the album is saved.
  const saveAlbum = async () => {
    const fresh = media.filter(p => p.type === 'photo' && p.file)
    const keys = await savePreviews(fresh.map(p => p.file))
    const preview = new Map(fresh.map((p, i) => [p.id, keys[i]]))
    const photoSet = stored('photo').map(p => (preview.has(p.id) ? { ...p, preview: preview.get(p.id) } : p))
    return erp.updateListing(l.id, { photoSet, videoSet: stored('video') })
  }
  const price = v => (v === '' || v == null ? '' : rm(Number(v)))
  const editChanges = dialog === 'edit' ? changedRows(start, f, [['askPrice', 'Ad Price', price], ['bestPrice', 'Best Price', price], ['marketValue', 'Market Value', price],
    ['commission', 'Commission', v => `${v}%`], ['builtUp', 'Built-up (sq ft)'], ['beds', 'Bedrooms'], ['baths', 'Bathrooms'], ['tenure', 'Tenure'], ['furnishing', 'Furnishing'],
    ['ownerName', 'Owner Name'], ['ownerPhone', 'Owner Contact'], ['description', 'Full Descriptions'], ['remarks', 'Personal Use Remarks']]) : []

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
        { label: 'Album', icon: 'image', sub: mediaCount(l) || 'No photos or videos yet', onClick: () => openWith('album', {
          media: [...photosOf(l).map(p => ({ ...p, type: 'photo' })), ...videosOf(l).map(v => ({ ...v, type: 'video' }))], picked: [] }) },
        '-',
        { label: 'Delete listing', icon: 'trash', danger: true, disabled: !!l.dealId, why: 'It has an E-Form. Set it Not Valid instead.', onClick: remove },
      ].map(i => (i?.label ? gate(i, 'listings', i.danger ? 'full' : 'edit') : i))} />

      <Modal open={dialog === 'edit'} onClose={close} title={step === 'review' ? `Review changes · ${l.code}` : `Edit ${l.code}`} width={step === 'review' ? 680 : 620}
        footer={step === 'review' ? <>
          <button style={btn} onClick={() => setStep('form')}>Back to edit</button>
          <button style={{ ...btnPrimary, opacity: busy || !editChanges.length ? 0.5 : 1 }} disabled={busy || !editChanges.length} onClick={() => save(() => erp.updateListing(l.id, { askPrice: f.askPrice, bestPrice: f.bestPrice, marketValue: f.marketValue, commission: f.commission,
            beds: f.beds, baths: f.baths, builtUp: f.builtUp, tenure: f.tenure, furnishing: f.furnishing, description: f.description, remarks: f.remarks,
            owner: { name: f.ownerName, phone: f.ownerPhone } }), `${l.code} saved`)}>Save &amp; Publish</button>
        </> : <>
          <button style={btn} onClick={close}>Cancel</button>
          <button style={btnPrimary} onClick={() => {
            const gaps = missing([['Ad Price', f.askPrice], ['Owner Name', f.ownerName], ['Owner Contact', f.ownerPhone]])
            if (gaps.length) { setError(needText(gaps)); markGaps(gaps) } else { setError(null); setStep('review') }
          }}>Review changes</button>
        </>}>
        {error && <Notice tone="red">{error}</Notice>}
        {step === 'review' ? (
          <Review changes={editChanges} intro="Check the changes. The listing on the website is updated as soon as you save."
            preview={<ListingPreview l={{ ...l, ...f }} agent={m.staff[l.holderId]} photos={l.photos} videos={l.videos} cover={coverOf(photosOf(l))?.preview} />} />
        ) : <div style={grid}>
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
        </div>}
      </Modal>

      <Modal open={dialog === 'owner'} onClose={close} title={`Change Listing Owner · ${l.code}`}
        footer={footer('Save', () => save(() => erp.updateListing(l.id, { holderId: f.holderId }), `${l.code} now belongs to ${m.staffName(Number(f.holderId))}`))}>
        {error && <Notice tone="red">{error}</Notice>}
        <p style={{ fontSize: 13.5, marginTop: 0 }}>The listing owner is the product handler: they get the Product side of the commission on new E-Forms.</p>
        <FormField label="Listing owner (product handler)"><Select block plain label="Owner" value={f.holderId} onChange={v => setF(x => ({ ...x, holderId: v }))} options={agentOptions('Select agent')} /></FormField>
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
          <FormField label="Agent"><Select block plain label="Agent" value={f.by} onChange={v => setF(x => ({ ...x, by: v }))} options={agentOptions('Select agent')} /></FormField>
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
              <FormField label={`Co-Product Handler slot ${i + 1}`}><Select block plain label="Co-PH" value={c.staffId} onChange={v => setF(x => ({ ...x, coPh: x.coPh.map((y, j) => (j === i ? { ...y, staffId: v } : y)) }))} options={agentOptions('Empty slot')} /></FormField>
              <FormField label="Valid until"><input type="date" style={field} value={c.until} min={m.today} onChange={e => setF(x => ({ ...x, coPh: x.coPh.map((y, j) => (j === i ? { ...y, until: e.target.value } : y)) }))} /></FormField>
            </div>
          ))}
        </div>
      </Modal>

      <Modal open={dialog === 'album'} onClose={close} title={`Album · ${l.code}`} width={680}
        footer={footer('Save', () => save(saveAlbum, `${l.code} album saved`))}>
        {error && <Notice tone="red">{error}</Notice>}
        <div style={{ display: 'grid', gap: 12 }}>
          <FormField label="Upload photos"><FileInput kind="photo" onChange={addFiles('photo')} /></FormField>
          <FormField label="Upload videos" help={extraVideos > 0 ? <span style={{ color: C.err }}>A listing holds up to {MAX_VIDEOS} videos: delete {extraVideos} before saving.</span>
            : `A walk-through of the house, the facilities or the neighbourhood. Up to ${MAX_VIDEOS} per listing.`}>
            <FileInput kind="listingVideo" onChange={addFiles('video')} disabled={savedVideos >= MAX_VIDEOS}
              placeholder={savedVideos >= MAX_VIDEOS ? `${MAX_VIDEOS} videos already: delete one to add another` : undefined} />
          </FormField>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '14px 0 10px', fontSize: 13 }}>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={media.length > 0 && f.picked.length === media.length} onChange={e => setF(x => ({ ...x, picked: e.target.checked ? x.media.map(keyOf) : [] }))} style={{ accentColor: C.primary }} />Select all
          </label>
          <span style={{ flex: 1 }} />
          {f.picked?.length > 0 && <>
            <button style={small} onClick={() => setPicked({ published: true })}>Publish</button>
            <button style={small} onClick={() => setPicked({ published: false })}>Unpublish</button>
            <button style={{ ...small, color: C.err }} onClick={() => setF(x => ({ ...x, media: withCover(x.media.filter(p => !x.picked.includes(keyOf(p)))), picked: [] }))}>Delete {f.picked.length}</button>
          </>}
        </div>
        {!media.length ? <p style={{ color: C.muted, fontSize: 13.5, margin: 0 }}>No photos or videos yet.</p> : (
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(140px, 100%), 1fr))' }}>
            {shown.map(p => {
              const key = keyOf(p), video = p.type === 'video'
              return (
                <div key={key} style={{ border: `1px solid ${p.cover ? C.primary : C.border}`, borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                  <div style={{ height: 84, background: video ? 'linear-gradient(135deg, #1d1f27, #5a0a2a)' : 'linear-gradient(135deg, #e3edfb, #f7c4d1)', display: 'grid', placeItems: 'center',
                    color: video ? 'rgba(255,255,255,.75)' : 'rgba(29,35,48,.4)', position: 'relative', opacity: p.published ? 1 : 0.45 }}>
                    <Icon name={video ? 'video' : 'image'} size={26} />
                    {!video && (p.file || p.preview) && <span style={{ position: 'absolute', inset: 0 }}><Photo src={p.file || p.preview} alt={p.name} /></span>}
                    <input type="checkbox" aria-label={`Select ${p.name}`} checked={f.picked.includes(key)} onChange={() => setF(x => ({ ...x, picked: x.picked.includes(key) ? x.picked.filter(y => y !== key) : [...x.picked, key] }))}
                      style={{ position: 'absolute', top: 6, left: 6, accentColor: C.primary }} />
                    {(p.cover || video) && <span style={{ position: 'absolute', top: 6, right: 6, fontSize: 11.5, fontWeight: 700, background: video ? 'rgba(255,255,255,.9)' : C.primary, color: video ? C.text : '#fff', borderRadius: 4, padding: '1px 5px' }}>{video ? 'Video' : 'Cover'}</span>}
                  </div>
                  <div style={{ padding: '6px 8px', fontSize: 12 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }} title={p.name}>{p.name}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      <button style={{ ...small, fontSize: 12, padding: '2px 6px' }} onClick={() => setOne(key, { published: !p.published })}>{p.published ? 'Unpublish' : 'Publish'}</button>
                      {!video && !p.cover && <button style={{ ...small, fontSize: 12, padding: '2px 6px' }} onClick={() => setF(x => ({ ...x, media: x.media.map(y => (y.type === 'photo' ? { ...y, cover: keyOf(y) === key } : y)) }))}>Set cover</button>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <p style={{ fontSize: 12.5, color: C.muted, margin: '10px 0 0' }}>Published photos and videos show on the SubSaleKing site. Unpublished ones stay private. (Demo: photos are kept as small previews in this browser; videos are not stored.)</p>
      </Modal>
    </>
  )
}

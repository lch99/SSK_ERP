import { useState } from 'react'
import { C, btn, btnPrimary, sel } from '../../styles.js'
import { LISTING_SETTINGS, CATEGORIES } from '../../demo/erpSample.js'
import { useErp } from '../ErpContext.jsx'
import { isAgent } from '../model.js'
import { Page, Card, Notice, FormField, FileInput, go, field } from '../ui.jsx'
import { PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { useReview, missing, needText, markGaps } from '../review.jsx'
import { rm } from '../format.js'
import ListingPreview from './ListingPreview.jsx'
import { STATES } from './options.js'
import { savePreviews } from '../photos.jsx'

// Add Property List: the current form's fields, in the same order.
export default function ListingNew() {
  const erp = useErp()
  const fb = useFeedback()
  const review = useReview()
  const { scoped: d, m } = erp
  // Product handlers are agents (office staff don't hold listings).
  const holders = d.staff.filter(s => isAgent(s) && s.status === 'active').sort((a, b) => a.short.localeCompare(b.short))
  // "Create Listing" on an owner request (#/listing-new?vr=<id>) fills in what the owner told us.
  const vr = m.data.vendorRequests.find(v => v.id === Number(new URLSearchParams(window.location.hash.split('?')[1] || '').get('vr')))
  const [f, setF] = useState(() => ({ type: vr?.forType === 'Rent' ? 'rental' : 'sale', state: vr ? m.data.areas.find(a => a.name === vr.area)?.state || 'Selangor' : 'Selangor',
    category: vr?.category && CATEGORIES[vr.category] ? vr.category : 'Condominium', tenure: 'Freehold', race: 'cina', furnishing: 'Partly furnished',
    flags: [], holderId: String((vr?.handledBy && holders.find(s => s.id === vr.handledBy)?.id) || holders[0]?.id || ''),
    ...(vr ? { area: vr.area, askPrice: String(vr.price), ownerName: vr.name, ownerPhone: vr.phone } : {}) }))
  const [photoFiles, setPhotoFiles] = useState([])
  const photos = photoFiles.length
  const [videos, setVideos] = useState(0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const toggle = flag => setF({ ...f, flags: f.flags.includes(flag) ? f.flags.filter(x => x !== flag) : [...f.flags, flag] })
  const areas = [...new Set(m.data.areas.map(a => a.name))].sort()
  const titles = [...new Set(m.data.titles.filter(t => !f.area || t.area === f.area).map(t => t.name))].sort()
  // Before publishing: how it will look on the website, and the private details.
  async function preview() {
    const gaps = missing([['Area', f.area], ['Title (building / taman)', f.title], ['Advertised Price', f.askPrice], ['Unit Number & Jalan', f.unit], ['Owner Name', f.ownerName], ['Owner Contact', f.ownerPhone]])
    if (gaps.length) { setError(needText(gaps)); if (!markGaps(gaps)) window.scrollTo(0, 0); return false }
    const race = { cina: 'Chinese', india: 'Indian', melayu: 'Malay', 'malay-reserved': 'Malay Reserved' }[f.race]
    const price = v => (Number(v) > 0 ? rm(Number(v)) : '')
    return review({
      title: 'Preview before publishing', confirmLabel: 'Publish listing',
      intro: 'This is how the listing will look on the SubSaleKing website once it is published. Check it, then publish, or go back to edit.',
      warnings: [!photos && 'No photos yet. Listings with photos get far more enquiries; you can add them now or later in Album.', !f.desc && 'No description yet.'],
      preview: <ListingPreview photos={photos} videos={videos} cover={photoFiles[0]} agent={m.staff[Number(f.holderId)]} l={{ ...f, description: f.desc }} />,
      sections: [{ title: 'Private', note: 'Never shown on the website', rows: [
        ['Owner', `${f.ownerName} · ${f.ownerPhone}`], ['Unit Number & Jalan', f.unit], ['Product Handler', m.staffName(Number(f.holderId))],
        ['Best Price', price(f.bestPrice)], ['Market Price', price(f.marketValue)], ['Vendor/Landlord Race', race],
        ['Settings', f.flags.join(', ')], ['Personal Use Remarks', f.remarks],
      ] }],
    })
  }
  async function save(draft) {
    setError(null)
    if (!draft && !await preview()) return
    setBusy(true)
    try {
      // Each photo is kept as a small preview; the first is the cover.
      const keys = await savePreviews(photoFiles)
      const photoSet = photoFiles.map((file, i) => ({ id: i + 1, name: file.name, published: true, cover: i === 0, preview: keys[i] }))
      const st = await erp.addListing({ ...f, draft, photoSet, videos, askPrice: f.askPrice, ownerName: f.ownerName, ownerPhone: f.ownerPhone, address: [f.unit, f.title, f.area].filter(Boolean).join(', ') })
      const made = st.data.listings.reduce((a, b) => (b.id > a.id ? b : a))
      if (vr) await erp.setVendorRequest(vr.id, 2, made.id)
      fb.toast(`${made.code} ${draft ? 'saved as draft' : 'published'}${vr ? ` · ticket ${vr.ticket} set to Listing Created` : ''}`)
      go(`listings/${made.id}`)
    } catch (e) { setError(e.message); window.scrollTo(0, 0) } finally { setBusy(false) }
  }
  const grid = { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))' }
  const radio = (k, opts) => (
    <div style={{ display: 'flex', gap: 14, paddingTop: 6, flexWrap: 'wrap' }}>
      {opts.map(([v, l]) => <label key={v} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 14 }}><input type="radio" checked={f[k] === v} onChange={() => setF({ ...f, [k]: v })} style={{ accentColor: C.primary }} />{l}</label>)}
    </div>
  )
  return (
    <Page title="Add a listing" help={PAGE.listingNew} back={{ to: 'listings', label: 'All listings' }} sub="New listings are published to the SubSaleKing site once saved.">
      {vr && <Notice tone="blue">From owner request <b>{vr.ticket}</b> ({vr.name}, {vr.phone}). Saving links the listing to it.</Notice>}
      {error && <Notice tone="red">{error}</Notice>}
      <div style={{ display: 'grid', gap: 16 }}>
        <Card title="Property">
          <div style={grid}>
            <FormField label="Listing for" wide>{radio('type', [['sale', 'For Sale'], ['rental', 'For Rent']])}</FormField>
            <FormField label="State">
              <select style={{ ...sel, width: '100%' }} value={f.state} onChange={set('state')}>{STATES.map(s => <option key={s} value={s}>{s}</option>)}</select>
            </FormField>
            <FormField label="Area" required>
              <input style={field} list="areas" value={f.area || ''} onChange={set('area')} placeholder="e.g. Taman Desa" />
              <datalist id="areas">{areas.map(a => <option key={a} value={a} />)}</datalist>
            </FormField>
            <FormField label="Title (building / taman)" required>
              <input style={field} list="titles" value={f.title || ''} onChange={set('title')} placeholder="e.g. Residensi Harmoni" />
              <datalist id="titles">{titles.map(t => <option key={t} value={t} />)}</datalist>
            </FormField>
            <FormField label="Categories">
              <select style={{ ...sel, width: '100%' }} value={f.category} onChange={set('category')}>{Object.keys(CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}</select>
            </FormField>
            <FormField label="Built up / Land area (sq ft)"><input type="number" style={field} value={f.builtUp || ''} onChange={set('builtUp')} /></FormField>
            <FormField label="Tenure">
              <select style={{ ...sel, width: '100%' }} value={f.tenure} onChange={set('tenure')}><option value="Freehold">Freehold</option><option value="Leasehold">Leasehold</option></select>
            </FormField>
            <FormField label="Vendor/Landlord Race">
              <select style={{ ...sel, width: '100%' }} value={f.race} onChange={set('race')}>
                {[['cina', 'Chinese'], ['india', 'Indian'], ['melayu', 'Malay'], ['malay-reserved', 'Malay Reserved']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </FormField>
          </div>
        </Card>
        <Card title="Price and details">
          <div style={grid}>
            <FormField label="Best Price (RM)"><input type="number" style={field} value={f.bestPrice || ''} onChange={set('bestPrice')} /></FormField>
            <FormField label="Advertised Price (Ad Price, RM)" required><input type="number" style={field} value={f.askPrice || ''} onChange={set('askPrice')} /></FormField>
            <FormField label="Market Price (RM)"><input type="number" style={field} value={f.marketValue || ''} onChange={set('marketValue')} /></FormField>
            <FormField label="Bedrooms"><input type="number" style={field} value={f.beds || ''} onChange={set('beds')} /></FormField>
            <FormField label="Bathrooms"><input type="number" style={field} value={f.baths || ''} onChange={set('baths')} /></FormField>
            <FormField label="Car Parks"><input type="number" style={field} value={f.parks || ''} onChange={set('parks')} /></FormField>
            <FormField label="Furnishing" wide>{radio('furnishing', [['Unfurnished', 'Non-Furnish'], ['Partly furnished', 'Partial Furnished'], ['Fully furnished', 'Furnitured']])}</FormField>
            <FormField label="Settings" wide>
              <div style={{ display: 'flex', gap: '8px 16px', flexWrap: 'wrap', paddingTop: 4 }}>
                {LISTING_SETTINGS.map(flag => (
                  <label key={flag} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13.5 }}>
                    <input type="checkbox" checked={f.flags.includes(flag)} onChange={() => toggle(flag)} style={{ accentColor: C.primary }} />{flag}
                  </label>
                ))}
              </div>
            </FormField>
            <FormField label="Full Descriptions" wide><textarea style={{ ...field, minHeight: 80 }} value={f.desc || ''} onChange={set('desc')} /></FormField>
          </div>
        </Card>
        <Card title="Owner (private)">
          <div style={grid}>
            <FormField label="Unit Number & Jalan" required><input style={field} value={f.unit || ''} onChange={set('unit')} placeholder="Lot Number" /></FormField>
            <FormField label="Owner Name" required><input style={field} value={f.ownerName || ''} onChange={set('ownerName')} /></FormField>
            <FormField label="Owner Contact" required><input style={field} value={f.ownerPhone || ''} onChange={set('ownerPhone')} /></FormField>
            <FormField label="Product Handler">
              <select style={{ ...sel, width: '100%' }} value={f.holderId} onChange={set('holderId')}>{holders.map(s => <option key={s.id} value={s.id}>{s.short} {s.code}</option>)}</select>
            </FormField>
            <FormField label="Personal Use Remarks" wide><textarea style={{ ...field, minHeight: 60 }} value={f.remarks || ''} onChange={set('remarks')} /></FormField>
          </div>
        </Card>
        <Card title="Photos and videos">
          <div style={{ display: 'grid', gap: 12 }}>
            <FormField label="Photos" help="The first one is the cover; pick another later in Album."><FileInput kind="photo" onChange={setPhotoFiles} /></FormField>
            <FormField label="Videos" help="Optional: a walk-through of the house, the facilities or the neighbourhood."><FileInput kind="listingVideo" onChange={files => setVideos(files.length)} /></FormField>
          </div>
          <p style={{ fontSize: 12.5, color: C.muted, margin: '8px 0 0' }}>(Demo: photos are kept as small previews in this browser; videos are not stored.)</p>
        </Card>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => save(false)}>Preview &amp; publish</button>
        <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => save(true)}>Save as Draft</button>
        <button style={btn} onClick={() => go('listings')}>Cancel</button>
      </div>
    </Page>
  )
}

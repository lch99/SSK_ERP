import { useState } from 'react'
import * as P from '../../../shared/payout.js'
import { C, btn, btnPrimary } from '../../styles.js'
import { docNames } from '../../demo/erpSample.js'
import { useErp } from '../ErpContext.jsx'
import { PARTY, DEAL_STATUS, isAgent, r2 } from '../model.js'
import { Page, Card, Segmented, Select, Notice, FormField, FileInput, TextArea, KV, Status, go, field, mono, tabular } from '../ui.jsx'
import { CARD, PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { rm, rm0, pct } from '../format.js'
import { BANKS } from './options.js'
import { useCan } from '../access.jsx'

// New E-Form ("Submit New Case") and Edit E-Form, in the current form's order:
// the case, purchaser/tenant, vendor/landlord, deposits (rent), others (fees,
// co-broke, introducer), supporting documents. Totals work out as you type,
// with the same rules the server checks (shared/payout.js).
const blankParty = () => ({ name: '', ic: '', phone: '', address: '', email: '' })
const grid = { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))' }

function fromDeal(d) {
  return {
    type: d.type, date: d.date, listingId: d.listingId ? String(d.listingId) : '', agentId: String(d.agentId), holderId: d.holderId != null ? String(d.holderId) : '',
    price: String(d.price), feePct: String(d.feePct), fee: String(d.fee), buyer: { ...blankParty(), ...d.buyer }, owner: { ...blankParty(), ...d.owner },
    otherBuyers: (d.otherBuyers || []).map(p => ({ ...blankParty(), ...p })), otherOwners: (d.otherOwners || []).map(p => ({ ...blankParty(), ...p })),
    coBroke: d.coBroke ? { agency: '', licence: '', agent: '', phone: '', address: '', ...d.coBroke } : null,
    referral: d.referral ? { name: '', ic: '', phone: '', bank: '', account: '', ...d.referral } : null,
    rental: d.rental ? { ...d.rental } : { months: 12, deposit: 2, utility: 0.5, advance: 1, taFee: 0 },
    property: { title: d.property.title, address: d.property.address, category: d.property.category }, remark: d.remark || '', files: {},
  }
}

export default function DealForm({ id }) {
  const erp = useErp()
  const can = useCan()
  const { m, setup } = erp
  const fb = useFeedback()
  const deal = id ? m.deals[id] : null
  const enabled = P.DEAL_TYPES.filter(t => setup.dealTypes[t]?.enabled)
  const query = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const [f, setF] = useState(() => {
    if (deal) return fromDeal(deal)
    const type = enabled.includes(query.get('type')) ? query.get('type') : enabled[0]
    const rate = setup.dealTypes[type]?.defaultRate ?? 2
    const start = { type, date: m.today, listingId: '', agentId: '', holderId: '', price: '', feePct: String(rate), fee: '', buyer: blankParty(), owner: blankParty(),
      otherBuyers: [], otherOwners: [], coBroke: null, referral: null, rental: { months: 12, deposit: 2, utility: 0.5, advance: 1, taFee: 0 },
      property: { title: '', address: '', category: 'Condominium' }, remark: '', files: {} }
    const l = m.listings[Number(query.get('listing'))]
    return l ? pickListing(start, l) : start
  })
  const [errors, setErrors] = useState(null)
  const [busy, setBusy] = useState(false)
  if (id && !deal) return <Page title="E-Form not found" back={{ to: 'deals', label: 'All E-Forms' }}><Notice tone="red">This E-Form no longer exists.</Notice></Page>
  const locked = deal && (m.closesByDeal[deal.id] || []).length > 0
  const party = PARTY[f.type]
  const dt = setup.dealTypes

  // Picking a listing fills in its owner, product handler and asking price.
  function pickListing(state, l) {
    const price = state.price || String(l.askPrice)
    return { ...state, listingId: String(l.id), holderId: String(l.holderId), price, fee: price ? String(r2(Number(price) * Number(state.feePct) / 100)) : state.fee,
      owner: state.owner.name && state.listingId === String(l.id) ? state.owner : { ...blankParty(), name: l.owner.name, ic: l.owner.ic || '', phone: l.owner.phone },
      property: { title: l.title, address: l.address, category: l.category } }
  }
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const setIn = (k, sub, v) => setF(s => ({ ...s, [k]: { ...s[k], [sub]: v } }))
  const setPrice = v => setF(s => ({ ...s, price: v, fee: v && s.feePct !== '' ? String(r2(Number(v) * Number(s.feePct) / 100)) : s.fee }))
  const setPct = v => setF(s => ({ ...s, feePct: v, fee: s.price && v !== '' ? String(r2(Number(s.price) * Number(v) / 100)) : s.fee }))
  const setFee = v => setF(s => ({ ...s, fee: v, feePct: s.price && v !== '' ? String(r2(Number(v) / Number(s.price) * 100)) : s.feePct }))
  const setType = t => setF(s => ({ ...s, type: t, listingId: '', holderId: '', feePct: String(dt[t]?.defaultRate ?? s.feePct), fee: s.price ? String(r2(Number(s.price) * Number(dt[t]?.defaultRate ?? 0) / 100)) : '' }))

  const listing = f.listingId ? m.listings[Number(f.listingId)] : null
  const listings = m.data.listings.filter(l => l.type === f.type && (l.id === Number(f.listingId) || (l.status === 'active' && (!l.dealId || l.dealId === deal?.id || m.deals[l.dealId]?.status === 'cancelled'))))
    .sort((a, b) => b.id - a.id)
  const agents = m.data.staff.filter(s => (isAgent(s) && s.status === 'active') || String(s.id) === f.agentId).sort((a, b) => a.short.localeCompare(b.short))
  const holders = listing ? [...new Set([listing.holderId, ...(listing.share?.coPh || []).map(c => c.staffId)])].map(sid => m.staff[sid]).filter(Boolean) : []
  const agent = m.staff[Number(f.agentId)]
  const bm = agent && m.branchManagerOf(agent.id), am = agent && m.areaManagerOf(agent.id)
  const money = P.dealMoney({ fee: Number(f.fee) || 0, sstPct: dt.sstPct, sstMode: dt.sstMode, coBroke: !!f.coBroke, coaSharePct: dt.coaSharePct, referral: !!f.referral, referralPct: dt.referralPct })
  const docs = docNames(f.type, !!f.coBroke)

  const body = extra => ({ ...f, ...extra })
  async function save(submit) {
    setErrors(null)
    if (submit) {
      const ok = await fb.confirm({ title: deal ? `Submit ${deal.code}?` : 'Submit this E-Form?', confirmLabel: 'Submit',
        body: <KV min={150} items={[
          ['Form type', P.DEAL_TYPE_LABELS[f.type]], ['Listing', listing?.code || '—'], [f.type === 'rental' ? 'Rent' : 'Selling Price', rm(Number(f.price) || 0)],
          ['Vendor Professional Fees', rm(Number(f.fee) || 0)], ['SST', rm(money.sst)], ['Total Commission', rm(money.billed - money.coBroke - money.referral)],
          ['Net Total Commission', <b>{rm(money.net)}</b>],
        ]} /> })
      if (!ok) return
    }
    setBusy(true)
    try {
      if (deal) {
        await erp.updateDeal(deal.id, body({ submit }))
        for (const [name, file] of Object.entries(f.files)) await erp.setDealDoc(deal.id, name, file)
        fb.toast(submit && deal.status === 'draft' ? `${deal.code} submitted` : `${deal.code} saved`)
        go(`deals/${deal.id}`)
      } else {
        const s = await erp.addDeal(body({ submit }))
        const made = s.data.deals.reduce((a, b) => (b.id > a.id ? b : a))
        fb.toast(`${made.code} ${submit ? 'submitted' : 'saved as Draft'}`, { action: { label: 'Add Transaction', onClick: () => go(`money-in/new/${made.id}`) } })
        go(`deals/${made.id}`)
      }
    } catch (e) {
      setErrors(e.message)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally { setBusy(false) }
  }
  async function remove() {
    const ok = await fb.confirm({ title: `Delete ${deal.code}?`, body: 'The E-Form is removed and its listing is free again. This cannot be undone.', confirmLabel: 'Delete', danger: true })
    if (ok && await fb.run(() => erp.deleteDeal(deal.id), `${deal.code} deleted`)) go('deals')
  }

  const partyCard = (key, othersKey, title, required) => (
    <Card title={title} help={CARD.parties}>
      <div style={grid}>
        <FormField label="Name" required={required}><input style={field} value={f[key].name} onChange={e => setIn(key, 'name', e.target.value)} /></FormField>
        <FormField label="NRIC No"><input style={field} value={f[key].ic} onChange={e => setIn(key, 'ic', e.target.value)} placeholder="000000-00-0000" inputMode="numeric" /></FormField>
        <FormField label="Tel"><input style={field} type="tel" value={f[key].phone} onChange={e => setIn(key, 'phone', e.target.value)} placeholder="012-345 6789" /></FormField>
        <FormField label="Fax / E-mail"><input style={field} value={f[key].email} onChange={e => setIn(key, 'email', e.target.value)} /></FormField>
        <FormField label="Address" wide><input style={field} value={f[key].address} onChange={e => setIn(key, 'address', e.target.value)} /></FormField>
      </div>
      {f[othersKey].map((p, i) => (
        <div key={i} style={{ ...grid, marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${C.border}` }}>
          <FormField label={`Other ${title.toLowerCase().split(' / ')[0]} ${i + 1}`}><input style={field} value={p.name} onChange={e => set(othersKey, f[othersKey].map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></FormField>
          <FormField label="NRIC No" help="All 12 digits"><input style={field} value={p.ic} inputMode="numeric" onChange={e => set(othersKey, f[othersKey].map((x, j) => (j === i ? { ...x, ic: e.target.value } : x)))} /></FormField>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}><button type="button" style={{ ...btn, color: C.err }} onClick={() => set(othersKey, f[othersKey].filter((_, j) => j !== i))}>Remove</button></div>
        </div>
      ))}
      {f[othersKey].length < 2 && <button type="button" style={{ ...btn, marginTop: 12 }} onClick={() => set(othersKey, [...f[othersKey], blankParty()])}>+ Add another {title.toLowerCase().split(' / ')[0]}</button>}
    </Card>
  )

  return (
    <Page title={deal ? <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>Edit E-Form <span style={mono}>{deal.code}</span><Status of={DEAL_STATUS} value={deal.status} /></span> : 'Submit an E-Form'}
      help={PAGE.dealForm} back={deal ? { to: `deals/${deal.id}`, label: deal.code } : { to: 'deals', label: 'All E-Forms' }}
      sub={deal ? 'Change the E-Form. Every change is kept in the Deal change log.' : 'One E-Form per sale, rental or project unit. Save as Draft to finish later, or Submit to start collecting the money.'}>
      {errors && <Notice tone="red">{errors}</Notice>}
      {locked && <Notice tone="blue">Part of this case is closed, so the people, listing, price and fees are fixed. Parties, documents and remarks can still change.</Notice>}
      <div style={{ display: 'grid', gap: 16 }}>
        <Card title="The case" help={CARD.eform}>
          <div style={grid}>
            {enabled.length > 1 && (
              <FormField label="Form type" wide>
                <div style={{ opacity: locked ? 0.6 : 1, pointerEvents: locked ? 'none' : 'auto' }}>
                  <Segmented label="Form type" value={f.type} onChange={setType} options={enabled.map(t => ({ key: t, label: t === 'sale' ? 'Sales' : P.DEAL_TYPE_LABELS[t] }))} />
                </div>
              </FormField>
            )}
            <FormField label="Date" help="Date of the letter of offer / booking"><input type="date" style={field} value={f.date} max={m.today} onChange={e => set('date', e.target.value)} /></FormField>
            <FormField label="Agent Name (Sale Staff)" required>
              <Select block plain label="Agent" value={f.agentId} onChange={v => set('agentId', v)}
                options={[{ value: '', label: 'Select the agent' }, ...agents.map(s => ({ value: String(s.id), label: `${s.short} (${s.code})` }))]} />
            </FormField>
            <FormField label="Branch Manager · Area Manager"><input style={{ ...field, background: C.bg }} readOnly value={agent ? `${bm?.short || '—'} · ${am?.short || '—'}` : 'From the agent'} /></FormField>
            {f.type !== 'project' ? (
              <>
                <FormField label="Listing" required help={listings.length ? null : `No free ${f.type === 'sale' ? 'sale' : 'rental'} listing. Add the listing first.`}>
                  <Select block plain label="Listing" value={f.listingId} onChange={v => setF(s => (v ? pickListing(s, m.listings[Number(v)]) : { ...s, listingId: '', holderId: '' }))}
                    options={[{ value: '', label: 'Select the listing' }, ...listings.map(l => ({ value: String(l.id), label: `${l.code} · ${l.title}, ${l.area} · ${rm0(l.askPrice)}` }))]} />
                </FormField>
                <FormField label="Product Handler" help="The listing holder, or a co-product handler on it">
                  <Select block plain label="Product Handler" value={f.holderId} onChange={v => set('holderId', v)}
                    options={holders.length ? holders.map(s => ({ value: String(s.id), label: `${s.short} (${s.code})` })) : [{ value: '', label: 'From the listing' }]} />
                </FormField>
                <FormField label="Property Address" wide><input style={{ ...field, background: C.bg }} readOnly value={listing ? listing.address : 'From the listing'} /></FormField>
                <FormField label="Property Type"><input style={{ ...field, background: C.bg }} readOnly value={listing?.category || '—'} /></FormField>
              </>
            ) : (
              <>
                <FormField label="Project"><input style={field} value={f.property.title} onChange={e => setIn('property', 'title', e.target.value)} placeholder="e.g. Residensi Sentral" /></FormField>
                <FormField label="Unit Address" required wide><input style={field} value={f.property.address} onChange={e => setIn('property', 'address', e.target.value)} /></FormField>
                <FormField label="Property Type"><input style={field} value={f.property.category} onChange={e => setIn('property', 'category', e.target.value)} /></FormField>
              </>
            )}
            <FormField label={f.type === 'rental' ? 'Rent (RM / month)' : 'Selling Price (RM)'} required>
              <input style={field} type="number" min="0" value={f.price} onChange={e => setPrice(e.target.value)} />
            </FormField>
          </div>
        </Card>

        {partyCard('buyer', 'otherBuyers', `${party.buyer.toUpperCase()}`, true)}
        {partyCard('owner', 'otherOwners', `${party.owner.toUpperCase()}`, true)}

        {f.type === 'rental' && (
          <Card title="DEPOSIT / TENANCY AGREEMENT" help={CARD.tenancy}>
            <div style={grid}>
              <FormField label="Tenancy (months)"><input style={field} type="number" min="1" value={f.rental.months} onChange={e => setIn('rental', 'months', e.target.value)} /></FormField>
              <FormField label="Rental Deposit (months)" help={rm((Number(f.price) || 0) * Number(f.rental.deposit || 0))}><input style={field} type="number" min="0" step="0.5" value={f.rental.deposit} onChange={e => setIn('rental', 'deposit', e.target.value)} /></FormField>
              <FormField label="Utility Deposit (months)" help={rm((Number(f.price) || 0) * Number(f.rental.utility || 0))}><input style={field} type="number" min="0" step="0.5" value={f.rental.utility} onChange={e => setIn('rental', 'utility', e.target.value)} /></FormField>
              <FormField label="Advance Rental (months)" help={rm((Number(f.price) || 0) * Number(f.rental.advance || 0))}><input style={field} type="number" min="0" step="0.5" value={f.rental.advance} onChange={e => setIn('rental', 'advance', e.target.value)} /></FormField>
              <FormField label="Tenancy Fees (RM)" help="Paid to the lawyer for the tenancy agreement"><input style={field} type="number" min="0" value={f.rental.taFee} onChange={e => setIn('rental', 'taFee', e.target.value)} /></FormField>
            </div>
          </Card>
        )}

        <Card title="OTHERS" help={CARD.others}>
          <div style={grid}>
            <FormField label="Commission (% of price)"><input style={field} type="number" min="0" step="0.25" value={f.feePct} onChange={e => setPct(e.target.value)} disabled={locked} /></FormField>
            <FormField label="Vendor Professional Fees (RM)" required help={dt.sstMode === 'included' ? `Includes ${pct(dt.sstPct)} SST` : `${pct(dt.sstPct)} SST is added on top`}>
              <input style={field} type="number" min="0" value={f.fee} onChange={e => setFee(e.target.value)} disabled={locked} />
            </FormField>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, fontWeight: 600, margin: '16px 0 10px' }}>
            <input type="checkbox" disabled={locked} checked={!!f.coBroke} onChange={e => set('coBroke', e.target.checked ? { agency: '', licence: '', agent: '', phone: '', address: '' } : null)} style={{ accentColor: C.primary }} />
            Got Co-Bro Agency
          </label>
          {f.coBroke && (
            <div style={grid}>
              <FormField label="Co-bro Agency Name" required><input style={field} value={f.coBroke.agency} onChange={e => setIn('coBroke', 'agency', e.target.value)} /></FormField>
              <FormField label="Agency Reg Number"><input style={field} value={f.coBroke.licence} onChange={e => setIn('coBroke', 'licence', e.target.value)} placeholder="E (1) 1234" /></FormField>
              <FormField label="Agent"><input style={field} value={f.coBroke.agent} onChange={e => setIn('coBroke', 'agent', e.target.value)} /></FormField>
              <FormField label="Tel (Office)"><input style={field} value={f.coBroke.phone} onChange={e => setIn('coBroke', 'phone', e.target.value)} /></FormField>
              <FormField label="Agency Address" wide><input style={field} value={f.coBroke.address} onChange={e => setIn('coBroke', 'address', e.target.value)} /></FormField>
              <FormField label="Co-bro Fees" help={`The co-bro agency keeps ${100 - Number(dt.coaSharePct)}% (Setup)`}><input style={{ ...field, background: C.bg }} readOnly value={rm(money.coBroke)} /></FormField>
            </div>
          )}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, fontWeight: 600, margin: '16px 0 10px' }}>
            <input type="checkbox" disabled={locked} checked={!!f.referral} onChange={e => set('referral', e.target.checked ? { name: '', ic: '', phone: '', bank: '', account: '' } : null)} style={{ accentColor: C.primary }} />
            Got Introducer
          </label>
          {f.referral && (
            <div style={grid}>
              <FormField label="Introducer IC Name" required><input style={field} value={f.referral.name} onChange={e => setIn('referral', 'name', e.target.value)} /></FormField>
              <FormField label="Introducer IC Number"><input style={field} value={f.referral.ic} onChange={e => setIn('referral', 'ic', e.target.value)} /></FormField>
              <FormField label="Introducer Tel"><input style={field} value={f.referral.phone} onChange={e => setIn('referral', 'phone', e.target.value)} /></FormField>
              <FormField label="Introducer Bank Name">
                <Select block plain label="Bank" value={f.referral.bank} onChange={v => setIn('referral', 'bank', v)} options={[{ value: '', label: 'Select bank' }, ...BANKS.map(b => ({ value: b, label: b }))]} />
              </FormField>
              <FormField label="Introducer Bank Account"><input style={field} value={f.referral.account} onChange={e => setIn('referral', 'account', e.target.value)} /></FormField>
              <FormField label="Introducer Fees" help={`${dt.referralPct}% (Setup) · max 20% of the Vendor Professional Fees (${rm(r2(money.fee * 0.2))})`}>
                <input style={{ ...field, background: C.bg }} readOnly value={rm(money.referral)} />
              </FormField>
            </div>
          )}
          <div style={{ marginTop: 16, padding: 14, background: C.bg, borderRadius: 10, display: 'grid', gap: 6, fontSize: 14 }}>
            {[['SST amount', money.sst], ['Total Commission', r2(money.billed - money.coBroke - money.referral)], ['Net Total Commission (shared out)', money.net]].map(([l, v], i) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontWeight: i === 2 ? 700 : 500 }}><span>{l}</span><span style={tabular}>{rm(v)}</span></div>
            ))}
          </div>
        </Card>

        <Card title="Supporting Document Attachments" help={CARD.docs} sub={`${docs.length} documents must be uploaded before the case can close. Upload them now or later.`}>
          <div style={grid}>
            {docs.map(name => (
              <FormField key={name} label={name} help={deal?.docs?.[name] ? `Uploaded${deal.files?.[name] ? `: ${deal.files[name]}` : ''}` : null}>
                <FileInput kind="document" onChange={files => setF(s => ({ ...s, files: files[0] ? { ...s.files, [name]: files[0].name } : Object.fromEntries(Object.entries(s.files).filter(([k]) => k !== name)) }))} />
              </FormField>
            ))}
          </div>
        </Card>

        <Card title="Remarks">
          <TextArea value={f.remark} onChange={e => set('remark', e.target.value)} placeholder="Anything accounts or the approver should know" />
        </Card>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        {(!deal || deal.status === 'draft') && <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => save(true)}>Submit</button>}
        <button style={deal && deal.status !== 'draft' ? { ...btnPrimary, opacity: busy ? 0.6 : 1 } : btn} disabled={busy} onClick={() => save(false)}>{deal ? 'Save changes' : 'Save as Draft'}</button>
        <button style={btn} onClick={() => go(deal ? `deals/${deal.id}` : 'deals')}>Cancel</button>
        <span style={{ flex: 1 }} />
        {deal && !locked && can('deals', 'full') && <button style={{ ...btn, color: C.err }} onClick={remove}>Delete E-Form</button>}
      </div>
    </Page>
  )
}

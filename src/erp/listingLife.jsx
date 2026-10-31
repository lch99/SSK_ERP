import { useState } from 'react'
import * as L from '../../shared/listings.js'
import { C, btn, btnPrimary } from '../styles.js'
import { useErp } from './ErpContext.jsx'
import { useAccess, useCan } from './access.jsx'
import { useFeedback } from './feedback.jsx'
import { isAgent } from './model.js'
import { Pill, Modal, FormField, Select, TextArea, Notice, Link, field, small, mono } from './ui.jsx'
import { missing, needText, markGaps } from './review.jsx'
import Icon from './Icon.jsx'
import { date } from './format.js'

// Pieces the listing pages share for the rules in shared/listings.js: who is
// looking, what of the owner they may see, favourites, the price pill, the
// hot-list tags and the Book a viewing dialog.

// The person using the ERP: their staff id (`key` is 0 for the office's demo
// user, who has none), their branch, and their agent id when they sign in as one.
export function useViewer() {
  const a = useAccess()
  const { m } = useErp()
  const staffId = a?.who?.staffId ?? null
  return { key: staffId ?? 0, staffId, agentId: a?.agentId ?? null, branchId: (staffId != null ? m?.staff[staffId]?.branchId : null) ?? a?.who?.branchId ?? null }
}

// What of a listing's owner the viewer may see: 'full' for the product handler
// and the creator (the owner deals with them); 'ask' for others tied to it and
// the office staff who edit listings (shown on "Show", and logged); 'none' for
// everyone else, who books viewings through the product handler instead.
export function useOwnerSight() {
  const { m } = useErp()
  const v = useViewer()
  const can = useCan()
  return l => {
    const roles = L.listingRoles(l, v.staffId, { title: m.titles[l.titleId], leaders: m.chain(l.holderId).map(p => p.id) })
    if (roles.includes('holder') || roles.includes('creator')) return { level: 'full', roles }
    if (roles.length || (!v.agentId && can('listings', 'edit'))) return { level: 'ask', roles }
    return { level: 'none', roles }
  }
}

// The owner's name and contact, as far as the viewer may see them. `reveal`
// (in the listing's details) offers "Show" to those who may ask, and logs it.
export function OwnerContact({ l, sight, reveal = false }) {
  const erp = useErp()
  const v = useViewer()
  const fb = useFeedback()
  const [shown, setShown] = useState(false)
  if (sight.level === 'none') return <span style={{ fontSize: 12.5, color: C.muted }}>Hidden<span style={{ display: 'block' }}>Ask the product handler</span></span>
  const open = sight.level === 'full' || shown
  const show = async () => { if (await fb.run(() => erp.revealOwner(l.id, v.key))) setShown(true) }
  return (
    <span style={{ fontSize: 12.5 }}>{l.owner.name}
      <span style={{ display: 'flex', gap: 6, alignItems: 'center', color: C.muted }}>
        <span style={open ? undefined : mono}>{open ? l.owner.phone : L.hidePhone(l.owner.phone)}</span>
        {reveal && !open && <button style={{ ...small, padding: '1px 8px', fontSize: 12 }} onClick={show}>Show</button>}
      </span>
    </span>
  )
}

export function FavStar({ kind, id, size = 16, label }) {
  const erp = useErp()
  const v = useViewer()
  const fb = useFeedback()
  const can = useCan()
  if (!can('listings', 'view')) return null
  const on = (erp.m.data.favourites?.[v.key]?.[kind] || []).includes(id)
  const toggle = e => {
    e.stopPropagation()
    fb.run(() => erp.toggleFavourite(kind, id, v.key), on ? 'Removed from your favourites' : 'Added to your favourites: you will hear about price changes and where it goes')
  }
  return (
    <button type="button" onClick={toggle} aria-pressed={on} aria-label={on ? 'Remove from favourites' : 'Add to favourites'} title={on ? 'In your favourites' : 'Add to favourites'}
      style={{ ...small, padding: label ? '4px 10px' : 5, display: 'inline-flex', gap: 6, alignItems: 'center', color: on ? '#b77900' : C.muted, background: on ? '#fff7e0' : '#fff' }}>
      <Icon name="star" size={size} fill={on ? '#f5b400' : 'none'} />{label && (on ? 'Favourite' : label)}
    </button>
  )
}

export function RatingPill({ l, long = false }) {
  const r = L.priceRating(l)
  if (!r) return null
  const s = L.RATING[r.band]
  const vs = `${r.pct > 0 ? '+' : ''}${r.pct}% vs market`
  return <Pill tone={s.tone} dot={false} title={`${s.label}: ${vs}. ${s.help}`} style={{ fontSize: 11 }}>{long ? `${s.label} · ${vs}` : s.label}</Pill>
}

export function HotTags({ l }) {
  const hot = L.hotLists(l)
  if (!hot.length) return null
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {hot.map(k => (
        <span key={k} title={L.HOT_LISTS[k].help} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, color: '#b42318', background: '#fff1ec', borderRadius: 999, padding: '1px 7px' }}>
          <Icon name="flame" size={11} stroke={2.2} />{L.HOT_LISTS[k].label}
        </span>
      ))}
    </span>
  )
}

const LENGTHS = [30, 45, 60, 90]
const SLOT_TIMES = Array.from({ length: 27 }, (_, i) => { const t = 9 * 60 + i * 30; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` })

// Book a viewing of `listing`: the agent bringing the customer asks; the
// listing's product handler confirms with the owner. Shows the handler's other
// viewings that day, so a free time is easy to pick.
export function BookViewing({ listing, open, onClose }) {
  const erp = useErp()
  const { m } = erp
  const v = useViewer()
  const fb = useFeedback()
  const start = () => ({ requestedBy: v.agentId ? String(v.agentId) : '', customerId: '', customerName: '', customerPhone: '', date: '', time: '10:00', minutes: '30', extra: '', remark: '' })
  const [f, setF] = useState(start)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  if (!open || !listing) return null
  const set = k => e => setF(x => ({ ...x, [k]: e.target ? e.target.value : e }))
  const agents = m.data.staff.filter(s => s.status === 'active' && isAgent(s)).sort((a, b) => a.short.localeCompare(b.short))
  const customers = f.requestedBy ? m.data.customers.filter(c => c.ownerId === Number(f.requestedBy) && c.track === 0) : []
  const twins = m.data.listings.filter(x => x.id !== listing.id && x.status === 'active' && x.titleId === listing.titleId && x.type === listing.type)
  const busyThatDay = (m.data.viewings || []).filter(x => x.handlerId === listing.holderId && x.date === f.date && ['new', 'rescheduled', 'confirmed'].includes(x.status))
    .sort((a, b) => a.time.localeCompare(b.time))
  const close = () => { setF(start()); setError(null); onClose() }
  const save = async () => {
    const gaps = missing([['Agent bringing the customer', f.requestedBy], ['Customer', f.customerId || f.customerName], ['Customer phone', f.customerId || f.customerPhone], ['Date', f.date], ['Time', f.time]])
    if (gaps.length) { setError(needText(gaps)); markGaps(gaps); return }
    setBusy(true); setError(null)
    try {
      await erp.bookViewing({ ...f, listingIds: [listing.id, ...(f.extra ? [Number(f.extra)] : [])] })
      fb.toast(listing.holderId === Number(f.requestedBy) ? 'Viewing booked and confirmed (it is your own listing)' : `Viewing requested. ${m.staffName(listing.holderId)} confirms it with the owner.`)
      close()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const pickCustomer = id => {
    const c = m.data.customers.find(x => x.id === Number(id))
    setF(x => ({ ...x, customerId: id, customerName: c?.name || '', customerPhone: c?.phone || '' }))
  }
  return (
    <Modal open onClose={close} title={`Book a viewing · ${listing.code}`} width={600}
      footer={<><button style={btn} onClick={close}>Cancel</button><button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>Book viewing</button></>}>
      {error && <Notice tone="red">{error}</Notice>}
      <p style={{ fontSize: 13.5, marginTop: 0 }}>{listing.title}, {listing.area}. <b>{m.staffName(listing.holderId)}</b> (the product handler) confirms the time with the owner; you hear back here and in your notifications.</p>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))' }}>
        <FormField label="Agent bringing the customer" required>
          <Select block plain label="Agent" value={f.requestedBy} onChange={id => setF(x => ({ ...x, requestedBy: id, customerId: '' }))}
            options={[{ value: '', label: 'Select agent' }, ...agents.map(s => ({ value: String(s.id), label: `${s.short} (${s.code})` }))]} />
        </FormField>
        <FormField label="Customer" required name="Customer" help={customers.length ? 'One of their customers, or type a new one below' : 'Type the customer’s name below'}>
          <Select block plain label="Customer" value={f.customerId} onChange={pickCustomer}
            options={[{ value: '', label: customers.length ? 'New customer' : 'No saved customers' }, ...customers.map(c => ({ value: String(c.id), label: `${c.name} · ${c.phone}` }))]} />
        </FormField>
        {!f.customerId && <>
          <FormField label="Customer name" name="Customer"><input style={field} value={f.customerName} onChange={set('customerName')} /></FormField>
          <FormField label="Customer phone" help="e.g. 012-3456789"><input style={field} type="tel" value={f.customerPhone} onChange={set('customerPhone')} /></FormField>
        </>}
        <FormField label="Date" required><input type="date" style={field} value={f.date} min={m.today} onChange={set('date')} /></FormField>
        <FormField label="Time" required>
          <Select block plain label="Time" value={f.time} onChange={set('time')} options={SLOT_TIMES.map(t => ({ value: t, label: t }))} />
        </FormField>
        <FormField label="How long"><Select block plain label="How long" value={f.minutes} onChange={set('minutes')} options={LENGTHS.map(n => ({ value: String(n), label: `${n} minutes` }))} /></FormField>
        {twins.length > 0 && (
          <FormField label="Also view" help={`Another unit in ${listing.title}, same visit`}>
            <Select block plain label="Also view" value={f.extra} onChange={set('extra')} options={[{ value: '', label: 'Just this one' }, ...twins.map(x => ({ value: String(x.id), label: `${x.code} · ${x.address.split(',')[0]}` }))]} />
          </FormField>
        )}
        <FormField label="Remarks" wide><TextArea value={f.remark} onChange={set('remark')} onSubmit={save} placeholder="e.g. Customer prefers a high floor; coming with their parents" /></FormField>
      </div>
      {f.date && (
        <div style={{ marginTop: 12, fontSize: 13, color: C.muted }}>
          {busyThatDay.length
            ? <>{m.staffName(listing.holderId)} already has on {date(f.date)}: {busyThatDay.map(x => <span key={x.id} style={{ display: 'inline-block', marginRight: 8 }}><b style={{ color: C.text }}>{x.time}–{x.end}</b> <Link to={`appointments/${x.id}`} style={mono}>{x.code}</Link></span>)}</>
            : <>{m.staffName(listing.holderId)} has no other viewings on {date(f.date)}.</>}
        </div>
      )}
    </Modal>
  )
}

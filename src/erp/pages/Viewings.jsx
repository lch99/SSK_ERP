import { useMemo, useState } from 'react'
import * as L from '../../../shared/listings.js'
import { C, btn, btnPrimary } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, Status, Link, Drawer, Block, KV, Who, Modal, FormField, TextArea, Notice, Empty, Stat, Pill, cols, go, mono, small, field } from '../ui.jsx'
import { PAGE, CARD } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { useCan } from '../access.jsx'
import { useViewer, BookViewing } from '../listingLife.jsx'
import { date } from '../format.js'
import Icon from '../Icon.jsx'

// Viewings (the current app's appointments): the agent bringing a customer
// books; the listing's product handler confirms with the owner, or either side
// moves or cancels it; afterwards the agent reviews it, which goes on the
// listing's follow-ups. Unconfirmed viewings expire at their time, and a
// review is due within 24 hours (shared/listings.js).
const TIMES = Array.from({ length: 27 }, (_, i) => { const t = 9 * 60 + i * 30; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` })
const OPEN = ['new', 'rescheduled', 'confirmed']
const minutesOf = v => { const [a, b] = [v.time, v.end].map(t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))); return String(Math.max(30, b - a)) }
const nowStamp = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

export default function Viewings({ parts }) {
  const erp = useErp()
  const { m, scoped: d } = erp
  const me = useViewer()
  const all = useMemo(() => d.viewings || [], [d.viewings])
  const mine = me.agentId
  // Agents start on what waits for them; the office on everything to confirm.
  const [tab, setTab] = useState(mine ? 'mine' : 'confirm')
  const [q, setQ] = useState('')
  const [who, setWho] = useState('')
  const [book, setBook] = useState(null)
  const openId = Number(parts[1]) || null
  const open = openId ? (m.data.viewings || []).find(v => v.id === openId) : null
  const now = nowStamp()
  const overdue = v => L.reviewOverdue(v, now)
  const TABS = [
    mine && { key: 'mine', label: 'Waiting for me', pick: v => (v.handlerId === mine && (v.status === 'new' || v.status === 'rescheduled')) || (v.requestedBy === mine && v.status === 'review') },
    { key: 'confirm', label: 'To confirm', pick: v => v.status === 'new' || v.status === 'rescheduled' },
    { key: 'upcoming', label: 'Confirmed', pick: v => v.status === 'confirmed' },
    { key: 'review', label: 'To review', pick: v => v.status === 'review' },
    { key: 'done', label: 'Completed', pick: v => v.status === 'done' },
    { key: 'off', label: 'Cancelled & expired', pick: v => v.status === 'cancelled' || v.status === 'expired' },
  ].filter(Boolean)
  const current = TABS.find(t => t.key === tab) || TABS[0]
  const people = [...new Set(all.flatMap(v => [v.requestedBy, v.handlerId]))].map(id => m.staff[id]).filter(Boolean).sort((a, b) => a.short.localeCompare(b.short))
  const rows = all.filter(v => current.pick(v) && (!who || v.requestedBy === Number(who) || v.handlerId === Number(who)) && (!q.trim() ||
    [v.code, v.customer.name, ...v.listingIds.map(id => `${m.listings[id]?.code} ${m.listings[id]?.title}`), m.staffName(v.requestedBy), m.staffName(v.handlerId)].join(' ').toLowerCase().includes(q.trim().toLowerCase())))
  // Upcoming first for what is ahead; newest first for what is behind.
  const ahead = ['mine', 'confirm', 'upcoming'].includes(current.key)
  rows.sort((a, b) => (ahead ? 1 : -1) * `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
  const days = []
  for (const v of rows) { const day = days.at(-1); if (day?.date === v.date) day.list.push(v); else days.push({ date: v.date, list: [v] }) }
  const [limit, setLimit] = useState(12)
  const today = all.filter(v => v.date === m.today && v.status === 'confirmed').length
  const week = all.filter(v => v.date >= m.today && v.date <= L.addDays(m.today, 6) && OPEN.includes(v.status)).length

  return (
    <Page title="Viewings" help={PAGE.appointments} sub="Agents book viewings of any listing for their customers; the listing's product handler confirms with the owner.">
      <div style={{ ...cols(170, 12), marginBottom: 16 }}>
        <Stat label="To confirm" value={all.filter(TABS.find(t => t.key === 'confirm').pick).length} tone="amber" onClick={() => setTab('confirm')} on={tab === 'confirm'} />
        <Stat label="Today" value={today} sub={`${week} in the next 7 days`} tone="blue" onClick={() => setTab('upcoming')} on={tab === 'upcoming'} />
        <Stat label="To review" value={all.filter(v => v.status === 'review').length} sub={`${all.filter(overdue).length} past 24 hours`} tone="violet" onClick={() => setTab('review')} on={tab === 'review'} />
        <Stat label="Completed (30 days)" value={all.filter(v => v.status === 'done' && v.date >= L.addDays(m.today, -30)).length} tone="green" onClick={() => setTab('done')} on={tab === 'done'} />
      </div>
      <Card pad={16}>
        <Tabs value={current.key} onChange={k => { setTab(k); setLimit(12) }} tabs={TABS.map(t => ({ key: t.key, label: t.label, count: all.filter(t.pick).length }))} />
        <Toolbar fold onClear={() => { setWho(''); setQ('') }}>
          <SearchBox value={q} onChange={setQ} placeholder="Viewing no., customer, listing or agent" />
          {!mine && <Select label="Agent" value={who} onChange={setWho} options={[{ value: '', label: 'Everyone' }, ...people.map(s => ({ value: String(s.id), label: `${s.short} (${s.code})` }))]} />}
          <span style={{ flex: 1 }} />
          <button style={btn} onClick={() => go('listings')} title="Open a listing, then Actions → Book a viewing"><Icon name="plus" size={15} /> Book from a listing</button>
        </Toolbar>
        {!rows.length ? <Empty icon="calendar" title={`No viewings ${current.label.toLowerCase()}`} text={current.key === 'mine' ? 'Nothing waits for you. Viewings you host or booked show here when they need you.' : null} /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }}>
            {days.slice(0, limit).map(day => (
              <section key={day.date}>
                <h3 style={{ fontSize: 13, margin: '0 0 6px', color: day.date === m.today ? C.primaryDark : C.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {day.date === m.today ? 'Today · ' : day.date === L.addDays(m.today, 1) ? 'Tomorrow · ' : ''}{date(day.date)}
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 }}>{day.list.map(v => <ViewingRow key={v.id} v={v} overdue={overdue(v)} />)}</div>
              </section>
            ))}
            {days.length > limit && <div style={{ textAlign: 'center', fontSize: 13, color: C.muted }}>Showing {limit} of {days.length} days <button style={{ ...small, marginLeft: 8 }} onClick={() => setLimit(limit + 12)}>Show more</button></div>}
          </div>
        )}
      </Card>
      <Drawer open={!!open} onClose={() => go('appointments')} width={560} title={open ? `${open.code} · ${open.customer.name}` : ''} sub={open ? `${date(open.date)} · ${open.time}–${open.end}` : ''}
        footer={open && <ViewingActions v={open} onBook={setBook} />}>
        {open && <ViewingDetails v={open} />}
      </Drawer>
      <BookViewing listing={book} open={!!book} onClose={() => setBook(null)} />
    </Page>
  )
}

function ViewingRow({ v, overdue }) {
  const { m } = useErp()
  const l = m.listings[v.listingIds[0]]
  return (
    <button onClick={() => go(`appointments/${v.id}`)} className="ssk-lift"
      style={{ all: 'unset', cursor: 'pointer', width: '100%', boxSizing: 'border-box', display: 'flex', flexWrap: 'wrap', gap: '6px 12px', alignItems: 'center', padding: '10px 12px', border: `1px solid ${overdue ? C.err : C.border}`, borderRadius: 10, background: '#fff' }}>
      <span style={{ fontWeight: 700, fontSize: 15, width: 56, flexShrink: 0 }}>{v.time}<span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: C.muted }}>to {v.end}</span></span>
      <span style={{ minWidth: 0, flex: '1 1 200px' }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {l ? `${l.title}, ${l.area}` : 'Listing removed'}{v.listingIds.length > 1 ? ` + ${v.listingIds.length - 1} more` : ''}
        </span>
        <span style={{ display: 'block', fontSize: 12.5, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {v.customer.name} with {m.staffName(v.requestedBy)} · hosted by {m.staffName(v.handlerId)} · <span style={mono}>{v.code}</span>
        </span>
      </span>
      <span style={{ textAlign: 'right', marginLeft: 'auto' }}><Status of={L.VIEWING_STATUS} value={v.status} />{overdue && <span style={{ display: 'block', fontSize: 12, color: C.err, fontWeight: 600 }}>Review overdue</span>}</span>
    </button>
  )
}

function ViewingDetails({ v }) {
  const { m } = useErp()
  return (
    <>
      <Block title="Viewing" right={<Status of={L.VIEWING_STATUS} value={v.status} />}>
        <KV min={150} items={[['When', `${date(v.date)}, ${v.time}–${v.end}`], ['Booked', `${date(v.created.slice(0, 10))}, ${v.created.slice(11)}`], ['Customer', `${v.customer.name} · ${v.customer.phone}`],
          v.customerId && ['Customer record', <Link key="c" to={`customers/${v.customerId}`}>Open customer</Link>]]} />
      </Block>
      <Block title={v.listingIds.length > 1 ? 'Listings' : 'Listing'}>
        <div style={{ display: 'grid', gap: 8 }}>
          {v.listingIds.map(id => m.listings[id]).filter(Boolean).map(l => (
            <div key={l.id} style={{ fontSize: 13.5 }}><Link to={`listings/${l.id}`} style={mono}>{l.code}</Link> {l.title}, {l.area}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{l.category} · {l.type === 'sale' ? 'For sale' : 'For rent'}</span></div>
          ))}
        </div>
      </Block>
      <Block title="People" help={CARD.viewingPeople}>
        <div style={{ display: 'grid', gap: 10 }}>
          <Who name={m.staffName(v.requestedBy)} to={`staff/${v.requestedBy}`} sub="Brings the customer and reviews the viewing" />
          <Who name={m.staffName(v.handlerId)} to={`staff/${v.handlerId}`} sub="Product handler: confirms with the owner and hosts" />
        </div>
      </Block>
      {v.review && (
        <Block title="Review">
          <p style={{ margin: 0, fontSize: 13.5 }}><b>{L.VIEWING_OUTCOME[v.review.outcome]}</b>{v.review.text ? ` · ${v.review.text}` : ''}</p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: C.muted }}>{v.review.at} · also on the listing's follow-up history</p>
        </Block>
      )}
      <Block title="Remarks">
        {!v.remarks.length ? <p style={{ margin: 0, fontSize: 13.5, color: C.muted }}>No remarks yet.</p> : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {v.remarks.map((r, i) => (
              <li key={i} style={{ padding: '7px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13.5 }}>
                <span style={{ fontSize: 12, color: C.muted }}>{r.at} · {r.by ? m.staffName(r.by) : 'Office'}</span>
                <span style={{ display: 'block' }}>{r.text}</span>
              </li>
            ))}
          </ol>
        )}
        <Remark v={v} />
      </Block>
    </>
  )
}

function Remark({ v }) {
  const erp = useErp()
  const me = useViewer()
  const fb = useFeedback()
  const can = useCan()
  const [text, setText] = useState('')
  if (!can('listings', 'edit')) return null
  const save = async () => { if (text.trim() && await fb.run(() => erp.addViewingRemark(v.id, text, me.key), 'Remark added; the other side is told')) setText('') }
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-start' }}>
      <TextArea value={text} onChange={e => setText(e.target.value)} onSubmit={save} placeholder="Add a remark for the other side (⌘Enter)" style={{ ...field, flex: 1 }} />
      <button style={btn} disabled={!text.trim()} onClick={save}>Add</button>
    </div>
  )
}

// Confirm, move, cancel or review, by where the viewing stands.
function ViewingActions({ v, onBook }) {
  const erp = useErp()
  const { m } = erp
  const me = useViewer()
  const fb = useFeedback()
  const can = useCan()
  const [dialog, setDialog] = useState(null)
  const [f, setF] = useState({})
  const [error, setError] = useState(null)
  if (!can('listings', 'edit')) return null
  const openWith = (name, values) => { setError(null); setF(values); setDialog(name) }
  const close = () => setDialog(null)
  const run = async (fn, done) => { setError(null); try { await fn(); fb.toast(done); close() } catch (e) { setError(e.message) } }
  const l = m.listings[v.listingIds[0]]
  const host = me.staffId === v.handlerId || !me.agentId
  const footer = (label, onClick, danger) => <><button style={btn} onClick={close}>Back</button>
    <button style={danger ? { ...btn, background: C.err, borderColor: C.err, color: '#fff' } : btnPrimary} onClick={onClick}>{label}</button></>
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {(v.status === 'new' || v.status === 'rescheduled') && host && <button style={btnPrimary} onClick={() => fb.run(() => erp.confirmViewing(v.id, me.key), `${v.code} confirmed. ${m.staffName(v.requestedBy)} is told.`)}>Confirm with owner</button>}
        {v.status === 'review' && <button style={btnPrimary} onClick={() => openWith('review', { outcome: '', text: '' })}>Review the viewing</button>}
        {OPEN.includes(v.status) && <button style={btn} onClick={() => openWith('move', { date: v.date, time: v.time, minutes: minutesOf(v), reason: '' })}>Reschedule</button>}
        {OPEN.includes(v.status) && <button style={{ ...btn, color: C.err }} onClick={() => openWith('cancel', { reason: '' })}>Cancel</button>}
        {['done', 'cancelled', 'expired'].includes(v.status) && l?.status === 'active' && <button style={btn} onClick={() => onBook(l)}>Book again</button>}
      </div>
      <Modal open={dialog === 'move'} onClose={close} title={`Reschedule ${v.code}`}
        footer={footer('Move it', () => run(() => erp.rescheduleViewing(v.id, { ...f, by: me.key }), `${v.code} moved to ${f.date} ${f.time}`))}>
        {error && <Notice tone="red">{error}</Notice>}
        {!host && <p style={{ fontSize: 13.5, marginTop: 0 }}>{m.staffName(v.handlerId)} confirms the new time with the owner.</p>}
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(160px, 100%), 1fr))' }}>
          <FormField label="Date"><input type="date" style={field} value={f.date || ''} min={m.today} onChange={e => setF(x => ({ ...x, date: e.target.value }))} /></FormField>
          <FormField label="Time"><Select block plain label="Time" value={f.time} onChange={t => setF(x => ({ ...x, time: t }))} options={TIMES.map(t => ({ value: t, label: t }))} /></FormField>
          <FormField label="Why" wide><TextArea value={f.reason || ''} onChange={e => setF(x => ({ ...x, reason: e.target.value }))} placeholder="Optional, e.g. Owner only free in the evening" /></FormField>
        </div>
      </Modal>
      <Modal open={dialog === 'cancel'} onClose={close} title={`Cancel ${v.code}?`}
        footer={footer('Cancel the viewing', () => run(() => erp.cancelViewing(v.id, f.reason, me.key), `${v.code} cancelled; the other side is told`), true)}>
        {error && <Notice tone="red">{error}</Notice>}
        <FormField label="Reason" required><TextArea value={f.reason || ''} onChange={e => setF(x => ({ ...x, reason: e.target.value }))} placeholder="e.g. Customer found another unit" /></FormField>
      </Modal>
      <Modal open={dialog === 'review'} onClose={close} title={`How did ${v.code} go?`}
        footer={footer('Save review', () => run(() => erp.reviewViewing(v.id, f), 'Review saved on the listing\'s follow-ups'))}>
        {error && <Notice tone="red">{error}</Notice>}
        <div style={{ display: 'grid', gap: 12 }}>
          <FormField label="Outcome" required>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(L.VIEWING_OUTCOME).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setF(x => ({ ...x, outcome: k }))} aria-pressed={f.outcome === k}
                  style={{ ...small, borderColor: f.outcome === k ? C.primary : C.border, color: f.outcome === k ? C.primaryDark : C.text, background: f.outcome === k ? C.primaryBg : '#fff' }}>{label}</button>
              ))}
            </div>
          </FormField>
          <FormField label="Notes"><TextArea value={f.text || ''} onChange={e => setF(x => ({ ...x, text: e.target.value }))} placeholder="What the customer said, next step" /></FormField>
          {f.outcome === 'offer' && <Pill tone="green">{m.staffName(v.handlerId)} is told an offer is coming.</Pill>}
        </div>
      </Modal>
    </>
  )
}

// A listing's viewings, for its details: upcoming ones and the latest few.
export function ListingViewings({ l, onBook }) {
  const { m } = useErp()
  const list = (m.data.viewings || []).filter(v => v.listingIds.includes(l.id))
  const ahead = list.filter(v => OPEN.includes(v.status)).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
  const past = list.filter(v => !OPEN.includes(v.status)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4)
  const done = list.filter(v => v.status === 'done')
  return (
    <Block title="Viewings" help={CARD.listingViewings} right={l.status === 'active' && onBook && <button style={{ ...small, fontSize: 12.5 }} onClick={onBook}>Book a viewing</button>}>
      {!list.length ? <p style={{ margin: 0, fontSize: 13.5, color: C.muted }}>No viewings yet.</p> : (
        <>
          <p style={{ margin: '0 0 8px', fontSize: 12.5, color: C.muted }}>{list.length} booked · {done.length} viewed · {done.filter(v => ['interested', 'second', 'offer'].includes(v.review?.outcome)).length} interested</p>
          {[...ahead, ...past].map(v => (
            <div key={v.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
              <Link to={`appointments/${v.id}`} style={mono}>{v.code}</Link>
              <span style={{ flex: 1, minWidth: 0 }}>{date(v.date, { short: true })} {v.time} · {m.staffName(v.requestedBy)}</span>
              <Status of={L.VIEWING_STATUS} value={v.status} />
            </div>
          ))}
        </>
      )}
    </Block>
  )
}

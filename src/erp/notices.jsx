import { useEffect, useRef, useState } from 'react'
import * as L from '../../shared/listings.js'
import { C, btn, btnPrimary } from '../styles.js'
import { useErp } from './ErpContext.jsx'
import { useCan } from './access.jsx'
import { useFeedback } from './feedback.jsx'
import { useViewer } from './listingLife.jsx'
import { Page, Card, Tabs, Pill, Empty, Modal, FormField, Select, TextArea, Notice, go, small, field } from './ui.jsx'
import { PAGE } from './help.js'
import { ago } from './format.js'
import Icon from './Icon.jsx'

// Notifications (the current system's in-app notices and pushes): viewing
// requests and replies, price changes and sales on favourites, becoming a
// listing's product handler or a building's lead, commission ready to claim,
// and notices the office sends. Each person's own; read state is theirs too.
export function useNotices() {
  const { m } = useErp()
  const v = useViewer()
  const list = (m?.data.notices || []).filter(n => L.noticeFor(n, v.key, v.branchId))
  return { list, unread: list.filter(n => !n.readBy.includes(v.key)), key: v.key }
}

function NoticeLine({ n, unread, onOpen, compact }) {
  const cat = L.NOTICE_CAT[n.cat] || L.NOTICE_CAT.notice
  const { m } = useErp()
  return (
    <button onClick={() => onOpen(n)} className="ssk-menu-item"
      style={{ all: 'unset', cursor: n.link ? 'pointer' : 'default', display: 'flex', gap: 10, padding: compact ? '9px 10px' : '12px 14px', borderRadius: 8, alignItems: 'flex-start', width: '100%', boxSizing: 'border-box',
        background: unread ? '#fff8fa' : 'transparent' }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, marginTop: 6, flexShrink: 0, background: unread ? C.primary : 'transparent' }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, lineHeight: 1.45, color: C.text, fontWeight: unread ? 600 : 500 }}>{n.text}</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 3, fontSize: 12, color: C.muted }}>
          <Pill tone={cat.tone} dot={false} style={{ fontSize: 11 }}>{cat.label}</Pill>{ago(n.at.slice(0, 10), m.today)} · {n.at.slice(11)}
        </span>
      </span>
    </button>
  )
}

// The bell in the top bar: unread count, the latest ten, mark all read.
export function NoticeBell() {
  const erp = useErp()
  const { list, unread, key } = useNotices()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc) }
  }, [open])
  if (!erp.m) return null
  const openOne = n => {
    if (!n.readBy.includes(key)) erp.readNotices([n.id], key)
    setOpen(false)
    if (n.link) go(n.link)
  }
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ''}`} title="Notifications"
        style={{ ...btn, padding: 8, boxShadow: 'none', position: 'relative', background: open ? C.grayBg : '#fff' }}>
        <Icon name="bell" size={18} />
        {unread.length > 0 && <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 99, background: C.primary, color: '#fff', fontSize: 11, fontWeight: 700,
          display: 'grid', placeItems: 'center', padding: '0 4px', boxSizing: 'border-box', border: '2px solid #fff' }}>{unread.length > 99 ? '99+' : unread.length}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="ssk-fade" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 'min(380px, calc(100vw - 24px))', maxHeight: 'min(520px, 75vh)', overflowY: 'auto',
          background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: C.shadowLg, zIndex: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: '#fff' }}>
            <b style={{ flex: 1, fontSize: 14 }}>Notifications</b>
            {unread.length > 0 && <button style={{ ...small, fontSize: 12 }} onClick={() => erp.readNotices('all', key)}>Mark all read</button>}
          </div>
          {!list.length ? <p style={{ padding: 16, margin: 0, fontSize: 13.5, color: C.muted }}>Nothing yet. You will hear about viewings, your favourites and your commission here.</p>
            : <div style={{ padding: 4 }}>{list.slice(0, 10).map(n => <NoticeLine key={n.id} n={n} unread={!n.readBy.includes(key)} onOpen={openOne} compact />)}</div>}
          <div style={{ padding: 8, borderTop: `1px solid ${C.border}`, textAlign: 'center' }}>
            <a href="#/notifications" onClick={() => setOpen(false)} style={{ fontSize: 13, fontWeight: 600, color: C.primaryDark }}>See all notifications</a>
          </div>
        </div>
      )}
    </div>
  )
}

export function Notifications() {
  const erp = useErp()
  const { list, unread, key } = useNotices()
  const can = useCan()
  const [cat, setCat] = useState('')
  const [sending, setSending] = useState(false)
  const [limit, setLimit] = useState(30)
  const cats = Object.entries(L.NOTICE_CAT).filter(([k]) => list.some(n => n.cat === k))
  const rows = list.filter(n => (cat === 'unread' ? !n.readBy.includes(key) : !cat || n.cat === cat))
  const openOne = n => { if (!n.readBy.includes(key)) erp.readNotices([n.id], key); if (n.link) go(n.link) }
  return (
    <Page title="Notifications" help={PAGE.notifications} sub="What happened to your viewings, favourites, listings and commission, and notices from the office."
      actions={<>
        {unread.length > 0 && <button style={btn} onClick={() => erp.readNotices('all', key)}>Mark all read</button>}
        {can('staff', 'edit') && <button style={btnPrimary} onClick={() => setSending(true)}>Send a notice</button>}
      </>}>
      <Card pad={16}>
        <Tabs value={cat} onChange={c => { setCat(c); setLimit(30) }} tabs={[{ key: '', label: 'All', count: list.length }, { key: 'unread', label: 'Unread', count: unread.length },
          ...cats.map(([k, c]) => ({ key: k, label: c.label, count: list.filter(n => n.cat === k).length }))]} />
        {!rows.length ? <Empty icon="bell" title="Nothing here" /> : (
          <div style={{ display: 'grid', gap: 2 }}>
            {rows.slice(0, limit).map(n => <NoticeLine key={n.id} n={n} unread={!n.readBy.includes(key)} onOpen={openOne} />)}
            {rows.length > limit && <div style={{ textAlign: 'center', marginTop: 8 }}><button style={small} onClick={() => setLimit(limit + 30)}>Show more ({rows.length - limit} left)</button></div>}
          </div>
        )}
      </Card>
      <SendNotice open={sending} onClose={() => setSending(false)} />
    </Page>
  )
}

// The office tells one person, one branch or everyone (the current system's admin push).
function SendNotice({ open, onClose }) {
  const erp = useErp()
  const { m, setup } = erp
  const fb = useFeedback()
  const [f, setF] = useState({ to: 'all', text: '' })
  const [error, setError] = useState(null)
  if (!open) return null
  const people = m.data.staff.filter(s => s.status === 'active').sort((a, b) => a.short.localeCompare(b.short))
  const count = f.to === 'all' ? people.length : String(f.to).startsWith('branch:') ? people.filter(s => `branch:${s.branchId}` === f.to).length : 1
  const send = async () => {
    setError(null)
    try { await erp.sendNotice(f); fb.toast(`Sent to ${count} ${count === 1 ? 'person' : 'people'}`); setF({ to: 'all', text: '' }); onClose() } catch (e) { setError(e.message) }
  }
  return (
    <Modal open onClose={onClose} title="Send a notice" footer={<><button style={btn} onClick={onClose}>Cancel</button><button style={btnPrimary} onClick={send}>Send to {count}</button></>}>
      {error && <Notice tone="red">{error}</Notice>}
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField label="To">
          <Select block plain label="To" value={String(f.to)} onChange={v => setF(x => ({ ...x, to: v }))}
            options={[{ value: 'all', label: 'Everyone' }, ...setup.branches.map(b => ({ value: `branch:${b.id}`, label: `Everyone in ${b.name}` })), ...people.map(s => ({ value: String(s.id), label: `${s.short} (${s.code})` }))]} />
        </FormField>
        <FormField label="Message" required><TextArea rows={3} value={f.text} onChange={e => setF(x => ({ ...x, text: e.target.value }))} onSubmit={send} placeholder="e.g. Monthly sales meeting this Friday, 10 am at HQ." /></FormField>
      </div>
    </Modal>
  )
}

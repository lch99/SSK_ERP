import { useEffect, useState } from 'react'
import * as M from '../../shared/maintenance.js'
import { C, btn } from '../styles.js'
import { useErp } from './ErpContext.jsx'
import { DEMO } from '../api.js'
import { useAccess } from './access.jsx'
import { useFeedback } from './feedback.jsx'
import Icon from './Icon.jsx'

// Planned downtime on every page: a notice from a week before, and while a
// window that closes the ERP runs, a "back soon" page instead of the ERP for
// everyone but the technical team and the Superadmin (who keep working).

const stampNow = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
// The current local time, ticking every 20 seconds so windows start and end on their own.
export function useNow() {
  const [now, setNow] = useState(stampNow)
  useEffect(() => { const t = setInterval(() => setNow(stampNow()), 20000); return () => clearInterval(t) }, [])
  return now
}

// { live, next, closed, bypass, now }: `closed` when this viewer gets the "back soon" page.
export function useDowntime() {
  const { m } = useErp()
  const a = useAccess()
  const now = useNow()
  const { live, next } = M.downtimeAt(m?.data.downtime, now)
  const bypass = !!a && (a.manages || a.can('technical', 'full'))
  return { live, next, now, bypass, closed: !!live && live.closes && !bypass }
}

export function DowntimeBanner() {
  const erp = useErp()
  const fb = useFeedback()
  const { live, next, bypass, closed } = useDowntime()
  if (closed || (!live && !next)) return null
  const w = live || next
  const bar = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '9px 16px', fontSize: 13.5, lineHeight: 1.45,
    background: live ? C.errBg : C.warnBg, color: live ? C.err : C.warn, borderBottom: `1px solid ${live ? '#f6c7c2' : '#f5dca6'}` }
  return (
    <div role="status" style={bar}>
      <Icon name={live ? 'alert' : 'clock'} size={16} />
      <span style={{ flex: '1 1 300px', color: C.text }}>
        {live
          ? <><b>Maintenance in progress</b> until {M.whenText(w).split('–').pop().trim()}. {w.closes ? 'Everyone else sees the "back soon" page; you can keep working.' : w.message}</>
          : <><b>Planned maintenance: {M.whenText(w)}.</b> {w.closes ? 'The ERP will be offline then; please finish and save your work before it starts.' : ''} {w.message}</>}
      </span>
      {live && bypass && erp.m && <button style={{ ...btn, fontSize: 13, padding: '4px 10px' }} onClick={() => fb.run(() => erp.endDowntime(w.id), 'Maintenance ended: the ERP is open again, and everyone is told')}>End now</button>}
    </div>
  )
}

export function BackSoon() {
  const { live } = useDowntime()
  const { reload } = useErp()
  // On the server, look again every minute: the technical team may end it early.
  useEffect(() => {
    if (DEMO) return undefined
    const t = setInterval(reload, 60000)
    return () => clearInterval(t)
  }, [reload])
  if (!live) return null
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh', padding: 24, textAlign: 'center' }}>
      <div style={{ maxWidth: 460 }}>
        <div style={{ width: 64, height: 64, borderRadius: 32, background: C.warnBg, color: C.warn, display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}><Icon name="setup" size={30} /></div>
        <h1 style={{ fontSize: 24, margin: '0 0 8px' }}>We're updating the ERP</h1>
        <p style={{ fontSize: 15, color: C.muted, margin: '0 0 6px' }}>Back by <b style={{ color: C.text }}>{M.whenText(live).split('–').pop().trim()}</b>.</p>
        <p style={{ fontSize: 14, color: C.muted, margin: 0 }}>{live.message}</p>
        <p style={{ fontSize: 12.5, color: C.muted, marginTop: 18 }}>This page opens the ERP again by itself when the work is done.</p>
      </div>
    </div>
  )
}

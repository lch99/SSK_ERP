import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { C, btn, btnPrimary } from '../styles.js'
import { Modal } from './ui.jsx'
import Icon from './Icon.jsx'

// Toasts (a short note after an action, with an optional Undo or link) and an
// in-app confirm dialog, in place of the browser's alert() and confirm().
//   const fb = useFeedback()
//   fb.toast('TRAN#82739 set to Clear')
//   fb.error(e)                                  → red toast with the message
//   if (await fb.confirm({ title, body, confirmLabel, danger, cancelLabel?, width? })) …
// (Previews before saving use useReview() in review.jsx, which builds on this.)
//   await fb.run(() => erp.x(…), 'Saved')        → toast on success, error toast on failure
const Ctx = createContext(null)
export const useFeedback = () => useContext(Ctx)

const TONE = {
  green: { fg: C.ok, icon: 'check' },
  red: { fg: C.err, icon: 'alert' },
  blue: { fg: C.info, icon: 'clock' },
}

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [ask, setAsk] = useState(null)
  const seq = useRef(0)

  const dismiss = useCallback(id => setToasts(ts => ts.filter(t => t.id !== id)), [])
  const toast = useCallback((text, { tone = 'green', action, ms } = {}) => {
    const id = ++seq.current
    // Newest at the bottom; never more than four on screen.
    setToasts(ts => [...ts.slice(-3), { id, text, tone, action, ms: ms ?? (tone === 'red' ? 7000 : 4500) }])
    return id
  }, [])

  const api = useMemo(() => ({
    toast,
    error: e => toast(e?.message || String(e), { tone: 'red' }),
    confirm: opts => new Promise(resolve => setAsk({ ...opts, resolve })),
    run: async (fn, done, opts) => {
      try {
        const out = await fn()
        if (done) toast(typeof done === 'function' ? done(out) : done, opts)
        return true
      } catch (e) {
        toast(e?.message || String(e), { tone: 'red' })
        return false
      }
    },
  }), [toast])

  const answer = ok => { ask?.resolve(ok); setAsk(null) }

  return (
    <Ctx.Provider value={api}>
      {children}
      <Modal open={!!ask} onClose={() => answer(false)} title={ask?.title || 'Are you sure?'} width={ask?.width || 440}
        footer={<>
          <button style={btn} onClick={() => answer(false)}>{ask?.cancelLabel || 'Cancel'}</button>
          <button autoFocus style={ask?.danger ? { ...btn, background: C.err, borderColor: C.err, color: '#fff' } : btnPrimary} onClick={() => answer(true)}>
            {ask?.confirmLabel || 'Confirm'}
          </button>
        </>}>
        <div style={{ fontSize: 14, lineHeight: 1.55, color: C.text }}>{ask?.body}</div>
      </Modal>
      <div aria-live="polite" aria-atomic="false"
        style={{ position: 'fixed', zIndex: 90, right: 16, bottom: 16, left: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
        {toasts.map(t => <Toast key={t.id} t={t} onClose={() => dismiss(t.id)} />)}
      </div>
    </Ctx.Provider>
  )
}

function Toast({ t, onClose }) {
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused) return
    const h = setTimeout(onClose, t.ms)
    return () => clearTimeout(h)
  }, [paused, t.ms, onClose])
  const tone = TONE[t.tone] || TONE.green
  return (
    <div role={t.tone === 'red' ? 'alert' : 'status'} className="ssk-toast" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      style={{ pointerEvents: 'auto', width: 'min(400px, 100%)', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 12px 11px 14px',
        background: '#17191f', color: '#fff', borderRadius: 12, boxShadow: '0 12px 32px -8px rgba(16,24,40,.45)', fontSize: 13.5, lineHeight: 1.45 }}>
      <span style={{ width: 22, height: 22, borderRadius: 11, background: tone.fg, display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: -1 }}>
        <Icon name={tone.icon} size={13} stroke={2.6} />
      </span>
      <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{t.text}</span>
      {t.action && (
        <button onClick={() => { t.action.onClick(); onClose() }}
          style={{ background: 'none', border: 'none', color: '#ff8fab', fontWeight: 700, fontSize: 13.5, fontFamily: C.font, cursor: 'pointer', padding: '0 2px', whiteSpace: 'nowrap' }}>
          {t.action.label}
        </button>
      )}
      <button onClick={onClose} aria-label="Dismiss"
        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.55)', cursor: 'pointer', padding: 2, display: 'grid', placeItems: 'center' }}>
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}

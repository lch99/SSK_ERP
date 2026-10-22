import { createContext, useContext, useEffect, useState } from 'react'
import { C, btn, btnPrimary } from '../styles.js'
import Icon from '../erp/Icon.jsx'
import { STEP_ICONS } from './visuals.jsx'

// Set by the Setup wizard: { onBack, onNext, isFirst, isLast, total, setDirty }.
// When present, each step ends with Back / Save & continue instead of a plain Save.
export const WizardNav = createContext(null)

// One Setup step: title, status, body, and its buttons. `errors` are the live
// client-side checks (same rules the server applies); saving stays blocked
// while there are any. `onSave` returns a promise; server errors show here too.
export default function Section({ id, step, title, hint, done, dirty, errors = [], onSave, onReset, children }) {
  const nav = useContext(WizardNav)
  const [saving, setSaving] = useState(false)
  const [serverErrors, setServerErrors] = useState([])
  const [savedAt, setSavedAt] = useState(null)
  // Tell the wizard about unsaved edits, so leaving the step can warn first.
  const setDirty = nav?.setDirty
  useEffect(() => { setDirty?.(!!dirty); return () => setDirty?.(false) }, [dirty, setDirty])

  async function save() {
    setSaving(true)
    setServerErrors([])
    try {
      await onSave()
      setSavedAt(new Date())
      return true
    } catch (e) {
      setServerErrors(e.errors || [e.message])
      return false
    } finally {
      setSaving(false)
    }
  }

  const blocked = dirty && errors.length > 0
  const shown = dirty ? errors : []
  return (
    <section id={id} className={nav ? 'ssk-page' : undefined} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: C.radius, padding: nav ? '26px 24px 20px' : 20,
      marginBottom: 16, scrollMarginTop: 76, boxShadow: C.shadow, position: 'relative', overflow: 'hidden' }}>
      {nav && (
        <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: C.grayBg }}>
          <div style={{ width: `${(step / nav.total) * 100}%`, height: '100%', background: `linear-gradient(90deg, ${C.primary}, #ff5c86)`, borderRadius: '0 4px 4px 0', transition: 'width .3s ease' }} />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
        <div style={{ position: 'relative', width: 46, height: 46, borderRadius: 13, flexShrink: 0, display: 'grid', placeItems: 'center',
          background: `linear-gradient(160deg, ${C.primary}, ${C.primaryDark})`, color: '#fff', boxShadow: '0 6px 14px -6px rgba(236, 0, 63, .55)' }}>
          {STEP_ICONS[id] ? <Icon name={STEP_ICONS[id]} size={22} /> : <b style={{ fontSize: 16 }}>{step}</b>}
          <span aria-label={done ? 'Done' : 'To do'} style={{ position: 'absolute', right: -5, bottom: -5, width: 18, height: 18, borderRadius: 9, display: 'grid', placeItems: 'center',
            fontSize: 10, fontWeight: 800, color: '#fff', background: done ? C.ok : C.warn, boxShadow: '0 0 0 2px #fff' }}>{done ? '✓' : '!'}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {nav && <div style={{ fontSize: 12, fontWeight: 600, color: C.primary, marginBottom: 3, letterSpacing: '.02em' }}>Step {step} of {nav.total}</div>}
          <h2 style={{ margin: 0, fontSize: 21 }}>{title}</h2>
          {hint && <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 13, lineHeight: 1.45 }}>{hint}</p>}
        </div>
      </div>
      {children}
      <ErrorList errors={[...shown, ...serverErrors]} />

      {nav ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
          {!nav.isFirst && <button style={btn} onClick={nav.onBack} disabled={saving}>← Back</button>}
          <span style={{ flex: 1 }} />
          {dirty && onSave && <button style={{ ...btn, border: 'none', color: C.muted }} onClick={() => { setServerErrors([]); onReset() }} disabled={saving}>Discard changes</button>}
          {!dirty && savedAt && <span style={{ color: C.ok, fontSize: 13 }}>Saved</span>}
          {/* Unchanged but never confirmed: saving as-is confirms the defaults. */}
          <button style={{ ...btnPrimary, padding: '9px 18px', opacity: blocked || saving ? 0.5 : 1 }} disabled={blocked || saving}
            onClick={async () => { if (onSave && (dirty || !done) && !(await save())) return; nav.onNext() }}>
            {saving ? 'Saving…' : onSave && dirty ? (nav.isLast ? 'Save & finish' : 'Save & continue →')
              : onSave && !done ? 'Confirm & continue →' : nav.isLast ? (nav.finishLabel || 'Finish') : 'Next →'}
          </button>
        </div>
      ) : onSave && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button style={{ ...btnPrimary, opacity: !dirty || errors.length || saving ? 0.5 : 1 }}
            disabled={!dirty || errors.length > 0 || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
          {dirty && <button style={btn} onClick={() => { setServerErrors([]); onReset() }} disabled={saving}>Discard changes</button>}
          {!dirty && savedAt && <span style={{ color: C.ok, fontSize: 13 }}>Saved {savedAt.toLocaleTimeString()}</span>}
          {dirty && !errors.length && <span style={{ color: C.muted, fontSize: 13 }}>Unsaved changes</span>}
        </div>
      )}
    </section>
  )
}

export function ErrorList({ errors }) {
  if (!errors?.length) return null
  return (
    <ul style={{ margin: '12px 0 0', padding: '10px 14px 10px 30px', background: C.errBg, color: C.err, borderRadius: 6, fontSize: 13, lineHeight: 1.5 }}>
      {errors.map((e, i) => <li key={i}>{e}</li>)}
    </ul>
  )
}

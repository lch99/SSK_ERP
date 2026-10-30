import { useCallback, useEffect, useRef, useState } from 'react'
import { getSetup, saveSetup, DEMO, loadSampleSetup, startBlankSetup } from '../api.js'
import { C, btn, btnPrimary, sel } from '../styles.js'
import { CompanySection, DealTypesSection } from './BasicSections.jsx'
import TiersSection from './TiersSection.jsx'
import AgentsSection from './AgentsSection.jsx'
import ReviewSection from './ReviewSection.jsx'
import ApprovalsSection from './ApprovalsSection.jsx'
import { ErrorList, WizardNav } from './Section.jsx'
import LogoMark from '../brand/Logo.jsx'
import { useFeedback } from '../erp/feedback.jsx'
import Icon from '../erp/Icon.jsx'
import { ProgressRing, STEP_ICONS } from './visuals.jsx'

// Order matches setupChecklist() in shared/payout.js; Review comes last.
const SECTIONS = {
  company: CompanySection,
  dealTypes: DealTypesSection,
  tiers: TiersSection,
  agents: AgentsSection,
  approvals: ApprovalsSection,
}
const REVIEW = { key: 'review', title: 'Review', detail: 'Check everything, then finish' }

function useWide(minWidth = 900) {
  const query = `(min-width: ${minWidth}px)`
  const [wide, setWide] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return wide
}

// The step lives in the address (#/setup/tiers), so a refresh stays put.
// Uplines used to be a step of their own; old links open the tiers step.
const OLD_STEPS = { uplines: 'tiers' }
const stepFromHash = () => {
  const k = window.location.hash.replace(/^#\/?/, '').split('/')[1] || null
  return OLD_STEPS[k] || k
}
// Demo: the welcome screen shows once per page load (see main.jsx).
let welcomeSeen = false

// Setup as a wizard: one step at a time, with Back / Save & continue, so it
// can be followed start to finish without knowing the system.
export default function SetupPage() {
  const wide = useWide()
  const fb = useFeedback()
  const [setup, setSetup] = useState(null)
  const [error, setError] = useState(null)
  const [current, setCurrent] = useState(stepFromHash)
  const [welcomed, setWelcomedState] = useState(() => (DEMO ? welcomeSeen : !!stepFromHash()))
  const setWelcomed = v => { welcomeSeen = v; setWelcomedState(v) }
  // Unsaved edits on the current step (reported by Section).
  const dirty = useRef(false)
  const setDirty = useCallback(v => { dirty.current = v }, [])
  useEffect(() => {
    const warn = e => { if (dirty.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  function load() {
    setError(null)
    getSetup().then(s => {
      setSetup(s)
      // Fix the starting step once (first unfinished one), so that finishing a
      // step later doesn't silently move "where you are".
      setCurrent(c => c || (s.checklist.find(i => !i.done) || REVIEW).key)
    }).catch(e => setError(e.message))
  }
  useEffect(load, [])

  async function save(step, body) {
    setSetup(await saveSetup(step, body))
  }

  if (error) return <div style={{ padding: 24 }}><ErrorList errors={[error]} /><button style={{ ...btnPrimary, marginTop: 12 }} onClick={load}>Try again</button></div>
  if (!setup) return <p style={{ padding: 24, color: C.muted }}>Loading setup…</p>

  const steps = [...setup.checklist, { ...REVIEW, done: setup.checklist.every(i => i.done) }]
  // Start at the first unfinished step (or Review when everything is done).
  const fallback = (steps.find(s => !s.done) || REVIEW).key
  const key = steps.some(s => s.key === current) ? current : fallback
  const index = steps.findIndex(s => s.key === key)
  const remaining = setup.checklist.filter(i => !i.done).length

  const leaveOk = async () => !dirty.current || fb.confirm({ title: 'Leave without saving?', body: 'This step has changes that are not saved yet.',
    confirmLabel: 'Leave without saving', cancelLabel: 'Stay on this step', danger: true })
  const goTo = async (k, { force = false } = {}) => {
    if (!force && k !== key && !(await leaveOk())) return
    dirty.current = false
    setCurrent(k)
    window.history.replaceState(null, '', `#/setup/${k}`)
    window.scrollTo(0, 0)
  }
  const nav = {
    total: steps.length, isFirst: index === 0, isLast: index === steps.length - 1,
    setDirty,
    onBack: () => goTo(steps[index - 1].key),
    // Called right after a successful save (or with nothing to save), so no warning.
    // On Review: when everything is done, Finish opens the ERP; otherwise it
    // takes you to whatever is still unfinished.
    onNext: () => {
      if (index < steps.length - 1) return goTo(steps[index + 1].key, { force: true })
      const todo = setup.checklist.find(i => !i.done)
      if (todo) return goTo(todo.key, { force: true })
      window.location.hash = '#/dashboard'
    },
    finishLabel: setup.checklist.every(i => i.done) ? 'Finish & open the ERP →' : 'Finish',
  }
  const Comp = SECTIONS[key]
  const fresh = !setup.company.name && !setup.branches.length && !setup.tiers.length

  const allDone = setup.checklist.every(i => i.done)
  if ((fresh || DEMO) && !welcomed) {
    return <Welcome steps={steps} done={allDone}
      onStart={() => { setWelcomed(true); goTo(steps[0].key, { force: true }) }}
      onErp={allDone ? () => { setWelcomed(true); window.location.hash = '#/dashboard' } : null}
      onExample={DEMO && !allDone ? async () => { setSetup(await loadSampleSetup()); setWelcomed(true); goTo('review', { force: true }) } : null} />
  }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '16px 16px 24px' }}>
      {DEMO && <DemoBar fb={fb} onLoaded={s => { dirty.current = false; setSetup(s) }} />}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {wide ? (
          <aside style={{ flex: '0 0 260px', minWidth: 0, position: 'sticky', top: 76, maxHeight: 'calc(100vh - 92px)', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <ProgressRing done={setup.checklist.length - remaining} total={setup.checklist.length} />
              <span style={{ minWidth: 0 }}>
                <h1 style={{ fontSize: 22, margin: '0 0 3px' }}>Setup</h1>
                <StatusPill remaining={remaining} total={setup.checklist.length} />
              </span>
            </div>
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, position: 'relative' }}>
              {steps.map(s => {
                const active = s.key === key
                return (
                  <li key={s.key}>
                    <button onClick={() => goTo(s.key)} title={s.detail} aria-current={active ? 'step' : undefined}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '7px 10px', marginBottom: 2, border: 'none',
                        borderLeft: `3px solid ${active ? C.primary : 'transparent'}`, borderRadius: 6, cursor: 'pointer', fontFamily: C.font,
                        background: active ? C.primaryBg : 'transparent', color: C.text }}>
                      <span style={{ position: 'relative', width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center',
                        background: active ? C.primary : s.done ? '#fff' : C.grayBg, color: active ? '#fff' : s.done ? C.text : C.muted,
                        border: active ? 'none' : `1px solid ${s.done ? C.border : 'transparent'}` }}>
                        <Icon name={STEP_ICONS[s.key] || 'check'} size={15} />
                        <span aria-label={s.done ? 'done' : 'to do'} style={{ position: 'absolute', right: -4, bottom: -4, width: 14, height: 14, borderRadius: 7, display: 'grid', placeItems: 'center',
                          fontSize: 9, fontWeight: 800, boxShadow: '0 0 0 2px #fff', background: s.done ? C.ok : C.warn, color: '#fff' }}>{s.done ? '✓' : '!'}</span>
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 14, fontWeight: active ? 700 : 600, lineHeight: 1.3 }}>{s.title}</span>
                        <span style={{ display: 'block', fontSize: 12, lineHeight: 1.4, color: s.done ? C.muted : C.warn,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.detail}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </aside>
        ) : (
          <MobileStepper steps={steps} index={index} remaining={remaining} total={setup.checklist.length} onGoTo={goTo} />
        )}
        <main style={{ flex: '1 1 560px', minWidth: 0 }}>
          <WizardNav.Provider value={nav}>
            {Comp
              ? <Comp key={key} setup={setup} save={save} step={index + 1} done={steps[index].done} />
              : <ReviewSection setup={setup} step={index + 1} onGoTo={goTo} />}
          </WizardNav.Provider>
        </main>
      </div>
    </div>
  )
}

function StatusPill({ remaining, total }) {
  return (
    <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
      background: remaining ? C.warnBg : C.okBg, color: remaining ? C.warn : C.ok }}>
      {remaining ? `${remaining} step${remaining > 1 ? 's' : ''} to finish` : 'Ready to go live'}
    </span>
  )
}

// Phones: progress bar and a step picker instead of the side list.
function MobileStepper({ steps, index, remaining, total, onGoTo }) {
  return (
    <div style={{ flex: '1 1 100%', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <ProgressRing done={total - remaining} total={total} size={40} />
        <h1 style={{ fontSize: 20, margin: 0 }}>Setup</h1>
        <StatusPill remaining={remaining} total={total} />
      </div>
      {/* One dot per step: green when done, crimson for this one. */}
      <div aria-hidden style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {steps.map((s, i) => <span key={s.key} style={{ flex: 1, height: 5, borderRadius: 3, background: i === index ? C.primary : s.done ? C.ok : C.border }} />)}
      </div>
      <select style={{ ...sel, width: '100%' }} value={steps[index].key} onChange={e => onGoTo(e.target.value)} aria-label="Go to step">
        {/* No ✓ of our own: the phone's picker already ticks the current step. */}
        {steps.map((s, i) => <option key={s.key} value={s.key}>{i + 1}. {s.title}{s.done ? ' · done' : ''}</option>)}
      </select>
    </div>
  )
}

// Demo only: everything is saved in this browser, so offer a quick way to
// show a filled-in example or start over.
function DemoBar({ fb, onLoaded }) {
  const run = async (fn, title, body, done) => {
    if (!(await fb.confirm({ title, body, confirmLabel: title.replace('?', ''), danger: true }))) return
    onLoaded(await fn())
    fb.toast(done)
  }
  const small = { ...btn, fontSize: 13, padding: '4px 10px', background: '#fff' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 12px', borderRadius: 6, marginBottom: 16,
      background: C.primaryBg, fontSize: 13 }}>
      <span style={{ flex: '1 1 220px' }}>
        <b style={{ color: C.primary }}>Demo</b> · changes are saved in this browser only
      </span>
      <button style={small} onClick={() => run(loadSampleSetup, 'Load sample data?', 'Everything in Setup is replaced with a filled-in example company.', 'Sample Setup loaded')}>Load sample data</button>
      <button style={small} onClick={() => run(startBlankSetup, 'Start blank?', 'Everything in Setup is cleared, so you can fill it in from the first step.', 'Setup cleared')}>Start blank</button>
    </div>
  )
}

// First visit: what is about to happen, before the first question.
function Welcome({ steps, done, onStart, onErp, onExample }) {
  const groups = [
    ['About the company', ['company']],
    ['How deals are paid', ['dealTypes', 'tiers']],
    ['Your people', ['agents']],
    ['Controls', ['approvals']],
    ['Check', ['review']],
  ]
  const need = ['SSM registration no.', 'BOVAEPM firm licence and REA', 'Company bank accounts', 'Your agent list in Excel (optional)']
  let n = 0
  const big = { padding: '12px 22px', fontSize: 15, borderRadius: 10 }
  return (
    <div className="ssk-page" style={{ maxWidth: 1080, margin: '28px auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', boxShadow: C.shadowLg }}>
        <div style={{ flex: '1 1 380px', minWidth: 0, padding: '36px 32px', color: '#fff', position: 'relative', overflow: 'hidden',
          background: `radial-gradient(120% 90% at 0% 0%, #3a0a1c 0%, #1a0b12 55%, #120a0e 100%)` }}>
          <div aria-hidden style={{ position: 'absolute', right: -80, bottom: -80, width: 280, height: 280, borderRadius: '50%',
            background: `radial-gradient(circle, rgba(236,0,63,0.55), rgba(236,0,63,0) 70%)` }} />
          <div style={{ position: 'relative' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: C.primary }}>
              <LogoMark size={34} />
              <span style={{ color: '#fff', fontFamily: C.fontHead, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', fontSize: 17 }}>SubSaleKing</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: 'rgba(255,255,255,0.14)', borderRadius: 5, padding: '2px 7px' }}>ERP</span>
            </span>
            <h1 style={{ fontSize: 34, lineHeight: 1.15, margin: '28px 0 12px', color: '#fff' }}>{done ? 'Your agency is set up' : "Let's set up your agency"}</h1>
            <p style={{ fontSize: 15.5, lineHeight: 1.6, color: 'rgba(255,255,255,0.78)', margin: 0, maxWidth: 440 }}>
              {done ? 'Every rule is in place. Open the ERP, or walk through the steps again to review them.'
                : `${steps.length} short steps, about 10 minutes: the usual tiers, upline chain and approvals are one click each, and your agents come in from one Excel file. Everything you save is kept, so you can stop and come back any time.`}
            </p>
            {!done && (
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'rgba(255,255,255,0.55)', marginBottom: 10 }}>Have these ready</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {need.map(x => (
                    <div key={x} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'rgba(255,255,255,0.9)' }}>
                      <span style={{ width: 20, height: 20, borderRadius: 10, background: 'rgba(236,0,63,0.25)', color: '#ff6b8f', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>✓</span>{x}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 30 }}>
              {onErp && <button style={{ ...btnPrimary, ...big }} onClick={onErp}>Open the ERP →</button>}
              <button style={onErp ? { ...btn, ...big, background: 'rgba(255,255,255,0.08)', color: '#fff', borderColor: 'rgba(255,255,255,0.22)', boxShadow: 'none' } : { ...btnPrimary, ...big }}
                onClick={onStart}>{done ? 'Review Setup' : 'Start setup →'}</button>
              {onExample && <button style={{ ...btn, ...big, background: 'rgba(255,255,255,0.08)', color: '#fff', borderColor: 'rgba(255,255,255,0.22)', boxShadow: 'none' }}
                onClick={onExample}>See a filled-in example</button>}
            </div>
          </div>
        </div>
        <div style={{ flex: '1 1 340px', minWidth: 0, padding: '32px 30px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 14 }}>The steps</div>
          {groups.map(([title, keys]) => (
            <div key={title} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>{title}</div>
              {keys.map(k => steps.find(s => s.key === k)).filter(Boolean).map(s => {
                const i = ++n
                return (
                  <div key={s.key} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '7px 0' }}>
                    <span style={{ width: 26, height: 26, borderRadius: 13, flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700,
                      background: s.done ? C.okBg : C.grayBg, color: s.done ? C.ok : C.muted }}>{s.done ? '✓' : i}</span>
                    <span style={{ fontSize: 14.5, fontWeight: 500 }}>{s.title}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

import { C } from '../styles.js'
import { useFeedback } from './feedback.jsx'
import { KV, Notice } from './ui.jsx'

// Preview before saving: every add and edit form shows what will be saved,
// laid out to read, with "Back to edit" and a confirm button. Nothing is
// saved until it is confirmed.
//   const review = useReview()
//   if (await review({ title, confirmLabel, sections, preview, warnings, changes })) save()
// Forms that already sit in a dialog show <Review> as a second step in it.

// sections: [{ title, rows: [[label, value]] }] (empty values show as —).
// changes: rows from changedRows(), shown first. preview: any JSX (e.g. how a
// listing will look on the website). warnings: strings shown in amber.
export function Review({ intro, warnings = [], preview, changes, sections = [] }) {
  const warn = warnings.filter(Boolean)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {intro && <p style={{ margin: 0, fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>{intro}</p>}
      {warn.length > 0 && <Notice tone="amber">{warn.length === 1 ? warn[0] : <ul style={{ margin: 0, paddingLeft: 18 }}>{warn.map(w => <li key={w}>{w}</li>)}</ul>}</Notice>}
      {changes && (
        <section>
          <ReviewHeading>What changes</ReviewHeading>
          {changes.length ? <KV min={220} items={changes} /> : <p style={{ margin: 0, fontSize: 13.5, color: C.muted }}>Nothing has changed yet.</p>}
        </section>
      )}
      {preview}
      {sections.filter(s => s && s.rows.some(Boolean)).map(s => (
        <section key={s.title}>
          <ReviewHeading note={s.note}>{s.title}</ReviewHeading>
          <KV min={170} items={s.rows} />
        </section>
      ))}
    </div>
  )
}

export function ReviewHeading({ children, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', margin: '0 0 8px', paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: C.muted, fontFamily: C.font }}>{children}</h3>
      {note && <span style={{ fontSize: 12, color: C.muted }}>{note}</span>}
    </div>
  )
}

// The fields that differ between `before` and `after`, as rows of
// "old → new". fields: [[key, label, format?]]; format turns a value into text.
export function changedRows(before, after, fields) {
  const text = (v, format) => (v === '' || v == null ? '—' : format ? format(v) : String(v))
  return fields.filter(([k, , format]) => text(before?.[k], format) !== text(after?.[k], format)).map(([k, label, format]) => [label, (
    <span>
      <span style={{ color: C.muted, textDecoration: 'line-through' }}>{text(before?.[k], format)}</span>
      <span style={{ color: C.faint, margin: '0 6px' }}>→</span>
      <b>{text(after?.[k], format)}</b>
    </span>
  )])
}

// The labels of required fields left empty: [[label, value]] → ['Area', …].
export const missing = pairs => pairs.filter(([, v]) => v == null || String(v).trim() === '').map(([label]) => label)
export const needText = labels => `Fill in ${labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`} first.`

// Marks the FormFields named in missing() so each shows "Required" in red
// (global.css), and puts the cursor in the first one. Labels match without
// their "(…)" part, so "Vendor Professional Fees" finds "Vendor Professional
// Fees (RM)". Looks inside the open dialog when there is one. Returns false
// when no field was found, so the form can scroll to its message instead.
//   if (gaps.length) { setError(needText(gaps)); if (!markGaps(gaps)) window.scrollTo(0, 0); return }
const CONTROLS = 'input:not([type=hidden]):not([type=file]), select, textarea, button'
const base = s => String(s).replace(/\s*\*\s*$/, '').replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase()
const unmark = el => { el.removeAttribute('data-missing'); el.querySelectorAll(CONTROLS).forEach(c => c.removeAttribute('aria-invalid')) }
export function markGaps(labels) {
  const root = [...document.querySelectorAll('[role=dialog][aria-modal=true]')].at(-1) || document
  const fields = [...root.querySelectorAll('label[data-formfield]')]
  fields.forEach(unmark)
  const want = new Set(labels.map(base))
  const gaps = fields.filter(el => want.has(base(el.dataset.formfield || el.firstElementChild?.textContent || '')))
  for (const el of gaps) {
    el.setAttribute('data-missing', '')
    el.querySelectorAll(CONTROLS).forEach(c => c.setAttribute('aria-invalid', 'true'))
    // Typing or picking a value clears the mark (Select and FileInput send change).
    const clear = () => { unmark(el); el.removeEventListener('input', clear); el.removeEventListener('change', clear) }
    el.addEventListener('input', clear)
    el.addEventListener('change', clear)
  }
  if (!gaps.length) return false
  gaps[0].scrollIntoView({ block: 'center' })
  gaps[0].querySelector(CONTROLS)?.focus({ preventScroll: true })
  return true
}

export function useReview() {
  const fb = useFeedback()
  return ({ title, confirmLabel = 'Confirm', ...body }) =>
    fb.confirm({ title, confirmLabel, cancelLabel: 'Back to edit', width: 680, body: <Review {...body} /> })
}

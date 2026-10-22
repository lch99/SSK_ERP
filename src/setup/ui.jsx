import { C, label as labelStyle } from '../styles.js'

// Small building blocks shared by the Setup steps.

export function Field({ title, help, children, style }) {
  return (
    <label style={{ display: 'block', minWidth: 0, ...style }}>
      <span style={labelStyle}>{title}</span>
      {children}
      {help && <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.4 }}>{help}</span>}
    </label>
  )
}

export const grid = (min = 220) => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))`, gap: 12 })

// A titled group inside a step.
export function Group({ title, note, children, first }) {
  return (
    <div style={{ marginTop: first ? 0 : 22 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 2px' }}>{title}</h3>
      {note && <p style={{ fontSize: 13, color: C.muted, margin: '0 0 10px', lineHeight: 1.45 }}>{note}</p>}
      {children}
    </div>
  )
}

// One-of-several choice shown as cards. options: [{ value, label, desc? }].
export function Choice({ name, value, options, onChange, recommended, min = 200 }) {
  return (
    <div role="radiogroup" style={grid(min)}>
      {options.map(o => {
        const on = value === o.value
        return (
          <label key={o.value} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
            border: `1.5px solid ${on ? C.primary : C.border}`, background: on ? C.primaryBg : '#fff' }}>
            <input type="radio" name={name} checked={on} onChange={() => onChange(o.value)} style={{ marginTop: 3, accentColor: C.primary }} />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>
                {o.label}
                {recommended === o.value && <span style={{ fontSize: 11, fontWeight: 600, color: C.ok, background: C.okBg, padding: '1px 7px', borderRadius: 10, marginLeft: 6 }}>Recommended</span>}
              </span>
              {o.desc && <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>{o.desc}</span>}
            </span>
          </label>
        )
      })}
    </div>
  )
}

// "RM 30,000" under an amount box, so big numbers are easy to read.
export const rmHint = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : `RM ${Number(v).toLocaleString('en-MY')}`)

import { Children, createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { C, btn, inp } from '../styles.js'
import { initials } from './format.js'
import Icon from './Icon.jsx'

// Building blocks shared by the ERP pages.

export const TONES = {
  gray: [C.muted, C.grayBg], blue: [C.info, C.infoBg], amber: [C.warn, C.warnBg],
  green: [C.ok, C.okBg], red: [C.err, C.errBg], violet: [C.violet, C.violetBg], brand: [C.primary, C.primaryBg],
}
export const tabular = { fontVariantNumeric: 'tabular-nums' }
export const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5 }
export const small = { ...btn, fontSize: 13, padding: '5px 11px' }

export const go = path => { window.location.hash = `/${path}` }

// Typing in a field: single-key shortcuts stay off.
export const isTyping = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || !!document.activeElement?.isContentEditable

// Where a sticky table header stops: under the top bar on a page, at the top inside a drawer.
const StickyTop = createContext(60)

// Width of an element, kept up to date.
function useBoxWidth() {
  const [el, setEl] = useState(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!el) return
    const measure = () => setW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, w, el]
}

// ── Layers: drawers and dialogs. Esc closes only the top one; the page behind
// does not scroll while any is open. ──
const layers = []
let locks = 0
function useLayer(open) {
  const id = useRef(Symbol('layer'))
  useEffect(() => {
    if (!open) return
    layers.push(id.current)
    if (locks++ === 0) document.body.style.overflow = 'hidden'
    return () => {
      const i = layers.lastIndexOf(id.current)
      if (i >= 0) layers.splice(i, 1)
      if (--locks === 0) document.body.style.overflow = ''
    }
  }, [open])
  return useCallback(() => layers[layers.length - 1] === id.current, [])
}

// Focus moves in when a dialog opens, Tab stays inside, and focus goes back to
// whatever opened it when it closes.
const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
function useFocusTrap(open, ref) {
  useEffect(() => {
    if (!open) return
    const before = document.activeElement
    const el = ref.current
    // A field with autoFocus already has focus; otherwise focus the panel itself.
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true })
    const onKey = e => {
      if (e.key !== 'Tab' || !el || !el.contains(document.activeElement)) return
      const items = [...el.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null)
      if (!items.length) return
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (before && before !== document.body && document.contains(before)) before.focus?.({ preventScroll: true })
    }
  }, [open, ref])
}

// ── Popovers: a panel under its button (or above it, when there is no room
// below), drawn over everything so cards and drawers never clip it. ──
function usePopover(open, trigger, panel, align = 'left') {
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const place = () => {
      const t = trigger.current?.getBoundingClientRect(), p = panel.current
      if (!t || !p) return
      const gap = 6, vw = window.innerWidth, vh = window.innerHeight
      const w = p.offsetWidth, h = p.scrollHeight
      const below = vh - t.bottom - gap - 8, above = t.top - gap - 8
      const up = h > below && above > below
      const left = Math.max(8, Math.min(align === 'right' ? t.right - w : t.left, vw - w - 8))
      setPos(up ? { bottom: vh - t.top + gap, left, maxH: above, width: t.width, up }
        : { top: t.bottom + gap, left, maxH: below, width: t.width, up })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  return pos
}
function useOutside(open, refs, onOut) {
  const cb = useRef(onOut)
  cb.current = onOut
  useEffect(() => {
    if (!open) return
    const on = e => { if (!refs.some(r => r.current?.contains(e.target))) cb.current() }
    document.addEventListener('mousedown', on)
    document.addEventListener('touchstart', on, { passive: true })
    return () => { document.removeEventListener('mousedown', on); document.removeEventListener('touchstart', on) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
}
const popStyle = pos => ({
  position: 'fixed', zIndex: 95, top: pos?.top, bottom: pos?.bottom, left: pos?.left ?? 0, maxHeight: pos ? Math.min(pos.maxH, 420) : undefined,
  visibility: pos ? 'visible' : 'hidden', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: C.shadowLg, padding: 6,
  boxSizing: 'border-box', fontFamily: C.font, color: C.text,
})

// A small (?) that explains the thing beside it: hover, keyboard focus or a tap
// shows the text; Esc or a tap elsewhere hides it. A new line in the text
// starts a new paragraph. The texts live in help.js.
export function Tip({ children, label = 'What is this?', size = 16, style }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef(null), panel = useRef(null)
  const pos = usePopover(open, trigger, panel)
  const timer = useRef(null), since = useRef(0)
  const id = useId()
  useOutside(open, [trigger, panel], () => setOpen(false))
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!open) return
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [open])
  if (!children) return null
  const show = ms => { clearTimeout(timer.current); timer.current = setTimeout(() => { since.current = Date.now(); setOpen(true) }, ms) }
  const hide = ms => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), ms) }
  const text = typeof children === 'string' ? children.split('\n').map((p, i) => <p key={i} style={{ margin: i ? '6px 0 0' : 0 }}>{p}</p>) : children
  return (
    <>
      <button ref={trigger} type="button" aria-label={label} aria-describedby={open ? id : undefined} className="ssk-tip"
        onMouseEnter={() => show(120)} onMouseLeave={() => hide(180)} onFocus={() => show(0)} onBlur={() => hide(0)}
        // A tap opens it (the hover that comes with a tap must not close it again).
        onClick={e => { e.stopPropagation(); e.preventDefault(); if (!open) show(0); else if (Date.now() - since.current > 400) setOpen(false) }}
        style={{ display: 'inline-grid', placeItems: 'center', width: size + 4, height: size + 4, borderRadius: '50%', border: 'none', background: 'transparent',
          color: open ? C.primary : C.faint, cursor: 'help', padding: 0, verticalAlign: 'middle', flexShrink: 0, ...style }}>
        <Icon name="help" size={size} />
      </button>
      {open && createPortal(
        <div ref={panel} role="tooltip" id={id} className="ssk-pop" data-up={pos?.up ? '' : undefined} onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={() => hide(180)}
          style={{ ...popStyle(pos), maxWidth: 'min(330px, calc(100vw - 16px))', padding: '10px 12px', fontSize: 13, lineHeight: 1.5, fontWeight: 400, overflowY: 'auto',
            textTransform: 'none', letterSpacing: 'normal', textAlign: 'left', whiteSpace: 'normal', zIndex: 97 }}>
          {text}
        </div>, document.body)}
    </>
  )
}

export function Link({ to, children, style, title }) {
  return (
    <a href={`#/${to}`} title={title} onClick={e => e.stopPropagation()}
      style={{ color: C.primaryDark, fontWeight: 600, textDecoration: 'none', ...style }}>{children}</a>
  )
}

export function Pill({ tone = 'gray', children, dot = true, style, title }) {
  const [fg, bg] = TONES[tone] || TONES.gray
  return (
    <span title={title} style={{ cursor: title ? 'help' : undefined, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600,
      color: fg, background: bg, whiteSpace: 'nowrap', lineHeight: 1.5, ...style }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 3, background: fg }} aria-hidden />}
      {children}
    </span>
  )
}
// A status pill; hovering it says what the status means (`help` in model.js).
export const Status = ({ of, value }) => <Pill tone={of[value]?.tone} title={of[value]?.help || of[value]?.hint}>{of[value]?.label || value}</Pill>

export function Avatar({ name, size = 32, tone = 'brand' }) {
  const [fg, bg] = TONES[tone] || TONES.brand
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: size / 2, background: bg, color: fg, flexShrink: 0,
      display: 'inline-grid', placeItems: 'center', fontSize: size * 0.38, fontWeight: 700 }}>{initials(name)}</span>
  )
}

// Page title row: title, a line under it, and the page's own buttons.
export function Page({ title, sub, actions, back, children, help }) {
  return (
    <div className="ssk-page">
      {back && (
        <a href={`#/${back.to}`} className="ssk-back" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 500, color: C.muted, textDecoration: 'none', marginBottom: 8 }}>
          <Icon name="back" size={15} /> {back.label}
        </a>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <h1 style={{ fontSize: 25, margin: 0, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{title}{help && <Tip label="About this page" size={18} style={{ marginLeft: 8, position: 'relative', top: -2 }}>{help}</Tip>}</h1>
          {sub && <div style={{ color: C.muted, fontSize: 14, marginTop: 6, lineHeight: 1.5, maxWidth: 760 }}>{sub}</div>}
        </div>
        {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
      </div>
      {children}
    </div>
  )
}

export function Card({ title, sub, actions, children, pad = 18, style, help }) {
  return (
    <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: C.shadow, minWidth: 0, ...style }}>
      {(title || actions) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: `16px ${pad}px 0` }}>
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>{title}{help && <Tip label={`About ${typeof title === 'string' ? title : 'this section'}`} size={15} style={{ marginLeft: 6, position: 'relative', top: -1 }}>{help}</Tip>}</h2>
            {sub && <div style={{ fontSize: 13, color: C.muted, marginTop: 3, lineHeight: 1.45 }}>{sub}</div>}
          </div>
          {actions}
        </div>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </section>
  )
}

export const cols = (min = 240, gap = 16) => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`, gap })

// A headline number. `tone` colours the icon; text stays ink. With onClick it
// is a shortcut (e.g. to a filtered list); `on` marks the one in use.
export function Stat({ label, value, sub, tone = 'gray', onClick, icon, on }) {
  const [fg, bg] = TONES[tone] || TONES.gray
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} className={onClick ? 'ssk-lift' : undefined} aria-pressed={onClick ? !!on : undefined}
      style={{ textAlign: 'left', fontFamily: C.font, color: C.text, cursor: onClick ? 'pointer' : 'default',
        background: C.card, border: `1px solid ${on ? fg : C.border}`, borderRadius: 12, padding: '16px 18px', boxShadow: on ? `0 0 0 3px ${bg}` : C.shadow, minWidth: 0,
        display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      {icon && <span style={{ width: 40, height: 40, borderRadius: 10, background: bg, color: fg, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={icon} size={20} /></span>}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 13, color: C.muted, fontWeight: 500 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 24, fontWeight: 700, marginTop: 4, lineHeight: 1.15, letterSpacing: '-0.02em', overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        {sub && <span style={{ display: 'block', fontSize: 12.5, color: C.muted, marginTop: 3, lineHeight: 1.4 }}>{sub}</span>}
      </span>
      {onClick && <Icon name="chevron" size={16} style={{ color: C.faint, alignSelf: 'center' }} />}
    </Tag>
  )
}

export function Tabs({ tabs, value, onChange }) {
  const onKey = e => {
    const i = tabs.findIndex(t => t.key === value)
    const to = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null
    if (to) { e.preventDefault(); onChange(to.key); e.currentTarget.querySelector(`[data-tab="${to.key}"]`)?.focus() }
  }
  return (
    <div role="tablist" onKeyDown={onKey} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 14 }}>
      {tabs.map(t => {
        const on = t.key === value
        return (
          <button key={t.key} role="tab" data-tab={t.key} aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => onChange(t.key)} className="ssk-tab"
            style={{ border: 'none', background: 'none', fontFamily: C.font, fontSize: 14, padding: '8px 10px', cursor: 'pointer', marginBottom: -1,
              color: on ? C.primary : C.text, fontWeight: on ? 700 : 500, borderBottom: `2px solid ${on ? C.primary : 'transparent'}`,
              display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: '6px 6px 0 0' }}>
            {t.label}
            {t.count != null && (
              <span style={{ fontSize: 11.5, fontWeight: 700, padding: '0 7px', borderRadius: 10, lineHeight: '18px', ...tabular,
                background: on ? C.primaryBg : C.grayBg, color: on ? C.primary : C.muted }}>{t.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// Filters above a table. With `fold`, a narrow box keeps the first control
// (usually the search) and folds the rest behind a "Filters" button. `active` is
// how many filters are set; `onClear` resets them all.
export function Toolbar({ children, fold = false, active = 0, onClear }) {
  const [ref, width] = useBoxWidth()
  const [open, setOpen] = useState(false)
  const items = Children.toArray(children).filter(Boolean)
  const clear = onClear && active > 0 && (
    <button key="clear" onClick={onClear} style={{ ...small, background: 'transparent', boxShadow: 'none', borderColor: 'transparent', color: C.primaryDark }}>
      <Icon name="close" size={13} /> Clear filters
    </button>
  )
  const folded = fold && width > 0 && width < 640 && items.length > 1
  if (!folded) return <div ref={ref} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>{items}{clear}</div>
  return (
    <div ref={ref} style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>{items[0]}</div>
        <button onClick={() => setOpen(!open)} aria-expanded={open}
          style={{ ...btn, flexShrink: 0, ...(active ? { borderColor: C.primary, background: C.primaryBg, color: C.primaryDark } : null) }}>
          <Icon name="filter" size={15} /> Filters
          {active > 0 && <span style={{ fontSize: 11, fontWeight: 700, padding: '0 6px', lineHeight: '17px', borderRadius: 9, background: C.primary, color: '#fff' }}>{active}</span>}
        </button>
      </div>
      {open && (
        <div className="ssk-fade" style={{ display: 'grid', gap: 8, marginTop: 8, padding: 10, borderRadius: 10, background: '#f9fafb', border: `1px solid ${C.border}` }}>
          {items.slice(1).map((x, i) => <div key={i} style={{ display: 'grid', minWidth: 0 }}>{x}</div>)}
          {clear && <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{clear}</div>}
        </div>
      )}
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder = 'Search' }) {
  return (
    <label style={{ position: 'relative', flex: '1 1 220px', maxWidth: 380, minWidth: 0, display: 'block' }}>
      <span style={{ position: 'absolute', left: 10, top: 11, color: C.muted, display: 'inline-flex' }}><Icon name="search" size={16} /></span>
      <input type="search" className="ssk-search" style={{ ...inp, width: '100%', paddingLeft: 34, paddingRight: value ? 32 : 11 }} value={value} placeholder={placeholder} aria-label={placeholder}
        onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Escape' && value) { e.stopPropagation(); onChange('') } }} />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search"
          style={{ position: 'absolute', right: 6, top: 7, width: 24, height: 24, borderRadius: 12, border: 'none', background: C.grayBg, color: C.muted, display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}>
          <Icon name="close" size={12} stroke={2.4} />
        </button>
      )}
    </label>
  )
}

// "Submitted (35)" → label and count, so the count can sit muted on the right.
const splitCount = s => { const m = /^(.*?)\s*\((\d[\d,]*)\)$/.exec(String(s)); return m ? [m[1], m[2]] : [s, null] }

// A dropdown in the SubSaleKing style: a tick on the current choice, a search
// box for long lists, arrow keys / Enter / Esc, and type-to-jump. options:
// [{ value, label }]. When the first option is the "all" choice (value ''),
// any other choice is a filter in use: the button turns crimson and shows the
// label, so set filters are easy to spot.
// `plain` (in forms) turns the filter colouring off.
export function Select({ value, onChange, options, label, small: compact = false, block = false, plain = false }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const trigger = useRef(null), panel = useRef(null), list = useRef(null), search = useRef(null)
  const pos = usePopover(open, trigger, panel)
  useOutside(open, [trigger, panel], () => setOpen(false))
  const v = String(value ?? '')
  const current = options.find(o => String(o.value) === v) || options[0]
  const active = !plain && options[0]?.value === '' && v !== ''
  const searchable = options.length > 8
  const shown = useMemo(() => {
    const w = q.trim().toLowerCase()
    return w ? options.filter(o => String(o.label).toLowerCase().includes(w)) : options
  }, [q, options])

  const show = () => { setQ(''); setAt(Math.max(0, options.findIndex(o => String(o.value) === v))); setOpen(true) }
  const hide = (focus = true) => { setOpen(false); if (focus) trigger.current?.focus({ preventScroll: true }) }
  const pick = o => { if (String(o.value) !== v) onChange(String(o.value)); hide() }
  useEffect(() => { if (open && pos) (searchable ? search.current : list.current)?.focus({ preventScroll: true }) }, [open, !!pos]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) list.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: 'nearest' }) }, [at, open, !!pos]) // eslint-disable-line react-hooks/exhaustive-deps

  const typed = useRef({ s: '', t: 0 })
  const onKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt(i => Math.min(shown.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(i => Math.max(0, i - 1)) }
    else if (e.key === 'Home' && !searchable) { e.preventDefault(); setAt(0) }
    else if (e.key === 'End' && !searchable) { e.preventDefault(); setAt(shown.length - 1) }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[at]) pick(shown[at]) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide() }
    else if (e.key === 'Tab') { e.preventDefault(); hide() }
    else if (!searchable && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      const now = Date.now()
      typed.current = { s: (now - typed.current.t < 700 ? typed.current.s : '') + e.key.toLowerCase(), t: now }
      const i = shown.findIndex(o => String(o.label).toLowerCase().startsWith(typed.current.s))
      if (i >= 0) setAt(i)
    }
  }
  const [curLabel, curCount] = splitCount(current?.label ?? '')
  return (
    <span onClick={e => e.stopPropagation()} style={{ display: block ? 'grid' : 'inline-grid', maxWidth: '100%', minWidth: 0 }}>
      <button ref={trigger} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label ? `${label}: ${current?.label ?? ''}` : undefined}
        onClick={() => (open ? hide(false) : show())} onKeyDown={e => { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) { e.preventDefault(); show() } }}
        style={{ ...inp, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', textAlign: 'left', maxWidth: '100%', minWidth: 0,
          padding: compact ? '4px 8px 4px 10px' : '8px 10px 8px 12px', fontSize: compact ? 12.5 : 14, fontWeight: 500, lineHeight: '20px',
          ...(active ? { borderColor: '#f7a3b8', background: C.primaryBg, color: C.primaryDark } : null),
          ...(open ? { borderColor: C.primary, boxShadow: '0 0 0 4px rgba(236,0,63,0.12)' } : null) }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {active && label && !compact && <span style={{ fontWeight: 500, opacity: 0.7 }}>{label}: </span>}
          <span style={{ fontWeight: active ? 650 : 500 }}>{curLabel}</span>
          {curCount && <span style={{ color: active ? C.primary : C.muted, marginLeft: 6, fontSize: '0.9em', ...tabular }}>{curCount}</span>}
        </span>
        <Icon name="down" size={15} style={{ color: active || open ? C.primary : C.muted, transition: 'transform .15s ease', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && createPortal(
        <div ref={panel} onKeyDown={onKey} className="ssk-pop" data-up={pos?.up ? '' : undefined}
          style={{ ...popStyle(pos), minWidth: Math.max(pos?.width || 0, 200), maxWidth: 'min(380px, calc(100vw - 16px))', display: 'flex', flexDirection: 'column' }}>
          {searchable && (
            <div style={{ position: 'relative', padding: '2px 2px 6px', flexShrink: 0 }}>
              <span style={{ position: 'absolute', left: 11, top: 11, color: C.muted, display: 'inline-flex' }}><Icon name="search" size={15} /></span>
              <input ref={search} value={q} onChange={e => { setQ(e.target.value); setAt(0) }} placeholder={`Search ${options.length - (options[0]?.value === '' ? 1 : 0)}…`}
                aria-label={`Search ${label || 'options'}`} aria-controls="ssk-listbox" aria-activedescendant={shown[at] ? `ssk-opt-${at}` : undefined}
                style={{ ...inp, width: '100%', padding: '7px 10px 7px 32px', fontSize: 13.5, boxShadow: 'none', background: '#f9fafb' }} />
            </div>
          )}
          <div ref={list} id="ssk-listbox" role="listbox" tabIndex={-1} aria-label={label} aria-activedescendant={!searchable && shown[at] ? `ssk-opt-${at}` : undefined}
            style={{ overflowY: 'auto', outline: 'none', flex: '1 1 auto', minHeight: 0 }}>
            {!shown.length && <div style={{ padding: '14px 10px', color: C.muted, fontSize: 13, textAlign: 'center' }}>Nothing matches “{q}”</div>}
            {shown.map((o, i) => {
              const sel = String(o.value) === v, on = i === at
              const [text, count] = splitCount(o.label)
              return (
                <div key={String(o.value)}>
                  <div id={`ssk-opt-${i}`} data-i={i} role="option" aria-selected={sel} onMouseMove={() => at !== i && setAt(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(o)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 13.5, lineHeight: 1.35,
                      background: on ? (sel ? C.primaryBg : '#f2f4f7') : 'transparent', color: sel ? C.primaryDark : C.text, fontWeight: sel ? 600 : 450 }}>
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{text}</span>
                    {count && <span style={{ fontSize: 12, color: C.muted, fontWeight: 600, ...tabular }}>{count}</span>}
                    <span style={{ width: 16, display: 'inline-flex', color: C.primary }}>{sel && <Icon name="check" size={16} stroke={2.4} />}</span>
                  </div>
                  {i === 0 && !q && options[0]?.value === '' && options.length > 1 && <div role="separator" style={{ height: 1, background: C.border, margin: '4px 6px' }} />}
                </div>
              )
            })}
          </div>
        </div>, document.body)}
    </span>
  )
}

// A row of pill buttons for one choice (e.g. Active · Inactive · Pending).
export function Chips({ options, value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(o => {
        const on = String(o.key) === String(value)
        return (
          <button key={o.key} role="radio" aria-checked={on} onClick={() => onChange(o.key)}
            style={{ ...small, borderRadius: 999, gap: 6, padding: '5px 12px', fontWeight: on ? 650 : 500, boxShadow: 'none',
              background: on ? C.primaryBg : '#fff', borderColor: on ? '#f7a3b8' : C.border, color: on ? C.primaryDark : C.text }}>
            {o.label}
            {o.count != null && <span style={{ fontSize: 11.5, fontWeight: 700, color: on ? C.primary : C.muted, ...tabular }}>{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

// Two or three views of the same thing (e.g. Table / Cards).
export function Segmented({ options, value, onChange, label }) {
  return (
    <span role="radiogroup" aria-label={label} style={{ display: 'inline-flex', padding: 3, gap: 2, borderRadius: 9, background: C.grayBg }}>
      {options.map(o => {
        const on = o.key === value
        return (
          <button key={o.key} role="radio" aria-checked={on} onClick={() => onChange(o.key)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', borderRadius: 7, padding: '4px 11px', fontSize: 13, fontFamily: C.font, cursor: 'pointer',
              fontWeight: on ? 600 : 500, background: on ? '#fff' : 'transparent', color: on ? C.text : C.muted, boxShadow: on ? '0 1px 2px rgba(16,24,40,.1)' : 'none' }}>
            {o.icon && <Icon name={o.icon} size={14} />}{o.label}
          </button>
        )
      })}
    </span>
  )
}

export function Progress({ value, tone = 'brand', height = 6, label }) {
  const [fg] = TONES[tone] || TONES.brand
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}
      style={{ height, borderRadius: height / 2, background: C.grayBg, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: '100%', background: fg, borderRadius: height / 2 }} />
    </div>
  )
}

// Label / value pairs in a grid that reflows with the space.
export function KV({ items, min = 180 }) {
  return (
    <dl style={{ ...cols(min, 12), margin: 0 }}>
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} style={{ minWidth: 0 }}>
          <dt style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 2 }}>{k}</dt>
          <dd style={{ margin: 0, fontSize: 14, overflowWrap: 'anywhere', lineHeight: 1.45 }}>{v === '' || v == null ? <span style={{ color: C.muted }}>—</span> : v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Empty({ title = 'Nothing here', text, icon = 'search', action }) {
  return (
    <div style={{ textAlign: 'center', padding: '36px 12px', color: C.muted }}>
      <span aria-hidden style={{ width: 48, height: 48, borderRadius: 24, background: C.grayBg, color: C.faint, display: 'inline-grid', placeItems: 'center', marginBottom: 12,
        boxShadow: `0 0 0 8px ${C.bg}` }}><Icon name={icon} size={22} /></span>
      <div style={{ fontWeight: 600, color: C.text, marginBottom: 4, fontSize: 15 }}>{title}</div>
      {text && <div style={{ fontSize: 13.5, maxWidth: 380, margin: '0 auto', lineHeight: 1.5 }}>{text}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  )
}

// A table that turns into stacked cards when its own box is narrow, so it
// never scrolls sideways. columns: [{ key, label, render, align, sort, width,
// card: false (hide on cards), cardTop }]. The first column is the card's title;
// cardTop columns (status and stage by default) sit at its top right. If the
// table would still be wider than its box, it switches to cards too.
// The header row stays in view while the table scrolls under the top bar.
// Rows with onRow open with a click, or with Enter after Tab / ↑ ↓.
// onOrder(keys) reports the rows in the order shown (for useRecordNav);
// onClear adds "Clear filters" to the empty state.
export function DataTable({ columns, rows, rowKey = r => r.id, onRow, narrowAt = 760, pageSize = 25, empty, selection, defaultSort, onOrder, onClear }) {
  const [setWrap, width, wrap] = useBoxWidth()
  const stickyTop = useContext(StickyTop)
  // The widest box the table did not fit in: at or below it, show cards.
  const [tooWideAt, setTooWideAt] = useState(0)
  const tableRef = useRef(null)
  useLayoutEffect(() => {
    const t = tableRef.current
    if (t && wrap && t.scrollWidth > wrap.clientWidth + 1 && wrap.clientWidth > tooWideAt) setTooWideAt(wrap.clientWidth)
  })
  const narrow = width < narrowAt || (tooWideAt > 0 && width <= tooWideAt)
  const [limit, setLimit] = useState(pageSize)
  const [sort, setSort] = useState(defaultSort || null)
  useEffect(() => setLimit(pageSize), [rows.length, pageSize])

  const sorted = useMemo(() => {
    const col = sort && columns.find(c => c.key === sort.key)
    if (!col?.sort) return rows
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = col.sort(a), y = col.sort(b)
      return (x < y ? -1 : x > y ? 1 : 0) * dir
    })
  }, [rows, sort, columns])
  useLayoutEffect(() => { onOrder?.(sorted.map(rowKey)) }, [sorted, onOrder]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = sorted.slice(0, limit)
  const selectable = selection ? shown.filter(r => selection.can?.(r) ?? true) : []
  const allOn = selectable.length > 0 && selectable.every(r => selection.selected.has(rowKey(r)))
  const someOn = selectable.some(r => selection.selected.has(rowKey(r)))
  const toggle = r => {
    const next = new Set(selection.selected)
    next.has(rowKey(r)) ? next.delete(rowKey(r)) : next.add(rowKey(r))
    selection.onChange(next)
  }
  const toggleAll = () => {
    const next = new Set(selection.selected)
    selectable.forEach(r => (allOn ? next.delete(rowKey(r)) : next.add(rowKey(r))))
    selection.onChange(next)
  }
  const box = el => (
    <input type="checkbox" checked={el ? selection.selected.has(rowKey(el)) : allOn} disabled={el ? !(selection.can?.(el) ?? true) : !selectable.length}
      ref={el ? undefined : x => { if (x) x.indeterminate = !allOn && someOn }}
      onChange={() => (el ? toggle(el) : toggleAll())} onClick={e => e.stopPropagation()}
      aria-label={el ? 'Select row' : 'Select all shown'} style={{ accentColor: C.primary, width: 16, height: 16 }} />
  )
  // Keyboard: Enter / Space opens the row, ↑ ↓ move between rows.
  const keys = r => (onRow ? {
    tabIndex: 0,
    onKeyDown: e => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRow(r) }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const sib = e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling
        if (sib?.tabIndex === 0) sib.focus()
      }
    },
  } : {})
  const picked = r => selection?.selected.has(rowKey(r))

  return (
    <div ref={setWrap} style={{ minWidth: 0 }}>
      {!rows.length ? <Empty title={empty || 'Nothing here yet'} text={onClear ? 'Try fewer filters, or clear them all.' : undefined}
        action={onClear && <button style={small} onClick={onClear}><Icon name="close" size={13} /> Clear filters</button>} /> : narrow ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {selection && selectable.length > 0 && <label style={{ fontSize: 13, color: C.muted, display: 'flex', gap: 8, alignItems: 'center' }}>{box(null)} Select all shown</label>}
          {shown.map(r => {
            const [head, ...others] = columns.filter(c => c.card !== false)
            const isTop = c => c.cardTop ?? (c.key === 'status' || c.key === 'stage')
            const rest = others.filter(c => !isTop(c))
            return (
              <div key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined} {...keys(r)}
                className={onRow ? 'ssk-lift ssk-row' : undefined}
                style={{ border: `1px solid ${picked(r) ? '#f7a3b8' : C.border}`, borderRadius: 10, padding: '12px 14px', background: picked(r) ? '#fff7f9' : '#fff', cursor: onRow ? 'pointer' : 'default',
                  display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                {selection && <span style={{ paddingTop: 2 }}>{box(r)}</span>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: rest.length ? 8 : 0 }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 14, overflowWrap: 'anywhere' }}>{head.render(r)}</div>
                    {others.filter(isTop).map(c => <div key={c.key} style={{ flexShrink: 0 }}>{c.render(r)}</div>)}
                  </div>
                  {rest.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px 12px', paddingTop: 8, borderTop: `1px dashed ${C.border}` }}>
                      {rest.map(c => (
                        <div key={c.key} style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{c.label}{c.help && <Tip size={13} style={{ marginLeft: 2 }}>{c.help}</Tip>}</div>
                          <div style={{ fontSize: 13, overflowWrap: 'anywhere', ...tabular }}>{c.render(r)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <table ref={tableRef} style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'auto' }}>
          <thead>
            <tr>
              {selection && <th style={{ ...thStyle, top: stickyTop, width: 28 }}>{box(null)}</th>}
              {columns.map(c => {
                const active = sort?.key === c.key
                return (
                  <th key={c.key} style={{ ...thStyle, top: stickyTop, textAlign: c.align || 'left', width: c.width, color: active ? C.text : C.muted }}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sort ? (
                      <button onClick={() => setSort({ key: c.key, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })} className="ssk-sort"
                        title={`Sort by ${typeof c.label === 'string' ? c.label : 'this column'}`}
                        style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'flex-end', gap: 3, borderRadius: 4 }}>
                        <span>{c.label}</span>
                        <Icon name={active && sort.dir === 'asc' ? 'up' : 'down'} size={12} stroke={2.4} style={{ opacity: active ? 1 : 0.3, marginBottom: 2, color: active ? C.primary : 'currentColor' }} />
                      </button>
                    ) : c.label}
                    {c.help && <Tip label={`About ${typeof c.label === 'string' ? c.label : 'this column'}`} size={14} style={{ marginLeft: 3 }}>{c.help}</Tip>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map(r => {
              const k = rowKey(r)
              return (
                <tr key={k} onClick={onRow ? () => onRow(r) : undefined} {...keys(r)} className={onRow ? 'ssk-row' : undefined}
                  style={{ cursor: onRow ? 'pointer' : 'default', background: '#fff' }}>
                  {selection && <td style={{ ...tdStyle, ...(picked(r) ? pickedTd : null) }}>{box(r)}</td>}
                  {columns.map(c => (
                    <td key={c.key} style={{ ...tdStyle, textAlign: c.align || 'left', ...(c.align === 'right' ? tabular : null), ...(c.nowrap ? { whiteSpace: 'nowrap' } : null), ...(picked(r) ? pickedTd : null) }}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {sorted.length > limit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', padding: '14px 0 2px', fontSize: 13, color: C.muted, flexWrap: 'wrap' }}>
          <span style={tabular}>Showing {limit} of {sorted.length}</span>
          <button style={small} onClick={() => setLimit(limit + pageSize)}>Show {Math.min(pageSize, sorted.length - limit)} more</button>
          {sorted.length - limit > pageSize && sorted.length <= 500 && <button style={{ ...small, background: 'transparent', boxShadow: 'none', borderColor: 'transparent' }} onClick={() => setLimit(sorted.length)}>Show all</button>}
        </div>
      )}
    </div>
  )
}
const thStyle = { textAlign: 'left', fontSize: 12.5, fontWeight: 600, color: C.muted, padding: '10px 12px', borderBottom: `1px solid ${C.border}`, background: '#f9fafb',
  verticalAlign: 'bottom', lineHeight: 1.35, position: 'sticky', zIndex: 2 }
const tdStyle = { padding: '11px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 13.5, verticalAlign: 'middle', lineHeight: 1.45 }
const pickedTd = { background: '#fff7f9' }

// Previous / next record for a drawer opened from a DataTable, in the order the
// table shows them. Give `onOrder` to the table and `nav` to the Drawer. If the
// open record drops out of the list (it was just cleared, say), Next goes to the
// one that took its place.
export function useRecordNav(openKey, toPath) {
  const [order, setOrder] = useState([])
  const onOrder = useCallback(keys => setOrder(o => (o.length === keys.length && o.every((k, i) => k === keys[i]) ? o : keys)), [])
  const lastAt = useRef(-1)
  const at = openKey == null ? -1 : order.indexOf(openKey)
  if (openKey == null) lastAt.current = -1
  else if (at >= 0) lastAt.current = at
  const here = at >= 0 ? at : lastAt.current
  const prevKey = here > 0 ? order[here - 1] : null
  const nextKey = at >= 0 ? order[here + 1] : order[here]
  const nav = openKey == null || here < 0 || !order.length ? null : {
    label: at >= 0 ? `${at + 1} of ${order.length}` : `${order.length} left`,
    prev: prevKey != null ? () => go(toPath(prevKey)) : null,
    next: nextKey != null ? () => go(toPath(nextKey)) : null,
  }
  return { onOrder, nav }
}

const iconBtn = { ...btn, padding: 6, display: 'grid', placeItems: 'center' }

// Details slide in from the right; full screen on a phone. With `nav` (from
// useRecordNav) the header gets ↑ ↓ buttons, and J / K step through the list.
export function Drawer({ open, onClose, title, sub, children, footer, width = 560, nav }) {
  const panel = useRef(null)
  const body = useRef(null)
  const isTop = useLayer(open)
  useFocusTrap(open, panel)
  useEffect(() => {
    if (!open) return
    const onKey = e => {
      if (!isTop()) return
      if (e.key === 'Escape') onClose()
      else if (nav && !isTyping() && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if ((e.key === 'j' || e.key === 'J') && nav.next) { e.preventDefault(); nav.next() }
        if ((e.key === 'k' || e.key === 'K') && nav.prev) { e.preventDefault(); nav.prev() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, nav, isTop])
  // A new record starts at the top.
  const titleKey = typeof title === 'string' ? title : null
  useEffect(() => { if (body.current) body.current.scrollTop = 0 }, [titleKey])
  if (!open) return null
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50 }}>
      <div className="ssk-fade" onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(15, 17, 23, 0.38)' }} aria-hidden />
      <aside ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Details'} className="ssk-drawer"
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: `min(${width}px, 100vw)`, background: C.bg, display: 'flex', flexDirection: 'column',
          boxShadow: '-8px 0 30px rgba(15, 17, 23, 0.18)', outline: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '16px 18px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, overflowWrap: 'anywhere', fontFamily: C.fontHead }}>{title}</div>
            {sub && <div style={{ fontSize: 13, color: C.muted, marginTop: 3 }}>{sub}</div>}
          </div>
          {nav && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: C.muted, marginRight: 4, whiteSpace: 'nowrap', ...tabular }}>{nav.label}</span>
              <button onClick={nav.prev || undefined} disabled={!nav.prev} aria-label="Previous (K)" title="Previous (K)" style={{ ...iconBtn, opacity: nav.prev ? 1 : 0.4 }}><Icon name="up" size={16} /></button>
              <button onClick={nav.next || undefined} disabled={!nav.next} aria-label="Next (J)" title="Next (J)" style={{ ...iconBtn, opacity: nav.next ? 1 : 0.4 }}><Icon name="down" size={16} /></button>
              <span style={{ width: 1, height: 22, background: C.border, margin: '0 4px' }} aria-hidden />
            </div>
          )}
          <button onClick={onClose} aria-label="Close (Esc)" title="Close (Esc)" style={iconBtn}><Icon name="close" size={16} /></button>
        </div>
        <div ref={body} style={{ flex: 1, overflowY: 'auto', padding: 18 }}><StickyTop.Provider value={0}>{children}</StickyTop.Provider></div>
        {footer && <div style={{ padding: '12px 18px', background: C.card, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>{footer}</div>}
      </aside>
    </div>
  )
}

// A titled block inside a drawer or card.
export function Block({ title, children, right, help }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
      {title && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ fontSize: 12, margin: 0, flex: 1, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.muted, fontFamily: C.font, fontWeight: 700 }}>{title}{help && <Tip size={14} style={{ marginLeft: 4, position: 'relative', top: -1 }}>{help}</Tip>}</h3>
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

// Person: avatar, short name, and a muted line under it.
export function Who({ name, sub, to, size = 28 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, maxWidth: '100%' }}>
      <Avatar name={name} size={size} tone="gray" />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5, overflowWrap: 'anywhere' }}>{to ? <Link to={to} style={{ color: C.text }}>{name}</Link> : name}</span>
        {sub && <span style={{ display: 'block', fontSize: 12, color: C.muted, overflowWrap: 'anywhere' }}>{sub}</span>}
      </span>
    </span>
  )
}

const NOTICE_ICON = { amber: 'alert', red: 'alert', green: 'check', blue: 'clock', gray: 'clock', brand: 'alert', violet: 'clock' }
export function Notice({ tone = 'amber', children }) {
  const [fg, bg] = TONES[tone]
  return (
    <div role={tone === 'red' ? 'alert' : undefined}
      style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: bg, color: fg, borderRadius: 10, padding: '10px 12px', fontSize: 13, lineHeight: 1.5, marginBottom: 12,
        border: `1px solid color-mix(in srgb, ${fg} 18%, transparent)` }}>
      <Icon name={NOTICE_ICON[tone] || 'alert'} size={16} style={{ marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

// A small centred dialog for quick forms (abort, transfer, verify…).
export function Modal({ open, onClose, title, children, footer, width = 460 }) {
  const panel = useRef(null)
  const isTop = useLayer(open)
  useFocusTrap(open, panel)
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape' && isTop()) { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, isTop])
  if (!open) return null
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="ssk-fade" onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(15, 17, 23, 0.42)', backdropFilter: 'blur(1.5px)' }} aria-hidden />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} style={{ position: 'relative', width: `min(${width}px, 100%)`, maxHeight: '90vh', overflowY: 'auto',
        background: C.card, borderRadius: 14, boxShadow: '0 20px 50px rgba(15,17,23,.25)', outline: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}>
          <h2 style={{ flex: 1, fontSize: 16, margin: 0, lineHeight: 1.3 }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" style={{ ...btn, padding: 5, display: 'grid', placeItems: 'center' }}><Icon name="close" size={15} /></button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
        {footer && <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', padding: '12px 18px', borderTop: `1px solid ${C.border}`, background: '#fafbfc', borderRadius: '0 0 14px 14px' }}>{footer}</div>}
      </div>
    </div>
  )
}

// A button that opens a list of actions. items (falsy ones are skipped):
//   { label, onClick, icon, hint (right side, e.g. an amount), sub (a line
//     under the label), why (shown instead of sub when disabled), danger, disabled }
//   { note: '…' }      a warning at the top
//   { section: 'Print' } a small heading;  '-'  a divider
// `quiet` (for table rows) hides the button's frame until the row is hovered.
export function Menu({ label = 'Actions', items, align = 'right', quiet = false, icon }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef(null), panel = useRef(null)
  const pos = usePopover(open, trigger, panel, align)
  useOutside(open, [trigger, panel], () => setOpen(false))
  const list = items.filter(Boolean)
  const withIcons = list.some(it => it.icon)
  useEffect(() => { if (open && pos) panel.current?.querySelector('[role=menuitem]:not(:disabled)')?.focus({ preventScroll: true }) }, [open, !!pos]) // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }
  const onKey = e => {
    const els = [...panel.current.querySelectorAll('[role=menuitem]:not(:disabled)')]
    const i = els.indexOf(document.activeElement)
    const to = { ArrowDown: els[(i + 1) % els.length], ArrowUp: els[(i - 1 + els.length) % els.length], Home: els[0], End: els[els.length - 1] }[e.key]
    if (to) { e.preventDefault(); to.focus() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'Tab') { e.preventDefault(); close() }
  }
  return (
    <span onClick={e => e.stopPropagation()} style={{ display: 'inline-block' }}>
      <button ref={trigger} type="button" className={quiet ? 'ssk-quiet' : undefined} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}
        style={{ ...small, gap: 5, whiteSpace: 'nowrap', ...(open ? { borderColor: C.primary, color: C.primaryDark, background: C.primaryBg } : null) }}>
        {icon && <Icon name={icon} size={15} />}{label}
        <Icon name="down" size={13} style={{ transition: 'transform .15s ease', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && createPortal(
        <div ref={panel} role="menu" aria-label={typeof label === 'string' ? label : 'Actions'} onKeyDown={onKey} className="ssk-pop" data-up={pos?.up ? '' : undefined}
          style={{ ...popStyle(pos), minWidth: 248, maxWidth: 'min(330px, calc(100vw - 16px))', overflowY: 'auto' }}>
          {list.map((it, i) => {
            if (it === '-' || it.divider) return <div key={`d${i}`} role="separator" style={{ height: 1, background: C.border, margin: '5px 4px' }} />
            if (it.section) return <div key={`s${i}`} style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '.07em', padding: '8px 10px 4px' }}>{it.section}</div>
            if (it.note) {
              return (
                <div key={`n${i}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '0 0 6px', padding: '8px 10px', borderRadius: 8, background: C.warnBg, color: C.warn, fontSize: 12.5, lineHeight: 1.4, fontWeight: 500 }}>
                  <Icon name="alert" size={15} style={{ marginTop: 1 }} />{it.note}
                </div>
              )
            }
            const tint = it.disabled ? C.faint : it.danger ? C.err : C.text
            return (
              <button key={it.label} role="menuitem" type="button" disabled={it.disabled} className={`ssk-menu-item${it.danger ? ' ssk-danger' : ''}`}
                onMouseEnter={e => { if (!it.disabled) e.currentTarget.focus({ preventScroll: true }) }}
                onClick={() => { close(); it.onClick() }}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 8, padding: '8px 10px',
                  fontSize: 13.5, fontFamily: C.font, lineHeight: 1.35, cursor: it.disabled ? 'not-allowed' : 'pointer', color: tint }}>
                {withIcons && <span style={{ width: 18, display: 'inline-flex', marginTop: 1, color: it.disabled ? C.faint : it.danger ? C.err : C.muted }}>{it.icon && <Icon name={it.icon} size={16} />}</span>}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 500 }}>{it.label}</span>
                  {(it.sub || (it.disabled && it.why)) && <span style={{ display: 'block', fontSize: 12, color: C.faint, marginTop: 2, fontWeight: 400 }}>{it.disabled && it.why ? it.why : it.sub}</span>}
                </span>
                {it.hint && <span style={{ fontSize: 12, color: it.disabled ? C.faint : C.muted, fontWeight: 600, whiteSpace: 'nowrap', marginTop: 1, ...tabular }}>{it.hint}</span>}
              </button>
            )
          })}
        </div>, document.body)}
    </span>
  )
}

// Bulk actions for ticked rows. Put it after the table: it floats at the bottom
// of the screen while the table is in view, so the buttons stay in reach.
export function SelectionBar({ count, summary, onClear, children }) {
  if (!count) return null
  return (
    <div className="ssk-toast" role="region" aria-label="Selected rows"
      style={{ position: 'sticky', bottom: 16, zIndex: 15, marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '10px 12px 10px 16px', background: '#17191f', color: '#fff', borderRadius: 12, boxShadow: '0 12px 32px -8px rgba(16,24,40,.45)', fontSize: 13.5 }}>
      <b style={tabular}>{count} selected</b>
      {summary && <span style={{ color: 'rgba(255,255,255,.72)', ...tabular }}>{summary}</span>}
      <button onClick={onClear} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.72)', textDecoration: 'underline', cursor: 'pointer', fontFamily: C.font, fontSize: 13, padding: 0 }}>Clear</button>
      <span style={{ flex: 1 }} />
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</span>
    </div>
  )
}

// A labelled form field that fills its grid cell.
export function FormField({ label, required, help, children, wide }) {
  return (
    <label style={{ display: 'block', minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#344054', marginBottom: 5 }}>{label}{required && <span style={{ color: C.primary }}> *</span>}</span>
      {children}
      {help && <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.45 }}>{help}</span>}
    </label>
  )
}
export const field = { ...inp, width: '100%' }

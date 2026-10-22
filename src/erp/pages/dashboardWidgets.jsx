import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../../styles.js'
import { Avatar, Pill, Progress, go, tabular } from '../ui.jsx'
import { rm, rmShort, monthLabel, ago, num } from '../format.js'
import Icon from '../Icon.jsx'

// Building blocks for the dashboard: counting numbers, the hero banner, the
// commission trend, the deal-mix ring, the leaderboard, the activity feed and
// the branch race. Colours: brand crimson for money in, green for closed.

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// A number that counts up from zero when it first appears.
export function useCountUp(value, ms = 900) {
  const [shown, setShown] = useState(() => (reduced() ? value : 0))
  const from = useRef(0)
  useEffect(() => {
    if (reduced()) { setShown(value); return }
    const start = performance.now(), a = from.current, b = Number(value) || 0
    let raf
    const tick = t => {
      const k = Math.min(1, (t - start) / ms)
      const e = 1 - (1 - k) ** 3
      setShown(a + (b - a) * e)
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = b
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}
export function CountUp({ value, format = v => num(Math.round(v)) }) {
  const v = useCountUp(value)
  return <span style={tabular} aria-label={format(value)}>{format(v)}</span>
}

// Staggered entrance: wrap a widget, give it its place in the order.
export const rise = i => ({ className: 'ssk-rise', style: { animationDelay: `${i * 60}ms` } })

// ── Hero: greeting, this month so far, the pace to month-end, quick actions ──

export function Hero({ greet, place, dateText, thisMonth, lastMonth, daysIn, dayNo, monthName, stats, actions }) {
  const pace = dayNo ? (thisMonth / dayNo) * daysIn : 0
  const ratio = lastMonth ? thisMonth / lastMonth : 0
  return (
    <section {...rise(0)} style={{ ...rise(0).style, position: 'relative', overflow: 'hidden', borderRadius: 18, color: '#fff', marginBottom: 16,
      background: 'radial-gradient(130% 140% at 0% 0%, #4a0c22 0%, #23101a 45%, #14101a 100%)', boxShadow: C.shadowLg }}>
      <Skyline />
      <div aria-hidden style={{ position: 'absolute', right: -120, top: -120, width: 360, height: 360, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(236,0,63,.45), rgba(236,0,63,0) 70%)' }} />
      <div style={{ position: 'relative', display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', padding: '26px 28px' }}>
        <div style={{ flex: '1 1 380px', minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,.7)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <LiveDot /> {place} · {dateText}
          </div>
          <h1 style={{ fontSize: 30, margin: '8px 0 14px', color: '#fff', lineHeight: 1.15 }}>{greet}</h1>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,.72)' }}>Submitted so far in {monthName}</div>
          <div style={{ fontSize: 42, fontWeight: 800, fontFamily: C.fontHead, letterSpacing: '-0.03em', lineHeight: 1.1, margin: '2px 0 8px' }}>
            <CountUp value={thisMonth} format={rmShort} />
          </div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,.85)', lineHeight: 1.5 }}>
            On pace for <b style={{ color: '#fff' }}>{rmShort(pace)}</b> by month-end
            {lastMonth > 0 && <> · last month <b style={{ color: '#fff' }}>{rmShort(lastMonth)}</b></>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            {stats.map(s => (
              <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999, fontSize: 13,
                background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)' }}>
                <Icon name={s.icon} size={15} /><b>{s.value}</b><span style={{ color: 'rgba(255,255,255,.7)' }}>{s.label}</span>
              </span>
            ))}
          </div>
        </div>
        <div style={{ flex: '0 1 auto', display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
          <Ring value={ratio} label={lastMonth ? `${Math.round(ratio * 100)}%` : '—'} sub="of last month" />
          <Ring value={dayNo / daysIn} label={`${daysIn - dayNo}`} sub="days left" color="#ffb4c6" />
        </div>
      </div>
      <div style={{ position: 'relative', display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 28px 22px' }}>
        {actions.map(a => (
          <button key={a.label} onClick={a.onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10, cursor: 'pointer',
            fontFamily: C.font, fontSize: 13.5, fontWeight: 600, color: '#fff', border: '1px solid rgba(255,255,255,.18)',
            background: a.primary ? 'linear-gradient(180deg, #f5124f, #c10036)' : 'rgba(255,255,255,.07)', backdropFilter: 'blur(6px)' }}>
            <Icon name={a.icon} size={16} />{a.label}
            {a.badge > 0 && <span style={{ fontSize: 11, fontWeight: 700, background: '#fff', color: C.primary, borderRadius: 9, padding: '0 6px', lineHeight: '17px' }}>{a.badge}</span>}
          </button>
        ))}
      </div>
    </section>
  )
}

function LiveDot() {
  return (
    <span aria-hidden style={{ position: 'relative', width: 8, height: 8, display: 'inline-block' }}>
      <span style={{ position: 'absolute', inset: 0, borderRadius: 4, background: '#34d399' }} />
      <span className="ssk-pulse" style={{ position: 'absolute', inset: 0, borderRadius: 4, background: '#34d399' }} />
    </span>
  )
}

// A faint city skyline along the bottom of the hero (decoration only).
function Skyline() {
  const bars = [[0, 40], [22, 70], [40, 52], [64, 96], [80, 60], [104, 120], [126, 74], [150, 88], [172, 46], [190, 108], [214, 66], [236, 82], [260, 58], [280, 128], [304, 72], [326, 90], [350, 54]]
  return (
    <svg aria-hidden viewBox="0 0 370 130" preserveAspectRatio="none" style={{ position: 'absolute', right: 0, bottom: 0, width: '62%', height: 130, opacity: 0.12 }}>
      {bars.map(([x, h], i) => <rect key={i} x={x} y={130 - h} width={18} height={h} rx={2} fill="#fff" />)}
    </svg>
  )
}

// A progress ring with a big label in the middle.
export function Ring({ value, label, sub, size = 108, color = '#ff3d6e', track = 'rgba(255,255,255,.12)', textColor = '#fff' }) {
  const [on, setOn] = useState(reduced())
  useEffect(() => { const t = setTimeout(() => setOn(true), 60); return () => clearTimeout(t) }, [])
  const r = size / 2 - 8, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value || 0))
  return (
    <div style={{ position: 'relative', width: size, height: size }} role="img" aria-label={`${label} ${sub}`}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth="9" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={on ? c * (1 - v) : c} style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', color: textColor }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: C.fontHead, lineHeight: 1 }}>{label}</div>
          <div style={{ fontSize: 11.5, opacity: 0.75, marginTop: 3 }}>{sub}</div>
        </div>
      </div>
    </div>
  )
}

// ── Commission trend: two smooth areas over the months, with a hover readout ──

function useWidth() {
  const [el, setEl] = useState(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el); setW(el.clientWidth)
    return () => ro.disconnect()
  }, [el])
  return [setEl, w]
}
// Smooth line through points (Catmull-Rom as cubic Béziers).
const smooth = pts => pts.reduce((d, p, i, a) => {
  if (!i) return `M${p[0]},${p[1]}`
  const p0 = a[i - 2] || a[i - 1], p1 = a[i - 1], p3 = a[i + 1] || p
  const c1 = [p1[0] + (p[0] - p0[0]) / 6, p1[1] + (p[1] - p0[1]) / 6], c2 = [p[0] - (p3[0] - p1[0]) / 6, p[1] - (p3[1] - p1[1]) / 6]
  return `${d} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p[0]},${p[1]}`
}, '')
const niceMax = v => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return [1, 2, 2.5, 5, 10].map(k => k * p).find(n => n >= v) }

export function AreaTrend({ months, series, height = 250 }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const [drawn, setDrawn] = useState(reduced())
  useEffect(() => { const t = setTimeout(() => setDrawn(true), 80); return () => clearTimeout(t) }, [])
  const pad = { l: 62, r: 26, t: 12, b: 28 }
  const w = Math.max(0, width - pad.l - pad.r), h = height - pad.t - pad.b
  const max = niceMax(Math.max(...series.flatMap(s => s.values), 1))
  const x = i => pad.l + (months.length > 1 ? (i / (months.length - 1)) * w : w / 2)
  const y = v => pad.t + h - (v / max) * h
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(k => k * max)
  const onMove = e => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left - pad.l) / Math.max(1, w)) * (months.length - 1))
    setHover(Math.max(0, Math.min(months.length - 1, i)))
  }
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
        {series.map(s => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: C.muted }}>
            <span style={{ width: 18, height: 3, borderRadius: 2, background: s.color }} />{s.label}
            <b style={{ color: C.text, ...tabular }}>{rmShort(s.values.reduce((t, v) => t + v, 0))}</b>
          </span>
        ))}
      </div>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map(s => `${s.label}: ${months.map((m, i) => `${monthLabel(m)} ${rmShort(s.values[i])}`).join(', ')}`).join('. ')}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onMove} style={{ display: 'block', cursor: 'crosshair', touchAction: 'pan-y' }}>
          <defs>
            {series.map(s => (
              <linearGradient key={s.key} id={`area-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity="0.28" /><stop offset="1" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
            <clipPath id="area-reveal"><rect x="0" y="0" height={height} width={drawn ? width : 0} style={{ transition: 'width 1.2s cubic-bezier(.2,.8,.2,1)' }} /></clipPath>
          </defs>
          {ticks.map(t => (
            <g key={t}>
              <line x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} stroke={C.grid} strokeDasharray={t ? '3 4' : undefined} />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={C.faint} fontFamily={C.font}>{rmShort(t)}</text>
            </g>
          ))}
          {months.map((m, i) => (i % Math.ceil(months.length / Math.max(1, Math.floor(w / 70))) === 0 || i === months.length - 1) && (
            <text key={m} x={x(i)} y={height - 8} textAnchor="middle" fontSize="11" fill={C.faint} fontFamily={C.font}>{monthLabel(m)}</text>
          ))}
          <g clipPath="url(#area-reveal)">
            {series.map(s => {
              const pts = s.values.map((v, i) => [x(i), y(v)])
              const line = smooth(pts)
              return (
                <g key={s.key}>
                  <path d={`${line} L${x(months.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#area-${s.key})`} />
                  <path d={line} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" />
                </g>
              )
            })}
          </g>
          {hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + h} stroke={C.borderStrong} strokeDasharray="3 3" />
              {series.map(s => <circle key={s.key} cx={x(hover)} cy={y(s.values[hover])} r="5" fill="#fff" stroke={s.color} strokeWidth="2.5" />)}
            </g>
          )}
        </svg>
      )}
      {hover != null && (
        <div style={{ position: 'absolute', top: 34, left: Math.max(0, Math.min(width - 240, x(hover) + (x(hover) > width / 2 ? -250 : 12))), width: 240, pointerEvents: 'none',
          background: '#101828', color: '#fff', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, boxShadow: C.shadowLg }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{monthLabel(months[hover])}</div>
          {series.map(s => (
            <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, ...tabular }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}><span style={{ width: 8, height: 8, borderRadius: 4, background: s.color }} />{s.label}</span>
              <b>{rm(s.values[hover])}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Deal mix: a ring of this year's fees by deal type ──

export function DonutMix({ parts, total, label }) {
  const [on, setOn] = useState(reduced())
  useEffect(() => { const t = setTimeout(() => setOn(true), 120); return () => clearTimeout(t) }, [])
  const size = 180, r = 70, c = 2 * Math.PI * r
  let acc = 0
  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: size, height: size }} role="img" aria-label={parts.map(p => `${p.label} ${Math.round(p.value / (total || 1) * 100)}%`).join(', ')}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.grayBg} strokeWidth="22" />
          {parts.filter(p => p.value > 0).map(p => {
            const len = (p.value / (total || 1)) * c
            const el = <circle key={p.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth="22"
              strokeDasharray={`${on ? Math.max(0, len - 3) : 0} ${c}`} strokeDashoffset={-acc} style={{ transition: 'stroke-dasharray 1s cubic-bezier(.2,.8,.2,1)' }} />
            acc += len
            return el
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: C.fontHead, ...tabular }}><CountUp value={total} format={rmShort} /></div>
            <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 10, minWidth: 160, flex: '1 1 160px' }}>
        {parts.map(p => (
          <div key={p.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13.5 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: p.color }} />{p.label}</span>
              <b style={tabular}>{Math.round(p.value / (total || 1) * 100)}%</b>
            </div>
            <div style={{ fontSize: 12, color: C.muted, ...tabular }}>{rm(p.value)} · {num(p.count)} deals</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Leaderboard: the top three on a podium, then the rest ──

// Gold, silver, bronze: [ribbon/medal colour, light, card tint].
const MEDALS = [['#e0a100', '#ffd65a', '#fff8e1'], ['#8a94a6', '#e4e7ec', '#f2f4f7'], ['#b4622f', '#f0b48a', '#fdf1e8']]

function Medal({ place, size = 30 }) {
  const [dark, light] = MEDALS[place - 1]
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 30 36" aria-label={`Number ${place}`} role="img">
      <path d="M8 0h6l3 9h-6zM16 0h6l-3 9h-6z" fill={dark} opacity=".85" />
      <circle cx="15" cy="22" r="12" fill={light} stroke={dark} strokeWidth="2.5" />
      <text x="15" y="26.5" textAnchor="middle" fontSize="13" fontWeight="800" fontFamily="Montserrat, sans-serif" fill={dark}>{place}</text>
    </svg>
  )
}

export function Leaderboard({ rows, m, showBranch }) {
  if (!rows.length) return <p style={{ color: C.muted, margin: 0 }}>No closed deals yet this year.</p>
  const max = rows[0].v
  const order = [1, 0, 2].filter(i => rows[i])
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${order.length}, minmax(0, 1fr))`, gap: 10, alignItems: 'end', marginBottom: 14 }}>
        {order.map(i => {
          const { s, v } = rows[i]
          const [color, , bg] = MEDALS[i]
          return (
            <button key={s.id} onClick={() => go(`staff/${s.id}`)} className="ssk-lift"
              style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', textAlign: 'center', borderRadius: 14, padding: i === 0 ? '18px 10px 14px' : '14px 10px 12px',
                background: `linear-gradient(180deg, ${bg}, #fff)`, border: `1px solid ${C.border}`, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'center' }}><Medal place={i + 1} size={i === 0 ? 30 : 24} /></div>
              <div style={{ margin: '8px auto 6px', width: 'fit-content', borderRadius: '50%', boxShadow: `0 0 0 3px ${color}` }}><Avatar name={s.short} size={i === 0 ? 48 : 40} /></div>
              <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.short}</div>
              <div style={{ fontSize: 15, fontWeight: 800, fontFamily: C.fontHead, marginTop: 2 }}><CountUp value={v} format={rmShort} /></div>
              <div style={{ marginTop: 4 }}><Pill tone="gray" dot={false}>{m.tierInfo(s.id).tier.name}</Pill></div>
            </button>
          )
        })}
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {rows.slice(3).map(({ s, v }, k) => {
          const t = m.tierInfo(s.id)
          return (
            <a key={s.id} href={`#/staff/${s.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: C.text }}>
              <span style={{ width: 22, textAlign: 'center', fontWeight: 700, color: C.faint, fontSize: 13 }}>{k + 4}</span>
              <Avatar name={s.short} size={30} tone="gray" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13.5 }}>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><b>{s.short}</b>{showBranch && <span style={{ color: C.muted }}> · {m.branchName(s.branchId)}</span>}</span>
                  <b style={tabular}>{rmShort(v)}</b>
                </span>
                <span style={{ display: 'block', marginTop: 5 }}><Progress value={v / max} tone="brand" height={5} label={`${s.short} against the leader`} /></span>
                {t.next && <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginTop: 3 }}>{rmShort(t.toNext)} to {t.next.name}</span>}
              </span>
            </a>
          )
        })}
      </div>
    </div>
  )
}

// ── Activity: the latest things that happened, newest first ──

export function ActivityFeed({ events, today }) {
  if (!events.length) return <p style={{ color: C.muted, margin: 0 }}>Nothing yet.</p>
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, position: 'relative' }}>
      <span aria-hidden style={{ position: 'absolute', left: 15, top: 8, bottom: 8, width: 2, background: C.border }} />
      {events.map((e, i) => (
        <li key={i} className="ssk-rise" style={{ animationDelay: `${120 + i * 50}ms`, position: 'relative', display: 'flex', gap: 12, padding: '8px 0' }}>
          <span style={{ width: 32, height: 32, borderRadius: 16, background: e.bg, color: e.fg, display: 'grid', placeItems: 'center', flexShrink: 0,
            boxShadow: `0 0 0 4px ${C.card}`, zIndex: 1 }}><Icon name={e.icon} size={16} /></span>
          <a href={e.to ? `#/${e.to}` : undefined} style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: C.text }}>
            <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>{e.text}</div>
            <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{ago(e.date, today)}{e.meta ? ` · ${e.meta}` : ''}</div>
          </a>
          {e.amount != null && <b style={{ fontSize: 13, whiteSpace: 'nowrap', color: e.amountColor || C.text, ...tabular }}>{e.amount}</b>}
        </li>
      ))}
    </ol>
  )
}

// ── Branch race: who is ahead this month ──

const RACE = ['#ec003f', '#2a78d6', '#1baf7a', '#eb6834', '#7a4fc9', '#0f8a6a']

export function BranchRace({ rows }) {
  const max = Math.max(...rows.map(r => r.value), 1)
  const [on, setOn] = useState(reduced())
  useEffect(() => { const t = setTimeout(() => setOn(true), 100); return () => clearTimeout(t) }, [])
  const sorted = useMemo(() => [...rows].sort((a, b) => b.value - a.value), [rows])
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {sorted.map((r, i) => (
        <div key={r.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13.5, marginBottom: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, background: i === 0 ? '#fff8e1' : C.grayBg, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700,
                color: i === 0 ? '#b07d00' : C.muted }}>{i === 0 ? '★' : i + 1}</span>
              <b>{r.label}</b><span style={{ color: C.muted }}>{r.sub}</span>
            </span>
            <b style={tabular}>{rmShort(r.value)}</b>
          </div>
          <div style={{ height: 10, borderRadius: 5, background: C.grayBg, overflow: 'hidden' }}>
            <div style={{ width: on ? `${(r.value / max) * 100}%` : 0, height: '100%', borderRadius: 5, transition: `width 1s cubic-bezier(.2,.8,.2,1) ${i * 90}ms`,
              background: `linear-gradient(90deg, ${RACE[r.index % RACE.length]}cc, ${RACE[r.index % RACE.length]})` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

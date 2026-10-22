import { useEffect, useState } from 'react'
import { C, btn } from '../styles.js'
import { rm, rmShort } from './format.js'
import { tabular } from './ui.jsx'

// Width of an element, kept up to date (for drawing SVG to fit its box).
function useWidth() {
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
  return [setEl, w]
}

const TIP = 200
// Beside the hovered column (right of it, or left past the middle), never outside the chart.
const tipLeft = (x, band, width) => Math.max(0, Math.min(width - TIP, x + band / 2 > width / 2 ? x - TIP - 8 : x + band + 8))

function niceMax(v) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 2, 2.5, 5, 10].map(k => k * p).find(n => n >= v)
}

// Rounded top, square base: a bar's data end.
const topRounded = (x, y, w, h, r) => {
  const rr = Math.min(r, h, w / 2)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

// Stacked columns, one per period. rows: [{ key, label, values: { [series]: n } }];
// series: [{ key, label, color }] in fixed order (bottom → top).
export function StackedBars({ rows, series, height = 250, format = rmShort, title }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const [asTable, setAsTable] = useState(false)
  const pad = { top: 10, right: 6, bottom: 26, left: 58 }
  const innerW = Math.max(0, width - pad.left - pad.right), innerH = height - pad.top - pad.bottom
  const totals = rows.map(r => series.reduce((s, x) => s + (r.values[x.key] || 0), 0))
  const max = niceMax(Math.max(0, ...totals))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max)
  const band = rows.length ? innerW / rows.length : 0
  const barW = Math.min(24, Math.max(6, band * 0.55))
  const y = v => pad.top + innerH - (v / max) * innerH
  const every = band < 38 ? 2 : 1
  const h = hover != null ? rows[hover] : null

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, fontSize: 12.5, color: C.muted }}>
        {series.map(s => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} aria-hidden />{s.label}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <button style={{ ...btn, fontSize: 12, padding: '3px 9px' }} onClick={() => setAsTable(!asTable)}>{asTable ? 'Show chart' : 'Show as table'}</button>
      </div>
      {asTable ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr>{['Month', ...series.map(s => s.label), 'Total'].map(hd => <th key={hd} style={{ textAlign: hd === 'Month' ? 'left' : 'right', padding: '6px 8px', color: C.muted, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>{hd}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{r.label}</td>
                {series.map(s => <td key={s.key} style={{ padding: '6px 8px', textAlign: 'right', borderBottom: `1px solid ${C.border}`, ...tabular }}>{rm(r.values[s.key] || 0)}</td>)}
                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, borderBottom: `1px solid ${C.border}`, ...tabular }}>{rm(totals[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div ref={ref} style={{ position: 'relative', width: '100%' }} onMouseLeave={() => setHover(null)}>
          {width > 0 && (
            <svg width={width} height={height} role="img" aria-label={title} style={{ display: 'block' }}>
              {ticks.map(t => (
                <g key={t}>
                  <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#c9cdd4' : C.grid} strokeWidth={1} />
                  <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={C.muted} style={tabular}>{format(t)}</text>
                </g>
              ))}
              {rows.map((r, i) => {
                const cx = pad.left + band * i + band / 2
                let base = 0
                const segs = series.map(s => ({ s, v: r.values[s.key] || 0 })).filter(x => x.v > 0)
                return (
                  <g key={r.key} opacity={hover == null || hover === i ? 1 : 0.45}>
                    {segs.map((seg, k) => {
                      const y0 = y(base), y1 = y(base + seg.v)
                      base += seg.v
                      const top = k === segs.length - 1
                      const hh = Math.max(0, y0 - y1 - (k > 0 ? 2 : 0))   // 2px surface gap between segments
                      return top
                        ? <path key={seg.s.key} d={topRounded(cx - barW / 2, y1, barW, hh, 4)} fill={seg.s.color} />
                        : <rect key={seg.s.key} x={cx - barW / 2} y={y1} width={barW} height={hh} fill={seg.s.color} />
                    })}
                    {i % every === (rows.length - 1) % every && (
                      <text x={cx} y={height - 8} textAnchor="middle" fontSize={11} fill={C.muted}>{r.label}</text>
                    )}
                    <rect x={pad.left + band * i} y={pad.top} width={band} height={innerH} fill="transparent" tabIndex={0}
                      aria-label={`${r.label}: ${rm(totals[i])}`} style={{ outline: 'none', cursor: 'default' }}
                      onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
                  </g>
                )
              })}
            </svg>
          )}
          {h && (
            <div style={{ position: 'absolute', top: 4, pointerEvents: 'none', zIndex: 2, background: '#fff', border: `1px solid ${C.border}`,
              borderRadius: 8, boxShadow: '0 6px 18px rgba(16,24,40,.12)', padding: '8px 10px', fontSize: 12.5, whiteSpace: 'nowrap',
              width: TIP, boxSizing: 'border-box', left: tipLeft(pad.left + band * hover, band, width) }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{h.label}</div>
              {[...series].reverse().map(s => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '1px 0' }}>
                  <span style={{ width: 10, height: 2, background: s.color }} aria-hidden />
                  <b style={{ ...tabular }}>{rm(h.values[s.key] || 0)}</b>
                  <span style={{ color: C.muted }}>{s.label}</span>
                </div>
              ))}
              <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 5, paddingTop: 5, display: 'flex', gap: 8 }}>
                <b style={tabular}>{rm(totals[hover])}</b><span style={{ color: C.muted }}>Total</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// One horizontal bar per row, for ranking (single series: no legend).
export function RankBars({ rows, format = rm, color = C.series[0] }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map(r => (
        <div key={r.key} style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }}>{r.label}</div>
            <b style={{ fontSize: 13, ...tabular, whiteSpace: 'nowrap' }}>{format(r.value)}</b>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: C.grayBg }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: '100%', borderRadius: 3, background: color }} />
          </div>
        </div>
      ))}
    </div>
  )
}

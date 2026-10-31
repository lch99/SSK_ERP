import { useState } from 'react'
import * as P from '../../shared/payout.js'
import { C, inp, btn, btnPrimary, label } from '../styles.js'
import Icon from '../erp/Icon.jsx'
import { Segmented } from '../erp/ui.jsx'
import { useNarrow } from './useNarrow.js'
import { Bar, Key, DealIcon, POOL_COLOR } from './visuals.jsx'
import { rmHint } from './ui.jsx'
import { AGENT_COLOR, COMPANY_COLOR } from './colors.js'

// ── The tier ladder, edited in place ─────────────────────────────────────────
// One line per tier: its code and name, the RM amount it starts at, and what a
// deal pays at that tier (negotiator · upline pool · company). Clicking a tier
// opens its fields right there, one tier at a time. Tiers sit under what they
// climb on (since joining, then each year), so that is no longer a column.

const r2 = n => Math.round(n * 100) / 100
const isNum = v => v !== '' && v != null && Number.isFinite(Number(v))
const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const everyType = v => Object.fromEntries(P.DEAL_TYPES.map(dt => [dt, v]))

const GROUPS = [
  { basis: 'lifetime', title: 'Since joining', add: '+ Add a tier',
    note: 'Climbed on the commission an agent has earned since joining. Every agent starts at the first tier, at RM 0.' },
  { basis: 'yearly', title: 'Then each year', add: '+ Add a yearly tier',
    note: "Optional. After the top tier above, agents climb these again every year on that year's commission." },
]
const inGroup = (t, basis) => (t.basis === 'yearly') === (basis === 'yearly')

// The next code not taken: T1, T2, …
function nextCode(tiers) {
  const used = new Set(tiers.map(t => String(t.name ?? '').trim().toLowerCase()))
  let n = tiers.length + 1
  while (used.has(`t${n}`)) n++
  return `T${n}`
}

// What is still wrong with one tier, in a few words. The full list (order of
// the RM amounts, duplicate codes…) shows by the Save button.
function problem(t, types, perType) {
  if (!String(t.name ?? '').trim()) return 'Give it a code'
  if (!isNum(t.threshold)) return 'Set the RM amount'
  if (!isNum(t.agentRate)) return 'Set the agent rate'
  const rate = Number(t.agentRate)
  if (rate <= 0 || rate >= 100) return 'The agent rate must be between 0% and 100%'
  for (const dt of types) {
    const v = t.totals?.[dt]
    const which = perType && types.length > 1 ? ` for ${P.DEAL_TYPE_LABELS[dt]}` : ''
    if (!isNum(v)) return `Set the total payout${which}`
    const e = P.validateTotal(v, rate)
    if (e) return `Total payout${which} ${e}`
  }
  return null
}

// Negotiator, upline pool and company for one deal type, as Bar parts.
function split(t, dt) {
  const agent = Number(t.agentRate), total = Number(t.totals?.[dt])
  return [
    { key: 'a', pct: agent, color: AGENT_COLOR, text: `${r2(agent)}%`, title: `Negotiator ${r2(agent)}%` },
    { key: 'p', pct: total - agent, color: POOL_COLOR, text: `${r2(total - agent)}%`, title: `Upline pool ${r2(total - agent)}%` },
    { key: 'c', pct: 100 - total, color: COMPANY_COLOR, ink: C.text, text: `${r2(100 - total)}%`, title: `Company ${r2(100 - total)}%` },
  ]
}
const splitLabel = (t, dt) => `${P.tierLabel(t)}: ${split(t, dt).map(p => p.title).join(', ')}`

function Badge({ t, bad }) {
  return (
    <span style={{ minWidth: 34, padding: '2px 7px', borderRadius: 6, background: '#fff', border: `1px solid ${bad ? C.err : C.borderStrong}`,
      fontSize: 12, fontWeight: 700, textAlign: 'center', ...ellipsis, maxWidth: 90 }}>{String(t.name ?? '').trim() || '?'}</span>
  )
}

const startsAt = t => (!isNum(t.threshold) ? null : Number(t.threshold) ? `from ${rmHint(t.threshold)}` : 'everyone starts here')

export default function TierEditor({ tiers, setTiers, enabled, perType }) {
  const [open, setOpen] = useState(null)
  const types = enabled.length ? enabled : ['sale']
  const [dtRaw, setDt] = useState(types[0])
  const dt = types.includes(dtRaw) ? dtRaw : types[0]
  const [ref, narrow] = useNarrow(620)

  const edit = (i, patch) => setTiers(tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  const setTotal = (i, type, v) => edit(i, { totals: { ...tiers[i].totals, ...(type ? { [type]: v } : everyType(v)) } })
  // The ladder settles into RM order when a tier is opened or closed, never
  // while one is being typed in, so rows don't jump under the cursor.
  const show = i => {
    const sorted = P.sortTiers(tiers)
    setTiers(sorted)
    setOpen(i == null ? null : sorted.indexOf(tiers[i]))
  }
  const add = basis => {
    const sorted = P.sortTiers(tiers)
    setTiers([...sorted, { id: null, name: nextCode(sorted), title: '', basis, threshold: sorted.length ? '' : 0, agentRate: '', totals: {} }])
    setOpen(sorted.length)
  }
  const remove = i => { setTiers(tiers.filter((_, j) => j !== i)); setOpen(null) }

  const row = (t, i) => {
    const bad = problem(t, types, perType)
    const from = startsAt(t)
    return (
      <button key={t.id ?? `new-${i}`} className="ssk-tier" aria-expanded={false} onClick={() => show(i)}
        style={{ display: 'grid', gridTemplateColumns: narrow ? 'auto minmax(0, 1fr) auto' : 'auto minmax(0, 220px) minmax(0, 1fr) auto',
          gap: narrow ? '6px 10px' : 14, alignItems: 'center', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none',
          borderTop: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', fontFamily: C.font, color: C.text }}>
        <Badge t={t} bad={bad} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 600, ...ellipsis }}>
            {String(t.title ?? '').trim() || <span style={{ color: C.muted, fontWeight: 500 }}>No name</span>}
          </span>
          <span style={{ display: 'block', fontSize: 12, color: from ? C.muted : C.err }}>{from || 'RM amount not set'}</span>
        </span>
        <span style={narrow ? { gridColumn: '1 / -1', gridRow: 2, minWidth: 0 } : { minWidth: 0 }}>
          {bad
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.err }}><Icon name="alert" size={14} />{bad}</span>
            : <Bar parts={split(t, dt)} height={22} label={splitLabel(t, dt)} textAt={narrow ? 0.125 : 0.07} />}
        </span>
        <span style={{ color: C.faint, display: 'flex' }}><Icon name="chevron" size={16} /></span>
      </button>
    )
  }

  const editor = (t, i) => {
    const bad = problem(t, types, perType)
    const rateBad = isNum(t.agentRate) && (Number(t.agentRate) <= 0 || Number(t.agentRate) >= 100)
    const field = (title, control, hint, err) => (
      <label style={{ display: 'block', minWidth: 0 }}>
        <span style={label}>{title}</span>
        {control}
        <span style={{ display: 'block', fontSize: 12, color: err ? C.err : C.muted, marginTop: 4, minHeight: 16 }}>{hint}</span>
      </label>
    )
    const total = type => {
      const key = type || types[0]
      const v = t.totals?.[key]
      const ok = isNum(v) && isNum(t.agentRate) && !P.validateTotal(v, t.agentRate)
      const err = isNum(v) && isNum(t.agentRate) && !ok
      return field(type ? `Pays out · ${P.DEAL_TYPE_LABELS[type]} (%)` : 'Pays out in total (%)',
        <input style={{ ...inp, width: '100%', ...(err ? { borderColor: C.err } : {}) }} type="number" min="0" max="100" step="0.01" value={v ?? ''}
          onChange={e => setTotal(i, type, e.target.value)} />,
        ok ? `Uplines ${r2(v - t.agentRate)}% · company ${r2(100 - v)}%` : err ? `At least the agent rate, ${t.agentRate}%` : 'Agent rate plus the upline pool.',
        err)
    }
    return (
      <div key={t.id ?? `new-${i}`} onKeyDown={e => { if (e.key === 'Escape') show(null) }}
        style={{ borderTop: `1px solid ${C.border}`, boxShadow: `inset 3px 0 0 ${C.primary}`, background: '#fffafb' }}>
        <button className="ssk-tier" aria-expanded onClick={() => show(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 12px 4px 15px', border: 'none',
            background: 'transparent', cursor: 'pointer', fontFamily: C.font, color: C.text }}>
          <Badge t={t} bad={bad} />
          <b style={{ flex: 1, minWidth: 0, fontSize: 14, ...ellipsis }}>{String(t.title ?? '').trim() || 'New tier'}</b>
          <span style={{ color: C.faint, display: 'flex' }}><Icon name="chevron" size={16} style={{ transform: 'rotate(90deg)' }} /></span>
        </button>
        <div style={{ padding: '8px 15px 14px' }}>
          {/* Who the tier is, then its numbers. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'flex-start' }}>
            <span style={{ flex: '0 1 110px', minWidth: 90 }}>
              {field('Code', <input style={{ ...inp, width: '100%' }} maxLength={20} value={t.name} onChange={e => edit(i, { name: e.target.value })} />, 'e.g. T3')}
            </span>
            <span style={{ flex: '1 1 220px', minWidth: 0 }}>
              {field('Name', <input style={{ ...inp, width: '100%' }} maxLength={60} value={t.title ?? ''} placeholder="e.g. Senior Negotiator" autoFocus
                onChange={e => edit(i, { title: e.target.value })} />, 'Optional.')}
            </span>
            <span style={{ flex: '0 0 auto' }}>
              <span style={label}>Climbs on</span>
              <Segmented label="Climbs on" value={t.basis === 'yearly' ? 'yearly' : 'lifetime'} onChange={v => edit(i, { basis: v })}
                options={[{ key: 'lifetime', label: 'Since joining' }, { key: 'yearly', label: 'Each year' }]} />
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(160px, 100%), 1fr))', gap: '4px 14px', margin: '4px 0 8px' }}>
            {field('Reached at (RM)', <input style={{ ...inp, width: '100%' }} type="number" min="0" step="1000" value={t.threshold}
              onChange={e => edit(i, { threshold: e.target.value })} />,
              !isNum(t.threshold) ? 'Commission earned to reach it.' : Number(t.threshold) ? `${rmHint(t.threshold)} ${t.basis === 'yearly' ? 'this year' : 'since joining'}` : 'Everyone starts here.')}
            {field('Agent keeps (%)', <input style={{ ...inp, width: '100%', ...(rateBad ? { borderColor: C.err } : {}) }} type="number" min="0" max="100" step="0.01"
              value={t.agentRate} onChange={e => edit(i, { agentRate: e.target.value })} />,
              rateBad ? 'Between 0% and 100%.' : "The negotiator's own share.", rateBad)}
            {(perType ? types : [null]).map(type => <span key={type || 'all'} style={{ display: 'contents' }}>{total(type)}</span>)}
          </div>
          {!bad && <Bar parts={split(t, dt)} height={26} label={splitLabel(t, dt)} textAt={narrow ? 0.125 : 0.05} />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <button style={{ ...btn, border: 'none', boxShadow: 'none', background: 'transparent', color: C.err, padding: '8px 4px' }} onClick={() => remove(i)}>Remove tier</button>
            <span style={{ flex: 1 }} />
            <button style={btnPrimary} onClick={() => show(null)}>Done</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={ref} style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px 14px', flexWrap: 'wrap', padding: '10px 12px', background: C.bg }}>
        <span style={{ flex: '1 1 260px', fontSize: 12.5, color: C.muted, lineHeight: 1.45 }}>
          What each deal's commission pays at every tier, when the negotiator has uplines. Click a tier to change it.
        </span>
        <Key color={AGENT_COLOR}>Negotiator</Key><Key color={POOL_COLOR}>Upline pool</Key><Key color={COMPANY_COLOR}>Company</Key>
      </div>
      {perType && types.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '0 12px 10px', background: C.bg }}>
          <span style={{ fontSize: 12.5, color: C.muted }}>Show:</span>
          {types.map(x => (
            <button key={x} onClick={() => setDt(x)} aria-pressed={x === dt}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 14, cursor: 'pointer', fontFamily: C.font, fontSize: 12.5, fontWeight: 600,
                border: `1px solid ${x === dt ? C.primary : C.border}`, background: x === dt ? C.primaryBg : '#fff', color: x === dt ? C.primaryDark : C.muted }}>
              <DealIcon type={x} size={13} />{P.DEAL_TYPE_LABELS[x]}
            </button>
          ))}
        </div>
      )}
      {GROUPS.map(g => {
        const rows = tiers.map((t, i) => [t, i]).filter(([t]) => inGroup(t, g.basis))
        return (
          <div key={g.basis} style={{ borderTop: `1px solid ${C.border}` }}>
            <div style={{ padding: '12px 12px 8px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted }}>{g.title}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 1.45 }}>{g.note}</div>
            </div>
            {rows.map(([t, i]) => (open === i ? editor(t, i) : row(t, i)))}
            <div style={{ padding: '8px 12px 12px', borderTop: rows.length ? `1px solid ${C.border}` : 'none' }}>
              <button style={{ ...btn, fontSize: 13, padding: '6px 12px', border: `1px dashed ${C.borderStrong}`, boxShadow: 'none', color: C.muted }}
                onClick={() => add(g.basis)}>{g.add}</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

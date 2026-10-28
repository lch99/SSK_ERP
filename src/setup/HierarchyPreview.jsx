import { useState } from 'react'
import * as P from '../../shared/payout.js'
import { C, inp, sel, btn, btnPrimary, label } from '../styles.js'

import { ROLE_COLORS, AGENT_COLOR, COMPANY_COLOR } from './colors.js'

const r2 = n => Math.round(n * 100) / 100
const fmtRM = n => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const isNum = v => v !== '' && v != null && Number.isFinite(Number(v))

// Live picture of the upline chain being set up: who sits above the
// negotiator, and how one example deal would pay out. Uses the unsaved draft:
// `tiers` are the tier plan being edited (`planName` when there are several).
export default function HierarchyPreview({ setup, tiers: all, planName, roles, splits, onAddLevel, onUseExample }) {
  const [absent, setAbsent] = useState([])
  const tiers = all.filter(t => isNum(t.agentRate))
  const [tierIdx, setTierIdx] = useState(0)
  const [amount, setAmount] = useState('10000')

  const enabled = P.DEAL_TYPES.filter(dt => setup.dealTypes?.[dt]?.enabled)
  const [dealType, setDealType] = useState(enabled[0] || 'sale')
  const dt = enabled.includes(dealType) ? dealType : enabled[0] || 'sale'

  const tier = tiers[Math.min(tierIdx, tiers.length - 1)]
  const agentRate = tier ? Number(tier.agentRate) : 60
  const raw = tier?.totals?.[dt]
  // A half-typed or too-low total counts as not set yet, as in the tier table.
  const totalPct = isNum(raw) && !P.validateTotal(raw, agentRate) ? Number(raw) : null

  const present = roles.map(r => r.code).filter(c => !absent.includes(c))
  const out = P.distribute({ agentRate, totalPct, uplines: present, splits, roles })
  const presentInChain = roles.filter(r => present.includes(r.code))
  const split = roles.length === 1 ? { [roles[0].code]: 100 } : splits || {}
  // What the levels taken off the deal would have had: it stays with the company.
  const left = totalPct == null ? 0 : r2(totalPct - out.agent - Object.values(out.uplines).reduce((s, v) => s + v, 0))
  const offDeal = roles.filter(r => !present.includes(r.code)).map(r => r.code)
  const comm = Number(amount) || 0
  const colorOf = code => ROLE_COLORS[roles.findIndex(r => r.code === code) % ROLE_COLORS.length]
  const toggle = code => setAbsent(absent.includes(code) ? absent.filter(c => c !== code) : [...absent, code])

  const segments = [
    { key: 'agent', name: 'Negotiator', pct: out.agent, color: AGENT_COLOR },
    ...presentInChain.map(r => ({ key: r.code, name: r.code, pct: out.uplines[r.code] || 0, color: colorOf(r.code) })),
    { key: 'company', name: 'Company', pct: out.company, color: COMPANY_COLOR },
  ].filter(s => s.pct > 0)

  return (
    <div style={{ marginTop: 20, padding: 16, background: C.bg, borderRadius: 8 }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <h3 style={{ fontSize: 14, margin: 0, flex: '1 1 160px' }}>Try a deal{planName ? ` · ${planName}` : ''}</h3>
        {tiers.length > 0 && (
          <label><span style={label}>Negotiator's tier</span>
            <select style={sel} value={tiers.indexOf(tier)} onChange={e => setTierIdx(Number(e.target.value))}>
              {tiers.map((t, i) => <option key={t.id ?? `new-${i}`} value={i}>{P.tierLabel(t) || `Tier ${i + 1}`} · {t.agentRate}%</option>)}
            </select>
          </label>
        )}
        {enabled.length > 1 && (
          <label><span style={label}>Deal type</span>
            <select style={sel} value={dt} onChange={e => setDealType(e.target.value)}>
              {enabled.map(x => <option key={x} value={x}>{P.DEAL_TYPE_LABELS[x]}</option>)}
            </select>
          </label>
        )}
        <label><span style={label}>Commission (RM)</span>
          <input style={{ ...inp, width: 110 }} type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* The chain, most senior at the top */}
        <div style={{ flex: '1 1 260px', maxWidth: 360 }}>
          {!roles.length && <ExampleChain onAddLevel={onAddLevel} onUse={onUseExample} />}
          {[...roles].reverse().map(r => {
            const on = present.includes(r.code)
            const color = colorOf(r.code)
            return (
              <div key={r.code}>
                <button onClick={() => toggle(r.code)} title={on ? 'Click to take this level off the deal' : 'Click to put this level on the deal'}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                    fontFamily: C.font, background: on ? '#fff' : 'transparent', border: `2px ${on ? 'solid' : 'dashed'} ${on ? color : C.border}`, opacity: on ? 1 : 0.6 }}>
                  <span style={{ minWidth: 44, padding: '3px 6px', borderRadius: 5, fontSize: 12, fontWeight: 700, textAlign: 'center',
                    color: '#fff', background: on ? color : C.muted }}>{r.code || '?'}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: C.text }}>{r.name || 'Untitled level'}</span>
                    <span style={{ display: 'block', fontSize: 12, color: C.muted }}>
                      {on ? `${r2(Number(split[r.code]) || 0)}% of the upline pool` : `Not on this deal: its ${r2(Number(split[r.code]) || 0)}% stays with the company`}
                    </span>
                  </span>
                  {on && totalPct != null && (
                    <span style={{ textAlign: 'right' }}>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color }}>{out.uplines[r.code] ?? 0}%</span>
                      <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{fmtRM(r2(comm * (out.uplines[r.code] || 0) / 100))}</span>
                    </span>
                  )}
                </button>
                <Connector />
              </div>
            )
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, background: AGENT_COLOR, color: '#fff' }}>
            <span style={{ minWidth: 44, padding: '3px 6px', borderRadius: 5, fontSize: 12, fontWeight: 700, textAlign: 'center', background: 'rgba(255,255,255,0.18)' }}>AGENT</span>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Negotiator{tier ? ` · ${P.tierLabel(tier)}` : ''}</span>
            <span style={{ textAlign: 'right' }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{out.agent}%</span>
              <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>{fmtRM(r2(comm * out.agent / 100))}</span>
            </span>
          </div>
          {roles.length > 0 && <p style={{ fontSize: 12, color: C.muted, margin: '8px 0 0' }}>Click a level to take it off or put it back on the deal.</p>}
        </div>

        {/* Where the whole commission goes */}
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <span style={label}>Where the commission goes</span>
          <div style={{ display: 'flex', height: 28, borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}>
            {segments.map(s => (
              <div key={s.key} title={`${s.name}: ${s.pct}%`} style={{ width: `${s.pct}%`, background: s.color, color: '#fff', fontSize: 11, fontWeight: 600,
                display: 'grid', placeItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>{s.pct >= 8 ? `${s.pct}%` : ''}</div>
            ))}
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <tbody>
              {segments.map(s => (
                <tr key={s.key}>
                  <td style={{ padding: '4px 0' }}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: s.color, marginRight: 8 }} />{s.name}</td>
                  <td style={{ padding: '4px 0', textAlign: 'right' }}>{s.pct}%</td>
                  <td style={{ padding: '4px 0 4px 12px', textAlign: 'right' }}>{fmtRM(r2(comm * s.pct / 100))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: C.muted, margin: '10px 0 0', lineHeight: 1.45 }}>
            {!tier ? 'Add a tier with an agent rate above to preview real numbers. Using 60% for now.'
              : !present.length ? 'No uplines on this deal: the negotiator keeps the tier rate and the rest stays with the company.'
              : totalPct == null ? `No valid total payout yet for ${P.tierLabel(tier)} (${P.DEAL_TYPE_LABELS[dt]}), so the uplines get nothing. Set it in the tier table above.`
              : `Total payout ${totalPct}% for ${P.DEAL_TYPE_LABELS[dt]}${planName ? ` on the ${planName} plan` : ''}: agent ${out.agent}% + upline pool ${r2(totalPct - out.agent)}%.`
                + (offDeal.length && left > 0 ? ` ${offDeal.join(' and ')} not on this deal, so ${left}% of the pool goes back to the company.` : '')}
          </p>
        </div>
      </div>
    </div>
  )
}

// The usual chain, most junior first: also what "Use this chain" fills in.
export const EXAMPLE_CHAIN = [{ code: 'TL', name: 'Team Leader' }, { code: 'UM', name: 'Unit Manager' }, { code: 'BM', name: 'Branch Manager' }]

// Shown before any upline level exists, so the shape of the chain is clear.
function ExampleChain({ onAddLevel, onUse }) {
  const example = [...EXAMPLE_CHAIN].reverse().map(r => [r.code, r.name])
  return (
    <div style={{ position: 'relative' }}>
      {example.map(([code, name]) => (
        <div key={code}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: `2px dashed ${C.border}`, opacity: 0.55 }}>
            <span style={{ minWidth: 44, padding: '3px 6px', borderRadius: 5, fontSize: 12, fontWeight: 700, textAlign: 'center', color: '#fff', background: C.muted }}>{code}</span>
            <span style={{ fontSize: 14, color: C.muted }}>{name} <i>(example)</i></span>
          </div>
          <Connector />
        </div>
      ))}
      <div style={{ position: 'absolute', inset: '0 0 14px', display: 'grid', placeItems: 'center' }}>
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px', textAlign: 'center', maxWidth: 250, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <p style={{ fontSize: 13, margin: '0 0 8px', lineHeight: 1.4 }}>No upline levels yet. Use the usual chain, or add your own levels.</p>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
            {onUse && <button style={{ ...btnPrimary, fontSize: 13 }} onClick={onUse}>Use this chain</button>}
            {onAddLevel && <button style={{ ...btn, fontSize: 13 }} onClick={onAddLevel}>+ Add a level</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

function Connector() {
  return <div aria-hidden style={{ width: 2, height: 14, background: C.border, margin: '0 auto' }} />
}

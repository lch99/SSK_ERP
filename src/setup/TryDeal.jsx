import { useState } from 'react'
import * as P from '../../shared/payout.js'
import { C, inp, sel, label } from '../styles.js'
import PayoutTree from './PayoutTree.jsx'

const isNum = v => v !== '' && v != null && Number.isFinite(Number(v))

// Try a deal: pick a tier and which uplines the negotiator has, and see who
// gets what. `tiers` carry their own totals (tier.totals[dealType]), so this
// works on a plan being edited as well as on a saved one.
export default function TryDeal({ setup, tiers: all, title = 'Try a deal' }) {
  const tiers = all.filter(t => isNum(t.agentRate))
  const enabled = P.DEAL_TYPES.filter(dt => setup.dealTypes?.[dt]?.enabled)
  const [tierIdx, setTierIdx] = useState(0)
  const [dealRaw, setDealType] = useState(enabled[0] || 'sale')
  const [present, setPresent] = useState(() => setup.roles.map(r => r.code))
  const [amount, setAmount] = useState('10000')
  const tier = tiers[Math.min(tierIdx, tiers.length - 1)]
  if (!tier) return null
  const dt = enabled.includes(dealRaw) ? dealRaw : enabled[0] || 'sale'
  const raw = tier.totals?.[dt]
  const total = isNum(raw) && !P.validateTotal(raw, tier.agentRate) ? Number(raw) : null
  const uplines = present.filter(c => setup.roles.some(r => r.code === c))
  const out = P.distribute({ agentRate: Number(tier.agentRate), totalPct: total, uplines, splits: setup.splits, roles: setup.roles })
  const differs = enabled.length > 1 && tiers.some(t => new Set(enabled.map(x => String(t.totals?.[x] ?? ''))).size > 1)

  return (
    <div style={{ marginTop: 20, padding: 14, background: C.bg, borderRadius: 8 }}>
      <h3 style={{ fontSize: 14, margin: '0 0 4px' }}>{title}</h3>
      <p style={{ fontSize: 13, color: C.muted, margin: '0 0 10px' }}>Pick a tier and the uplines on the deal, and see where every ringgit goes.</p>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
        <label><span style={label}>Negotiator's tier</span>
          <select style={sel} value={tiers.indexOf(tier)} onChange={e => setTierIdx(Number(e.target.value))}>
            {tiers.map((t, i) => <option key={t.id ?? `new-${i}`} value={i}>{P.tierLabel(t) || `Tier ${i + 1}`} · {t.agentRate}%</option>)}
          </select>
        </label>
        {differs && (
          <label><span style={label}>Deal type</span>
            <select style={sel} value={dt} onChange={e => setDealType(e.target.value)}>
              {enabled.map(x => <option key={x} value={x}>{P.DEAL_TYPE_LABELS[x]}</option>)}
            </select>
          </label>
        )}
        <label><span style={label}>Commission (RM)</span>
          <input style={{ ...inp, width: 120 }} type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} />
        </label>
        {setup.roles.length > 0 && (
          <div><span style={label}>Uplines on this deal</span>
            <div style={{ display: 'flex', gap: 10, paddingTop: 6, flexWrap: 'wrap' }}>
              {setup.roles.map(r => (
                <label key={r.code} style={{ fontSize: 14 }}>
                  <input type="checkbox" checked={present.includes(r.code)} style={{ accentColor: C.primary }}
                    onChange={e => setPresent(e.target.checked ? [...present, r.code] : present.filter(c => c !== r.code))} /> {r.code}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
      {uplines.length > 0 && total == null && (
        <p style={{ color: C.warn, fontSize: 13, margin: '0 0 8px' }}>No valid total payout for {P.tierLabel(tier)} yet, so uplines get nothing in this preview.</p>
      )}
      {total != null && setup.roles.length > 0 && uplines.length < setup.roles.length && (
        <p style={{ color: C.muted, fontSize: 13, margin: '0 0 8px' }}>
          {setup.roles.filter(r => !uplines.includes(r.code)).map(r => r.code).join(' and ')} not on this deal: that share of the upline pool stays with the company.
        </p>
      )}
      {!setup.roles.length && (
        <p style={{ color: C.muted, fontSize: 13, margin: '0 0 8px' }}>No upline levels are set up, so the negotiator gets the tier rate and the rest stays with the company.</p>
      )}
      <PayoutTree amount={amount} out={out} roles={setup.roles} tier={P.tierLabel(tier)} />
    </div>
  )
}

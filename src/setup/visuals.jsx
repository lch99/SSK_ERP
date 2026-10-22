import { Fragment, useState } from 'react'
import * as P from '../../shared/payout.js'
import { C, inp, label as labelStyle } from '../styles.js'
import Icon from '../erp/Icon.jsx'
import { Avatar } from '../erp/ui.jsx'
import { rm, rmShort } from '../erp/format.js'
import { useNarrow } from './useNarrow.js'
import { AGENT_COLOR, COMPANY_COLOR, roleColor } from './colors.js'

// Pictures for the Setup steps: each one draws the step's own (unsaved) values,
// so the boss sees what a number means while typing it.

export const POOL_COLOR = '#7a4fc9'
const TAX_COLOR = '#f2a93b'
const OTHER_COLOR = '#d0d5dd'

const isNum = v => v !== '' && v != null && Number.isFinite(Number(v))
const r2 = n => Math.round(n * 100) / 100
const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
export const panel = { background: C.bg, borderRadius: 10, padding: 14 }

// One icon per Setup step: the side list, the step header and the review tiles.
export const STEP_ICONS = { company: 'listings', dealTypes: 'deals', tiers: 'reports', uplines: 'customers', agents: 'users', approvals: 'payouts', review: 'eye' }

// Rental has no icon in the ERP set, so it gets a key drawn here.
const KEY = 'M8 20a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM10.9 13.1 20 4M16.5 7.5l2.2 2.2M14 10l2 2'
export function DealIcon({ type, size = 18 }) {
  if (type !== 'rental') return <Icon name={type === 'project' ? 'project' : 'home'} size={size} />
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
      <path d={KEY} />
    </svg>
  )
}

export function Key({ color, children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.muted, whiteSpace: 'nowrap' }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />{children}
    </span>
  )
}

// A bar split into parts: [{ key, pct, color, text, ink, hatch, title }]; `pct`
// is any size (shares of their sum). A part shows its text only when it takes
// at least an eighth of the bar.
export function Bar({ parts, height = 24, label }) {
  const total = parts.reduce((t, p) => t + Math.max(0, p.pct), 0) || 1
  return (
    <div role="img" aria-label={label} style={{ display: 'flex', gap: 2, height, borderRadius: 6, overflow: 'hidden', minWidth: 0 }}>
      {parts.filter(p => p.pct > 0).map(p => (
        <span key={p.key} title={p.title} style={{ flex: `${p.pct} 1 0`, minWidth: 3, background: p.color, color: p.ink || '#fff',
          backgroundImage: p.hatch ? `repeating-linear-gradient(135deg, transparent 0 5px, ${C.border} 5px 7px)` : undefined,
          fontSize: 11.5, fontWeight: 650, display: 'flex', alignItems: 'center', justifyContent: 'center', ...ellipsis, transition: 'flex-grow .35s ease' }}>
          {p.pct / total >= 0.125 ? p.text : ''}
        </span>
      ))}
    </div>
  )
}

// Small round progress: done out of total.
export function ProgressRing({ done, total, size = 44 }) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r, f = total ? done / total : 0
  return (
    <span role="img" aria-label={`${done} of ${total} steps done`} style={{ position: 'relative', width: size, height: size, flexShrink: 0, display: 'inline-block' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.grayBg} strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={f === 1 ? C.ok : C.primary} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${c * f} ${c}`} style={{ transition: 'stroke-dasharray .5s ease' }} />
      </svg>
      <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {done}/{total}
      </span>
    </span>
  )
}

// ── Flow: boxes joined by arrows, left to right; top to bottom when the boxes
// would get too narrow to read (about 190px each). ──

function Flow({ steps }) {
  const [ref, narrow] = useNarrow(steps.length * 190 + (steps.length - 1) * 40)
  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', alignItems: narrow ? 'stretch' : 'center', gap: 0 }}>
      {steps.map((s, i) => (
        <Fragment key={s.key}>
          {i > 0 && <Arrow label={s.via} down={narrow} />}
          <FlowBox {...s} />
        </Fragment>
      ))}
    </div>
  )
}

function FlowBox({ icon, title, sub, tone = 'gray', note, missing }) {
  const tones = { gray: [C.muted, '#fff'], brand: [C.primary, C.primaryBg], green: [C.ok, C.okBg], blue: [C.info, C.infoBg], violet: [C.violet, C.violetBg], dark: ['#fff', AGENT_COLOR] }
  const [fg, bg] = tones[tone]
  return (
    <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: missing ? 'transparent' : '#fff',
      border: missing ? `1.5px dashed ${C.borderStrong}` : `1px solid ${C.border}`, boxShadow: missing ? 'none' : C.shadow }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, background: missing ? C.grayBg : bg, color: missing ? C.faint : fg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        {typeof icon === 'string' ? <Icon name={icon} size={17} /> : icon}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 650, color: missing ? C.muted : C.text, lineHeight: 1.3 }}>{title}</span>
        {sub && <span style={{ display: 'block', fontSize: 12, color: C.muted, lineHeight: 1.35 }}>{sub}</span>}
        {note && <span style={{ display: 'inline-block', marginTop: 4, fontSize: 11.5, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: C.warnBg, color: C.warn }}>{note}</span>}
      </span>
    </div>
  )
}

function Arrow({ label, down }) {
  return (
    <span aria-hidden style={{ flex: '0 0 auto', display: 'flex', flexDirection: down ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: down ? 8 : 0,
      padding: down ? '4px 0 4px 26px' : '0 6px', color: C.faint, fontSize: 11, fontWeight: 600, minWidth: down ? 0 : 34 }}>
      {!down && label && <span style={{ whiteSpace: 'nowrap', marginBottom: 1 }}>{label}</span>}
      <Icon name={down ? 'down' : 'chevron'} size={16} />
      {down && label && <span>{label}</span>}
    </span>
  )
}

// ── Company: where money comes in and goes out ──

const last4 = no => (String(no || '').replace(/\D/g, '').slice(-4) ? `···${String(no).replace(/\D/g, '').slice(-4)}` : '')
const accountsFor = (accounts, purpose) => {
  const list = accounts.filter(a => a.purpose === purpose && String(a.bank || '').trim())
  if (!list.length) return null
  return `${list[0].bank} ${last4(list[0].accountNo)}${list.length > 1 ? ` + ${list.length - 1} more` : ''}`
}

export function MoneyFlow({ accounts }) {
  const client = accountsFor(accounts, 'client'), operating = accountsFor(accounts, 'operating')
  return (
    <div style={{ ...panel, display: 'grid', gap: 10, marginBottom: 12 }}>
      <Flow steps={[
        { key: 'in', icon: 'moneyIn', title: 'Commission', sub: 'from clients and developers', tone: 'brand' },
        { key: 'op', via: 'paid into', icon: 'payRuns', title: 'Operating account', sub: operating || 'Not added yet', tone: 'dark', missing: !operating },
        { key: 'out', via: 'pays', icon: 'customers', title: 'Agents and uplines', sub: 'and co-agencies', tone: 'green' },
      ]} />
      <Flow steps={[
        { key: 'cl', icon: 'users', title: 'Buyers and tenants', sub: 'earnest deposits', tone: 'blue' },
        { key: 'ca', via: 'held in', icon: 'lock', title: 'Client account', sub: client || 'Not added (optional)', tone: 'blue', missing: !client },
      ]} />
    </div>
  )
}

// A coloured tile with the bank's initials, crimson for Operating, blue for Client.
export function BankTile({ bank, purpose }) {
  const words = String(bank || '').trim().split(/\s+/).filter(Boolean)
  const text = words.length ? (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase() : '?'
  const [fg, bg] = purpose === 'operating' ? [C.primary, C.primaryBg] : purpose === 'client' ? [C.info, C.infoBg] : [C.muted, C.grayBg]
  return <span aria-hidden style={{ width: 38, height: 38, borderRadius: 10, background: bg, color: fg, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, flexShrink: 0, fontFamily: C.fontHead }}>{text}</span>
}

// The branch code as a big tile, with the manager's face beside the name.
export function BranchTile({ code }) {
  return (
    <span aria-hidden style={{ width: 44, height: 44, borderRadius: 11, background: `linear-gradient(160deg, ${C.primary}, ${C.primaryDark})`, color: '#fff', flexShrink: 0,
      display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: code && code.length > 2 ? 12 : 15, fontFamily: C.fontHead, letterSpacing: '.02em' }}>{code || '?'}</span>
  )
}

export function Manager({ name, phone }) {
  if (!name && !phone) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: C.muted, minWidth: 0 }}>
      {name && <Avatar name={name} size={22} tone="gray" />}
      <span style={ellipsis}>{[name && <b key="n" style={{ color: C.text, fontWeight: 600 }}>{name}</b>, phone].filter(Boolean).reduce((a, x, i) => (i ? [...a, ' · ', x] : [x]), [])}</span>
    </span>
  )
}

// ── Deals: one deal worked through with the step's own rates ──

const EXAMPLE = { sale: 500000, rental: 2500, project: 600000 }
const BASE_LABEL = { sale: 'Selling price', rental: 'Monthly rent', project: 'Selling price' }

export function DealWalkthrough({ d }) {
  const enabled = P.DEAL_TYPES.filter(dt => d[dt]?.enabled)
  const [typeRaw, setType] = useState(enabled[0] || 'sale')
  const [amounts, setAmounts] = useState(EXAMPLE)
  const type = enabled.includes(typeRaw) ? typeRaw : enabled[0]
  if (!type) return <div style={panel}><p style={{ margin: 0, fontSize: 13, color: C.muted }}>Turn on a deal type to see an example deal.</p></div>

  const pct = v => (isNum(v) ? Math.max(0, Number(v)) : 0)
  const base = pct(amounts[type])
  const rate = pct(d[type].defaultRate), sst = pct(d.sstPct), coa = Math.min(100, pct(d.coaSharePct)), ref = Math.min(100, pct(d.referralPct)), wht = pct(d.whtPct)
  const commission = base * rate / 100
  const onTop = d.sstMode !== 'included'
  const sstAmt = onTop ? commission * sst / 100 : commission * sst / (100 + sst)
  const fee = onTop ? commission : commission - sstAmt
  const rows = [
    {
      key: 'client', title: 'The client pays', amount: fee + sstAmt,
      parts: [{ key: 'fee', pct: fee, color: C.primary, text: 'Commission' }, { key: 'sst', pct: sstAmt, color: TAX_COLOR, ink: C.text, text: `SST ${sst}%` }],
      foot: <><Key color={C.primary}>Commission {rm(fee)}</Key><Key color={TAX_COLOR}>SST {rm(sstAmt)} {onTop ? 'on top' : 'inside'}</Key></>,
    },
    {
      key: 'coa', title: 'With another agency on the deal', amount: fee * coa / 100,
      parts: [{ key: 'us', pct: coa, color: C.primary, text: `Us ${coa}%` }, { key: 'them', pct: 100 - coa, color: OTHER_COLOR, ink: C.text, text: `Them ${r2(100 - coa)}%` }],
      foot: <><Key color={C.primary}>We keep {rm(fee * coa / 100)}</Key><Key color={OTHER_COLOR}>Other agency {rm(fee * (100 - coa) / 100)}</Key></>,
    },
    {
      key: 'ref', title: 'With an outside referrer', amount: fee * (100 - ref) / 100,
      parts: [{ key: 'us', pct: 100 - ref, color: C.primary, text: `Us ${r2(100 - ref)}%` }, { key: 'ref', pct: ref, color: OTHER_COLOR, ink: C.text, text: `${ref}%` }],
      foot: <><Key color={C.primary}>We keep {rm(fee * (100 - ref) / 100)}</Key><Key color={OTHER_COLOR}>Referral fee {rm(fee * ref / 100)}</Key></>,
    },
  ]
  return (
    <div style={panel}>
      <h3 style={{ fontSize: 14, margin: '0 0 2px' }}>One deal, worked through</h3>
      <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 10px', lineHeight: 1.45 }}>Uses the rates on this page, and changes as you type.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        {enabled.length > 1 && (
          <span role="radiogroup" aria-label="Example deal type" style={{ display: 'inline-flex', gap: 4, padding: 3, background: '#fff', borderRadius: 9, border: `1px solid ${C.border}` }}>
            {enabled.map(dt => (
              <button key={dt} role="radio" aria-checked={dt === type} onClick={() => setType(dt)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', borderRadius: 7, padding: '5px 9px', cursor: 'pointer', fontFamily: C.font, fontSize: 12.5, fontWeight: 600,
                  background: dt === type ? C.primaryBg : 'transparent', color: dt === type ? C.primaryDark : C.muted }}>
                <DealIcon type={dt} size={14} />{P.DEAL_TYPE_LABELS[dt]}
              </button>
            ))}
          </span>
        )}
        <label style={{ minWidth: 0 }}><span style={labelStyle}>{BASE_LABEL[type]} (RM)</span>
          <input style={{ ...inp, width: 130 }} type="number" min="0" step="1000" value={amounts[type]} onChange={e => setAmounts({ ...amounts, [type]: e.target.value })} />
        </label>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', padding: '10px 12px', background: '#fff', borderRadius: 8, border: `1px solid ${C.border}`, marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: C.muted }}>{rmShort(base)} × {rate}% =</span>
        <b style={{ fontSize: 20, fontFamily: C.fontHead, whiteSpace: 'nowrap' }}>{rm(commission)}</b>
        <span style={{ fontSize: 13, color: C.muted }}>commission</span>
      </div>
      <div style={{ display: 'grid', gap: 14 }}>
        {rows.map(r => (
          <div key={r.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, marginBottom: 5, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>{r.title}</span>
              <b style={{ fontVariantNumeric: 'tabular-nums' }}>{rm(r.amount)}</b>
            </div>
            <Bar parts={r.parts} height={20} label={`${r.title}: ${rm(r.amount)}`} />
            <div style={{ display: 'flex', gap: '4px 14px', flexWrap: 'wrap', marginTop: 6 }}>{r.foot}</div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, color: C.muted, lineHeight: 1.45, paddingTop: 10, borderTop: `1px dashed ${C.borderStrong}` }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: C.warnBg, color: C.warn, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="file" size={14} /></span>
          <span>Withholding tax: of every <b style={{ color: C.text }}>RM 1,000</b> paid to an agent, <b style={{ color: C.text }}>{rm(10 * wht)}</b> goes to LHDN.</span>
        </div>
      </div>
    </div>
  )
}

// ── Tiers: the whole ladder as bars, so the jumps between tiers are visible ──

export function TierLadder({ tiers, enabled }) {
  const [dtRaw, setDt] = useState(enabled[0] || 'sale')
  const dt = enabled.includes(dtRaw) ? dtRaw : enabled[0] || 'sale'
  const [ref, narrow] = useNarrow(560)
  const rows = P.sortTiers(tiers)
  if (!rows.length) return null
  const differs = enabled.length > 1 && rows.some(t => new Set(enabled.map(x => String(t.totals?.[x] ?? ''))).size > 1)
  const firstYearly = rows.findIndex(t => t.basis === 'yearly')
  return (
    <div ref={ref} style={{ ...panel, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px 14px', flexWrap: 'wrap', marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, margin: 0, flex: '1 1 auto' }}>Your ladder at a glance</h3>
        <Key color={AGENT_COLOR}>Negotiator</Key><Key color={POOL_COLOR}>Upline pool</Key><Key color={COMPANY_COLOR}>Company</Key>
      </div>
      <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 10px', lineHeight: 1.45 }}>
        Each deal's commission at every tier, when the negotiator has uplines. With no uplines, the pool stays with the company.
      </p>
      {differs && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {enabled.map(x => (
            <button key={x} onClick={() => setDt(x)} aria-pressed={x === dt}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 14, cursor: 'pointer', fontFamily: C.font, fontSize: 12.5, fontWeight: 600,
                border: `1px solid ${x === dt ? C.primary : C.border}`, background: x === dt ? C.primaryBg : '#fff', color: x === dt ? C.primaryDark : C.muted }}>
              <DealIcon type={x} size={13} />{P.DEAL_TYPE_LABELS[x]}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gap: 7 }}>
        {rows.map((t, i) => {
          const agent = isNum(t.agentRate) && Number(t.agentRate) > 0 && Number(t.agentRate) < 100 ? Number(t.agentRate) : null
          const raw = t.totals?.[dt]
          const total = agent != null && isNum(raw) && Number(raw) >= agent && Number(raw) <= 100 ? Number(raw) : null
          const parts = agent == null ? [] : [
            { key: 'a', pct: agent, color: AGENT_COLOR, text: `${r2(agent)}%`, title: `Negotiator ${r2(agent)}%` },
            ...(total != null
              ? [{ key: 'p', pct: total - agent, color: POOL_COLOR, text: `${r2(total - agent)}%`, title: `Upline pool ${r2(total - agent)}%` },
                { key: 'c', pct: 100 - total, color: COMPANY_COLOR, ink: C.text, text: `${r2(100 - total)}%`, title: `Company ${r2(100 - total)}%` }]
              : [{ key: 'x', pct: 100 - agent, color: '#fff', hatch: true, ink: C.muted, text: 'total not set' }]),
          ]
          return (
            <Fragment key={t.id ?? `t${i}`}>
              {i === firstYearly && i > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, fontWeight: 600, color: C.muted, margin: '4px 0 0' }}>
                  <span style={{ flex: 1, height: 1, background: C.borderStrong }} />Then each year, on this year's commission<span style={{ flex: 1, height: 1, background: C.borderStrong }} />
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : 'minmax(0, 200px) minmax(0, 1fr)', gap: narrow ? 4 : 12, alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ minWidth: 30, padding: '2px 6px', borderRadius: 6, background: '#fff', border: `1px solid ${C.border}`, fontSize: 12, fontWeight: 700, textAlign: 'center' }}>{t.name || `T${i + 1}`}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 600, ...ellipsis }}>{String(t.title || '').trim() || <span style={{ color: C.faint, fontWeight: 500 }}>No name</span>}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: C.muted }}>{isNum(t.threshold) ? (Number(t.threshold) ? `from ${rmShort(t.threshold)}` : 'everyone starts here') : 'amount not set'}</span>
                  </span>
                </span>
                {agent == null
                  ? <span style={{ fontSize: 12.5, color: C.muted }}>Set an agent rate to see this tier.</span>
                  : <Bar parts={parts} label={`${P.tierLabel(t)}: ${parts.map(p => p.title || p.text).join(', ')}`} />}
              </div>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

// ── Uplines: how one mix of uplines shares the pool ──

export function SplitBar({ roles, combo, split }) {
  const sum = combo.reduce((s, c) => s + (Number(split?.[c]) || 0), 0)
  const parts = [
    ...combo.map(c => ({ key: c, pct: Math.max(0, Number(split?.[c]) || 0), color: roleColor(roles, c), text: `${r2(Number(split?.[c]) || 0)}%`, title: `${c} ${r2(Number(split?.[c]) || 0)}%` })),
    ...(sum < 100 ? [{ key: 'gap', pct: 100 - sum, color: '#fff', hatch: true, ink: C.muted, text: 'not shared' }] : []),
  ]
  return <Bar parts={parts} height={18} label={`${combo.join(' + ')}: ${parts.map(p => p.title || p.text).join(', ')}`} />
}

// ── Approvals: the road from a closed case to money in the agent's bank ──

export function ApprovalFlow({ a }) {
  const above = a.dealApprover === 'manager' && isNum(a.bossAbove) ? `Over ${rmShort(a.bossAbove)}: boss too` : null
  const approvers = a.dealApprover === 'both'
    ? [{ key: 'm', via: 'checked by', icon: 'staff', title: 'Branch manager', sub: 'approves the split', tone: 'violet' },
      { key: 'b', via: 'then', icon: 'crown', title: 'Boss', sub: 'approves too', tone: 'violet' }]
    : a.dealApprover === 'manager' ? [{ key: 'm', via: 'checked by', icon: 'staff', title: 'Branch manager', sub: 'approves the split', tone: 'violet', note: above }]
    : a.dealApprover === 'boss' ? [{ key: 'b', via: 'checked by', icon: 'crown', title: 'Boss', sub: 'approves every payout', tone: 'violet' }]
    : [{ key: 'm', via: 'checked by', icon: 'staff', title: 'Approver', sub: 'not chosen yet', missing: true }]
  const when = P.PAY_WHEN.find(x => x.value === a.payWhen)
  const run = a.payRun === 'weekly' ? `Every ${P.WEEKDAYS[a.payDay - 1] || 'week'}` : a.payRun === 'twice' ? '1st and 15th' : a.payRun === 'monthly' ? `On the ${a.payDay || '?'}th` : a.payRun === 'any' ? 'Any day' : null
  return (
    <div style={{ ...panel, marginTop: 20 }}>
      <h3 style={{ fontSize: 14, margin: '0 0 10px' }}>From a closed case to the agent's bank</h3>
      <Flow steps={[
        { key: 'c', icon: 'check', title: 'Case closed', sub: 'the split is worked out', tone: 'brand' },
        ...approvers,
        when ? { key: 'w', via: 'waits until', icon: 'moneyIn', title: a.payWhen === 'full' ? 'Client paid in full' : 'Money comes in', sub: a.payWhen === 'full' ? 'nothing goes out before' : 'shares paid as it arrives', tone: 'blue' }
          : { key: 'w', via: 'waits until', icon: 'moneyIn', title: 'Pay when', sub: 'not chosen yet', missing: true },
        run ? { key: 'r', via: 'paid', icon: 'payRuns', title: run, sub: a.payRun === 'any' ? 'once approved' : 'in one batch', tone: 'green' }
          : { key: 'r', via: 'paid', icon: 'payRuns', title: 'Pay day', sub: 'not chosen yet', missing: true },
      ]} />
      <p style={{ fontSize: 12.5, color: C.muted, margin: '10px 0 0' }}>
        Refunds are approved by {a.refundApprover === 'manager' ? 'the branch manager' : a.refundApprover === 'boss' ? 'the boss' : '… (not chosen yet)'}.
      </p>
    </div>
  )
}

// The next few pay days, as small calendar pages.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function nextPayDays(a, from = new Date(), count = 4) {
  const out = [], d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const hit = x => (a.payRun === 'weekly' ? ((x.getDay() + 6) % 7) + 1 === Number(a.payDay)
    : a.payRun === 'twice' ? [1, 15].includes(x.getDate())
    : a.payRun === 'monthly' ? x.getDate() === Number(a.payDay) : false)
  for (let i = 0; i < 400 && out.length < count; i++, d.setDate(d.getDate() + 1)) if (hit(d)) out.push(new Date(d))
  return out
}

export function PayDays({ a }) {
  const days = ['weekly', 'twice', 'monthly'].includes(a.payRun) ? nextPayDays(a) : []
  if (!days.length) return null
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
      <span style={{ fontSize: 12.5, color: C.muted, marginRight: 2 }}>Next pay days</span>
      {days.map((x, i) => (
        <span key={i} style={{ width: 54, borderRadius: 8, overflow: 'hidden', border: `1px solid ${i ? C.border : C.primary}`, textAlign: 'center', background: '#fff', boxShadow: C.shadow }}>
          <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: '#fff', background: i ? C.muted : C.primary, padding: '1px 0', textTransform: 'uppercase', letterSpacing: '.05em' }}>{MONTHS[x.getMonth()]}</span>
          <span style={{ display: 'block', fontSize: 17, fontWeight: 800, fontFamily: C.fontHead, lineHeight: 1.25, paddingTop: 2 }}>{x.getDate()}</span>
          <span style={{ display: 'block', fontSize: 10.5, color: C.muted, paddingBottom: 3 }}>{DAYS[x.getDay()]}</span>
        </span>
      ))}
    </div>
  )
}

// ── Numbering: what each part of a case number means ──

export function NumberAnatomy({ numbering, branches, enabled }) {
  const branch = branches[0] || { id: null, code: 'TD', name: 'a branch' }
  const kind = enabled[0] || 'sale'
  const lead = numbering.letters?.[kind] ?? ''
  const digits = Number(numbering.caseDigits) || 4
  const parts = [
    lead && { key: 'l', text: lead, label: `${P.DEAL_TYPE_LABELS[kind]} letter`, color: C.primary, bg: C.primaryBg },
    { key: 'b', text: branch.code || '??', label: `${branch.name || 'Branch'} code`, color: C.info, bg: C.infoBg },
    { key: 'n', text: '1'.padStart(digits, '0'), label: 'Running number', color: C.ok, bg: C.okBg },
  ].filter(Boolean)
  return (
    <div style={{ ...panel, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
      <div role="img" aria-label={`Case number ${parts.map(p => p.text).join('')}: ${parts.map(p => `${p.text} is the ${p.label}`).join(', ')}`} style={{ display: 'flex', gap: 4 }}>
        {parts.map(p => (
          <span key={p.key} style={{ textAlign: 'center' }}>
            <span style={{ display: 'block', padding: '6px 10px', borderRadius: 8, background: p.bg, color: p.color, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 22, fontWeight: 700, letterSpacing: '.04em' }}>{p.text}</span>
            <span style={{ display: 'block', fontSize: 11, color: C.muted, marginTop: 4, maxWidth: 96 }}>{p.label}</span>
          </span>
        ))}
      </div>
      <p style={{ flex: '1 1 220px', fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.5 }}>
        Every {P.DEAL_TYPE_LABELS[kind]} case at {branch.name || 'a branch'} starts with <b style={{ color: C.text }}>{lead}{branch.code}</b> and counts up from there. Vouchers work the same way with <b style={{ color: C.text }}>{numbering.voucherPrefix || ''}{branch.code}</b>.
      </p>
    </div>
  )
}

// ── Review: the whole setup as tiles, each opening its step ──

export function SetupGlance({ setup, onGoTo }) {
  const enabled = P.DEAL_TYPES.filter(dt => setup.dealTypes?.[dt]?.enabled)
  const plans = setup.plans || []
  const tiers = plans.flatMap(p => p.tiers || [])
  const rates = tiers.map(t => Number(t.agentRate)).filter(Number.isFinite)
  const agents = setup.agents || []
  const managers = setup.branches.map(b => b.manager).filter(Boolean)
  const tiles = [
    { key: 'company', label: 'Branches', value: setup.branches.length, sub: setup.branches.map(b => b.code).join(' · ') || 'None yet',
      extra: managers.length > 0 && (
        <span style={{ display: 'flex', marginTop: 8 }}>
          {managers.slice(0, 5).map((m, i) => <span key={m} title={m} style={{ marginLeft: i ? -8 : 0, borderRadius: '50%', boxShadow: '0 0 0 2px #fff', display: 'inline-flex' }}><Avatar name={m} size={26} tone="gray" /></span>)}
        </span>
      ) },
    { key: 'dealTypes', label: 'Deal types', value: enabled.length, sub: enabled.map(x => `${P.DEAL_TYPE_LABELS[x]} ${setup.dealTypes[x].defaultRate}%`).join(' · ') || 'None yet',
      extra: <span style={{ display: 'flex', gap: 6, marginTop: 8, color: C.primary }}>{enabled.map(x => <DealIcon key={x} type={x} size={18} />)}</span> },
    { key: 'tiers', label: 'Tiers', value: tiers.length, sub: rates.length ? `${plans.length} plan${plans.length === 1 ? '' : 's'} · agent ${Math.min(...rates)}–${Math.max(...rates)}%` : 'None yet' },
    { key: 'uplines', label: 'Upline levels', value: setup.roles.length, sub: setup.roles.map(r => r.code).join(' → ') || 'None: negotiators keep their rate' },
    { key: 'agents', label: 'Agents', value: agents.length, sub: agents.length ? `${agents.filter(x => x.position).length} leaders · ${agents.filter(x => !x.position).length} negotiators` : 'None imported yet' },
    { key: 'approvals', label: 'Pay day', value: null, big: setup.approvals?.payRun === 'weekly' ? `Every ${P.WEEKDAYS[setup.approvals.payDay - 1]?.slice(0, 3)}` : P.PAY_RUNS.find(x => x.value === setup.approvals?.payRun)?.label || 'Not set',
      sub: P.APPROVERS.find(x => x.value === setup.approvals?.dealApprover)?.label ? `${P.APPROVERS.find(x => x.value === setup.approvals.dealApprover).label} approves` : 'Approvals not set' },
  ]
  const done = Object.fromEntries(setup.checklist.map(i => [i.key, i.done]))
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(190px, 100%), 1fr))', gap: 10, marginBottom: 16 }}>
      {tiles.map(t => (
        <button key={t.key} onClick={() => onGoTo(t.key)} className="ssk-lift" title={`Open ${t.label}`}
          style={{ textAlign: 'left', fontFamily: C.font, cursor: 'pointer', background: '#fff', border: `1px solid ${done[t.key] === false ? C.warn : C.border}`, borderRadius: 12, padding: '12px 14px', minWidth: 0, color: C.text }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: C.primaryBg, color: C.primary, display: 'grid', placeItems: 'center' }}><Icon name={STEP_ICONS[t.key]} size={15} /></span>
            <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 600, flex: 1 }}>{t.label}</span>
            {done[t.key] === false && <span style={{ fontSize: 11, fontWeight: 700, color: C.warn }}>To do</span>}
          </span>
          <span style={{ display: 'block', fontSize: t.big ? 18 : 24, fontWeight: 800, fontFamily: C.fontHead, lineHeight: 1.2 }}>{t.big ?? t.value}</span>
          <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 2, ...ellipsis }}>{t.sub}</span>
          {t.extra}
        </button>
      ))}
    </div>
  )
}

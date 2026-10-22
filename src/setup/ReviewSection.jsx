import { useState } from 'react'
import * as P from '../../shared/payout.js'
import { C, sel, btn, label } from '../styles.js'
import Section from './Section.jsx'
import OutlineTree from './OutlineTree.jsx'
import TryDeal from './TryDeal.jsx'
import { roleColor, AGENT_COLOR } from './colors.js'
import { SetupGlance } from './visuals.jsx'

const r2 = n => Math.round(n * 100) / 100
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }
const pill = (text, bg, fg) => (
  <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: bg, color: fg, marginLeft: 6, whiteSpace: 'nowrap' }}>{text}</span>
)

// ── Last step: everything on one page, as a tree ─────────────────────────────

export default function ReviewSection({ setup, step, onGoTo }) {
  const enabled = P.DEAL_TYPES.filter(dt => setup.dealTypes?.[dt]?.enabled)
  const [dealRaw, setDealType] = useState(enabled[0] || 'sale')
  const dt = enabled.includes(dealRaw) ? dealRaw : enabled[0] || 'sale'
  const [tryRaw, setTryPlan] = useState(0)
  const plans = setup.plans || []
  const tryPlan = Math.min(tryRaw, Math.max(0, plans.length - 1))
  const agents = setup.agents || []
  const todo = setup.checklist.filter(i => !i.done)

  const tierNode = t => {
    const v = t.totals?.[dt]
    const ok = v !== '' && v != null
    return {
      key: `t${t.id}`,
      tone: ok ? AGENT_COLOR : C.warn,
      label: <>{P.tierLabel(t)} {pill(t.basis === 'yearly' ? 'this year' : 'lifetime', C.bg, C.muted)}</>,
      meta: ok
        ? <>From RM {Number(t.threshold).toLocaleString('en-MY')} · agent <b>{t.agentRate}%</b> · total <b>{v}%</b> · upline pool {r2(v - t.agentRate)}% · company {r2(100 - v)}%</>
        : <span style={{ color: C.warn }}>From RM {Number(t.threshold).toLocaleString('en-MY')} · agent {t.agentRate}% · no total payout set for {P.DEAL_TYPE_LABELS[dt]}</span>,
    }
  }

  const planNode = (p, i) => {
    const on = P.branchesOnPlan(plans, setup.branches, i)
    return {
      key: `plan${p.id}`, open: plans.length === 1,
      label: <>{plans.length > 1 ? `${P.planLabel(p, i)} plan` : 'Tiers'} {pill(`${p.tiers.length} tiers`, C.bg, C.muted)}</>,
      meta: on.length ? `Used by ${on.length === setup.branches.length && on.length > 1 ? 'every branch' : on.map(b => b.name).join(', ')}` : <span style={{ color: C.warn }}>Not used by any branch</span>,
      children: p.tiers.map(tierNode),
    }
  }

  const branchNode = b => {
    const plan = P.planIndexFor(plans, b.id)
    const team = agents.filter(a => a.branchId === b.id).length
    const nums = [...enabled, 'voucher'].map(k => P.formatNumber(setup.numbering, k, b)).join(' · ')
    return {
      key: `b${b.id}`,
      label: <>{b.name} <span style={{ ...mono, fontSize: 12, color: C.muted }}>({b.code})</span>
        {plans.length > 1 && pill(`${P.planLabel(plans[plan], plan)} tiers`, plan ? C.primaryBg : C.bg, plan ? C.primary : C.muted)}
        {team > 0 && pill(`${team} agent${team === 1 ? '' : 's'}`, C.bg, C.muted)}</>,
      meta: <>{b.manager && <>Manager: {b.manager} · </>}First numbers: <span style={mono}>{nums}</span></>,
    }
  }

  const nodes = [{
    key: 'company',
    label: <>{setup.company.name || <span style={{ color: C.warn }}>Company name not set</span>}</>,
    meta: [setup.company.regNo && `SSM ${setup.company.regNo}`, setup.company.licenceNo && `Licence ${setup.company.licenceNo}`,
      setup.company.reaName && `REA ${setup.company.reaName}${setup.company.reaNo ? ` (${setup.company.reaNo})` : ''}`,
      setup.company.sstNo && `SST ${setup.company.sstNo}`].filter(Boolean).join(' · '),
    children: [
      {
        key: 'branches', label: <>Branches {pill(`${setup.branches.length}`, C.bg, C.muted)}</>,
        children: setup.branches.map(branchNode),
      },
      {
        key: 'banks', label: <>Bank accounts {pill(`${(setup.bankAccounts || []).length}`, C.bg, C.muted)}</>, open: false,
        meta: (setup.bankAccounts || []).length ? null : <span style={{ color: C.warn }}>No bank account yet</span>,
        children: (setup.bankAccounts || []).map(a => ({
          key: `bank${a.id}`, label: `${a.bank} · ${a.accountNo}`,
          meta: `${a.accountName} · ${P.BANK_PURPOSES.find(x => x.value === a.purpose)?.label || ''}`,
        })),
      },
      {
        key: 'deals', label: 'Deal types', open: false,
        children: [
          { key: 'sst', label: 'SST', meta: `${setup.dealTypes.sstPct}% · ${P.SST_MODES.find(m => m.value === setup.dealTypes.sstMode)?.label.toLowerCase() || ''}` },
          { key: 'wht', label: 'Withholding tax on agents', meta: `${setup.dealTypes.whtPct}%` },
          { key: 'share', label: 'Sharing', meta: `Co-agency: our share ${setup.dealTypes.coaSharePct}% · Referral fee ${setup.dealTypes.referralPct}% of our commission` },
        ],
        meta: enabled.map(x => `${P.DEAL_TYPE_LABELS[x]} ${setup.dealTypes[x].defaultRate === '' ? '(rate not set)' : `${setup.dealTypes[x].defaultRate}%`}`)
          .join(' · ') + ` · SST ${setup.dealTypes.sstPct}%`,
      },
      ...(plans.length ? plans.map(planNode) : [{ key: 'noplans', label: 'Tiers', meta: <span style={{ color: C.warn }}>No tiers yet</span> }]),
      {
        key: 'uplines', label: 'Upline chain', open: false,
        meta: setup.roles.length ? [...setup.roles].reverse().map(r => `${r.code} ${r.name}`).join(' → ') + ' → Negotiator' : 'No uplines: negotiators keep their tier rate',
        children: P.roleCombos(setup.roles).map(combo => ({
          key: P.comboKey(combo), tone: roleColor(setup.roles, combo[combo.length - 1]),
          label: combo.join(' + '),
          meta: combo.map(c => `${c} ${setup.splits[P.comboKey(combo)]?.[c] ?? '?'}%`).join(' · ') + ' of the upline pool',
        })),
      },
      {
        key: 'agents', label: <>Agents {pill(`${agents.length}`, C.bg, C.muted)}</>,
        meta: agents.length ? `${agents.filter(a => a.position).length} leaders · ${agents.filter(a => !a.position).length} negotiators` : 'None imported yet',
      },
      {
        key: 'approvals', label: 'Approvals and paying agents',
        meta: P.describeApprovals(setup.approvals) || <span style={{ color: C.warn }}>Not set yet</span>,
      },
    ],
  }]

  return (
    <Section id="review" step={step} title="Review" done={!todo.length}
      hint="Everything you've set up, in one place. Click a tile to change that step, open a tier plan to check its rates and totals, then try a deal to confirm the numbers.">
      <SetupGlance setup={setup} onGoTo={onGoTo} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
        {enabled.length > 1 && (
          <label><span style={label}>Show totals for</span>
            <select style={sel} value={dt} onChange={e => setDealType(e.target.value)}>
              {enabled.map(x => <option key={x} value={x}>{P.DEAL_TYPE_LABELS[x]}</option>)}
            </select>
          </label>
        )}
      </div>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 14px' }}>
        <OutlineTree nodes={nodes} />
      </div>

      {plans.length > 0 && enabled.length > 0 && (
        <>
          {plans.length > 1 && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 20 }}>
              <label><span style={label}>Try a deal on</span>
                <select style={sel} value={tryPlan} onChange={e => setTryPlan(Number(e.target.value))}>
                  {plans.map((p, i) => <option key={p.id} value={i}>{P.planLabel(p, i)} plan</option>)}
                </select>
              </label>
            </div>
          )}
          <TryDeal key={tryPlan} setup={setup} tiers={plans[tryPlan].tiers} />
        </>
      )}

      <div style={{ marginTop: 20, padding: 14, borderRadius: 8, background: todo.length ? C.warnBg : C.okBg }}>
        {todo.length ? (
          <>
            <b style={{ color: C.warn }}>{todo.length} step{todo.length > 1 ? 's' : ''} still to finish before going live</b>
            <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
              {todo.map(i => (
                <li key={i.key} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '4px 0', fontSize: 13 }}>
                  <span style={{ flex: '1 1 220px' }}><b>{i.title}</b>: {i.detail}</span>
                  <button style={{ ...btn, fontSize: 13, padding: '4px 10px' }} onClick={() => onGoTo(i.key)}>Go to step</button>
                </li>
              ))}
            </ul>
          </>
        ) : <b style={{ color: C.ok }}>✓ Setup complete. Ready to go live.</b>}
      </div>
    </Section>
  )
}

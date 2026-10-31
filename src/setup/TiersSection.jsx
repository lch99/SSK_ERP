import { useState } from 'react'
import * as P from '../../shared/payout.js'
import { C, inp, sel, btn, btnPrimary, label } from '../styles.js'
import Section from './Section.jsx'
import { useDraft } from './useDraft.js'
import TierEditor from './TierEditor.jsx'
import { Group, Choice } from './ui.jsx'
import { UplineFields, uplineErrors, uplineEdits } from './UplinesSection.jsx'
import HierarchyPreview from './HierarchyPreview.jsx'
import { AGENT_COLOR } from './colors.js'
import { useFeedback } from '../erp/feedback.jsx'

const r2 = n => Math.round(n * 100) / 100
const isNum = v => v !== '' && v != null && Number.isFinite(Number(v))
const everyType = v => Object.fromEntries(P.DEAL_TYPES.map(dt => [dt, v]))

// One click to a working ladder: the ranks and own rates of the current ERP
// (Trainee 60 · Agent 70 · Senior Negotiator 80) and its 90% paid out per deal.
// The RM amounts are only a starting point.
const STARTER = [
  ['T1', 'Trainee', 'lifetime', 0, 60],
  ['T2', 'Agent', 'lifetime', 30000, 70],
  ['T3', 'Senior Negotiator', 'lifetime', 80000, 80],
  ['T4', 'Top Achiever', 'yearly', 150000, 85],
].map(([name, title, basis, threshold, agentRate]) => ({ id: null, name, title, basis, threshold, agentRate, totals: everyType(90) }))

// Today and the 1st of next month, as YYYY-MM-DD in local time.
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayIso = () => isoDay(new Date())
const nextMonthIso = () => { const d = new Date(); return isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 1)) }
const dayBefore = iso => new Date(Date.parse(iso) - 864e5).toISOString().slice(0, 10)

// What changes what a deal pays: rates, totals, thresholds, branches, the
// chain, its split and the side share. Names alone don't.
const moneyKey = (plans, u, side) => JSON.stringify([
  plans.map(p => [p.branchIds, P.sortTiers(p.tiers).map(t => [t.basis, Number(t.threshold), Number(t.agentRate), P.DEAL_TYPES.map(dt => String(t.totals?.[dt] ?? ''))])]),
  u.roles.map(r => r.code), u.roles.map(r => Number(u.splits?.[r.code]) || 0), Number(side),
])

// ── Tiers, uplines and payouts ───────────────────────────────────────────────
// Each tier plan is one ladder (TierEditor.jsx): a line per tier, opened to
// change it. Branches pay on the standard plan unless picked for another one.
// Below it, the upline chain that shares the pool and the split between two
// agents on one deal (both the same for every plan). All saved together; once
// Setup is done, a change that moves money asks from which E-Form date it applies.

export default function TiersSection({ setup, save, step, done }) {
  const fb = useFeedback()
  const [plans, setPlans, plansDirty, plansReset] = useDraft(setup.plans)
  const [u, setU, uDirty, uReset] = useDraft({ roles: setup.roles, splits: setup.splits })
  const [side, setSide, sideDirty, sideReset] = useDraft(setup.sideSharePct)
  const dirty = plansDirty || uDirty || sideDirty
  const reset = () => { plansReset(); uReset(); sideReset() }
  const chain = uplineEdits(u, setU)
  const [activeRaw, setActive] = useState(0)
  const active = Math.min(activeRaw, Math.max(0, plans.length - 1))
  const plan = plans[active]
  const enabled = P.DEAL_TYPES.filter(dt => setup.dealTypes?.[dt]?.enabled)
  const differs = list => enabled.length > 1 && list.some(p => p.tiers.some(t => new Set(enabled.map(dt => String(t.totals?.[dt] ?? ''))).size > 1))
  const [perTypeRaw, setPerType] = useState(() => differs(setup.plans))
  const perType = perTypeRaw && enabled.length > 1
  const [fill, setFill] = useState({ value: '', mode: 'flat' })

  // Saved in ladder order, so check them that way too.
  const sorted = plans.map(p => ({ ...p, tiers: P.sortTiers(p.tiers) }))
  // After go-live, rules that change money start on a date; earlier E-Forms keep the old ones.
  const moneyChanged = done && moneyKey(sorted, u, side) !== moneyKey(setup.plans, setup, setup.sideSharePct)
  const [when, setWhen] = useState(null)
  const [pickedDay, setPickedDay] = useState(nextMonthIso)
  const since = P.rulesSince(setup)
  const startOptions = [
    { value: 'today', day: todayIso(), label: `E-Forms dated from today (${P.dayLabel(todayIso())})` },
    { value: 'month', day: nextMonthIso(), label: `E-Forms dated from ${P.dayLabel(nextMonthIso())}`, desc: 'A clean start with the new month.' },
  ].filter(o => !since || o.day > since)
  const choice = when || startOptions[0]?.value || 'date'
  const from = !moneyChanged || choice === 'fix' ? null : startOptions.find(o => o.value === choice)?.day || pickedDay
  const errors = [...P.validatePlans(sorted, setup.dealTypes, setup.branches), ...uplineErrors(u), ...P.validateSideShare(side),
    ...(from ? P.validateRulesFrom(from, setup.ruleHistory) : [])]
  const steps = [['plans', { plans: sorted, sideSharePct: side }], ['uplines', { roles: u.roles, splits: u.splits }]]

  const setPlan = patch => setPlans(plans.map((p, i) => (i === active ? { ...p, ...patch } : p)))
  const setTiers = tiers => setPlan({ tiers })

  const addPlan = () => {
    setPlans([...plans, { id: null, name: '', branchIds: [], tiers: plan.tiers.map(t => ({ ...t, id: null })) }])
    setActive(plans.length)
  }
  const removePlan = async () => {
    const name = P.planLabel(plan, active)
    if (!(await fb.confirm({ title: `Remove ${name}?`, body: `Its branches go back to ${P.planLabel(plans[0], 0)}.`, confirmLabel: 'Remove plan', danger: true }))) return
    setPlans(plans.filter((_, i) => i !== active))
    setActive(0)
  }
  // A branch is on one plan: picking it here takes it off any other.
  const toggleBranch = id => {
    const on = plan.branchIds.includes(id)
    setPlans(plans.map((p, i) => (i === 0 ? p
      : i === active ? { ...p, branchIds: on ? p.branchIds.filter(x => x !== id) : [...p.branchIds, id] }
      : { ...p, branchIds: on ? p.branchIds : p.branchIds.filter(x => x !== id) })))
  }
  // Back to one total for every deal type: keep the first deal type's.
  const togglePerType = on => {
    setPerType(on)
    if (!on && differs(plans)) {
      setPlans(plans.map(p => ({ ...p, tiers: p.tiers.map(t => ({ ...t, totals: { ...t.totals, ...everyType(t.totals?.[enabled[0]] ?? '') } })) })))
    }
  }
  const applyFill = () => {
    const v = Number(fill.value)
    setTiers(plan.tiers.map(t => {
      if (fill.mode === 'above' && !isNum(t.agentRate)) return t
      const total = fill.mode === 'above' ? Math.min(100, r2(Number(t.agentRate) + v)) : v
      return { ...t, totals: { ...t.totals, ...everyType(total) } }
    }))
  }

  if (!plans.length) {
    return (
      <Section id="tiers" step={step} title="Tiers, uplines and payouts" done={done}
        hint="What a negotiator earns at each level, what the deal pays out in total when they have uplines, and how the uplines share it.">
        <Starter onUse={tiers => setPlans([{ id: null, name: P.STANDARD_PLAN, branchIds: [], tiers }])} />
      </Section>
    )
  }

  const onStandard = P.branchesOnPlan(plans, setup.branches, 0)
  return (
    <Section id="tiers" step={step} title="Tiers, uplines and payouts" done={done} dirty={dirty} onReset={reset}
      hint={<>For each tier: the <b>agent rate</b> the negotiator keeps, and the <b>total payout</b> when they have uplines. The difference is the <b>upline pool</b>, shared by the upline levels further down; the rest stays with the company. Agents climb the tiers <b>since joining</b> on the commission they have earned, then optionally <b>each year</b> on that year's commission. Click a tier to change it.</>}
      errors={errors} onSave={() => save(from ? [['rules-from', { from }], ...steps] : steps)}>

      <RulesHistory setup={setup} />

      {/* Which branches pay on which tiers */}
      {setup.branches.length > 0 && plans.length === 1 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', borderRadius: 8, background: C.bg, marginBottom: 14, fontSize: 13.5 }}>
          <span style={{ flex: '1 1 260px' }}>
            {setup.branches.length === 1 ? <><b>{setup.branches[0].name}</b> pays on these tiers.</> : <>All {setup.branches.length} branches pay on these tiers.</>}
          </span>
          {setup.branches.length > 1 && <button style={{ ...btn, fontSize: 13, padding: '5px 11px' }} onClick={addPlan}>+ Different tiers for some branches</button>}
        </div>
      )}
      {plans.length > 1 && (
        <div role="tablist" aria-label="Tier plans" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {plans.map((p, i) => {
            const n = P.branchesOnPlan(plans, setup.branches, i).length
            const on = i === active
            return (
              <button key={p.id ?? `new-${i}`} role="tab" aria-selected={on} onClick={() => setActive(i)}
                style={{ ...btn, ...(on ? { background: C.primaryBg, border: `1px solid ${C.primary}`, color: C.primary } : {}) }}>
                {P.planLabel(p, i)} <span style={{ fontWeight: 500, color: on ? C.primary : C.muted }}>· {n} branch{n === 1 ? '' : 'es'}</span>
              </button>
            )
          })}
          <button style={{ ...btn, border: `1px dashed ${C.borderStrong}`, boxShadow: 'none', color: C.muted }} onClick={addPlan}>+ Another plan</button>
        </div>
      )}
      {plans.length > 1 && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ flex: '0 1 240px' }}><span style={label}>Plan name</span>
              <input style={{ ...inp, width: '100%' }} maxLength={40} value={plan.name} placeholder={active === 0 ? P.STANDARD_PLAN : 'e.g. Puchong'} onChange={e => setPlan({ name: e.target.value })} />
            </label>
            <span style={{ flex: 1 }} />
            {active > 0 && <button style={{ ...btn, fontSize: 13 }} onClick={removePlan}>Remove this plan</button>}
          </div>
          <div style={{ marginTop: 10 }}>
            <span style={label}>Used by</span>
            {active === 0 ? (
              <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.5 }}>
                {onStandard.length ? <b>{onStandard.map(b => b.name).join(', ')}</b> : <span style={{ color: C.muted }}>No branch right now</span>}
                <span style={{ color: C.muted }}>: every branch not picked for another plan.</span>
              </p>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {setup.branches.map(b => {
                  const on = plan.branchIds.includes(b.id)
                  const elsewhere = P.planIndexFor(plans, b.id)
                  return (
                    <button key={b.id} onClick={() => toggleBranch(b.id)} aria-pressed={on}
                      style={{ ...btn, fontSize: 13, padding: '5px 11px', borderRadius: 16,
                        ...(on ? { background: C.primary, border: `1px solid ${C.primary}`, color: '#fff' } : {}) }}>
                      {on ? '✓ ' : ''}{b.name}
                      {!on && <span style={{ fontWeight: 500, color: C.muted }}>· {P.planLabel(plans[elsewhere], elsewhere)}</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick fill and how totals are set */}
      {plan.tiers.length > 0 && (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10, fontSize: 13.5 }}>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: C.muted }}>Fill total payout:</span>
            <input style={{ ...inp, width: 72 }} type="number" min="0" max="100" step="0.01" placeholder={fill.mode === 'flat' ? '90' : '25'}
              aria-label="Fill value" value={fill.value} onChange={e => setFill({ ...fill, value: e.target.value })} />
            <select style={sel} value={fill.mode} aria-label="Fill how" onChange={e => setFill({ ...fill, mode: e.target.value })}>
              <option value="flat">% on every tier</option>
              <option value="above">points above each agent rate</option>
            </select>
            <button style={btn} disabled={!isNum(fill.value)} onClick={applyFill}>Fill</button>
          </span>
          {enabled.length > 1 && (
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={perType} onChange={e => togglePerType(e.target.checked)} style={{ accentColor: C.primary }} />
              Different total for each deal type
            </label>
          )}
        </div>
      )}

      <TierEditor key={`tiers-${active}`} tiers={plan.tiers} setTiers={setTiers} enabled={enabled} perType={perType} />

      {/* The chain is company-wide, so it sits apart from the plan tabs above. */}
      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 24, paddingTop: 2 }}>
        <Group title="Uplines and the split"
          note={<>The leaders above a negotiator, from most junior to most senior (e.g. TL → UM → BM){plans.length > 1 ? ', the same on every tier plan' : ''}. Each level gets its own share of the upline pool. When a negotiator has nobody at a level, or that person has left, that share stays with the company: the other uplines don't get more.</>}>
          <UplineFields d={u} setD={setU} />
        </Group>
        <SideShare value={side} onChange={setSide} />
      </div>

      <HierarchyPreview key={active} setup={setup} tiers={P.sortTiers(plan.tiers)} planName={plans.length > 1 ? P.planLabel(plan, active) : null}
        roles={chain.previewRoles} splits={u.splits} onAddLevel={chain.addLevel} onUseExample={chain.useExample} />

      {moneyChanged && (
        <div style={{ marginTop: 20, padding: 14, borderRadius: 10, border: `1.5px solid ${C.primary}`, background: C.card }}>
          <Group first title="When do these changes apply?"
            note={<>Each E-Form is paid on the rules in force on its date, so changing rates never changes what earlier deals pay. {since ? <>The current rules started on {P.dayLabel(since)}.</> : null}</>}>
            <Choice name="rulesFrom" value={choice} onChange={setWhen} min={210} options={[
              ...startOptions.map(({ value, label, desc }) => ({ value, label, desc: desc || 'Earlier E-Forms keep the current rules.' })),
              { value: 'date', label: 'From another date', desc: 'For example the date the new scheme was announced.' },
              { value: 'fix', label: since ? `Correct the rules from ${P.dayLabel(since)}` : 'Correct the current rules',
                desc: since ? `Every E-Form dated from ${P.dayLabel(since)} is paid on the corrected rules.` : 'Every E-Form, including earlier ones, is paid on the corrected rules. For fixing a mistake.' },
            ]} />
            {choice === 'date' && (
              <label style={{ display: 'block', marginTop: 12 }}><span style={label}>New rules start on</span>
                <input style={{ ...inp, width: 170 }} type="date" min={since ? isoDay(new Date(Date.parse(since) + 864e5)) : undefined}
                  value={pickedDay} onChange={e => setPickedDay(e.target.value)} />
              </label>
            )}
            {from && !P.validateRulesFrom(from, setup.ruleHistory).length && (
              <p style={{ fontSize: 13, margin: '10px 0 0', lineHeight: 1.45 }}>
                E-Forms dated up to <b>{P.dayLabel(dayBefore(from))}</b> keep the current rules; from <b>{P.dayLabel(from)}</b> they are paid on these. Review lists both.
              </p>
            )}
          </Group>
        </div>
      )}
    </Section>
  )
}

// First visit: a ready ladder in one click, or an empty one.
function Starter({ onUse }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 4px' }}>Start with the usual ladder</h3>
      <p style={{ fontSize: 13, color: C.muted, margin: '0 0 12px', lineHeight: 1.45 }}>
        The ranks and rates of the current ERP, with 90% of the commission paid out on every deal. Change the RM amounts and rates to yours afterwards.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 14 }}>
        {STARTER.map(t => (
          <div key={t.name} style={{ padding: '8px 10px', borderRadius: 8, background: C.bg }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{t.name} · {t.title}</div>
            <div style={{ fontSize: 12, color: C.muted }}>{t.agentRate}% · {t.basis === 'yearly' ? 'this year' : 'from'} RM {t.threshold.toLocaleString('en-MY')}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={btnPrimary} onClick={() => onUse(STARTER.map(t => ({ ...t, totals: { ...t.totals } })))}>Use this ladder</button>
        <button style={btn} onClick={() => onUse([blankTier(0)])}>Start from an empty table</button>
      </div>
    </div>
  )
}

// Two agents on one deal: the closing agent's share; the listing holder gets the rest.
const SIDE_PRESETS = [[50, 'the current ERP'], [60], [70]]
function SideShare({ value, onChange }) {
  const v = isNum(value) && !P.validateSideShare(value).length ? Number(value) : null
  const parts = v == null ? [] : [['Closing agent', v, AGENT_COLOR], ['Listing holder', r2(100 - v), '#5d6b85']]
  return (
    <Group title="Two agents on one deal"
      note="When one agent closes the deal and another holds the listing, the commission is split between them first. Each side is then paid on that agent's own tier and uplines. If either agent is retracted (taken off the E-Form, or has left), their portion goes back to the company: the other agent's portion stays the same. An agent who does both gets both portions; a deal with no listing, like a project, pays the closing agent in full.">
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', maxWidth: 620 }}>
        <label style={{ whiteSpace: 'nowrap' }}><span style={label}>Closing agent</span>
          <input style={{ ...inp, width: 76 }} type="number" min="0" max="100" step="0.01" value={value ?? ''} aria-label="Closing agent's share"
            onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} /> %
        </label>
        <span style={{ fontSize: 13.5, paddingBottom: 9 }}>Listing holder <b>{v == null ? '–' : r2(100 - v)}%</b></span>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 4 }}>
          {SIDE_PRESETS.map(([n, note]) => (
            <button key={n} style={{ ...btn, fontSize: 13, padding: '5px 11px', ...(v === n ? { background: C.primaryBg, border: `1px solid ${C.primary}`, color: C.primary } : {}) }}
              onClick={() => onChange(n)} title={note ? `As ${note}` : undefined}>{n} / {100 - n}</button>
          ))}
        </span>
      </div>
      {parts.length > 0 && (
        <div style={{ maxWidth: 620, marginTop: 12 }}>
          <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden' }} role="img" aria-label={parts.map(([n, p]) => `${n} ${p}%`).join(', ')}>
            {parts.map(([n, p, color]) => <div key={n} style={{ width: `${p}%`, background: color }} />)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', fontSize: 12.5, color: C.muted, marginTop: 6 }}>
            {parts.map(([n, p]) => <span key={n}>{n}: RM {(100 * p).toLocaleString('en-MY')} of RM 10,000</span>)}
          </div>
        </div>
      )}
    </Group>
  )
}

// Once the rules have changed after go-live: when these started, and what applied before.
function RulesHistory({ setup }) {
  const [open, setOpen] = useState(false)
  const history = setup.ruleHistory || []
  if (!history.length) return null
  const since = P.rulesSince(setup)
  const upcoming = since > todayIso()
  return (
    <div style={{ padding: '10px 12px', borderRadius: 8, background: C.bg, marginBottom: 14, fontSize: 13.5, lineHeight: 1.5 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: '1 1 260px' }}>
          {upcoming
            ? <>These rules start on <b>{P.dayLabel(since)}</b>. E-Forms dated before then are paid on the earlier rules.</>
            : <>These rules apply to E-Forms dated from <b>{P.dayLabel(since)}</b>. Earlier E-Forms are paid on the rules in force on their date.</>}
        </span>
        <button style={{ ...btn, fontSize: 13, padding: '5px 11px' }} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide' : 'See'} earlier rules ({history.length})
        </button>
      </div>
      {open && (
        <ol style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'grid', gap: 6 }}>
          {[...history].reverse().map((h, k) => {
            const i = history.length - 1 - k
            const rates = h.plans.flatMap(p => p.tiers.map(t => Number(t.agentRate)))
            return (
              <li key={h.until} style={{ padding: '8px 10px', borderRadius: 6, background: '#fff', border: `1px solid ${C.border}` }}>
                <b>{i === 0 ? `Before ${P.dayLabel(h.until)}` : `${P.dayLabel(history[i - 1].until)} to ${P.dayLabel(dayBefore(h.until))}`}</b>
                <span style={{ display: 'block', fontSize: 12.5, color: C.muted }}>
                  {rates.length} tier{rates.length === 1 ? '' : 's'}{h.plans.length > 1 ? ` on ${h.plans.length} plans` : ''} · agent {Math.min(...rates)}–{Math.max(...rates)}%
                  {' · '}{h.roles.length ? h.roles.map(r => `${r.code} ${P.normalizeSplits(h.splits, h.roles)[r.code]}%`).join(' / ') : 'no uplines'}
                  {' · '}closing agent {h.sideSharePct ?? P.SIDE_SHARE}%
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

import { useState } from 'react'
import * as P from '../../shared/payout.js'
import * as ST from '../../shared/standard.js'
import { saveMyBranchCommission } from '../api.js'
import { C, inp, label } from '../styles.js'
import Section from '../setup/Section.jsx'
import TierEditor from '../setup/TierEditor.jsx'
import { Group, Choice } from '../setup/ui.jsx'
import { Example } from '../setup/PayoutSection.jsx'

// A branch's commission schema on My branch: the company's (the default) or its own, within the
// company's payout standard, as Setup sets it: under the existing standard, the branch's own rates,
// paid-out share, band ends and creator's part; under the CMS, its own tier plan. A change to what
// is paid starts on an E-Form date (today at the earliest); earlier E-Forms keep their rates.

const small = { ...inp, padding: '6px 8px', fontSize: 13.5 }
const cell = { padding: '4px 6px', verticalAlign: 'middle' }
const muted = { color: C.muted, fontSize: 12.5 }
const num = v => (v === '' ? '' : Number(v))
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayIso = () => isoDay(new Date())
const nextMonthIso = () => { const d = new Date(); return isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 1)) }
const dayBefore = iso => new Date(Date.parse(iso) - 864e5).toISOString().slice(0, 10)

// "From which E-Form date?": today at the earliest, after the rules in force started; while those
// haven't started yet, correcting them is offered too.
function useStart(since, asked) {
  const today = todayIso(), month = nextMonthIso()
  const options = [
    { value: 'today', day: today, label: `E-Forms dated from today (${P.dayLabel(today)})` },
    { value: 'month', day: month, label: `E-Forms dated from ${P.dayLabel(month)}`, desc: 'A clean start with the new month.' },
  ].filter(o => !since || o.day > since)
  const fixable = !!since && since >= today
  const [choice, setChoice] = useState('month')
  const [picked, setPicked] = useState(month)
  const allowed = [...options.map(o => o.value), 'date', ...(fixable ? ['fix'] : [])]
  const pick = allowed.includes(choice) ? choice : options[0]?.value || 'date'
  const from = !asked ? null : pick === 'fix' ? since : options.find(o => o.value === pick)?.day || picked
  const errors = !from ? [] : from < today ? ['The new rates can start today at the earliest.']
    : from === since ? [] : P.validateRulesFrom(from, since ? [{ until: since }] : [])
  const ui = asked && (
    <Group title="When do the new rates apply?" note={<>Earlier E-Forms keep the rates in force on their date.{since ? <> The rates in force started on {P.dayLabel(since)}.</> : null}</>}>
      <Choice name="branchRatesFrom" value={pick} onChange={setChoice} min={210} options={[
        ...options.map(({ value, label: l, desc }) => ({ value, label: l, desc: desc || 'Earlier E-Forms keep the current rates.' })),
        { value: 'date', label: 'From another date', desc: 'Today or later, e.g. the date you announce it.' },
        ...(fixable ? [{ value: 'fix', label: `Correct the rates from ${P.dayLabel(since)}`, desc: 'That change has not started yet: fix it instead of adding another.' }] : []),
      ]} />
      {pick === 'date' && (
        <label style={{ display: 'block', marginTop: 12 }}><span style={label}>The new rates start on</span>
          <input style={{ ...inp, width: 170 }} type="date" min={today} value={picked} onChange={e => setPicked(e.target.value)} />
        </label>
      )}
      {from && !errors.length && pick !== 'fix' && (
        <p style={{ fontSize: 13, margin: '10px 0 0', lineHeight: 1.45 }}>
          E-Forms dated up to <b>{P.dayLabel(dayBefore(from))}</b> keep the current rates; from <b>{P.dayLabel(from)}</b> they are paid on these.
        </p>
      )}
    </Group>
  )
  return { from, errors, ui }
}

export default function BranchCommission({ setup, branch, onSaved }) {
  const existing = ST.standardOf(setup).kind === 'existing'
  if (!existing && !setup.plans?.length) {
    return (
      <Section id="tiers" title="Commission" done={false}
        hint="The company has not set up its tiers yet. Once it has, your branch pays on them, or on a plan of your own set here." />
    )
  }
  return existing ? <OwnRules setup={setup} branch={branch} onSaved={onSaved} /> : <OwnPlan setup={setup} branch={branch} onSaved={onSaved} />
}

function OwnOrCompany({ own, setOwn, company, ownLabel }) {
  return (
    <Choice name="branchCommission" value={own ? 'own' : 'company'} onChange={v => setOwn(v === 'own')} min={240} options={[
      { value: 'company', label: company, desc: 'The company sets it; your branch pays on it as every other branch does.' },
      { value: 'own', label: ownLabel, desc: 'Your branch pays on its own numbers, set here. The positions and uplines stay the company\'s.' },
    ]} />
  )
}

// ── Existing standard: the branch's own numbers ───────────────────────────────
function OwnRules({ setup, branch, onSaved }) {
  const companySt = ST.standardFor(setup, null)
  const savedOwn = !!ST.branchRulesOf(setup.standard, branch.id)
  const savedSt = ST.standardFor(setup, branch.id)
  const [own, setOwn] = useState(savedOwn)
  const [st, setSt] = useState(savedSt)
  const paidOn = own ? st : companySt
  const asked = ST.moneyKeyOf(paidOn) !== ST.moneyKeyOf(savedSt)
  const when = useStart(setup.rulesSince, asked)
  const dirty = own !== savedOwn || (own && ST.moneyKeyOf(st) !== ST.moneyKeyOf(savedSt))
  const errors = [...(own ? ST.validateStandard(st) : []), ...when.errors]
  const reset = () => { setOwn(savedOwn); setSt(savedSt) }
  const editRow = (key, i, patch) => setSt({ ...st, [key]: st[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const companyOf = (key, i, field) => companySt[key][i]?.[field]
  const name = code => companySt.positions.find(p => p.code === code)?.name || code

  async function save() {
    const rules = { cap: st.cap, positions: st.positions.map(p => ({ code: p.code, rate: p.rate })), bands: st.bands.map(b => ({ code: b.code, upTo: b.upTo })),
      creator: { pct: st.creator.pct, holderKeeps: st.creator.holderKeeps, steps: st.creator.steps.map(s => ({ from: s.from, upTo: s.upTo })) } }
    onSaved(await saveMyBranchCommission({ own, ...(own ? { rules } : {}), from: when.from }))
  }

  return (
    <Section id="tiers" title="Commission" done dirty={dirty} onReset={reset} errors={errors} onSave={save}
      hint={<>The company pays on <b>{ST.STANDARDS.existing}</b>: each side of a case pays out up to a share, the agent gets their position's rate, and the bands above it go up the chain. {branch.name} can pay on the company's numbers or on its own.</>}>
      <OwnOrCompany own={own} setOwn={setOwn} company="The company's rates (default)" ownLabel={`${branch.name}'s own rates`} />
      {own && (
        <>
          <Group title="Paid out per side">
            <label style={{ display: 'inline-block', width: 170 }}><span style={label}>Paid out (%) <span style={muted}>company {companySt.cap}</span></span>
              <input style={small} type="number" value={st.cap} onChange={e => setSt({ ...st, cap: num(e.target.value) })} /></label>
          </Group>
          <Group title="Rate by position" note="The positions are the company's; only the rates are your branch's.">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 13.5 }}>
                <thead><tr style={{ color: C.muted, textAlign: 'left' }}><th style={cell}>Position</th><th style={cell}>Company %</th><th style={cell}>Your rate %</th></tr></thead>
                <tbody>{st.positions.map((p, i) => (
                  <tr key={p.code}>
                    <td style={cell}><b>{p.code}</b> · {p.name}</td>
                    <td style={{ ...cell, color: C.muted }}>{companyOf('positions', i, 'rate')}</td>
                    <td style={cell}><input aria-label={`${p.name} rate`} style={{ ...small, width: 80 }} type="number" value={p.rate} onChange={e => editRow('positions', i, { rate: num(e.target.value) })} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Group>
          <Group title="Bands up the chain" note="Where each band ends. Who it is paid to stays the company's.">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 13.5 }}>
                <thead><tr style={{ color: C.muted, textAlign: 'left' }}><th style={cell}>Band</th><th style={cell}>Paid to</th><th style={cell}>Company up to %</th><th style={cell}>Your up to %</th></tr></thead>
                <tbody>{st.bands.map((b, i) => (
                  <tr key={b.code}>
                    <td style={cell}><b>{b.code}</b></td>
                    <td style={cell}>{name(b.from)} and up</td>
                    <td style={{ ...cell, color: C.muted }}>{companyOf('bands', i, 'upTo')}</td>
                    <td style={cell}><input aria-label={`${b.code} band ends at`} style={{ ...small, width: 80 }} type="number" value={b.upTo} onChange={e => editRow('bands', i, { upTo: num(e.target.value) })} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Group>
          <Group title="Listing created by someone else">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ width: 190 }}><span style={label}>Holder keeps (%) <span style={muted}>company {companySt.creator.holderKeeps}</span></span>
                <input style={small} type="number" value={st.creator.holderKeeps} onChange={e => setSt({ ...st, creator: { ...st.creator, holderKeeps: num(e.target.value) } })} /></label>
              <label style={{ width: 190 }}><span style={label}>Creator's part (%) <span style={muted}>company {companySt.creator.pct}</span></span>
                <input style={small} type="number" value={st.creator.pct} onChange={e => setSt({ ...st, creator: { ...st.creator, pct: num(e.target.value) } })} /></label>
            </div>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13.5, lineHeight: 1.8 }}>
              {st.creator.steps.map((s, i) => (
                <li key={s.from}>{name(s.from)} and up gets up to{' '}
                  <input aria-label={`${name(s.from)} creator part`} style={{ ...small, width: 64, display: 'inline-block' }} type="number" value={s.upTo}
                    onChange={e => setSt({ ...st, creator: { ...st.creator, steps: st.creator.steps.map((x, j) => (j === i ? { ...x, upTo: num(e.target.value) } : x)) } })} />%
                  <span style={muted}> (company {companySt.creator.steps[i]?.upTo})</span>
                </li>
              ))}
            </ul>
          </Group>
          <Example st={st} />
        </>
      )}
      {when.ui}
    </Section>
  )
}

// ── CMS: the branch's own tier plan ──────────────────────────────────────────
function OwnPlan({ setup, branch, onSaved }) {
  const idx = P.planIndexFor(setup.plans, branch.id)
  const onPlan = setup.plans[idx]
  const savedOwn = idx > 0 && !setup.planShared
  const enabled = P.DEAL_TYPES.filter(dt => setup.dealTypes?.[dt]?.enabled)
  const start = () => (savedOwn ? onPlan.tiers : onPlan.tiers.map(t => ({ ...t, id: null })))
  const [own, setOwn] = useState(savedOwn)
  const [name, setName] = useState(savedOwn ? onPlan.name : `${branch.name} plan`)
  const [tiers, setTiers] = useState(start)
  const key = list => JSON.stringify(P.sortTiers(list).map(t => [t.basis, Number(t.threshold), Number(t.agentRate), P.DEAL_TYPES.map(dt => String(t.totals?.[dt] ?? ''))]))
  // What the branch would pay on: its own tiers; back from its own plan, the Standard plan; else the plan it is on now.
  const paidOn = own ? tiers : savedOwn ? setup.plans[0].tiers : onPlan.tiers
  const asked = key(paidOn) !== key(onPlan.tiers)
  const when = useStart(setup.rulesSince, asked)
  const dirty = own !== savedOwn || (own && (key(tiers) !== key(onPlan.tiers) || name !== (savedOwn ? onPlan.name : name)))
  const sorted = P.sortTiers(tiers)
  const errors = [...(own ? P.validatePlans([setup.plans[0], { name, branchIds: [branch.id], tiers: sorted }], setup.dealTypes, setup.branches) : []), ...when.errors]
  const perType = enabled.length > 1 && tiers.some(t => new Set(enabled.map(dt => String(t.totals?.[dt] ?? ''))).size > 1)
  const reset = () => { setOwn(savedOwn); setName(savedOwn ? onPlan.name : `${branch.name} plan`); setTiers(start()) }
  const companyName = idx > 0 && setup.planShared ? `The company's plan: ${P.planLabel(onPlan, idx)}` : `The company's plan: ${P.planLabel(setup.plans[0], 0)} (default)`

  return (
    <Section id="tiers" title="Commission" done dirty={dirty} onReset={reset} errors={errors}
      onSave={async () => onSaved(await saveMyBranchCommission({ own, ...(own ? { name, tiers: sorted } : {}), from: when.from }))}
      hint={<>The company pays on <b>tiers and uplines</b>: each tier's <b>agent rate</b>, and the <b>total payout</b> when the agent has uplines. {branch.name} can pay on the company's plan or on a plan of its own. The upline levels and how they share stay the company's.</>}>
      <OwnOrCompany own={own} setOwn={setOwn} company={companyName} ownLabel={`${branch.name}'s own plan`} />
      {own && (
        <>
          <Group title="Plan name">
            <input aria-label="Plan name" style={{ ...inp, width: 260 }} value={name} onChange={e => setName(e.target.value)} />
          </Group>
          <Group title="Tiers" note={savedOwn ? 'Click a tier to change it.' : `Starts as a copy of ${P.planLabel(onPlan, idx)}. Click a tier to change it.`}>
            <TierEditor tiers={tiers} setTiers={setTiers} enabled={enabled} perType={perType} />
          </Group>
        </>
      )}
      {when.ui}
    </Section>
  )
}

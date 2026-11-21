import { useState } from 'react'
import * as P from '../../shared/payout.js'
import * as ST from '../../shared/standard.js'
import { C, inp, sel, btn, label } from '../styles.js'
import Section from './Section.jsx'
import { useDraft } from './useDraft.js'
import TiersSection from './TiersSection.jsx'
import { Group, Choice } from './ui.jsx'

// Setup's payout step: which rules pay agents. The existing standard (the current ERP's,
// shared/standard.js) or the CMS's tiers and uplines (TiersSection). Each applies to
// E-Forms from a date once Setup is live, so moving between them never changes what
// earlier deals pay.

const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayIso = () => isoDay(new Date())
const nextMonthIso = () => { const d = new Date(); return isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 1)) }
const dayBefore = iso => new Date(Date.parse(iso) - 864e5).toISOString().slice(0, 10)
const small = { ...inp, padding: '6px 8px', fontSize: 13.5 }
const cell = { padding: '4px 6px', verticalAlign: 'middle' }

export default function PayoutSection({ setup, save, step, done }) {
  const current = setup.standard?.kind || 'cms'
  const [kind, setKind] = useState(current)
  const switching = kind !== current
  // Moving to the other standard after go-live starts on a date (asked here); within the
  // existing standard ExistingSection asks; within the CMS TiersSection does.
  const when = useWhen(setup, done && switching)
  const withSwitch = steps => {
    if (!switching) return save(steps)
    const own = steps.filter(([s]) => s !== 'rules-from' && s !== 'standard')
    const standardStep = steps.find(([s]) => s === 'standard') || ['standard', { kind: 'cms' }]
    return save([...(when.from ? [['rules-from', { from: when.from }]] : []), standardStep, ...own])
  }

  return (
    <>
      <div style={{ padding: 14, borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, marginBottom: 14 }}>
        <Group first title="Which rules pay agents?"
          note="Each E-Form is paid on the rules in force on its date. Start on the current ERP's rules, and move to the tiers and uplines when the company is ready.">
          <Choice name="standard" value={kind} onChange={setKind} min={240} recommended={current === 'cms' && !setup.plans?.length ? 'existing' : undefined} options={[
            { value: 'existing', label: ST.STANDARDS.existing, desc: 'By position, paid up the chain in bands to 90%, a listing creator\'s part, the rest to the Branch Manager. As agents are paid today.' },
            { value: 'cms', label: ST.STANDARDS.cms, desc: 'Tiers climbed on commission, a total payout per tier, and upline levels sharing the pool.' },
          ]} />
        </Group>
        {when.ui}
      </div>
      {kind === 'existing'
        ? <ExistingSection setup={setup} save={withSwitch} step={step} done={done} switching={switching} />
        : <TiersSection setup={setup} save={withSwitch} step={step} done={done && !switching} />}
    </>
  )
}

// "From which E-Form date?" for a change that moves money after go-live.
function useWhen(setup, asked) {
  const [choice, setChoice] = useState('month')
  const [picked, setPicked] = useState(nextMonthIso)
  const since = P.rulesSince(setup)
  const options = [
    { value: 'today', day: todayIso(), label: `E-Forms dated from today (${P.dayLabel(todayIso())})` },
    { value: 'month', day: nextMonthIso(), label: `E-Forms dated from ${P.dayLabel(nextMonthIso())}`, desc: 'A clean start with the new month.' },
  ].filter(o => !since || o.day > since)
  const pick = options.some(o => o.value === choice) || choice === 'date' || choice === 'fix' ? choice : options[0]?.value || 'date'
  const from = !asked || pick === 'fix' ? null : options.find(o => o.value === pick)?.day || picked
  const errors = from ? P.validateRulesFrom(from, setup.ruleHistory) : []
  const ui = asked && (
    <div style={{ marginTop: 16 }}>
      <Group first title="When do these rules apply?"
        note={<>Earlier E-Forms keep the rules in force on their date. {since ? <>The current rules started on {P.dayLabel(since)}.</> : null}</>}>
        <Choice name="standardFrom" value={pick} onChange={setChoice} min={210} options={[
          ...options.map(({ value, label, desc }) => ({ value, label, desc: desc || 'Earlier E-Forms keep the current rules.' })),
          { value: 'date', label: 'From another date', desc: 'For example the date the change was announced.' },
          { value: 'fix', label: since ? `Correct the rules from ${P.dayLabel(since)}` : 'Correct the current rules', desc: 'For fixing a mistake: every E-Form in that period is paid on these.' },
        ]} />
        {pick === 'date' && (
          <label style={{ display: 'block', marginTop: 12 }}><span style={label}>The rules start on</span>
            <input style={{ ...inp, width: 170 }} type="date" value={picked} onChange={e => setPicked(e.target.value)} />
          </label>
        )}
        {from && !errors.length && (
          <p style={{ fontSize: 13, margin: '10px 0 0', lineHeight: 1.45 }}>
            E-Forms dated up to <b>{P.dayLabel(dayBefore(from))}</b> keep the current rules; from <b>{P.dayLabel(from)}</b> they are paid on these.
          </p>
        )}
      </Group>
    </div>
  )
  return { from, errors, ui }
}

// The existing standard's values: positions and rates, the bands up the chain, the listing
// creator's part, and each branch's Branch Manager account (who BM profit is paid to).
function ExistingSection({ setup, save, step, done, switching }) {
  const saved = setup.standard?.kind === 'existing' ? setup.standard
    : { ...ST.existingDefault(), kind: 'existing', branchManagers: setup.standard?.branchManagers || {} }
  const [st, setSt, dirty, reset] = useDraft(saved)
  const moneyChanged = done && !switching && dirty
  const when = useWhen(setup, moneyChanged)
  const errors = [...ST.validateStandard(st), ...when.errors]
  const set = patch => setSt({ ...st, ...patch })
  const ladder = st.positions.filter(p => p.rank !== '' && p.rank != null)
  const posOptions = [...ladder].sort((a, b) => a.rank - b.rank).map(p => ({ value: p.code, label: `${p.code} · ${p.name}` }))
  const editRow = (key, i, patch) => set({ [key]: st[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const dropRow = (key, i) => set({ [key]: st[key].filter((_, j) => j !== i) })
  const num = v => (v === '' ? '' : Number(v))
  const body = { kind: 'existing', cap: st.cap, positions: st.positions, bands: st.bands, creator: st.creator, branchManagers: st.branchManagers }
  const steps = [...(when.from ? [['rules-from', { from: when.from }]] : []), ['standard', body]]
  const agents = setup.agents || []

  return (
    <Section id="tiers" step={step} title="Payout standard: the current ERP's rules" done={done && !switching} dirty={dirty || switching} onReset={reset}
      hint={<>Each side of a case (the closing agent's and the listing holder's) pays out up to <b>{st.cap}%</b>. The agent gets their <b>position's rate</b>; above it, each <b>band</b> goes to the nearest upline whose position holds it; a band nobody holds goes to the <b>Branch Manager</b>. These are the current ERP's values: change them only if the company's rules change.</>}
      errors={errors} onSave={() => save(steps)}>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 }}>
        <label style={{ width: 170 }}><span style={label}>Paid out per side (%)</span>
          <input style={small} type="number" value={st.cap} onChange={e => set({ cap: num(e.target.value) })} /></label>
        <button style={{ ...btn, fontSize: 13, padding: '6px 11px' }} onClick={() => setSt({ ...ST.existingDefault(), kind: 'existing', branchManagers: st.branchManagers })}>
          Use the current ERP's values</button>
      </div>

      <Group title="Positions and rates" note="Ladder place orders the positions for the bands (1 = most junior). Leave it blank for a position that never takes a band.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead><tr style={{ color: C.muted, textAlign: 'left' }}><th style={cell}>Code</th><th style={cell}>Position</th><th style={cell}>Rate %</th><th style={cell}>Ladder</th><th /></tr></thead>
            <tbody>
              {st.positions.map((p, i) => (
                <tr key={i}>
                  <td style={cell}><input aria-label="Code" style={{ ...small, width: 70 }} value={p.code} onChange={e => editRow('positions', i, { code: e.target.value.toUpperCase() })} /></td>
                  <td style={cell}><input aria-label="Position" style={{ ...small, width: 180 }} value={p.name} onChange={e => editRow('positions', i, { name: e.target.value })} /></td>
                  <td style={cell}><input aria-label="Rate" style={{ ...small, width: 70 }} type="number" value={p.rate} onChange={e => editRow('positions', i, { rate: num(e.target.value) })} /></td>
                  <td style={cell}><input aria-label="Ladder place" style={{ ...small, width: 60 }} type="number" value={p.rank ?? ''} onChange={e => editRow('positions', i, { rank: num(e.target.value) })} /></td>
                  <td style={cell}><button style={{ ...btn, fontSize: 12, padding: '4px 8px' }} onClick={() => dropRow('positions', i)} aria-label={`Remove ${p.name || 'position'}`}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button style={{ ...btn, fontSize: 13, padding: '5px 11px', marginTop: 6 }} onClick={() => set({ positions: [...st.positions, { code: '', name: '', rate: '', rank: '' }] })}>+ Position</button>
      </Group>

      <Group title="Bands up the chain" note="From the agent's rate up to each band's end, paid to the nearest upline at that position or above. The earner keeps a band when their own position is at the second one or above.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead><tr style={{ color: C.muted, textAlign: 'left' }}><th style={cell}>Line</th><th style={cell}>Up to %</th><th style={cell}>Paid to</th><th style={cell}>Earner keeps it from</th></tr></thead>
            <tbody>
              {st.bands.map((b, i) => (
                <tr key={i}>
                  <td style={cell}><input aria-label="Line code" style={{ ...small, width: 70 }} value={b.code} onChange={e => editRow('bands', i, { code: e.target.value.toUpperCase() })} /></td>
                  <td style={cell}><input aria-label="Up to" style={{ ...small, width: 70 }} type="number" value={b.upTo} onChange={e => editRow('bands', i, { upTo: num(e.target.value) })} /></td>
                  <td style={cell}><select aria-label="Paid to" style={{ ...sel, fontSize: 13.5 }} value={b.from} onChange={e => editRow('bands', i, { from: e.target.value })}>
                    <option value="">Pick…</option>{posOptions.map(o => <option key={o.value} value={o.value}>{o.label} and up</option>)}</select></td>
                  <td style={cell}><select aria-label="Earner keeps it from" style={{ ...sel, fontSize: 13.5 }} value={b.selfFrom || ''} onChange={e => editRow('bands', i, { selfFrom: e.target.value })}>
                    <option value="">Never</option>{posOptions.map(o => <option key={o.value} value={o.value}>{o.label} and up</option>)}</select></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Group>

      <Group title="Listing created by someone else" note="On the listing holder's side: the holder keeps up to their part, the creator gets theirs by position, and the rest of it goes up the creator's chain.">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ width: 170 }}><span style={label}>Holder keeps (%)</span>
            <input style={small} type="number" value={st.creator.holderKeeps} onChange={e => set({ creator: { ...st.creator, holderKeeps: num(e.target.value) } })} /></label>
          <label style={{ width: 170 }}><span style={label}>Creator's part (%)</span>
            <input style={small} type="number" value={st.creator.pct} onChange={e => set({ creator: { ...st.creator, pct: num(e.target.value) } })} /></label>
        </div>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>
          {st.creator.steps.map((s, i) => (
            <li key={i}>
              <select aria-label="Creator position" style={{ ...sel, fontSize: 13.5 }} value={s.from}
                onChange={e => set({ creator: { ...st.creator, steps: st.creator.steps.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) } })}>
                {posOptions.map(o => <option key={o.value} value={o.value}>{o.label} and up</option>)}</select>
              {' '}gets up to{' '}
              <input aria-label="Creator gets up to" style={{ ...small, width: 64, display: 'inline-block' }} type="number" value={s.upTo}
                onChange={e => set({ creator: { ...st.creator, steps: st.creator.steps.map((x, j) => (j === i ? { ...x, upTo: num(e.target.value) } : x)) } })} />%
            </li>
          ))}
        </ul>
      </Group>

      <Group title="Branch Manager accounts" note="BM profit is paid to this account: the closing agent's own branch on their side, the case's branch on the listing side. A branch with none: the company keeps it.">
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))' }}>
          {setup.branches.map(b => {
            const mine = agents.filter(a => a.branchId === b.id)
            return (
              <label key={b.id}><span style={label}>{b.name}</span>
                <select style={{ ...sel, width: '100%', fontSize: 13.5 }} value={st.branchManagers?.[b.id] ?? ''}
                  onChange={e => set({ branchManagers: { ...st.branchManagers, [b.id]: e.target.value === '' ? '' : Number(e.target.value) } })}>
                  <option value="">None (the company keeps it)</option>
                  {(mine.length ? mine : agents).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            )
          })}
        </div>
      </Group>

      {(() => {
        // Branches paying on their own numbers (their partners set them on My branch); the rest pay on these.
        const own = setup.branches.filter(b => ST.branchRulesOf(st, b.id))
        return own.length > 0 && (
          <Group title="Branches on their own rates" note="Set by each branch's partner on My branch, within this standard. Every other branch pays on the values above.">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>
              {own.map(b => <li key={b.id}><b>{b.name}</b>: {ST.describeOwnRules(ST.standardFor({ standard: st }, b.id))}</li>)}
            </ul>
          </Group>
        )
      })()}

      <Example st={st} />
      {when.ui}
    </Section>
  )
}

// One worked example per position: what a side of RM 10,000 pays with a full chain above.
export function Example({ st }) {
  if (ST.validateStandard(st).length) return null
  const ladder = [...st.positions].filter(p => p.rank !== '' && p.rank != null).sort((a, b) => a.rank - b.rank)
  const rows = ladder.slice(0, 4).map(p => {
    // A chain of one person at every position above.
    const above = ladder.filter(q => q.rank > p.rank)
    const staffById = { 1: { id: 1, role: p.code, uplineId: above.length ? 2 : null, status: 'active' } }
    above.forEach((q, i) => { staffById[i + 2] = { id: i + 2, role: q.code, uplineId: i + 1 < above.length ? i + 3 : null, status: 'active' } })
    const out = ST.existingSide({ standard: st, amount: 10000, earnerId: 1, staffById, bmId: 99 })
    return { p, parts: out.lines.map(l => `${l.role || p.code} ${l.pct}%`).join(' · '), company: out.companyPct }
  })
  return (
    <Group title="How a side pays" note="With one person at every position above the agent.">
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>
        {rows.map(r => <li key={r.p.code}><b>{r.p.name}</b>: {r.parts} · company {r.company}%</li>)}
      </ul>
    </Group>
  )
}

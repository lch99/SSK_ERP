import { useState } from 'react'
import { C, btn, btnPrimary, inp } from '../../styles.js'
import * as P from '../../../shared/payout.js'
import * as J from '../../../shared/projects.js'
import { saveProject, saveIncentive } from '../../demo/projectsApi.js'
import { useErp } from '../ErpContext.jsx'
import { Page, Card, Drawer, FormField, field, cols, go, small } from '../ui.jsx'
import { Choice } from '../../setup/ui.jsx'
import { ErrorList } from '../../setup/Section.jsx'
import { rm0, date } from '../format.js'
import { useReview, changedRows, missing, needText, markGaps } from '../review.jsx'

const pctBox = (value, onChange, props = {}) => (
  <span style={{ whiteSpace: 'nowrap' }}><input style={{ ...inp, width: 90 }} type="number" step="0.01" min="0" value={value ?? ''} onChange={e => onChange(e.target.value)} {...props} /> %</span>
)

// ── Add / edit a project ─────────────────────────────────────────────────────

export function ProjectForm({ project, onSaved }) {
  const { setup } = useErp()
  const review = useReview()
  const [p, setP] = useState(() => project ? structuredClone(project) : {
    id: null, name: '', developer: '', location: '', category: '', units: '', priceFrom: '',
    devCommissionPct: setup.dealTypes?.project?.defaultRate ?? '', payout: { mode: 'setup' },
  })
  const [errors, setErrors] = useState([])
  const set = (k, v) => setP({ ...p, [k]: v })
  const setPayout = patch => setP({ ...p, payout: { ...p.payout, ...patch } })
  const normal = t => P.resolveTotal(setup.totals, { branchId: P.COMPANY_SCOPE, dealType: 'project', tierId: t.id })?.pct

  // Before saving: the project, and what each tier is paid on it under its rule.
  async function save() {
    const gaps = missing([['Project name', p.name], ['Developer', p.developer], ["Developer's commission", p.devCommissionPct]])
    if (gaps.length) { setErrors([needText(gaps)]); if (!markGaps(gaps)) window.scrollTo(0, 0); return }
    setErrors([])
    const mode = q => J.PAYOUT_MODES.find(x => x.value === (q.payout?.mode || 'setup'))?.label
    const flat = q => ({ name: q.name, developer: q.developer, location: q.location, category: q.category, units: q.units, devCommissionPct: q.devCommissionPct,
      mode: mode(q), boost: q.payout?.mode === 'boost' ? q.payout.boostPct : '' })
    const pays = setup.tiers.map(t => {
      const r = J.projectPayout(p, t, normal(t))
      return [P.tierLabel(t), `agent ${r.agentRate}%${r.totalPct != null ? ` · total payout ${r.totalPct}%` : ''}${r.totalPct !== normal(t) || r.agentRate !== Number(t.agentRate) ? ' (changed from Setup)' : ''}`]
    })
    const ok = await review({
      title: project ? `Review changes · ${project.name}` : 'Preview the project', confirmLabel: project ? 'Save changes' : 'Add project',
      intro: 'The pay rule applies to every unit booked under this project.',
      changes: project ? changedRows(flat(project), flat(p), [['name', 'Project name'], ['developer', 'Developer'], ['location', 'Location'], ['category', 'Property type'],
        ['units', 'Total units'], ['devCommissionPct', "Developer's commission", v => `${v}%`], ['mode', 'How it pays agents'], ['boost', 'Extra for the negotiator', v => `${v}%`]]) : undefined,
      sections: [
        { title: 'Project', rows: [['Project name', p.name], ['Developer', p.developer], ['Location', p.location], ['Property type', p.category], ['Total units', p.units],
          ["Developer's commission", `${p.devCommissionPct}% of the selling price`]] },
        { title: `Pays agents: ${mode(p)}`, rows: pays },
      ],
    })
    if (!ok) return
    try { onSaved(saveProject(p, setup.tiers)) } catch (e) { setErrors(e.errors || [e.message]); window.scrollTo(0, 0) }
  }

  return (
    <Page title={project ? `Edit ${project.name}` : 'Add a project'} sub="A developer's launch you sell for. Its payout rule applies to every unit booked under it."
      back={{ to: project ? `projects/${project.id}` : 'projects', label: project ? project.name : 'All projects' }}>
      <ErrorList errors={errors} />
      <div style={{ display: 'grid', gap: 16, marginTop: errors.length ? 12 : 0 }}>
        <Card title="Project">
          <div style={cols(240, 12)}>
            <FormField label="Project name" required><input style={field} value={p.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Vista Kinara" /></FormField>
            <FormField label="Developer" required><input style={field} value={p.developer} onChange={e => set('developer', e.target.value)} placeholder="e.g. Bayu Development Sdn Bhd" /></FormField>
            <FormField label="Location"><input style={field} value={p.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Puchong" /></FormField>
            <FormField label="Property type"><input style={field} value={p.category || ''} onChange={e => set('category', e.target.value)} placeholder="e.g. Condominium" /></FormField>
            <FormField label="Total units"><input style={field} type="number" min="1" value={p.units ?? ''} onChange={e => set('units', e.target.value)} /></FormField>
            <FormField label="Developer's commission" required help="What the developer pays the agency, as % of the selling price.">
              {pctBox(p.devCommissionPct, v => set('devCommissionPct', v))}
            </FormField>
          </div>
        </Card>

        <Card title="How this project pays agents" sub="Usually the same as Setup. Change it when the developer pays more, or this launch needs a push.">
          <Choice name="payoutMode" value={p.payout?.mode || 'setup'} onChange={v => setPayout({ mode: v })} options={J.PAYOUT_MODES} recommended="setup" min={220} />
          {p.payout?.mode === 'boost' && (
            <div style={{ marginTop: 14 }}>
              <FormField label="Extra for the negotiator, on every tier" help="Added to the agent's tier rate and to the total payout, so uplines keep the same pool.">
                {pctBox(p.payout.boostPct, v => setPayout({ boostPct: v }), { 'aria-label': 'Extra for the negotiator' })}
              </FormField>
            </div>
          )}
          {p.payout?.mode === 'custom' && (
            <div style={{ ...cols(170, 10), marginTop: 14 }}>
              {setup.tiers.map(t => (
                <FormField key={t.id} label={`${P.tierLabel(t)} · agent ${t.agentRate}%`} help={normal(t) != null ? `Setup: ${normal(t)}%` : 'Not set in Setup'}>
                  {pctBox(p.payout.customTotals?.[t.id], v => setPayout({ customTotals: { ...p.payout.customTotals, [t.id]: v } }), { placeholder: normal(t) ?? '', 'aria-label': `${t.name} total payout` })}
                </FormField>
              ))}
            </div>
          )}
        </Card>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button style={btn} onClick={() => go(project ? `projects/${project.id}` : 'projects')}>Cancel</button>
          <button style={btnPrimary} onClick={save}>{project ? 'Review changes' : 'Preview & add'}</button>
        </div>
      </div>
    </Page>
  )
}

// ── Add / edit a developer incentive ─────────────────────────────────────────

const blank = today => ({
  id: null, name: '', from: `${today.slice(0, 8)}01`, to: '', kind: 'target', counts: 'company',
  steps: [{ units: '', amount: '' }], perUnit: '', paidTo: 'agents', agentPct: 80,
})

export function IncentiveDrawer({ open, incentive, project, onClose, onSaved }) {
  const { m } = useErp()
  const [d, setD] = useState(null)
  const [errors, setErrors] = useState([])
  const key = open ? incentive?.id ?? 'new' : null
  const [forKey, setForKey] = useState(null)
  if (key !== forKey) {       // a different incentive opened: start from it
    setForKey(key)
    setD(open ? (incentive?.id != null ? structuredClone(incentive) : blank(m.today)) : null)
    setErrors([])
  }
  if (!open || !d) return null
  const set = (k, v) => setD({ ...d, [k]: v })
  const setStep = (i, k, v) => set('steps', d.steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)))

  function save() {
    try { saveIncentive(project.id, d); onSaved() } catch (e) { setErrors(e.errors || [e.message]) }
  }

  return (
    <Drawer open onClose={onClose} width={620} title={incentive?.id != null ? `Edit ${incentive.name}` : 'Add a developer incentive'} sub={project.name}
      footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
        <button style={btn} onClick={onClose}>Cancel</button>
        <button style={btnPrimary} onClick={save}>{incentive?.id != null ? 'Save' : 'Add incentive'}</button>
      </div>}>
      <ErrorList errors={errors} />
      <div style={{ display: 'grid', gap: 18, marginTop: 8 }}>
        <div style={cols(180, 12)}>
          <FormField label="Name" required wide><input style={field} value={d.name} onChange={e => set('name', e.target.value)} placeholder="e.g. October push" /></FormField>
          <FormField label="From" required><input style={field} type="date" value={d.from} onChange={e => set('from', e.target.value)} /></FormField>
          <FormField label="To" required><input style={field} type="date" value={d.to} onChange={e => set('to', e.target.value)} /></FormField>
        </div>

        <Section title="What the developer offers">
          <Choice name="kind" value={d.kind} onChange={v => set('kind', v)} options={J.INCENTIVE_KINDS} min={220} />
          {d.kind === 'target' ? (
            <div style={{ marginTop: 12 }}>
              {d.steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, fontSize: 14 }}>
                  <span>Sell</span>
                  <input style={{ ...inp, width: 80 }} type="number" min="1" value={s.units} onChange={e => setStep(i, 'units', e.target.value)} aria-label={`Target ${i + 1} units`} />
                  <span>units →</span>
                  <span style={{ whiteSpace: 'nowrap' }}>RM <input style={{ ...inp, width: 110 }} type="number" min="0" step="100" value={s.amount} onChange={e => setStep(i, 'amount', e.target.value)} aria-label={`Target ${i + 1} reward`} /></span>
                  {d.steps.length > 1 && <button style={small} onClick={() => set('steps', d.steps.filter((_, j) => j !== i))} aria-label={`Remove target ${i + 1}`}>✕</button>}
                </div>
              ))}
              <button style={small} onClick={() => set('steps', [...d.steps, { units: '', amount: '' }])}>+ Add a higher target</button>
              <p style={{ fontSize: 12, color: C.muted, margin: '8px 0 0' }}>Only the highest target reached is paid, e.g. 10 units → RM 3,000, 15 units → RM 6,000.</p>
            </div>
          ) : (
            <div style={{ marginTop: 12, fontSize: 14 }}>
              RM <input style={{ ...inp, width: 110 }} type="number" min="0" step="50" value={d.perUnit} onChange={e => set('perUnit', e.target.value)} aria-label="Amount per unit" /> for every unit booked in the period
            </div>
          )}
        </Section>

        <Section title="Whose units count?">
          <Choice name="counts" value={d.counts} onChange={v => set('counts', v)} options={J.COUNTS} min={170} />
        </Section>

        <Section title="Who receives it?">
          <Choice name="paidTo" value={d.paidTo} onChange={v => set('paidTo', v)} options={J.PAID_TO} min={170} />
          {d.paidTo === 'split' && (
            <div style={{ marginTop: 12, fontSize: 14 }}>
              Agents get {pctBox(d.agentPct, v => set('agentPct', v), { 'aria-label': "Agents' share" })} · company keeps {Math.max(0, 100 - (Number(d.agentPct) || 0))}%
            </div>
          )}
        </Section>

        <Preview d={d} />
      </div>
    </Drawer>
  )
}

function Section({ title, children }) {
  return <div><div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{title}</div>{children}</div>
}

// The incentive in one sentence, as you fill it in.
function Preview({ d }) {
  const who = { company: 'the whole company sells', branch: 'a branch sells', agent: 'an agent sells' }[d.counts]
  const to = d.paidTo === 'company' ? 'the company keeps it' : d.paidTo === 'split' ? `agents get ${d.agentPct || 0}% (shared by units), the company keeps the rest` : 'the selling agents share it by units sold'
  const steps = (d.steps || []).filter(s => Number(s.units) > 0 && Number(s.amount) > 0).sort((a, b) => a.units - b.units)
  const what = d.kind === 'perUnit'
    ? (Number(d.perUnit) > 0 ? `For every unit ${who.replace(' sells', '')} sells, the developer pays ${rm0(d.perUnit)}` : null)
    : steps.length ? `When ${who} ${steps.map(s => `${s.units} unit${Number(s.units) === 1 ? '' : 's'}, the developer pays ${rm0(s.amount)}`).join('; or ')}` : null
  if (!what) return null
  return (
    <p style={{ margin: 0, padding: '10px 12px', borderRadius: 8, background: C.bg, fontSize: 13, lineHeight: 1.5 }}>
      <b>In short:</b> {what}{d.from && d.to ? ` between ${date(d.from)} and ${date(d.to)}` : ''}, and {to}.
    </p>
  )
}


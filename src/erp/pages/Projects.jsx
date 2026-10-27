import { useEffect, useMemo, useState } from 'react'
import { C, btn, btnPrimary } from '../../styles.js'
import * as P from '../../../shared/payout.js'
import * as J from '../../../shared/projects.js'
import { getProjects, deleteIncentive } from '../../demo/projectsApi.js'
import { useErp } from '../ErpContext.jsx'
import { DEAL_STATUS, sum } from '../model.js'
import { Page, Card, Stat, Pill, Progress, DataTable, Status, Link, Empty, Notice, cols, go, mono, small, tabular } from '../ui.jsx'
import { CARD, PAGE } from '../help.js'
import { rm, rm0, date, num, pct } from '../format.js'
import { ProjectForm, IncentiveDrawer } from './ProjectForms.jsx'
import { useFeedback } from '../feedback.jsx'
import Icon from '../Icon.jsx'
import { NoAccess, useAccess, useCan } from '../access.jsx'

// Projects: developers' new launches. Each project can pay differently from
// Setup, and carries the developer's incentive campaigns.
//   #/projects · #/projects/incentives · #/projects/new · #/projects/<id> · #/projects/<id>/edit

const STATUS_PILL = { active: ['green', 'Running'], upcoming: ['blue', 'Starts soon'], ended: ['gray', 'Ended'] }
// Running first, then upcoming, then ended; newest first within each.
const ORDER = { active: 0, upcoming: 1, ended: 2 }
const byStatus = today => (a, b) => ORDER[J.incentiveStatus(a, today)] - ORDER[J.incentiveStatus(b, today)] || b.from.localeCompare(a.from)

export function useProjects() {
  const { m, setup } = useErp()
  const [state, setState] = useState(() => getProjects(m?.data, setup))
  useEffect(() => { setState(getProjects(m?.data, setup)) }, [m, setup])
  return { projects: state.projects, reload: () => setState(getProjects(m?.data, setup)) }
}

export default function Projects({ parts }) {
  const { projects, reload } = useProjects()
  const can = useCan()
  if (parts[1] === 'incentives') return <AllIncentives projects={projects} />
  if (parts[1] === 'new') return <ProjectForm onSaved={p => { reload(); go(`projects/${p.id}`) }} />
  const project = parts[1] ? projects.find(p => p.id === Number(parts[1])) : null
  if (parts[1] && !project) return <Page title="Project not found" back={{ to: 'projects', label: 'All projects' }}><Empty title="This project doesn't exist" /></Page>
  if (project && parts[2] === 'edit' && !can('projects', 'edit')) return <NoAccess />
  if (project && parts[2] === 'edit') return <ProjectForm project={project} onSaved={() => { reload(); go(`projects/${project.id}`) }} />
  if (project) return <ProjectPage project={project} reload={reload} />
  return <ProjectList projects={projects} />
}

// ── All projects ─────────────────────────────────────────────────────────────

function ProjectList({ projects }) {
  const { m } = useErp()
  const can = useCan()
  const deals = m.data.deals
  const today = m.today
  const month = today.slice(0, 7)
  const sold = p => J.projectDeals(deals, p)
  const running = projects.flatMap(p => p.incentives.map(i => ({ p, i }))).filter(x => J.incentiveStatus(x.i, today) === 'active')
  const earned = projects.reduce((t, p) => t + p.incentives.reduce((s, i) => s + J.incentiveProgress(i, p, deals, today).total, 0), 0)

  return (
    <Page title="Projects" help={PAGE.projects} sub="Developers' new launches. Each project can pay agents differently from Setup, and carry the developer's incentives."
      actions={can('projects', 'edit') && <button style={btnPrimary} onClick={() => go('projects/new')}>Add a project</button>}>
      <div style={{ ...cols(210, 14), marginBottom: 16 }}>
        <Stat icon="listings" tone="blue" label="Projects selling" value={num(projects.filter(p => p.status !== 'closed').length)} />
        <Stat icon="deals" tone="green" label="Units sold this month" value={num(projects.reduce((t, p) => t + sold(p).filter(d => d.date.startsWith(month)).length, 0))} />
        <Stat icon="medal" tone="amber" label="Incentives running" value={num(running.length)} sub="Developer campaigns now" onClick={() => go('projects/incentives')} />
        <Stat icon="crown" tone="violet" label="Incentives earned" value={rm0(earned)} sub="All campaigns so far" onClick={() => go('projects/incentives')} />
      </div>
      {!projects.length && <Card><Empty title="No projects yet" text="Add a developer's project to start tracking its sales and incentives." /></Card>}
      <div style={cols(320, 14)}>
        {projects.map(p => {
          const s = sold(p)
          const live = p.incentives.filter(i => J.incentiveStatus(i, today) === 'active')
          return (
            <Card key={p.id} pad={16}>
              <button onClick={() => go(`projects/${p.id}`)} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{p.name}</div>
                <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{p.developer}{p.location ? ` · ${p.location}` : ''}</div>
                <div style={{ marginTop: 8 }}><Pill tone={p.payout?.mode === 'setup' ? 'gray' : 'brand'}>{J.describePayout(p)}</Pill></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, margin: '14px 0 6px', ...tabular }}>
                  <span><b>{num(s.length)}</b> sold{p.units ? <span style={{ color: C.muted }}> of {num(p.units)} units</span> : ''}</span>
                  <span style={{ color: C.muted }}>Developer pays {pct(p.devCommissionPct)}</span>
                </div>
                <Progress value={p.units ? s.length / p.units : 0} label={`${p.name} units sold`} />
                <div style={{ marginTop: 12, fontSize: 13, minHeight: 20 }}>
                  {live.length
                    ? live.map(i => <div key={i.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Pill tone="green">Incentive</Pill><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</span></div>)
                    : <span style={{ color: C.muted }}>No incentive running</span>}
                </div>
              </button>
            </Card>
          )
        })}
      </div>
    </Page>
  )
}

// ── One project ──────────────────────────────────────────────────────────────

function ProjectPage({ project: p, reload }) {
  const fb = useFeedback()
  const { m, scoped, setup } = useErp()
  const [editing, setEditing] = useState(null)   // incentive being edited, {} for new
  const access = useAccess()
  const edit = access.can('projects', 'edit')
  // Totals and incentives count the whole company; the sales list shows only the viewer's reach.
  const deals = m.data.deals
  const sold = J.projectDeals(deals, p)
  const today = m.today
  const reach = access.scope === 'all' ? deals : scoped.deals
  const sales = useMemo(() => reach.filter(d => d.type === 'project' && d.property?.title === p.name), [reach, p.name])

  const columns = [
    { key: 'date', label: 'Booked', nowrap: true, sort: d => d.date, render: d => date(d.date) },
    { key: 'code', label: 'E-Form', sort: d => d.code, render: d => <Link to={`deals/${d.id}`} style={mono}>{d.code}</Link> },
    { key: 'unit', label: 'Unit', sort: d => d.property.address, render: d => d.property.address.split(', ')[0] },
    { key: 'agent', label: 'Agent', sort: d => m.staffName(d.agentId), render: d => <span>{m.staffName(d.agentId)}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{m.branchName(d.branchId)}</span></span> },
    { key: 'price', label: 'Price', align: 'right', sort: d => d.price, render: d => rm0(d.price) },
    { key: 'fee', label: 'Developer commission', align: 'right', sort: d => d.fee, render: d => rm(d.fee) },
    { key: 'status', label: 'Status', sort: d => d.status, render: d => <Status of={DEAL_STATUS} value={d.status} /> },
  ]

  return (
    <Page title={p.name} help={PAGE.project} sub={<>{p.developer}{p.location ? ` · ${p.location}` : ''}{p.launchedOn ? ` · launched ${date(p.launchedOn)}` : ''}</>}
      back={{ to: 'projects', label: 'All projects' }}
      actions={edit && <>
        <button style={btn} onClick={() => go(`projects/${p.id}/edit`)}>Edit project</button>
        <button style={btnPrimary} onClick={() => setEditing({})}>+ Add incentive</button>
      </>}>
      <div style={{ ...cols(200, 14), marginBottom: 16 }}>
        <Stat icon="deals" tone="green" label="Units sold" value={`${num(sold.length)}${p.units ? ` / ${num(p.units)}` : ''}`}
          sub={p.units ? `${Math.round(sold.length / p.units * 100)}% of the project` : undefined} />
        <Stat icon="reports" tone="blue" label="Sales value" value={rm0(sum(sold, d => d.price))} />
        <Stat icon="moneyIn" tone="violet" label="Developer commission" value={rm0(sum(sold, d => d.fee))} sub={`At ${pct(p.devCommissionPct)} of the price`} />
        <Stat icon="medal" tone="amber" label="Incentives earned" value={rm0(p.incentives.reduce((t, i) => t + J.incentiveProgress(i, p, deals, today).total, 0))} />
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        <Card title="Developer incentives" help={CARD.incentivesCard} sub="Extra money the developer pays for hitting sales targets. Progress updates as E-Forms are submitted."
          actions={edit && <button style={small} onClick={() => setEditing({})}><Icon name="plus" size={14} /> Add incentive</button>}>
          {!p.incentives.length && <Empty title="No incentives yet" text="Add one when the developer offers a bonus, e.g. sell 10 units this month for RM 3,000." />}
          <div style={{ display: 'grid', gap: 12 }}>
            {[...p.incentives].sort(byStatus(today)).map(i => (
              <IncentiveCard key={i.id} inc={i} project={p} onEdit={edit ? () => setEditing(i) : null}
                onDelete={edit && (async () => {
                  if (!(await fb.confirm({ title: `Delete “${i.name}”?`, body: 'The incentive and its progress are removed from this project. Deals are not changed.', confirmLabel: 'Delete incentive', danger: true }))) return
                  deleteIncentive(p.id, i.id); reload(); fb.toast(`“${i.name}” deleted`)
                })} />
            ))}
          </div>
        </Card>

        <PayoutCard project={p} setup={setup} edit={edit} />

        <Card title="Sales" help={CARD.projectSales} sub="Every E-Form booked for this project." pad={16}>
          <DataTable columns={columns} rows={sales} onRow={d => go(`deals/${d.id}`)} defaultSort={{ key: 'date', dir: 'desc' }} pageSize={10} narrowAt={860}
            empty="No units booked yet" />
        </Card>
      </div>

      <IncentiveDrawer open={!!editing} incentive={editing} project={p} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />
    </Page>
  )
}

// How this project pays, tier by tier, next to the normal Setup numbers.
function PayoutCard({ project: p, setup, edit }) {
  const rows = setup.tiers.map(t => {
    const normal = P.resolveTotal(setup.totals, { branchId: P.COMPANY_SCOPE, dealType: 'project', tierId: t.id })?.pct ?? null
    return { t, normal, mine: J.projectPayout(p, t, normal) }
  })
  return (
    <Card title="How this project pays agents" help={CARD.projectPay} sub={<>{J.PAYOUT_MODES.find(x => x.value === (p.payout?.mode || 'setup'))?.desc} Standard plan tiers shown; branches on another tier plan follow the same rule.</>}
      actions={edit && <button style={small} onClick={() => go(`projects/${p.id}/edit`)}>Change</button>}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <Pill tone={p.payout?.mode === 'setup' ? 'gray' : 'brand'}>{J.describePayout(p)}</Pill>
      </div>
      <div style={cols(150, 10)}>
        {rows.map(({ t, normal, mine }) => {
          const changed = mine.agentRate !== t.agentRate || mine.totalPct !== normal
          return (
            <div key={t.id} style={{ border: `1px solid ${changed ? C.primary : C.border}`, borderRadius: 8, padding: '10px 12px', ...tabular }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{P.tierLabel(t)}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Agent {mine.agentRate !== t.agentRate && <span style={{ color: C.muted }}>{pct(t.agentRate)} → </span>}<b>{pct(mine.agentRate)}</b></div>
              <div style={{ fontSize: 13 }}>Total {normal != null && mine.totalPct !== normal && <span style={{ color: C.muted }}>{pct(normal)} → </span>}<b>{mine.totalPct == null ? '—' : pct(mine.totalPct)}</b></div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export function IncentiveCard({ inc, project, onEdit, onDelete, showProject }) {
  const { m } = useErp()
  const [open, setOpen] = useState(false)
  const r = J.incentiveProgress(inc, project, m.data.deals, m.today)
  const [tone, label] = STATUS_PILL[r.status]
  const name = g => (inc.counts === 'branch' ? m.branchName(g.key) : inc.counts === 'agent' ? m.staffName(g.key) : 'Whole company')
  const steps = [...(inc.steps || [])].sort((a, b) => a.units - b.units)
  const top = steps[steps.length - 1]
  const shown = inc.counts === 'company' ? r.groups : r.groups.slice(0, open ? undefined : 4)

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <b style={{ fontSize: 15 }}>{inc.name}</b><Pill tone={tone}>{label}</Pill>
          </div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3, lineHeight: 1.45 }}>
            {showProject && <><Link to={`projects/${project.id}`}>{project.name}</Link> · </>}
            {date(inc.from)} – {date(inc.to)} · {J.describeIncentive(inc)} · paid to {J.PAID_TO.find(x => x.value === inc.paidTo)?.label.toLowerCase()}
            {inc.paidTo === 'split' ? ` (agents ${inc.agentPct}%)` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right', ...tabular }}>
          <div style={{ fontSize: 12, color: C.muted }}>Earned</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: r.total ? C.ok : C.text }}>{rm0(r.total)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {!r.groups.length && <div style={{ fontSize: 13, color: C.muted }}>No units sold in this period yet.</div>}
        {shown.map(g => (
          <div key={g.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, marginBottom: 5, ...tabular }}>
              <span>{inc.counts !== 'company' && <b>{name(g)} · </b>}{num(g.units)} unit{g.units === 1 ? '' : 's'} sold</span>
              <span style={{ color: C.muted, textAlign: 'right' }}>
                {inc.kind === 'perUnit' ? `${rm0(g.amount)} so far`
                  : g.next ? <>{num(g.next.units - g.units)} more for <b style={{ color: C.text }}>{rm0(g.next.amount)}</b></> : <b style={{ color: C.ok }}>Top target reached</b>}
              </span>
            </div>
            {inc.kind === 'target' && top && <StepBar units={g.units} steps={steps} />}
          </div>
        ))}
        {inc.counts !== 'company' && r.groups.length > 4 && (
          <button style={{ ...small, justifySelf: 'start' }} onClick={() => setOpen(!open)}>{open ? 'Show fewer' : `Show all ${r.groups.length}`}</button>
        )}
      </div>

      {r.total > 0 && (
        <details style={{ marginTop: 10, fontSize: 13 }}>
          <summary style={{ cursor: 'pointer', color: C.primary, fontWeight: 600 }}>Who gets what</summary>
          <div style={{ marginTop: 8, display: 'grid', gap: 4, ...tabular }}>
            {r.groups.filter(g => g.amount > 0).flatMap(g => g.shares.filter(s => s.amount > 0)).sort((a, b) => b.amount - a.amount).map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{m.staffName(s.agentId)} <span style={{ color: C.muted }}>· {s.units} unit{s.units === 1 ? '' : 's'}</span></span><b>{rm(s.amount)}</b>
              </div>
            ))}
            {r.groups.some(g => g.toCompany > 0) && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>
                <span>Company keeps</span><b>{rm(r.groups.reduce((t, g) => t + g.toCompany, 0))}</b>
              </div>
            )}
          </div>
        </details>
      )}

      {(onEdit || onDelete) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {onEdit && <button style={small} onClick={onEdit}>Edit</button>}
          {onDelete && <button style={{ ...small, color: C.err }} onClick={onDelete}>Delete</button>}
        </div>
      )}
    </div>
  )
}

// Progress toward the targets, with a mark and reward at each one.
function StepBar({ units, steps }) {
  const max = steps[steps.length - 1].units
  return (
    <div style={{ position: 'relative', paddingBottom: 18 }}>
      <Progress value={units / max} tone={units >= steps[0].units ? 'green' : 'brand'} height={8} label="Units toward the target" />
      {steps.map(s => (
        <div key={s.units} style={{ position: 'absolute', left: `${(s.units / max) * 100}%`, top: 0, transform: 'translateX(-100%)', textAlign: 'right' }}>
          <div style={{ width: 2, height: 8, background: '#fff', marginLeft: 'auto' }} />
          <div style={{ fontSize: 12, color: units >= s.units ? C.ok : C.muted, whiteSpace: 'nowrap', marginTop: 2 }}>{s.units} → {rm0(s.amount)}</div>
        </div>
      ))}
    </div>
  )
}

// ── Every incentive, across projects ─────────────────────────────────────────

function AllIncentives({ projects }) {
  const { m } = useErp()
  const [filter, setFilter] = useState('active')
  const all = projects.flatMap(p => p.incentives.map(i => ({ p, i, status: J.incentiveStatus(i, m.today) })))
    .sort((a, b) => byStatus(m.today)(a.i, b.i))
  const rows = filter === 'all' ? all : all.filter(x => x.status === filter)
  const total = all.reduce((t, x) => t + J.incentiveProgress(x.i, x.p, m.data.deals, m.today).total, 0)
  return (
    <Page title="Developer incentives" help={PAGE.incentives} sub="Every developer campaign across your projects, and how close each one is."
      back={{ to: 'projects', label: 'All projects' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {[['active', 'Running'], ['upcoming', 'Starts soon'], ['ended', 'Ended'], ['all', 'All']].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
            style={{ ...small, ...(filter === k ? { background: C.primaryBg, borderColor: C.primary, color: C.primary, fontWeight: 600 } : {}) }}>
            {label} ({k === 'all' ? all.length : all.filter(x => x.status === k).length})
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: C.muted }}>Earned across all campaigns: <b style={{ color: C.text }}>{rm0(total)}</b></span>
      </div>
      {!rows.length && <Card><Empty title="Nothing here" text="Add incentives from a project's page." /></Card>}
      <div style={{ display: 'grid', gap: 12 }}>
        {rows.map(({ p, i }) => <Card key={i.id} pad={0} style={{ border: 'none', boxShadow: 'none', background: 'transparent' }}><IncentiveCard inc={i} project={p} showProject /></Card>)}
      </div>
      {filter === 'active' && !rows.length && all.length > 0 && <Notice tone="blue">No campaign is running today. See "Starts soon" or "Ended".</Notice>}
    </Page>
  )
}

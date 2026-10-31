import * as P from '../../../shared/payout.js'
import { teamOf } from '../../../shared/access.js'
import { C } from '../../styles.js'
import { useNarrow } from '../../setup/useNarrow.js'
import { useErp } from '../ErpContext.jsx'
import { useAccess } from '../access.jsx'
import { DEAL_STATUS, sum } from '../model.js'
import { visibleModules } from '../modules.js'
import { Card, Stat, Status, Progress, Link, cols, go, mono, tabular } from '../ui.jsx'
import { CARD, MENU, MODULE } from '../help.js'
import { Hero, Leaderboard, rise } from './dashboardWidgets.jsx'
import { rm, date, monthName, lastMonths, daysFrom, num } from '../format.js'
import Icon from '../Icon.jsx'

// ── The agent's own dashboard (Home, when an agent signs in): their sales,
// their commission (ready, stacked, being checked), what waits on them, their
// team, and every page their role opens. Only their own records count, plus
// their downline's for the team card.
export default function AgentDashboard({ id }) {
  const { m } = useErp()
  const access = useAccess()
  const me = m.staff[id]
  const today = m.today
  const [prevYm, ym] = lastMonths(today, 2)
  const mine = m.dealsOf(id)
  const mineIds = new Set(mine.map(x => x.id))
  const own = mine.filter(x => x.agentId === id && x.status !== 'draft' && x.status !== 'cancelled')
  const billed = mo => sum(own.filter(x => x.date.startsWith(mo)), x => x.money.billed)
  const closedNow = m.data.closes.filter(c => mineIds.has(c.dealId) && c.date.startsWith(ym))
  const w = m.wallet(id)
  const t = m.tierInfo(id)
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const dayNo = Number(today.slice(8, 10))
  const daysIn = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate()
  const opens = path => access.opens(path)
  const [doRef, narrow] = useNarrow(560)

  // What only this agent can move on.
  const drafts = mine.filter(x => x.status === 'draft' && x.agentId === id)
  const open = mine.filter(x => x.status === 'submitted' || x.status === 'partial')
  const short = open.filter(x => x.agentId === id && m.received(x.id) < x.money.billed)
  const bounced = m.data.moneyIn.filter(x => mineIds.has(x.dealId) && (x.status === 'returned' || x.status === 'invalid') && daysFrom(x.date, today) <= 60)
  const queried = w.checking.filter(l => l.status === 'queried')
  const sentBack = m.data.requests.filter(r => r.staffId === id && r.status === 'invalid')
  const outdated = m.data.listings.filter(l => l.holderId === id && l.status === 'outdated')
  const views = m.data.viewings || []
  const toConfirm = views.filter(v => v.handlerId === id && (v.status === 'new' || v.status === 'rescheduled'))
  const toReview = views.filter(v => v.requestedBy === id && v.status === 'review')
  const soon = views.filter(v => (v.handlerId === id || v.requestedBy === id) && v.status === 'confirmed' && v.date === today)
  const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`
  const todo = [
    w.ready.length && { icon: 'wallet', tone: C.primary, to: 'my-pay', text: <><b>{rm(sum(w.ready, l => l.amount))}</b> ready to claim: get it paid or stack it</> },
    toConfirm.length && { icon: 'calendar', tone: C.warn, to: 'appointments', text: <><b>{plural(toConfirm.length, 'viewing')}</b> of your listings to confirm with the owner</> },
    toReview.length && { icon: 'calendar', tone: C.info, to: 'appointments', text: <><b>{plural(toReview.length, 'viewing')}</b> to review: how did it go?</> },
    soon.length && { icon: 'calendar', tone: C.ok, to: 'appointments', text: <><b>{plural(soon.length, 'viewing')}</b> today, the first at {soon.sort((a, b) => a.time.localeCompare(b.time))[0].time}</> },
    drafts.length && { icon: 'deals', tone: C.warn, to: drafts.length === 1 ? `deals/${drafts[0].id}` : 'deals?status=draft', text: <><b>{plural(drafts.length, 'draft E-Form')}</b> to finish and submit</> },
    queried.length && { icon: 'alert', tone: C.err, to: 'my-pay', text: <><b>{plural(queried.length, 'payout line')}</b> in Pending Queries: {queried[0].query}</> },
    sentBack.length && { icon: 'alert', tone: C.err, to: `salary/${sentBack[0].id}`, text: <><b>{sentBack[0].code}</b> sent back: {sentBack[0].remark}</> },
    bounced.length && { icon: 'alert', tone: C.err, to: 'money-in', text: <><b>{plural(bounced.length, 'payment')}</b> returned or rejected in the last 60 days</> },
    short.length && { icon: 'moneyIn', tone: C.info, to: short.length === 1 ? `deals/${short[0].id}` : 'deals', text: <><b>{plural(short.length, 'E-Form')}</b> still waiting for money: record each payment when it comes in</> },
    outdated.length && { icon: 'building', tone: C.warn, to: 'listing-roles/outdated', text: <><b>{plural(outdated.length, 'listing')}</b> marked outdated: update or close them</> },
  ].filter(Boolean)

  // The team: everyone under them in the upline chart.
  const team = teamOf(id, m.data.staff)
  const directs = m.data.staff.filter(s => s.uplineId === id).length
  const teamDeals = m.data.deals.filter(x => team.has(x.agentId) && x.date.startsWith(ym) && x.status !== 'draft' && x.status !== 'cancelled')
  const top = [...team].map(sid => ({ s: m.staff[sid], v: m.credit(sid).year })).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 5)

  // Every page the role opens, by module, as in the menu (less this one).
  const mods = visibleModules(i => !i.perm && !i.needsSignIn && opens(i.path) && i.path !== 'dashboard')

  const actions = [
    { path: 'deals/new', icon: 'deals', label: 'Submit an E-Form', primary: true },
    { path: 'money-in/new', icon: 'plus', label: 'Record a payment' },
    { path: 'listing-new', icon: 'building', label: 'Add a listing' },
    { path: 'customers/new', icon: 'customers', label: 'Add a customer' },
  ].filter(a => opens(a.path)).map(a => ({ ...a, onClick: () => go(a.path) }))

  return (
    <div className="ssk-page">
      <Hero greet={`${greet}, ${me.short} 👋`} place={`${m.branchName(me.branchId)} · ${P.tierLabel(t.tier)}`} dateText={date(today)}
        thisMonth={billed(ym)} lastMonth={billed(prevYm)} dayNo={dayNo} daysIn={daysIn} monthName={monthName(ym).split(' ')[0]}
        stats={[
          { icon: 'deals', value: num(own.filter(x => x.date.startsWith(ym)).length), label: 'E-Forms this month' },
          { icon: 'check', value: num(closedNow.length), label: closedNow.length === 1 ? 'close' : 'closes' },
          { icon: 'payRuns', value: rm(sum(w.ready, l => l.amount) + sum(w.stacked, l => l.amount)), label: 'to claim' },
        ]}
        actions={[...actions, { icon: 'search', label: 'Quick search  ⌘K', onClick: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true })) }]} />

      <div style={{ ...cols(220, 14), marginBottom: 16 }}>
        {[
          <Stat key="ready" icon="wallet" tone="brand" label="Ready to claim" value={rm(sum(w.ready, l => l.amount))} onClick={opens('my-pay') ? () => go('my-pay') : undefined}
            sub={w.ready.length ? 'Get it paid or stack it' : 'Nothing new'} />,
          <Stat key="stacked" icon="payRuns" tone="blue" label="Stacked" value={rm(sum(w.stacked, l => l.amount))} onClick={opens('my-pay') ? () => go('my-pay') : undefined}
            sub={w.stacked.length ? 'Kept for later. Claim it any time' : 'Nothing stacked'} />,
          <Stat key="earned" icon="check" tone="green" label={`Earned in ${m.year}`} value={rm(m.earned(id, { thisYear: true }))}
            sub={w.checking.length ? `${rm(sum(w.checking, l => l.amount))} more being checked` : 'Own deals and upline overrides'} />,
          <Stat key="tier" icon="reports" tone="amber" label="Tier" value={P.tierLabel(t.tier)} onClick={() => go(`staff/${id}`)}
            sub={t.next ? `${rm(t.toNext)} more to ${t.next.name} (${t.next.agentRate}%)` : 'At the top tier'} />,
        ].map((k, i) => <div key={i} {...rise(i + 1)} style={{ ...rise(i + 1).style, display: 'grid' }}>{k}</div>)}
      </div>

      <div style={{ ...cols(360, 16), marginBottom: 16 }}>
        <div {...rise(5)} style={{ ...rise(5).style, display: 'grid', minWidth: 0 }}>
          <Card title="Waiting for you" help={CARD.waitingForYou}>
            {todo.length ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {todo.map((a, i) => (
                  <a key={i} href={`#/${a.to}`} className="ssk-lift" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: '#fff',
                    border: `1px solid ${C.border}`, borderLeft: `3px solid ${a.tone}`, color: C.text, textDecoration: 'none', fontSize: 13.5 }}>
                    <span style={{ color: a.tone, display: 'inline-flex' }}><Icon name={a.icon} size={18} /></span>
                    <span style={{ flex: 1, minWidth: 0 }}>{a.text}</span>
                    <Icon name="chevron" size={16} style={{ color: C.muted }} />
                  </a>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '18px 0' }}>
                <span aria-hidden style={{ width: 48, height: 48, borderRadius: 24, background: C.okBg, color: C.ok, display: 'inline-grid', placeItems: 'center' }}><Icon name="check" size={24} stroke={2.4} /></span>
                <p style={{ color: C.ok, margin: '6px 0 0', fontWeight: 600 }}>All clear. Nothing is waiting for you.</p>
              </div>
            )}
          </Card>
        </div>
        <div {...rise(6)} style={{ ...rise(6).style, display: 'grid', minWidth: 0 }}>
          <Card title="My E-Forms in progress" help={CARD.myDeals} sub={open.length || drafts.length ? `${plural(open.length, 'open E-Form')}${drafts.length ? ` · ${plural(drafts.length, 'draft')}` : ''}` : null}
            actions={opens('deals') && <Link to="deals" style={{ fontSize: 13, fontWeight: 600 }}>See all</Link>}>
            {!open.length && !drafts.length && <p style={{ color: C.muted, margin: 0, fontSize: 13.5 }}>No open E-Forms. {opens('deals/new') && <Link to="deals/new">Submit one</Link>}</p>}
            <div style={{ display: 'grid', gap: 12 }}>
              {[...drafts, ...open].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map(x => {
                const got = Math.min(m.cleared(x.id), x.money.billed)
                return (
                  <a key={x.id} href={`#/deals/${x.id}`} style={{ textDecoration: 'none', color: C.text, display: 'grid', gap: 5 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, minWidth: 0 }}>
                      <b style={{ ...mono, fontSize: 12.5 }}>{x.code}</b>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.muted }}>{x.property.title}</span>
                      <Status of={DEAL_STATUS} value={x.status} />
                    </span>
                    {x.status !== 'draft' && <>
                      <Progress value={x.money.billed ? got / x.money.billed : 0} tone={got >= x.money.billed ? 'green' : 'blue'} height={5} label={`Collected on ${x.code}`} />
                      <span style={{ fontSize: 12, color: C.muted, ...tabular }}>{rm(got)} of {rm(x.money.billed)} cleared · {x.agentId === id ? (x.holderId === id || x.holderId == null ? 'both sides' : 'sales side') : 'your listing'}</span>
                    </>}
                  </a>
                )
              })}
            </div>
          </Card>
        </div>
      </div>

      {team.size > 1 && (
        <div {...rise(7)} style={{ marginBottom: 16, ...rise(7).style }}>
          <Card title="My team" sub={`${plural(team.size - 1, 'person', 'people')} under you · ${num(directs)} direct`}
            actions={opens('org-chart') && <Link to={`org-chart/${id}`} style={{ fontSize: 13, fontWeight: 600 }}>Open my org chart</Link>}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px', display: 'grid', gap: 10, alignContent: 'start' }}>
                {[[`Team E-Forms · ${monthName(ym).split(' ')[0]}`, num(teamDeals.length)], ['Team fees signed', rm(sum(teamDeals, x => x.fee))],
                  ['Team submission', rm(sum(teamDeals, x => x.money.billed))]].map(([k, v]) => (
                  <div key={k}><div style={{ fontSize: 12.5, color: C.muted }}>{k}</div><div style={{ fontSize: 20, fontWeight: 700, ...tabular }}>{v}</div></div>
                ))}
              </div>
              <div style={{ flex: '2 1 360px', minWidth: 0 }}><Leaderboard rows={top} m={m} showBranch={false} /></div>
            </div>
          </Card>
        </div>
      )}

      <div {...rise(8)} style={rise(8).style}>
        <Card title="Everything you can do" help={CARD.canDo} sub={`What your role (${access.role?.label}) opens, by module`}>
          {/* On a phone each module folds, so the list doesn't run on for screens. */}
          <div ref={doRef} style={{ display: 'grid', gap: narrow ? 0 : 18, gridTemplateColumns: 'repeat(auto-fill, minmax(min(230px, 100%), 1fr))', alignItems: 'start' }}>
            {mods.map(mod => {
              const head = (
                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 700, fontFamily: C.fontHead, color: C.text }}>
                  <span style={{ color: C.primary, display: 'inline-flex' }}><Icon name={mod.icon} size={17} /></span>{mod.label}
                  {narrow && <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 500, color: C.muted, fontFamily: C.font }}>{plural(mod.items.filter(i => i.path).length, 'page')}</span>}
                </span>
              )
              const pages = (
                <div style={{ display: 'grid' }}>
                  {mod.items.map((i, n) => i.section
                    ? <span key={`s${n}`} style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, margin: '8px 0 2px' }}>{i.section}</span>
                    : i.path && (
                      <a key={i.path} href={`#/${i.path}`} title={MENU[i.path]} className="ssk-menu-item"
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', margin: '0 -6px', borderRadius: 6, fontSize: 13.5, color: i.add ? C.primary : C.text, fontWeight: i.add ? 600 : 400, textDecoration: 'none' }}>
                        {i.add && <Icon name="plus" size={14} />}{i.label}
                      </a>
                    ))}
                </div>
              )
              return narrow ? (
                <details key={mod.key} style={{ borderTop: `1px solid ${C.border}`, padding: '10px 0' }}>
                  <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', color: C.muted }}>{head}</summary>
                  <p style={{ fontSize: 12, color: C.muted, margin: '6px 0 4px', lineHeight: 1.45 }}>{MODULE[mod.key]}</p>
                  {pages}
                </details>
              ) : (
                <section key={mod.key} style={{ minWidth: 0 }}>
                  <h3 style={{ margin: '0 0 2px' }}>{head}</h3>
                  <p style={{ fontSize: 12, color: C.muted, margin: '0 0 8px', lineHeight: 1.45 }}>{MODULE[mod.key]}</p>
                  {pages}
                </section>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}

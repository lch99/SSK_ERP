import * as P from '../../../shared/payout.js'
import { teamOf } from '../../../shared/access.js'
import { C } from '../../styles.js'
import { useNarrow } from '../../setup/useNarrow.js'
import { useErp } from '../ErpContext.jsx'
import { useAccess, useCan } from '../access.jsx'
import { DEAL_STATUS, tierStanding } from '../model.js'
import { visibleModules } from '../modules.js'
import { Card, Stat, Status, Progress, Link, cols, go, mono, tabular } from '../ui.jsx'
import { CARD, MENU, MODULE } from '../help.js'
import { Hero, Leaderboard, rise } from './dashboardWidgets.jsx'
import { rm, date, monthName, lastMonths, num } from '../format.js'
import { useList, useRecord } from '../useList.js'
import Icon from '../Icon.jsx'

// A short read of a list (the agent's own records): its first rows, total and counts.
const useRead = (key, params, size, skip) => useList(key, { counts: '0', ...params }, { branch: false, pageSize: size, skip })
// One month of a { 'YYYY-MM': { n, sum } } count.
const monthOf = (count, mo) => count?.[mo] || { n: 0, sum: 0 }
// Ready to claim: approved, not requested or archived (as My commission).
const OPEN = { status: 'approved', requested: 'false', archived: 'false' }

// ── The agent's own dashboard (Home, when an agent signs in): their sales,
// their commission (ready, stacked, being checked), what waits on them, their
// team, and every page their role opens. Only their own records count, plus
// their downline's for the team card; each is a short read or a count the
// server adds up, never every record.
export default function AgentDashboard({ id }) {
  const { m, setup } = useErp()
  const access = useAccess()
  const can = useCan()
  const me = m.staff[id]
  const today = m.today
  const [prevYm, ym] = lastMonths(today, 2)
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const dayNo = Number(today.slice(8, 10))
  const daysIn = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate()
  const opens = path => access.opens(path)
  const [doRef, narrow] = useNarrow(560)
  const hidden = area => !can(area, 'view')
  const noPay = hidden('payouts') && hidden('salary')

  // Their tier, from their commission so far (the server adds it up).
  const { record } = useRecord('staff', id)
  const t = tierStanding(record || me, record?.$?.credit?.lifetime || 0, record?.$?.credit?.yearly || 0, setup)

  // Their pay: ready, stacked, being checked, earned this year.
  const useLines = params => useRead('payouts', { staffId: id, counts: 'lines', ...params }, 1, noPay).counts.lines || { n: 0, sum: 0 }
  const ready = useLines({ ...OPEN, stacked: 'false' })
  const stacked = useLines({ ...OPEN, stacked: 'true' })
  const checking = useLines({ status: 'new,queried' })
  const earned = useRead('payouts', { staffId: id, counts: 'thisYear' }, 1, noPay).counts.thisYear?.sum || 0
  const queried = useRead('payouts', { staffId: id, status: 'queried', sort: '-date' }, 1, noPay)

  // Their E-Forms: billing this month and last, drafts, open ones (either side), those short of cash, closes this month.
  const own = useRead('deals', { agentId: id, counts: 'ownByMonth,short' }, 1, hidden('deals')).counts
  const billed = mo => monthOf(own.ownByMonth, mo).sum
  const short = own.short || { n: 0, first: null }
  const drafts = useRead('deals', { agentId: id, status: 'draft', sort: '-date' }, 6, hidden('deals'))
  const open = useRead('deals', { staffId: id, status: 'submitted,partial', sort: '-date' }, 6, hidden('deals'))
  const closedNow = useRead('closes', { staffId: id, counts: 'thisMonth' }, 1, hidden('payouts')).counts.thisMonth?.n || 0
  const bounced = useRead('moneyIn', { staffId: id, counts: 'bounced60' }, 1, hidden('moneyIn')).counts.bounced60?.n || 0

  // What else waits on them: a pay request sent back, outdated listings, viewings.
  const sentBack = useRead('requests', { staffId: id, status: 'invalid', sort: '-date' }, 1, hidden('salary'))
  const outdated = useRead('listings', { holderId: id, status: 'outdated' }, 1, hidden('listings')).total
  const toConfirm = useRead('viewings', { handlerId: id, status: 'new,rescheduled' }, 1, hidden('listings')).total
  const toReview = useRead('viewings', { requestedBy: id, status: 'review' }, 1, hidden('listings')).total
  const soon = useRead('viewings', { staffId: id, status: 'confirmed', from: today, to: today, sort: 'date,time' }, 1, hidden('listings'))
  const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`
  const todo = [
    ready.n && { icon: 'wallet', tone: C.primary, to: 'my-pay', text: <><b>{rm(ready.sum)}</b> ready to claim: get it paid or stack it</> },
    toConfirm && { icon: 'calendar', tone: C.warn, to: 'appointments', text: <><b>{plural(toConfirm, 'viewing')}</b> of your listings to confirm with the owner</> },
    toReview && { icon: 'calendar', tone: C.info, to: 'appointments', text: <><b>{plural(toReview, 'viewing')}</b> to review: how did it go?</> },
    soon.total && { icon: 'calendar', tone: C.ok, to: 'appointments', text: <><b>{plural(soon.total, 'viewing')}</b> today, the first at {soon.rows[0]?.time}</> },
    drafts.total && { icon: 'deals', tone: C.warn, to: drafts.total === 1 ? `deals/${drafts.rows[0]?.id}` : 'deals?status=draft', text: <><b>{plural(drafts.total, 'draft E-Form')}</b> to finish and submit</> },
    queried.total && { icon: 'alert', tone: C.err, to: 'my-pay', text: <><b>{plural(queried.total, 'payout line')}</b> in Pending Queries: {queried.rows[0]?.query}</> },
    sentBack.total && { icon: 'alert', tone: C.err, to: `salary/${sentBack.rows[0]?.id}`, text: <><b>{sentBack.rows[0]?.code}</b> sent back: {sentBack.rows[0]?.remark}</> },
    bounced && { icon: 'alert', tone: C.err, to: 'money-in', text: <><b>{plural(bounced, 'payment')}</b> returned or rejected in the last 60 days</> },
    short.n && { icon: 'moneyIn', tone: C.info, to: short.n === 1 ? `deals/${short.first}` : 'deals', text: <><b>{plural(short.n, 'E-Form')}</b> still waiting for money: record each payment when it comes in</> },
    outdated && { icon: 'building', tone: C.warn, to: 'listing-roles/outdated', text: <><b>{plural(outdated, 'listing')}</b> marked outdated: update or close them</> },
  ].filter(Boolean)

  // The team: everyone under them in the upline chart (the staff directory), this month's E-Forms they sold, their top earners.
  const team = teamOf(id, m.data.staff)
  const directs = m.data.staff.filter(s => s.uplineId === id).length
  const teamMonth = useRead('deals', { agentTeam: id, counts: 'teamFees,teamBilled' }, 1, team.size <= 1 || hidden('deals')).counts
  const earners = useRead('staff', { inTeam: id, sort: '-earned' }, 5, team.size <= 1 || hidden('staff')).rows
  const top = earners.map(s => ({ s, v: s.$?.credit?.yearly || 0 })).filter(x => x.v > 0)

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
          { icon: 'deals', value: num(monthOf(own.ownByMonth, ym).n), label: 'E-Forms this month' },
          { icon: 'check', value: num(closedNow), label: closedNow === 1 ? 'close' : 'closes' },
          { icon: 'payRuns', value: rm(ready.sum + stacked.sum), label: 'to claim' },
        ]}
        actions={[...actions, { icon: 'search', label: 'Quick search  ⌘K', onClick: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true })) }]} />

      <div style={{ ...cols(220, 14), marginBottom: 16 }}>
        {[
          <Stat key="ready" icon="wallet" tone="brand" label="Ready to claim" value={rm(ready.sum)} onClick={opens('my-pay') ? () => go('my-pay') : undefined}
            sub={ready.n ? 'Get it paid or stack it' : 'Nothing new'} />,
          <Stat key="stacked" icon="payRuns" tone="blue" label="Stacked" value={rm(stacked.sum)} onClick={opens('my-pay') ? () => go('my-pay') : undefined}
            sub={stacked.n ? 'Kept for later. Claim it any time' : 'Nothing stacked'} />,
          <Stat key="earned" icon="check" tone="green" label={`Earned in ${m.year}`} value={rm(earned)}
            sub={checking.n ? `${rm(checking.sum)} more being checked` : 'Own deals and upline overrides'} />,
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
          <Card title="My E-Forms in progress" help={CARD.myDeals} sub={open.total || drafts.total ? `${plural(open.total, 'open E-Form')}${drafts.total ? ` · ${plural(drafts.total, 'draft')}` : ''}` : null}
            actions={opens('deals') && <Link to="deals" style={{ fontSize: 13, fontWeight: 600 }}>See all</Link>}>
            {!open.total && !drafts.total && <p style={{ color: C.muted, margin: 0, fontSize: 13.5 }}>No open E-Forms. {opens('deals/new') && <Link to="deals/new">Submit one</Link>}</p>}
            <div style={{ display: 'grid', gap: 12 }}>
              {[...drafts.rows, ...open.rows].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 6).map(x => {
                const got = Math.min(x.$?.cleared || 0, x.money.billed)
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
                {[[`Team E-Forms · ${monthName(ym).split(' ')[0]}`, num(teamMonth.teamFees?.n || 0)], ['Team fees signed', rm(teamMonth.teamFees?.sum || 0)],
                  ['Team submission', rm(teamMonth.teamBilled?.sum || 0)]].map(([k, v]) => (
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

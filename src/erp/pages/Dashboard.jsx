import { useState } from 'react'
import * as P from '../../../shared/payout.js'
import { C, btn } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { DEAL_STATUS, sum } from '../model.js'
import { Card, Pill, Link, Progress, cols, go, tabular } from '../ui.jsx'
import { CARD } from '../help.js'
import { StackedBars } from '../charts.jsx'
import { Hero, AreaTrend, DealMix, Leaderboard, ActivityFeed, BranchRace, CountUp, rise } from './dashboardWidgets.jsx'
import { getProjects } from '../../demo/projectsApi.js'
import { FlowBar } from '../flow.jsx'
import * as J from '../../../shared/projects.js'
import { rm, date, monthLabel, monthName, lastMonths, daysFrom, num } from '../format.js'
import Icon from '../Icon.jsx'

export default function Dashboard({ me }) {
  const { m, scoped: d, branchId, setup } = useErp()
  const [byType, setByType] = useState(false)
  const today = m.today
  const [prevYm, ym] = lastMonths(today, 2)
  const enabled = P.DEAL_TYPES.filter(t => setup.dealTypes[t]?.enabled)
  const live = d.deals.filter(x => x.status !== 'cancelled' && x.status !== 'draft')
  const thisMonth = live.filter(x => x.date.startsWith(ym))
  const lastMonth = live.filter(x => x.date.startsWith(prevYm))
  const closedNow = d.closes.filter(c => c.date.startsWith(ym))
  const closedBefore = d.closes.filter(c => c.date.startsWith(prevYm))
  const toApprove = d.payouts.filter(p => !p.archiveId && (p.status === 'new' || p.status === 'queried'))
  const queried = toApprove.filter(p => p.status === 'queried')
  // Salary and incentive requests waiting to be paid on the Setup pay day.
  const unpaid = d.requests.filter(r => r.status === 'new' || r.status === 'ready')
  const unpaidTotal = sum(unpaid, r => m.slip(r.id).net)
  const payDay = unpaid.map(r => r.payOn).sort()[0]
  const branchLabel = branchId ? m.branchName(branchId) : 'All branches'

  // Fees signed per month, by deal type (colour fixed per type, never by rank).
  const months = lastMonths(today, 10)
  const rows = months.map(mo => ({
    key: mo, label: monthLabel(mo),
    values: Object.fromEntries(enabled.map(t => [t, sum(live.filter(x => x.type === t && x.date.startsWith(mo)), x => x.fee)])),
  }))
  const series = enabled.map(t => ({ key: t, label: P.DEAL_TYPE_LABELS[t], color: C.series[P.DEAL_TYPES.indexOf(t)] }))

  const pipeline = ['draft', 'submitted', 'partial', 'closed', 'cancelled'].filter(s => s !== 'partial' || d.deals.some(x => x.status === 'partial')).map(s => {
    const list = d.deals.filter(x => x.status === s && (s !== 'closed' && s !== 'cancelled' ? true : x.date.startsWith(m.year)))
    return { s, n: list.length, fee: sum(list, x => x.fee) }
  })

  const stale = d.deals.filter(x => x.status === 'submitted' && daysFrom(x.date, today) > 45)
  const toCheck = d.moneyIn.filter(t => t.status === 'pending' || t.status === 'draft')
  const outToApprove = d.moneyOut.filter(x => x.status === 'new' || x.status === 'queried')
  const openDeals = d.deals.filter(x => x.status === 'submitted' || x.status === 'partial')
  const toCollect = sum(openDeals, x => x.money.billed)
  const collected = sum(openDeals, x => Math.min(m.cleared(x.id), x.money.billed))
  const bounced = d.moneyIn.filter(t => t.status === 'returned' && daysFrom(t.date, today) <= 60)
  const attention = [
    queried.length && { icon: 'alert', tone: C.err, text: <><b>{new Set(queried.map(p => p.dealId)).size} case{new Set(queried.map(p => p.dealId)).size > 1 ? 's' : ''}</b> with Pending Queries</>, to: 'payouts' },
    toApprove.length && { icon: 'payouts', tone: C.warn, text: <><b>{toApprove.length} close-case lines</b> ({rm(sum(toApprove, p => p.amount))}) waiting to be made Ready</>, to: 'payouts' },
    toCheck.length && { icon: 'moneyIn', tone: C.warn, text: <><b>{toCheck.length} transaction{toCheck.length > 1 ? 's' : ''}</b> to check against the bank</>, to: 'money-in' },
    outToApprove.length && { icon: 'moneyOut', tone: C.warn, text: <><b>{outToApprove.length} request form{outToApprove.length > 1 ? 's' : ''}</b> to approve</>, to: 'money-out' },
    stale.length && { icon: 'deals', tone: C.info, text: <><b>{stale.length} E-Form{stale.length > 1 ? 's' : ''}</b> submitted over 45 days ago and still collecting</>, to: 'deals' },
    bounced.length && { icon: 'alert', tone: C.err, text: <><b>{bounced.length} returned cheque{bounced.length > 1 ? 's' : ''}</b> in the last 60 days</>, to: 'money-in' },
  ].filter(Boolean)

  // Top earners this year, by the commission they earned on (what tiers climb on).
  const top = d.staff.map(s => ({ s, v: m.credit(s.id).year })).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 7)

  const submitted = d.deals.filter(x => x.status !== 'draft')
  const billed = mo => sum(submitted.filter(x => x.date.startsWith(mo)), x => x.money.billed)
  const change = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null)
  const counts = Object.fromEntries(['draft', 'submitted', 'partial', 'closed', 'cancelled'].map(k => [k, d.deals.filter(x => x.status === k).length]))
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'



  // Days into the month, for the pace forecast.
  const dayNo = Number(today.slice(8, 10))
  const daysIn = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate()

  // This year's fees by deal type, for the deal mix.
  const yearLive = live.filter(x => x.date.startsWith(m.year))
  const mix = enabled.map(t => ({ key: t, label: P.DEAL_TYPE_LABELS[t], color: C.series[P.DEAL_TYPES.indexOf(t)],
    value: sum(yearLive.filter(x => x.type === t), x => x.fee), count: yearLive.filter(x => x.type === t).length }))

  // What happened lately: E-Forms in, cases closed, money in, people paid.
  const events = [
    ...submitted.filter(x => x.status !== 'cancelled').map(x => ({ date: x.submittedOn || x.date, icon: 'deals', fg: C.primary, bg: C.primaryBg, to: `deals/${x.id}`,
      text: <><b>{m.staffName(x.agentId)}</b> submitted <b>{x.code}</b> · {x.property.title}</>, meta: P.DEAL_TYPE_LABELS[x.type], amount: rm(x.fee) })),
    ...d.closes.map(c => ({ date: c.date, icon: 'check', fg: C.ok, bg: C.okBg, to: `deals/${c.dealId}`,
      text: <><b>{m.deals[c.dealId]?.code}</b> {c.full ? 'closed' : 'part-closed'} · {m.deals[c.dealId]?.property.title}</>, meta: 'Net commission', amount: rm(c.net), amountColor: C.ok })),
    ...d.moneyIn.filter(t => t.status !== 'pending').map(t => ({ date: t.date, icon: t.status === 'returned' ? 'alert' : 'moneyIn',
      fg: t.status === 'returned' ? C.err : C.info, bg: t.status === 'returned' ? C.errBg : C.infoBg, to: 'money-in',
      text: t.status === 'returned' ? <>Cheque <b>returned</b> from {t.payer}</> : <>Received from <b>{t.payer}</b></>, meta: t.code, amount: rm(t.amount) })),
  ].filter(e => e.date && e.date <= today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7)

  // Branch race: fees submitted this month, by branch.
  const race = setup.branches.map((b, i) => ({ key: b.id, index: i, label: b.name, sub: b.code,
    value: sum(m.data.deals.filter(x => x.branchId === b.id && x.date.startsWith(ym) && x.status !== 'cancelled' && x.status !== 'draft'), x => x.fee) }))

  // Developer incentives running now, across projects.
  const running = getProjects(m.data, setup).projects.flatMap(p => p.incentives.map(i => ({ p, i })))
    .filter(({ i }) => J.incentiveStatus(i, today) === 'active')
    .map(({ p, i }) => ({ p, i, r: J.incentiveProgress(i, p, m.data.deals, today) })).slice(0, 4)

  return (
    <div className="ssk-page">
      <Hero greet={`${greet}${me?.name && me.name !== 'Demo' ? `, ${me.name.split(' ')[0]}` : ''} 👋`} place={branchLabel === 'All branches' ? 'All branches' : branchLabel}
        dateText={date(today)} thisMonth={billed(ym)} lastMonth={billed(prevYm)} dayNo={dayNo} daysIn={daysIn} monthName={monthName(ym).split(' ')[0]}
        stats={[
          { icon: 'deals', value: num(thisMonth.length), label: 'E-Forms this month' },
          { icon: 'check', value: num(closedNow.length), label: 'closes' },
          { icon: 'moneyIn', value: toCollect ? `${Math.round(collected / toCollect * 100)}%` : '—', label: 'collected on open deals' },
        ]}
        actions={[
          { icon: 'deals', label: 'Deals', primary: true, onClick: () => go('deals') },
          { icon: 'plus', label: 'Record a payment', onClick: () => go('money-in/new') },
          { icon: 'payouts', label: 'Approve payouts', badge: new Set(toApprove.map(p => p.closeId)).size, onClick: () => go('payouts') },
          { icon: 'search', label: 'Quick search  ⌘K', onClick: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true })) },
        ]} />

      {/* Where work is waiting, from money in to pay out: one click to each step. */}
      <div {...rise(1)}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', margin: '4px 2px 8px' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Commission flow</h2>
          <span style={{ fontSize: 12.5, color: C.muted }}>Each deal goes through these five steps. Click a step to work on it.</span>
        </div>
        <FlowBar />
      </div>

      {/* Headline numbers: this month against last, with ten months of history. */}
      <div style={{ ...cols(240, 14), marginBottom: 16 }}>
        {[
          <Kpi key="sub" tone="brand" icon="deals" label={`Total submission · ${monthName(ym)}`} value={billed(ym)} money
            delta={change(billed(ym), billed(prevYm))} spark={months.map(billed)} onClick={() => go('deals')}
            foot={<>{num(thisMonth.length)} E-Forms · {rm(sum(thisMonth, x => x.fee))} fees<br />Year {m.year}: <b>{rm(sum(submitted.filter(x => x.date.startsWith(m.year)), x => x.money.billed))}</b> · last month {rm(billed(prevYm))}</>} />,
          <Kpi key="net" tone="green" icon="check" label={`Net commission closed · ${monthName(ym).split(' ')[0]}`} value={sum(closedNow, c => c.net)} money
            delta={change(sum(closedNow, c => c.net), sum(closedBefore, c => c.net))} spark={months.map(mo => sum(d.closes.filter(c => c.date.startsWith(mo)), c => c.net))}
            foot={<>{closedNow.length} close{closedNow.length === 1 ? '' : 's'} this month<br />All closed claims: <b>{rm(sum(d.closes, c => c.claim))}</b></>} />,
          <Kpi key="app" tone="amber" icon="payouts" label="Payouts to approve" value={sum(toApprove, p => p.amount)} money onClick={() => go('payouts')}
            foot={<>{new Set(toApprove.map(p => p.closeId)).size} closes waiting<br />{queried.length ? <span style={{ color: C.err, fontWeight: 600 }}>{queried.length} lines in Pending Queries</span> : 'None queried'}</>} />,
          <Kpi key="sal" tone="blue" icon="payRuns" label={payDay ? `Salary to pay · ${date(payDay, { short: true })}` : 'Salary to pay'} value={unpaidTotal} money onClick={() => go('salary')}
            foot={<>{unpaid.length ? `${unpaid.length} requests` : 'No open requests'}<br />{P.describeApprovals(setup.approvals).split(' · ')[1] || ''}</>} />,
        ].map((k, i) => <div key={i} {...rise(i + 1)} style={{ ...rise(i + 1).style, display: 'grid' }}>{k}</div>)}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
        <div {...rise(5)} style={{ ...rise(5).style, flex: '2 1 560px', minWidth: 0, display: 'grid' }}>
          <Card title="Commission trend" help={CARD.trend} sub="Fees on E-Forms submitted, and net commission closed, month by month"
            actions={<button style={{ ...btn, fontSize: 13, padding: '5px 11px' }} onClick={() => setByType(!byType)}>{byType ? 'Show trend' : 'By deal type'}</button>}>
            {byType ? <StackedBars rows={rows} series={series} title="Fees signed per month by deal type" />
              : <AreaTrend months={months} series={[
                { key: 'fees', label: 'Fees submitted', color: C.primary, values: months.map(mo => sum(live.filter(x => x.date.startsWith(mo)), x => x.fee)) },
                { key: 'net', label: 'Net closed', color: '#17a34a', values: months.map(mo => sum(d.closes.filter(c => c.date.startsWith(mo)), c => c.net)) },
              ]} />}
          </Card>
        </div>
        <div {...rise(6)} style={{ ...rise(6).style, flex: '1 1 320px', minWidth: 0, display: 'grid' }}>
          <Card title={`Deal mix ${m.year}`} help={CARD.mix} sub="Share of fees by deal type">
            <DealMix parts={mix} label="fees this year" />
          </Card>
        </div>
      </div>

      <div {...rise(7)}><Pipeline pipeline={pipeline} counts={counts} collected={collected} toCollect={toCollect} year={m.year} /></div>

      <div style={{ ...cols(360, 16), marginBottom: 16 }}>
        <div {...rise(8)} style={{ ...rise(8).style, display: 'grid', minWidth: 0 }}>
          <Card title={`Top negotiators ${m.year}`} help={CARD.top} sub="Commission they earned on, which is what tiers climb on">
            <Leaderboard rows={top} m={m} showBranch={!branchId} />
          </Card>
        </div>
        <div {...rise(9)} style={{ ...rise(9).style, display: 'grid', minWidth: 0 }}>
          <Card title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>Latest activity <Pill tone="green">Live</Pill></span>} sub="E-Forms, closes and money in, newest first">
            <ActivityFeed events={events} today={today} />
          </Card>
        </div>
      </div>

      <div style={{ ...cols(320, 16), marginBottom: 16 }}>
        <div {...rise(10)} style={{ ...rise(10).style, display: 'grid', minWidth: 0 }}>
          <Card title="Needs attention" help={CARD.attention} sub={attention.length ? 'Waiting on someone in the office' : null}>
            {attention.length ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {attention.map((a, i) => (
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
                <div style={{ fontSize: 34 }} aria-hidden>🎉</div>
                <p style={{ color: C.ok, margin: '6px 0 0', fontWeight: 600 }}>All clear. Nothing is waiting.</p>
              </div>
            )}
          </Card>
        </div>
        {!branchId && race.length > 1 && (
          <div {...rise(11)} style={{ ...rise(11).style, display: 'grid', minWidth: 0 }}>
            <Card title={`Branch race · ${monthName(ym).split(' ')[0]}`} help={CARD.race} sub="Fees submitted this month">
              <BranchRace rows={race} />
            </Card>
          </div>
        )}
        <div {...rise(12)} style={{ ...rise(12).style, display: 'grid', minWidth: 0 }}>
          <Card title="Developer incentives" help={CARD.devIncentives} sub="Campaigns running now" actions={<Link to="projects/incentives" style={{ fontSize: 13, fontWeight: 600 }}>See all</Link>}>
            {!running.length && <p style={{ color: C.muted, margin: 0, fontSize: 13.5 }}>No developer campaign is running today.</p>}
            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'minmax(0, 1fr)' }}>
              {running.map(({ p, i, r }) => {
                const g = r.groups[0]
                const steps = [...(i.steps || [])].sort((a, b) => a.units - b.units)
                const goal = i.kind === 'perUnit' ? null : (g?.next || steps[steps.length - 1])
                return (
                  <a key={i.id} href={`#/projects/${p.id}`} style={{ textDecoration: 'none', color: C.text }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13.5 }}>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><b>{i.name}</b><span style={{ color: C.muted }}> · {p.name}</span></span>
                      <b style={{ color: r.total ? C.ok : C.text, whiteSpace: 'nowrap', ...tabular }}>{rm(r.total)}</b>
                    </div>
                    <div style={{ marginTop: 6 }}><Progress value={goal ? (g?.units || 0) / goal.units : 1} tone={r.total ? 'green' : 'brand'} height={6} label={i.name} /></div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                      {goal ? `${g?.units || 0} of ${goal.units} units for ${rm(goal.amount)}` : `${r.units} units sold · ${rm(i.perUnit)} each`}
                    </div>
                  </a>
                )
              })}
            </div>
          </Card>
        </div>
      </div>

      {!branchId && setup.branches.length > 1 && <div {...rise(13)}><BranchTable m={m} /></div>}
    </div>
  )
}

function BranchTable({ m }) {
  const y = m.year
  const rows = m.setup.branches.map(b => {
    const deals = m.data.deals.filter(d => d.branchId === b.id && d.date.startsWith(y) && d.status !== 'cancelled' && d.status !== 'draft')
    const closes = m.data.closes.filter(c => m.deals[c.dealId].branchId === b.id && c.date.startsWith(y))
    const paid = m.data.payouts.filter(p => m.deals[p.dealId].branchId === b.id && p.date.startsWith(y))
    const net = sum(closes, c => c.net)
    return { b, deals: deals.length, fees: sum(deals, d => d.fee), net, paid: sum(paid, p => p.amount), kept: Math.max(0, net - sum(paid, p => p.amount)),
      people: m.data.staff.filter(s => s.branchId === b.id && s.status === 'active').length }
  })
  const head = ['Branch', 'Active staff', `Deals ${y}`, 'Fees signed', 'Net closed', 'Paid to people', 'Company keeps']
  return (
    <Card title={`Branches in ${y}`} help={CARD.branches} sub="Company keeps = net commission closed minus what was paid to negotiators and uplines">
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(250px, 100%), 1fr))' }}>
        {rows.map(r => (
          <div key={r.b.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <b style={{ flex: 1 }}>{r.b.name}</b>
              <Pill tone="gray" dot={false}>{r.b.code}</Pill>
            </div>
            {head.slice(1).map((h, i) => (
              <div key={h} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '3px 0' }}>
                <span style={{ color: C.muted }}>{h}</span>
                <b style={tabular}>{[r.people, r.deals, rm(r.fees), rm(r.net), rm(r.paid), rm(r.kept)][i]}</b>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  )
}

const KPI_TONES = { brand: [C.primary, C.primaryBg], green: [C.ok, C.okBg], amber: [C.warn, C.warnBg], blue: [C.info, C.infoBg] }

// A headline number: label, value, change on last month, a ten-month line and two lines of detail.
function Kpi({ tone, icon, label, value, money, delta, spark, foot, onClick }) {
  const [fg, bg] = KPI_TONES[tone]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} className={onClick ? 'ssk-lift' : undefined}
      style={{ textAlign: 'left', fontFamily: C.font, color: C.text, cursor: onClick ? 'pointer' : 'default', background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '16px 18px 14px', boxShadow: C.shadow, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', overflow: 'hidden', containerType: 'inline-size' }}>
      <span aria-hidden style={{ position: 'absolute', inset: '0 0 auto 0', height: 3, background: fg, opacity: 0.85 }} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: bg, color: fg, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={icon} size={18} /></span>
        <span style={{ fontSize: 13, color: C.muted, fontWeight: 500, lineHeight: 1.3 }}>{label}</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'flex-end', gap: 10, justifyContent: 'space-between' }}>
        {/* The amount never breaks; the sparkline gives up width first, and a
            full amount (2 dp) shrinks with the tile so it always fits. */}
        <span>
          <span style={{ display: 'block', fontSize: 'clamp(18px, 11cqi, 28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{money ? <CountUp value={value} format={rm} /> : value}</span>
          {delta != null && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12, color: C.muted, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 600, padding: '1px 7px', borderRadius: 999, whiteSpace: 'nowrap',
                color: delta >= 0 ? C.ok : C.err, background: delta >= 0 ? C.okBg : C.errBg }}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%</span>
              vs last month
            </span>
          )}
        </span>
        {spark && <Spark values={spark} color={fg} />}
      </span>
      <span style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, borderTop: `1px dashed ${C.border}`, paddingTop: 8 }}>{foot}</span>
    </Tag>
  )
}

// A small line with a soft fill: ten months, latest on the right.
function Spark({ values, color }) {
  const w = 96, h = 36, max = Math.max(...values, 1)
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * w, h - 3 - (v / max) * (h - 6)])
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const id = `spark-${color.replace('#', '')}`
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ flex: `0 1 ${w}px`, minWidth: 0, overflow: 'visible' }}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.22" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill="#fff" stroke={color} strokeWidth="2" />
    </svg>
  )
}

const PIPE_COLORS = { draft: '#98a2b3', submitted: '#2a78d6', partial: '#7a4fc9', closed: '#17803d', cancelled: '#d92d20' }

// Every E-Form by status in one bar, plus how much of the open ones is collected.
function Pipeline({ pipeline, counts, collected, toCollect, year }) {
  const total = pipeline.reduce((t, p) => t + p.n, 0) || 1
  return (
    <Card title="E-Form pipeline" help={CARD.pipeline} sub={`Open now; closed and aborted in ${year}`} style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div style={{ flex: '3 1 420px', minWidth: 0 }}>
          <div role="img" aria-label={pipeline.map(p => `${DEAL_STATUS[p.s].label} ${p.n}`).join(', ')}
            style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: C.grayBg, gap: 2 }}>
            {pipeline.filter(p => p.n).map(p => <div key={p.s} title={`${DEAL_STATUS[p.s].label}: ${p.n}`} style={{ flex: p.n / total, background: PIPE_COLORS[p.s] }} />)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 10, marginTop: 14 }}>
            {pipeline.map(p => (
              <a key={p.s} href="#/deals" className="ssk-lift" style={{ textDecoration: 'none', color: C.text, padding: '10px 12px', borderRadius: 10, border: `1px solid ${C.border}`, background: '#fff' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.muted, fontWeight: 500 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: PIPE_COLORS[p.s] }} />{DEAL_STATUS[p.s].label}
                </span>
                <span style={{ display: 'block', fontSize: 22, fontWeight: 700, marginTop: 4, ...tabular }}>{num(p.n)}</span>
                <span style={{ display: 'block', fontSize: 12, color: C.muted, ...tabular }}>{rm(p.fee)}</span>
              </a>
            ))}
          </div>
          <div style={{ fontSize: 12, color: C.faint, marginTop: 10 }}>
            All-time case count: {Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${DEAL_STATUS[k].label} ${num(n)}`).join(' · ')}
          </div>
        </div>
        {toCollect > 0 && (
          <div style={{ flex: '1 1 240px', minWidth: 0, padding: 16, borderRadius: 12, background: `linear-gradient(135deg, ${C.infoBg}, #f5f8ff)`, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}>Collected on open E-Forms</div>
            <div style={{ fontSize: 26, fontWeight: 700, margin: '4px 0 10px', ...tabular }}>{Math.round(collected / toCollect * 100)}%</div>
            <Progress value={collected / toCollect} tone="blue" height={8} label="Collected on open deals" />
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8, lineHeight: 1.5, ...tabular }}>{rm(collected)} of {rm(toCollect)}<br />{rm(toCollect - collected)} still to come in</div>
          </div>
        )}
      </div>
    </Card>
  )
}

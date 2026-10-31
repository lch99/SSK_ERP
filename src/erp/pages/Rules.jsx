import { useMemo } from 'react'
import * as L from '../../../shared/listings.js'
import { C, btn } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { useCan } from '../access.jsx'
import { useFeedback } from '../feedback.jsx'
import { Page, Card, Pill, Link, go } from '../ui.jsx'
import { PAGE } from '../help.js'
import { rmShort, num } from '../format.js'

// System → Automatic rules: what the ERP does by itself (the current system
// hides these in its code and on page loads), in plain words, with what each
// rule affects right now and, where it makes sense, a button to run it now.
const R = L.LISTING_RULES
const fmt = n => num(n)

function Rule({ title, children, now, action, last }) {
  return (
    <Card title={title}>
      <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{children}</div>
      {now && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>{now}</div>}
      {(action || last) && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
          {action}
          {last && <span style={{ fontSize: 12.5, color: C.muted }}>Last run {last.at}: {last.changed ? `${fmt(last.changed)} changed` : 'nothing to change'}</span>}
        </div>
      )}
    </Card>
  )
}
// `label` is one word form, or [one, many] when it changes with the count.
const Count = ({ n, label, tone = 'gray', to }) => {
  const text = Array.isArray(label) ? label[n === 1 ? 0 : 1] : label
  const pill = <Pill tone={n ? tone : 'gray'} dot={false}>{fmt(n)} {text}</Pill>
  return to && n ? <Link to={to}>{pill}</Link> : pill
}

export default function Rules() {
  const erp = useErp()
  const { m } = erp
  const can = useCan()
  const fb = useFeedback()
  const d = m.data
  const runs = d.runs || {}
  const full = can('listings', 'full')
  const now = useMemo(() => {
    const active = d.listings.filter(l => l.status === 'active')
    const last = l => l.phLog?.at(-1)
    const bands = {}
    for (const l of active) { const r = L.priceRating(l); bands[r?.band || 'none'] = (bands[r?.band || 'none'] || 0) + 1 }
    const hot = {}
    for (const l of active) for (const k of L.hotLists(l)) hot[k] = (hot[k] || 0) + 1
    const weekAhead = L.addDays(m.today, 7)
    const rankings = L.buildingRankings(d)
    const titles = d.titles.filter(t => t.status === 0)
    const close = kind => titles.filter(t => {
      const top = rankings.get(t.id)?.[kind]?.[0]
      const rule = kind === 'sale' ? R.projectManager : R.projectHandler
      return top && top.n >= rule.win * 0.6 && top.n < rule.win && top.staffId !== (kind === 'sale' ? t.managerId : t.handlerId)
    }).length
    const stamp = `${m.today} 23:59`
    return {
      active: active.length,
      byCoPh: active.filter(l => ['coPh', 'locked'].includes(last(l)?.from)).length,
      byMain: active.filter(l => l.share?.pmId && l.share.pmId === l.holderId).length,
      ending: active.filter(l => (l.share?.coPh || []).some(c => !c.locked && c.until && c.until >= m.today && c.until <= weekAhead)).length,
      locked: active.filter(l => (l.share?.coPh || []).some(c => c.locked)).length,
      pm: titles.filter(t => t.managerId).length, ph: titles.filter(t => t.handlerId).length,
      forGood: titles.filter(t => t.managerPermanent || t.handlerPermanent).length, closePm: close('sale'), closePh: close('rental'),
      bands, hot, outdated: active.filter(l => L.isOutdated(l, m.today)).length,
      toConfirm: (d.viewings || []).filter(v => v.status === 'new' || v.status === 'rescheduled').length,
      overdue: (d.viewings || []).filter(v => L.reviewOverdue(v, stamp)).length,
      pending: d.staff.filter(s => s.status === 'pending').length,
      suspendSoon: d.staff.filter(s => s.status === 'pending' && L.daysBetween(s.joined, m.today) >= R.pendingDays - 2).length,
      lockSoon: d.staff.filter(s => s.status === 'active' && s.lastActive && L.daysBetween(String(s.lastActive).slice(0, 10), m.today) > R.idleDays - 15).length,
      suspended: d.staff.filter(s => s.status === 'suspended').length, lockedStaff: d.staff.filter(s => s.status === 'locked').length,
      looks: d.listings.reduce((t, l) => t + (l.ownerViews || []).filter(x => x.at >= L.addDays(m.today, -30)).length, 0),
    }
  }, [d, m.today])
  const run = (fn, key, label) => async () => {
    const st = await fb.run(fn)
    if (st) { const n = st.data.runs?.[key]?.changed || 0; fb.toast(n ? `${fmt(n)} ${label}` : 'Checked: nothing to change') }
  }
  return (
    <Page title="Automatic rules" help={PAGE.rules} sub="What the ERP does by itself, and what each rule affects right now. The same rules run on the server when the ERP goes live.">
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', alignItems: 'start' }}>
        <Rule title="Who handles a listing (product handler)"
          now={<><Count n={now.byCoPh} label="handled by a co-product handler" tone="blue" /><Count n={now.byMain} label="by their main product handler" tone="blue" />
            <Count n={now.locked} label="locked in (key or exclusive)" tone="violet" /><Count n={now.ending} label={['co-PH slot ends within 7 days', 'co-PH slots end within 7 days']} tone="amber" /></>}
          action={full && <button style={btn} onClick={run(() => erp.recheckHandlers(), 'handlers', 'listings changed product handler; each new one is told')}>Re-check every listing</button>}
          last={runs.handlers}>
          Picked again whenever the slots, a follow-up or someone's account changes, in this order:
          <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            <li>A co-product handler locked in because they hold the key or an exclusive.</li>
            <li>The co-product handler who followed the listing up most recently (slots end on their date).</li>
            <li>The main product handler.</li>
            <li>The current product handler, while their account is active.</li>
            <li>If not: the building's Project Manager (sale) or Project Handler (rent), the area manager, the creator, then the branch manager. Their listings come back with "Give them back" on their page.</li>
          </ol>
        </Rule>
        <Rule title="Who leads each building"
          now={<><Count n={now.pm} label={['building with a Project Manager', 'buildings with a Project Manager']} /><Count n={now.ph} label="with a Project Handler" /><Count n={now.forGood} label="held for good" tone="violet" />
            <Count n={now.closePm + now.closePh} label="close to changing hands" tone="amber" to="titles" /></>}
          action={full && <button style={btn} onClick={run(() => erp.recheckBuildingLeads(), 'leads', 'building leads changed; each new lead is told')}>Re-check leads</button>}
          last={runs.leads}>
          <b>Project Manager</b> (sales): the product handler with the most full-closed sale value in the building takes over once past {rmShort(R.projectManager.win)}; from {rmShort(R.projectManager.keep)} it is theirs for good. Checked each time a sale closes in full.
          <br /><b>Project Handler</b> (rentals): the product handler holding the key to the most active rentals there takes over from {R.projectHandler.win}; from {R.projectHandler.keep} it is theirs for good.
          <br />New listings in a building are announced to its lead.
        </Rule>
        <Rule title="Price against market value"
          now={<>{Object.entries(L.RATING).map(([k, r]) => <Pill key={k} tone={r.tone} dot={false}>{fmt(now.bands[k] || 0)} {r.label.toLowerCase()}</Pill>)}<Count n={now.bands.none || 0} label="with no market value" tone="amber" /></>}>
          Each listing's Ad Price is compared with its market value: under {R.ratingSteps[0]}% above is a <b>hot price</b>, then <b>good</b> (to {R.ratingSteps[1]}%), <b>fair</b> (to {R.ratingSteps[2]}%) and <b>above market</b>. Shown on every listing and as a filter.
        </Rule>
        <Rule title="Hot lists" now={<>{Object.entries(L.HOT_LISTS).map(([k, h]) => <Count key={k} n={now.hot[k] || 0} label={h.label} tone="red" />)}</>}
          action={<button style={btn} onClick={() => go('listings')}>Open listings → Hot lists</button>}>
          {Object.values(L.HOT_LISTS).map(h => <div key={h.label}><b>{h.label}</b>: {h.help}</div>)}
          <div style={{ marginTop: 4, color: C.muted, fontSize: 12.5 }}>Worked out live from each listing, so they never go stale. (The current system hard-codes its home-page lists per area.)</div>
        </Rule>
        <Rule title="Outdated listings" now={<Count n={now.outdated} label={['active listing past the window', 'active listings past the window']} tone="amber" />}
          action={full && <button style={btn} onClick={run(() => erp.markOutdated(), 'outdated', 'listings marked Outdated; whoever keeps them as a favourite is told')}>Mark them Outdated</button>}
          last={runs.outdated}>
          A listing nobody updated (edit, price, photos or follow-up) for {R.outdatedDays.sale} days (sale) or {R.outdatedDays.rental} days (rent) becomes Outdated. Going live this runs every night; in the demo it runs when you press the button. The listing's page warns before it happens.
        </Rule>
        <Rule title="Viewings" now={<><Count n={now.toConfirm} label="waiting to be confirmed" tone="amber" to="appointments" /><Count n={now.overdue} label={['review overdue', 'reviews overdue']} tone="red" to="appointments" /></>}>
          A viewing not confirmed by the product handler before its time <b>expires</b>. Once a confirmed viewing is over it waits for the agent's <b>review</b>, due within {R.reviewWithinHours} hours; the review goes on the listing's follow-ups (and can make a co-product handler the handler). Both sides are told of every change.
        </Rule>
        <Rule title="Staff accounts" now={<><Count n={now.suspendSoon} label={['pending account about to be suspended', 'pending accounts about to be suspended']} tone="amber" to="staff" /><Count n={now.lockSoon} label={['idle account locking within 15 days', 'idle accounts locking within 15 days']} tone="amber" to="staff" />
          <Count n={now.suspended} label="suspended" tone="red" /><Count n={now.lockedStaff} label="locked" tone="red" /></>}>
          An account still Pending {R.pendingDays} days after joining is <b>suspended</b>; one with no activity for {R.idleDays} days is <b>locked</b>. Either way their listings go to the next person in line, and HR can give them back on re-enabling the account.
        </Rule>
        <Rule title="Owner's details" now={<Count n={now.looks} label={["look at an owner's details in 30 days", "looks at owners' details in 30 days"]} tone="blue" />}>
          The owner's name, contact and unit are for the product handler and the creator. Others tied to the listing (co- and main product handlers, the handler's leaders, the building's lead, people it is shared with) and office staff see them after pressing Show, which is logged on the listing. Everyone else sees the building and area only, and books viewings through the product handler.
        </Rule>
      </div>
    </Page>
  )
}

import * as P from '../../../shared/payout.js'
import { tierCredit, payoutForClose } from '../../../shared/erpRules.js'
import { projectOfDeal, describePayout } from '../../../shared/projects.js'
import { useEffect, useState } from 'react'
import { C, btn, btnPrimary } from '../../styles.js'
import { ROLE_COLORS, AGENT_COLOR, COMPANY_COLOR } from '../../setup/colors.js'
import { useErp } from '../ErpContext.jsx'
import { DEMO, getDealCredit } from '../../api.js'
import { useList, useRecord } from '../useList.js'
import { DEAL_STATUS, MONEY_IN_STATUS, MONEY_OUT_STATUS, PAYOUT_STATUS, MONEY_OUT_TYPES, PURPOSES, METHODS, PARTY, closeType, sum, r2 } from '../model.js'
import { Page, Card, KV, Status, Pill, Progress, Who, Link, Empty, Notice, Modal, FormField, FileInput, cols, go, mono, small, tabular } from '../ui.jsx'
import { useFeedback } from '../feedback.jsx'
import { CARD, PAGE } from '../help.js'
import { DealActions, useCloseDeal } from './Deals.jsx'
import { DealProgress } from '../flow.jsx'
import { rm, pct, date, maskIc, num } from '../format.js'
import Icon from '../Icon.jsx'
import { useCan } from '../access.jsx'

const OTHER_COLORS = { cobroke: '#c3c7cf', referral: '#d9b38c' }

// One E-Form (GET /api/erp/deals/<id> with its cash), and what the page shows
// from other records as small reads of their lists.
export default function DealPage({ id }) {
  const { record: deal, loading } = useRecord('deals', id)
  if (!deal) {
    return (
      <Page title={loading ? 'Loading…' : 'E-Form not found'} back={{ to: 'deals', label: 'All E-Forms' }}>
        {!loading && <Empty title="This E-Form no longer exists" text="Or it is not one you can see." />}
      </Page>
    )
  }
  return <DealView key={deal.id} deal={deal} />
}

// The E-Form's payments in and out, closes and payout lines, each read only for
// a role that sees that area; and, for the payout preview until the case is
// closed, its earners' tier credit and a project E-Form's project (its own
// payout rule).
function useDealRecords(deal) {
  const { m } = useErp()
  const can = useCan()
  const own = { dealId: deal.id, sort: 'date', counts: '0' }
  const only = (sees, pageSize = 50) => ({ branch: false, pageSize, skip: !sees })
  const seesCloses = can('payouts', 'view')
  const payments = useList('moneyIn', own, only(can('moneyIn', 'view')))
  const outs = useList('moneyOut', own, only(can('moneyOut', 'view')))
  const closes = useList('closes', own, only(seesCloses))
  const lines = useList('payouts', own, only(seesCloses || can('salary', 'view'), 200))
  const preview = !(seesCloses && deal.$.closeIds.length)
  const [credit, setCredit] = useState(null)
  useEffect(() => {
    if (!preview || DEMO) return undefined
    let live = true
    getDealCredit(deal.id).then(c => { if (live) setCredit(c) }, () => { if (live) setCredit({}) })
    return () => { live = false }
  }, [deal.id, preview, m])
  // In the demo, from the records in this browser, by the same rule.
  const creditOf = !preview ? null : DEMO ? sid => tierCredit(m.staff[sid], m.data.closes, m.year) : credit && (sid => credit[sid] || { lifetime: 0, yearly: 0 })
  const { project, ready: projectReady } = useDealProject(preview ? deal : null)
  return { payments, outs, closes: closes.rows, lines: lines.rows, creditOf, preview, project, projectReady }
}

// A project E-Form's project (the one it is named after), for its own payout rule
// (shared/projects.js projectPayout); ready: false while it is being read.
export function useDealProject(deal) {
  const can = useCan()
  const sees = deal?.type === 'project' && !!deal.property?.title && (can('deals', 'view') || can('projects', 'view'))
  const projects = useList('projects', { name: deal?.property?.title || '', counts: '0' }, { branch: false, pageSize: 5, skip: !sees })
  return { project: sees ? projectOfDeal(projects.rows, deal) : null, ready: !sees || !projects.loading || projects.rows.length > 0 }
}

function DealView({ deal }) {
  const erp = useErp()
  const can = useCan()
  const { m, setup } = erp
  const [busy, setBusy] = useState(false)
  const closeDeal = useCloseDeal(deal)
  const recs = useDealRecords(deal)
  const party = PARTY[deal.type]
  const money = deal.money
  const { cleared, closed } = deal.$
  const got = Math.min(cleared, money.billed)
  const branch = m.branches[deal.branchId]

  const bm = m.branchManagerOf(deal.agentId), am = m.areaManagerOf(deal.agentId)
  const total = r2(money.billed - money.coBroke - money.referral)
  const rent = deal.rental
  return (
    <Page back={{ to: 'deals', label: 'All E-Forms' }} help={PAGE.deal}
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        E-Form <span style={{ fontFamily: mono.fontFamily }}>{deal.code}</span><Status of={DEAL_STATUS} value={deal.status} />
      </span>}
      actions={<>{deal.status !== 'cancelled' && can('deals', 'edit') && <button style={btn} onClick={() => go(`deals/${deal.id}/edit`)}>Edit E-Form</button>}<DealActions deal={deal} /></>}
      sub={<>{deal.property.address} · {P.DEAL_TYPE_LABELS[deal.type]} · {branch?.name}</>}>

      {deal.status === 'cancelled' && <Notice tone="red"><b>Abort/Cancel on {date(deal.cancelledOn)}.</b> {deal.cancelReason}</Notice>}
      {deal.status === 'draft' && <Notice tone="amber"><b>This E-Form is a draft.</b> Payments can be recorded once it is submitted. {can('deals', 'edit') && <button style={{ ...small, marginLeft: 6 }} onClick={() => go(`deals/${deal.id}/edit`)}>Edit &amp; submit</button>}</Notice>}
      {deal.status !== 'cancelled' && <DealProgress deal={deal} lines={recs.lines} pending={recs.payments.rows.find(t => t.status === 'pending' || t.status === 'draft')}
        busy={busy} onClose={async amount => { setBusy(true); await closeDeal(amount); setBusy(false) }} />}

      <div style={{ ...cols(150, 12), marginBottom: 16 }}>
        <Figure label={deal.type === 'rental' ? 'Rent' : 'Selling Price'} value={rm(deal.price)}
          sub={rent ? `${rent.months}-month tenancy` : deal.property.category} />
        <Figure label="Total Commission" value={rm(total)} sub={`Net Total ${rm(money.net)}`} />
        <Figure label="Closing Total" value={rm(closed)} sub={`of ${rm(money.billed)} claim from owner`} />
        <Figure label="Transaction Amount" value={deal.status === 'draft' ? '—' : `${rm(cleared)}`}
          sub={deal.status === 'draft' ? 'Not submitted yet' : <Progress value={got / money.billed} tone={got >= money.billed ? 'green' : 'blue'} label="Cleared" />} />
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(440px, 100%), 1fr))', alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          <Card title="E-Form" help={CARD.eform}>
            <KV min={170} items={[
              ['Document Code', <span style={mono}>{deal.code}</span>], ['Date', date(deal.date)],
              ['Branch Manager', bm ? <Link to={`staff/${bm.id}`} style={{ color: C.text }}>{bm.short}</Link> : '—'],
              ['Area Manager', am ? <Link to={`staff/${am.id}`} style={{ color: C.text }}>{am.short}</Link> : '—'],
              ['Agent Name (Sale Staff)', <Link to={`staff/${deal.agentId}`} style={{ color: C.text }}>{m.staffName(deal.agentId)}</Link>],
              ['Product Handler', deal.holderId != null ? <Link to={`staff/${deal.holderId}`} style={{ color: C.text }}>{m.staffName(deal.holderId)}</Link> : '—'],
              ['Listing', deal.listingId ? <Link to={`listings/${deal.listingId}`} style={mono}>{deal.$.listingCode}</Link> : deal.type === 'project' ? 'Developer project' : '—'],
              ['Listing Creator', deal.$.listingCreator != null ? m.staffName(deal.$.listingCreator) : '—'],
              ['Property Type', deal.property.category], ['Property Address', deal.property.address],
            ]} />
          </Card>
          <Split deal={deal} m={m} setup={setup} recs={recs} />
          {can('moneyIn', 'view') && <MoneyInCard deal={deal} list={recs.payments} />}
          <MoneyOutCard list={recs.outs} />
        </div>
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          <PartyCard title={party.buyer.toUpperCase()} p={deal.buyer} others={deal.otherBuyers} help={CARD.parties} />
          <PartyCard title={party.owner.toUpperCase()} p={deal.owner} others={deal.otherOwners} />
          {rent && (
            <Card title="DEPOSIT / TENANCY AGREEMENT" help={CARD.tenancy}>
              <KV min={150} items={[
                ['Rental Deposit', rm(deal.price * rent.deposit)], ['Utility Deposit', rm(deal.price * rent.utility)], ['Advance Rental', rm(deal.price * rent.advance)],
                ['Tenancy Fees', rm(rent.taFee || 0)], ['Tenancy', `${rent.months} months`],
              ]} />
            </Card>
          )}
          <Card title="OTHERS" help={CARD.others}>
            <KV min={170} items={[
              ['Vendor Professional Fees', <>{rm(money.billed)}<Muted>Includes {pct(deal.sstPct)} SST · {pct(deal.feePct)} of price</Muted></>],
              ['Got Co-Bro Agency', deal.coBroke ? 'Yes' : 'No'],
              deal.coBroke && ['Co-bro Agency', <>{deal.coBroke.agency}<Muted>{[deal.coBroke.licence, deal.coBroke.agent, deal.coBroke.phone].filter(Boolean).join(' · ')}</Muted>{deal.coBroke.address && <Muted>{deal.coBroke.address}</Muted>}</>],
              ['Co-bro Fees', rm(money.coBroke)],
              ['Introducer Fees', <>{rm(money.referral)}{deal.referral && <Muted>{deal.referral.name}{deal.referral.ic ? ` · IC ${maskIc(deal.referral.ic)}` : ''}{deal.referral.phone ? ` · ${deal.referral.phone}` : ''}</Muted>}{deal.referral && <Muted>{deal.referral.bank} {deal.referral.account}</Muted>}</>],
              ['SST Amount', rm(money.sst)], ['Pay By', deal.sstMode === 'included' ? 'Owner (SST included)' : `Agent (${pct(deal.sstPct)} SST)`],
              ['Total Commission', <b>{rm(total)}</b>], ['Net Total Commission', <b>{rm(money.net)}</b>],
            ]} />
          </Card>
          <Docs deal={deal} />
          {deal.remark && <Card title="Remarks"><p style={{ margin: 0, fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{deal.remark}</p></Card>}
          <Closes deal={deal} closes={recs.closes} lines={recs.lines} />
          <Timeline deal={deal} m={m} recs={recs} />
        </div>
      </div>
    </Page>
  )
}

const Muted = ({ children }) => <span style={{ display: 'block', fontSize: 12.5, color: C.muted }}>{children}</span>

function Figure({ label, value, sub }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', boxShadow: C.shadow, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, margin: '2px 0 4px', ...tabular }}>{value}</div>
      <div style={{ fontSize: 12.5, color: C.muted }}>{sub}</div>
    </div>
  )
}

// Each side's people and amounts: the real payout lines once the deal has
// closed, otherwise a preview on everyone's tier today (creditOf: each
// earner's tier credit; null while it loads). Both use the payout rules in
// force on the E-Form's date.
function sidesOf(deal, m, setup, { closes, lines, creditOf, preview, project, projectReady }) {
  const rules = P.rulesAt(setup, deal.date)
  if (!preview && closes.length) {
    return P.dealSides(deal, rules.sideSharePct).map(sd => {
      const parts = closes.flatMap(c => c.sides.filter(s => s.side === sd.side))
      const mine = lines.filter(l => l.side === sd.side)
      const keyed = {}
      for (const l of mine) {
        const k = `${l.staffId}-${l.role}`
        keyed[k] ||= { staffId: l.staffId, role: l.role, pct: l.pct, amount: 0, statuses: new Set() }
        keyed[k].amount = r2(keyed[k].amount + l.amount)
        keyed[k].statuses.add(l.status)
      }
      const last = parts[parts.length - 1]
      return { ...sd, base: sum(parts, p => p.base), company: sum(parts, p => p.company), tierId: last.tierId, agentRate: last.agentRate,
        totalPct: last.totalPct, retracted: parts.some(p => p.retracted), lines: Object.values(keyed), preview: false }
    })
  }
  if (!creditOf || !projectReady) return null
  // What closing it today would pay: the same rule the close runs (payoutForClose), with a project's own rule.
  const out = payoutForClose(setup, m.staff, deal, deal.money.net, creditOf, undefined, project)
  return P.dealSides(deal, rules.sideSharePct).map(sd => {
    const s = out.sides.find(x => x.side === sd.side)
    return { ...sd, base: s.base, company: s.company, retracted: !!s.retracted, tierId: s.tierId, agentRate: s.agentRate, totalPct: s.totalPct,
      lines: out.lines.filter(l => l.side === sd.side), preview: true }
  })
}

function Split({ deal, m, setup, recs }) {
  const money = deal.money
  const rules = P.rulesAt(setup, deal.date)
  const sides = sidesOf(deal, m, setup, recs)
  if (!sides) return <Card title="Payout Preview" help={CARD.payoutPreview}><p style={{ margin: 0, fontSize: 13.5, color: C.muted }}>Working out the payout…</p></Card>
  const preview = sides.some(s => s.preview)
  const roleColor = code => ROLE_COLORS[Math.max(0, rules.roles.findIndex(r => r.code === code)) % ROLE_COLORS.length]
  const tierName = (sid, tierId) => {
    const t = P.tiersFor(rules, m.staff[sid].branchId).find(x => x.id === tierId)
    return t ? P.tierLabel(t) : ''
  }
  // One bar for the whole fee: co-broke, referral, then each person, then the company.
  const segs = [
    money.coBroke > 0 && { key: 'cb', label: 'Co-broke agency', amount: money.coBroke, color: OTHER_COLORS.cobroke },
    money.referral > 0 && { key: 'rf', label: 'Referral fee', amount: money.referral, color: OTHER_COLORS.referral },
    ...sides.flatMap(s => s.lines.map(l => ({ key: `${s.side}-${l.staffId}-${l.role}`, label: m.staffName(l.staffId), amount: l.amount, color: l.role ? roleColor(l.role) : AGENT_COLOR }))),
    { key: 'co', label: 'Company keeps', amount: sum(sides, s => s.company), color: COMPANY_COLOR },
  ].filter(Boolean).filter(s => s.amount > 0)
  const closedPart = deal.$.closed

  return (
    <Card title="Payout Preview" help={CARD.payoutPreview} sub={preview
      ? 'On everyone’s tier today. Case lines are made when the case is closed.'
      : deal.status === 'partial' ? `Closed so far: ${rm(closedPart)} of ${rm(money.billed)}` : 'Case lines made when this case was closed'}>
      <div style={{ display: 'grid', gap: 4, fontSize: 13.5, marginBottom: 14 }}>
        <Row label="Agency fee (before SST)" value={rm(money.fee)} />
        {money.coBroke > 0 && <Row label={`Co-broke agency keeps ${100 - Number(setup.dealTypes.coaSharePct)}%`} value={`− ${rm(money.coBroke)}`} muted />}
        {money.referral > 0 && <Row label={`Referral fee ${setup.dealTypes.referralPct}%`} value={`− ${rm(money.referral)}`} muted />}
        <Row label="Net commission to share" value={rm(money.net)} strong />
      </div>
      {recs.project && (recs.project.payout?.mode || 'setup') !== 'setup' && (
        <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 12px', lineHeight: 1.45 }}>
          {recs.project.name} pays by its own rule: {describePayout(recs.project).toLowerCase()}.
        </p>
      )}
      {rules.rulesUntil && (
        <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 12px', lineHeight: 1.45 }}>
          Paid on the payout rules for E-Forms dated before {date(rules.rulesUntil)}: this one is dated {date(deal.date)}, so later changes to tiers and splits don’t apply to it.
        </p>
      )}
      <div style={{ display: 'flex', gap: 2, height: 14, borderRadius: 4, overflow: 'hidden', marginBottom: 16 }} role="img" aria-label="Share of the fee">
        {segs.map(s => <div key={s.key} title={`${s.label}: ${rm(s.amount)}`} style={{ flex: `${s.amount} 0 0`, background: s.color, minWidth: 2 }} />)}
      </div>

      {sides.map(s => {
        const earnerName = m.staffName(s.staffId)
        // Upline levels nobody (still working here) holds on this side: their share stayed with the company.
        const missing = s.totalPct != null ? rules.roles.filter(r => !s.lines.some(l => l.role === r.code)).map(r => r.code) : []
        return (
          <div key={s.side} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
              <b style={{ fontSize: 13.5 }}>{sides.length > 1 ? (s.side === 'sales' ? 'Marketing side' : 'Product side') : 'Both sides'}</b>
              <span style={{ fontSize: 12.5, color: C.muted, flex: 1 }}>
                {sides.length > 1 ? `${s.pct}% · ` : ''}{rm(s.base)} · {s.retracted
                  ? `${s.staffId == null ? 'no listing holder on this E-Form' : `${earnerName} has left`}: this portion goes back to the company`
                  : `${earnerName} on ${tierName(s.staffId, s.tierId)}`}
                {s.totalPct != null && s.lines.length > 1 ? ` · total payout ${s.totalPct}%` : ''}
              </span>
            </div>
            {s.lines.map(l => (
              <div key={`${l.staffId}-${l.role}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
                <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: l.role ? roleColor(l.role) : AGENT_COLOR }} aria-hidden />
                <span style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <Who name={m.staffName(l.staffId)} to={`staff/${l.staffId}`} size={26} sub={m.commType({ ...l, side: s.side })} />
                </span>
                <span style={{ fontSize: 12.5, color: C.muted, ...tabular }}>{pct(l.pct)}</span>
                <b style={{ minWidth: 92, textAlign: 'right', ...tabular }}>{rm(l.amount)}</b>
                {!s.preview && <span style={{ minWidth: 92, textAlign: 'right' }}><LineStatus statuses={l.statuses} /></span>}
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', color: C.muted, fontSize: 13 }}>
              <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: COMPANY_COLOR }} aria-hidden />
              <span style={{ flex: 1 }}>Company keeps
                {missing.length > 0 && <span style={{ display: 'block', fontSize: 12 }}>Includes the {missing.join(', ')} share{missing.length > 1 ? 's' : ''}: nobody at that level on this deal</span>}
              </span>
              <span style={tabular}>{pct(r2(s.company / (s.base || 1) * 100))}</span>
              <span style={{ minWidth: 92, textAlign: 'right', ...tabular }}>{rm(s.company)}</span>
              {!s.preview && <span style={{ minWidth: 92 }} />}
            </div>
          </div>
        )
      })}
      <p style={{ fontSize: 12.5, color: C.muted, margin: '4px 0 0', lineHeight: 1.45 }}>
        SST of {rm(money.sst)} {deal.sstMode === 'included' ? 'is inside the fee' : 'is added on top'} and goes to LHDN, not to anyone on the deal.
        {Number(setup.dealTypes.whtPct) > 0 && ` Withholding tax of ${setup.dealTypes.whtPct}% comes off each person’s payslip.`}
      </p>
    </Card>
  )
}

function LineStatus({ statuses }) {
  const order = ['queried', 'new', 'approved', 'paid']
  const s = order.find(x => statuses.has(x)) || 'paid'
  return <Status of={PAYOUT_STATUS} value={s} />
}

function Row({ label, value, strong, muted }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: muted ? C.muted : C.text, fontWeight: strong ? 700 : 400,
      borderTop: strong ? `1px solid ${C.border}` : 'none', paddingTop: strong ? 6 : 0 }}>
      <span>{label}</span><span style={tabular}>{value}</span>
    </div>
  )
}

// list: the E-Form's payments, oldest first (useList).
function MoneyInCard({ deal, list: payments }) {
  const list = payments.rows
  const cleared = deal.$.cleared
  if (deal.status === 'draft') return null
  return (
    <Card title="Money in" help={CARD.dealMoneyIn} sub={`${rm(cleared)} clear · ${rm(deal.money.billed)} is the claim from owner (commission + SST)`}
      actions={<Link to={`money-in/new/${deal.id}`} style={{ fontSize: 13 }}>Add Transaction</Link>}>
      {!list.length ? <Empty title="No transactions yet" text="Payments show here once they are added." /> : list.map(t => (
        <div key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 200px', minWidth: 0 }}>
            <b style={{ fontSize: 13.5 }}><span style={mono}>{t.code}</span> · {PURPOSES[t.purpose]}</b>
            <span style={{ display: 'block', fontSize: 12.5, color: C.muted }}>{date(t.date)} · {METHODS[t.method]} · {t.payer}</span>
            {t.reason && <span style={{ display: 'block', fontSize: 12.5, color: C.err }}>{t.reason}</span>}
          </span>
          <b style={tabular}>{rm(t.amount)}</b>
          <Status of={MONEY_IN_STATUS} value={t.status} />
        </div>
      ))}
      {payments.rows.length < payments.total && <button style={{ ...small, marginTop: 10 }} disabled={payments.loading} onClick={payments.more}>Show more</button>}
      {cleared > deal.money.billed && (
        <p style={{ fontSize: 12.5, color: C.muted, margin: '10px 0 0' }}>{rm(cleared - deal.money.billed)} above the commission is client money and goes back out to the {PARTY[deal.type].owner.toLowerCase()}.</p>
      )}
    </Card>
  )
}

function MoneyOutCard({ list: outs }) {
  const list = outs.rows
  if (!list.length) return null
  return (
    <Card title="Payments out" help={CARD.dealMoneyOut} actions={<Link to="money-out" style={{ fontSize: 13 }}>All payments out</Link>}>
      {list.map(x => (
        <div key={x.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 200px', minWidth: 0 }}>
            <b style={{ fontSize: 13.5 }}>{MONEY_OUT_TYPES[x.type]}</b>
            <span style={{ display: 'block', fontSize: 12.5, color: C.muted }}><span style={mono}>{x.voucherNo}</span> · to {x.payee.name}</span>
          </span>
          <b style={tabular}>{rm(x.amount)}</b>
          <Status of={MONEY_OUT_STATUS} value={x.status} />
        </div>
      ))}
    </Card>
  )
}

function PartyCard({ title, p, others = [], help }) {
  return (
    <Card title={title} help={help}>
      <KV min={160} items={[['Name', p.name], ['NRIC No', p.ic ? maskIc(p.ic) : '—'], ['Tel', p.phone || '—'], p.email && ['Fax / E-mail', p.email], p.address && ['Address', p.address]]} />
      {others.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${C.border}`, display: 'grid', gap: 4 }}>
          {others.map((o, i) => <span key={i} style={{ fontSize: 13.5 }}>Other {title.toLowerCase().split(' / ')[0]} {i + 1}: <b>{o.name}</b> <span style={{ color: C.muted }}>{maskIc(o.ic)}</span></span>)}
        </div>
      )}
    </Card>
  )
}

// Supporting Document Attachments: each one can be uploaded (or replaced) here.
function Docs({ deal }) {
  const erp = useErp()
  const can = useCan()
  const fb = useFeedback()
  const [upload, setUpload] = useState(null)
  const [file, setFile] = useState('')
  const docs = Object.entries(deal.docs)
  const missing = docs.filter(([, ok]) => !ok).length
  const open = name => { setFile(''); setUpload(name) }
  const save = async () => { if (await fb.run(() => erp.setDealDoc(deal.id, upload, file), `${upload} uploaded`)) setUpload(null) }
  return (
    <Card title="Supporting Document Attachments" help={CARD.docs} sub={missing ? `${missing} must be uploaded to close the case` : 'Everything is uploaded'}>
      <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))' }}>
        {docs.map(([name, ok]) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, padding: '6px 8px', borderRadius: 6, background: ok ? C.bg : C.warnBg, minWidth: 0 }}>
            <span style={{ color: ok ? C.ok : C.warn, display: 'inline-flex' }}><Icon name={ok ? 'check' : 'file'} size={16} /></span>
            <span style={{ flex: 1, minWidth: 0 }}>{name}{deal.files?.[name] && <span style={{ display: 'block', fontSize: 11.5, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deal.files[name]}</span>}</span>
            {deal.status !== 'cancelled' && can('deals', 'edit') && <button style={{ ...small, fontSize: 12, padding: '3px 8px' }} onClick={() => open(name)}>{ok ? 'Replace' : 'Upload'}</button>}
          </div>
        ))}
      </div>
      <Modal open={!!upload} onClose={() => setUpload(null)} title={`Upload ${upload || ''} · ${deal.code}`}
        footer={<><button style={btn} onClick={() => setUpload(null)}>Cancel</button><button style={{ ...btnPrimary, opacity: file ? 1 : 0.5 }} disabled={!file} onClick={save}>Upload</button></>}>
        <FormField label={upload}><FileInput kind="document" onChange={files => setFile(files[0]?.name || '')} /></FormField>
      </Modal>
    </Card>
  )
}

// Each close of this case, with its case lines: Re-run (Make Close Case Rerun) or delete them.
function Closes({ deal, closes, lines: all }) {
  const erp = useErp()
  const can = useCan()
  const fb = useFeedback()
  if (!closes.length) return null
  const rerun = async c => {
    const ok = await fb.confirm({ title: `Re-run ${closeType(c)} of ${rm(c.claim)}?`, confirmLabel: 'Confirm Re-Run',
      body: 'Works the case lines out again on everyone’s tier and upline today, for example after a rank or upline change. The lines go back to New for approval.' })
    if (ok) await fb.run(() => erp.rerunClose(c.id), `${deal.code}: case lines re-run`)
  }
  const remove = async c => {
    const ok = await fb.confirm({ title: `Delete the case lines of this ${closeType(c)}?`, danger: true, confirmLabel: 'Delete',
      body: <>The {rm(c.claim)} close is undone and the case goes back to {closes.length > 1 ? 'Closed Partial' : 'Submitted'}. It can be closed again.</> })
    if (ok) await fb.run(() => erp.deleteClose(c.id), `${deal.code}: close deleted`)
  }
  return (
    <Card title="Closes" help={CARD.closes}>
      {closes.map((c, i) => {
        const lines = all.filter(l => l.closeId === c.id)
        const locked = lines.some(l => l.requestId || l.archiveId || l.status === 'paid')
        const last = i === closes.length - 1
        return (
          <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 200px', minWidth: 0 }}>
              <b style={{ fontSize: 13.5 }}>{closeType(c)} · {rm(c.claim)}</b>
              <span style={{ display: 'block', fontSize: 12.5, color: C.muted }}>{date(c.date)} · {lines.length} case lines · {locked ? 'requested for salary' : 'not requested yet'}</span>
            </span>
            {can('payouts', 'full') && <>
              <button style={small} disabled={locked} title={locked ? 'Already requested for salary' : undefined} onClick={() => rerun(c)}>Re-run</button>
              <button style={{ ...small, color: C.err }} disabled={locked || !last} title={locked ? 'Already requested for salary' : !last ? 'Delete the later close first' : undefined} onClick={() => remove(c)}>Delete</button>
            </>}
          </div>
        )
      })}
    </Card>
  )
}

function Timeline({ deal, m, recs }) {
  const ev = []
  const add = (d, text, tone = C.muted) => d && ev.push({ d, text, tone })
  add(deal.date, deal.type === 'project' ? 'Booking signed' : 'Letter of offer signed (E-Form date)', C.text)
  add(deal.submittedOn, <>E-Form submitted by <b>{m.staffName(deal.agentId)}</b></>)
  for (const t of recs.payments.rows) {
    add(t.date, <>{t.code}: {rm(t.amount)} from {t.payer} ({PURPOSES[t.purpose]})</>)
    if (t.status === 'returned') add(t.clearsOn, <span style={{ color: C.err }}>Cheque returned by the bank</span>)
  }
  for (const c of recs.closes) add(c.date, <>{closeType(c)} of {rm(c.claim)}</>, C.ok)
  const lines = recs.lines
  const approvals = [...new Map(lines.filter(l => l.approvedOn).map(l => [`${l.closeId}`, l])).values()]
  for (const l of approvals) add(l.approvedOn, <>Case lines made Ready by {l.approvedBy.join(' and ')}</>)
  const paid = [...new Map(lines.filter(l => l.paidOn).map(l => [l.paidOn, l])).values()]
  for (const l of paid) add(l.paidOn, <>Salary paid (Payment Clear) for this case</>)
  const arc = lines.find(l => l.$.archive)?.$.archive
  if (arc) add(arc.date, <>Archived in <Link to="payouts/archived">{arc.code}</Link></>)
  for (const x of recs.outs.rows) if (x.paidOn) add(x.paidOn, <>{MONEY_OUT_TYPES[x.type]} of {rm(x.amount)} paid to {x.payee.name}</>)
  add(deal.cancelledOn, <span style={{ color: C.err }}>Abort/Cancel: {deal.cancelReason}</span>)
  ev.sort((a, b) => b.d.localeCompare(a.d))
  return (
    <Card title="Activity" help={CARD.activity}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {ev.map((e, i) => (
          <li key={i} style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: i === ev.length - 1 ? 0 : 12 }}>
            {i < ev.length - 1 && <span aria-hidden style={{ position: 'absolute', left: 4, top: 12, bottom: -2, width: 2, background: C.border }} />}
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 5, background: e.tone === C.muted ? C.border : e.tone, marginTop: 4, flexShrink: 0, position: 'relative' }} />
            <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.4 }}>{e.text}</span>
            <span style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>{date(e.d, { short: true })}</span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

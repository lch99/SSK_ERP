import { C, btn, btnPrimary } from '../styles.js'
import { useNarrow } from '../setup/useNarrow.js'
import { useErp } from './ErpContext.jsx'
import { readyToClose, sum } from './model.js'
import { go, tabular } from './ui.jsx'
import { rm, date } from './format.js'
import Icon from './Icon.jsx'

// A deal's money goes through five pages in a row. These show the chain, so
// nobody has to know which menu holds the next step:
//   1 Clear payments → 2 Close cases → 3 Approve payouts → 4 Request pay → 5 Pay out

// What waits at each step, and where it is done.
export function flowSteps(m, d, setup) {
  const waiting = d.payouts.filter(p => !p.archiveId && (p.status === 'new' || p.status === 'queried'))
  const ready = d.payouts.filter(p => p.status === 'approved' && !p.requestId)
  return [
    { key: 'clear', label: 'Clear payments', short: 'Clear', unit: ['payment', 'payments'], to: 'money-in', what: 'Check money in against the bank, then set it Clear',
      n: d.moneyIn.filter(t => t.status === 'pending' || t.status === 'draft').length },
    { key: 'close', label: 'Close cases', short: 'Close', unit: ['deal', 'deals'], to: 'deals/ready', what: 'Deals whose cash has cleared: Request Close Case',
      n: d.deals.filter(x => readyToClose(x, m, setup) > 0).length },
    { key: 'approve', label: 'Approve payouts', short: 'Approve', unit: ['case', 'cases'], to: 'payouts', what: 'Check who each closed case pays, then Set Ready',
      n: new Set(waiting.map(p => p.closeId)).size },
    { key: 'request', label: 'Request pay', short: 'Request', unit: ['person', 'people'], to: ready.some(p => !p.role) || !ready.length ? 'salary/request' : 'salary/incentives',
      what: 'Put Ready lines into salary and incentive requests', n: new Set(ready.map(p => p.staffId)).size },
    { key: 'pay', label: 'Pay out', short: 'Pay', unit: ['request', 'requests'], to: 'salary', what: 'Pay on the pay day, then Payment Clear',
      n: d.requests.filter(r => r.status === 'new' || r.status === 'ready').length },
  ]
}

// The five steps in a row, each with what is waiting. `here` marks this page's step.
export function FlowBar({ here }) {
  const { m, scoped: d, setup } = useErp()
  const [ref, narrow] = useNarrow(600)
  const steps = flowSteps(m, d, setup)
  // Phones: five small tiles in one row, so the flow never takes over the screen.
  if (narrow) {
    return (
      <nav ref={ref} aria-label="Commission flow" style={{ marginBottom: 14 }}>
        <ol style={{ listStyle: 'none', margin: 0, padding: 4, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: C.shadow }}>
          {steps.map((s, i) => {
            const on = s.key === here, busy = s.n > 0
            return (
              <li key={s.key} style={{ minWidth: 0, display: 'grid' }}>
                <button onClick={() => go(s.to)} aria-current={on ? 'step' : undefined} aria-label={`${i + 1}. ${s.label}: ${busy ? `${s.n} waiting` : 'nothing waiting'}`}
                  style={{ minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '7px 2px 6px', border: 'none', borderRadius: 9, cursor: 'pointer', fontFamily: C.font,
                    background: on ? C.primaryBg : 'transparent', color: on ? C.primaryDark : C.text }}>
                  <span style={{ minWidth: 24, height: 24, padding: '0 6px', borderRadius: 12, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, boxSizing: 'border-box',
                    background: busy ? (on ? C.primary : C.warnBg) : C.okBg, color: busy ? (on ? '#fff' : C.warn) : C.ok, ...tabular }}>
                    {busy ? s.n : <Icon name="check" size={13} stroke={2.6} />}
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: on ? 700 : 600, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{s.short}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>
    )
  }
  return (
    <nav ref={ref} aria-label="Commission flow" style={{ marginBottom: 16 }}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(min(168px, 100%), 1fr))' }}>
        {steps.map((s, i) => {
          const on = s.key === here
          const busy = s.n > 0
          return (
            <li key={s.key} style={{ minWidth: 0, display: 'grid' }}>
              <button onClick={() => go(s.to)} aria-current={on ? 'step' : undefined} title={s.what} className={on ? undefined : 'ssk-lift'}
                style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', fontFamily: C.font, cursor: 'pointer', padding: '9px 12px',
                  borderRadius: 10, border: `1px solid ${on ? '#f7a3b8' : C.border}`, background: on ? C.primaryBg : '#fff', color: C.text, boxShadow: on ? 'none' : C.shadow }}>
                <span style={{ width: 26, height: 26, borderRadius: 13, flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 700,
                  background: busy ? (on ? C.primary : C.warnBg) : C.okBg, color: busy ? (on ? '#fff' : C.warn) : C.ok }}>
                  {busy ? i + 1 : <Icon name="check" size={14} stroke={2.6} />}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 650, lineHeight: 1.25, color: on ? C.primaryDark : C.text }}>{s.label}</span>
                  <span style={{ display: 'block', fontSize: 12, color: busy ? C.warn : C.muted, fontWeight: busy ? 600 : 400, ...tabular }}>
                    {busy ? `${s.n} ${s.n === 1 ? s.unit[0] : s.unit[1]} waiting` : 'Nothing waiting'}
                  </span>
                </span>
                {i < steps.length - 1 && <Icon name="chevron" size={14} style={{ color: C.faint }} />}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// One deal from submitted to paid, and the one thing to do next.
export function DealProgress({ deal, onClose, busy }) {
  const { m, setup } = useErp()
  const [ref, narrow] = useNarrow(720)
  const billed = deal.money.billed
  const got = Math.min(m.cleared(deal.id), billed)
  const closed = sum(m.closesByDeal[deal.id] || [], c => c.claim)
  const toClose = readyToClose(deal, m, setup)
  const lines = (m.payoutsByDeal[deal.id] || [])
  const approved = lines.filter(l => l.status === 'approved' || l.status === 'paid')
  const requested = lines.filter(l => l.requestId)
  const paid = lines.filter(l => l.status === 'paid')
  const pending = (m.moneyInByDeal[deal.id] || []).find(t => t.status === 'pending' || t.status === 'draft')
  const draft = deal.status === 'draft'

  const steps = [
    { label: 'Submitted', done: !draft, sub: draft ? 'Draft, not submitted' : date(deal.submittedOn || deal.date) },
    { label: 'Payment cleared', done: got >= billed, sub: `${rm(got)} of ${rm(billed)}` },
    { label: 'Case closed', done: deal.status === 'closed', sub: closed ? `${rm(closed)} closed` : 'Not yet' },
    { label: 'Payouts approved', done: lines.length > 0 && approved.length === lines.length, sub: lines.length ? `${approved.length} of ${lines.length} lines` : 'After closing' },
    { label: 'Paid', done: lines.length > 0 && paid.length === lines.length && deal.status === 'closed', sub: lines.length ? `${rm(sum(paid, l => l.amount))} of ${rm(sum(lines, l => l.amount))}` : 'After approval' },
  ]
  const at = steps.findIndex(s => !s.done)

  // The next step: one button, worded as the thing to do.
  const next = draft ? { text: 'Waiting for the agent to submit this E-Form.' }
    : toClose > 0 ? { text: <>{rm(toClose)} of cleared cash can be closed now. Closing makes the payout lines for approval.</>, label: `Request Close Case · ${rm(toClose)}`, primary: true, onClick: () => onClose(toClose) }
    : got < billed && pending ? { text: <>{pending.code} ({rm(pending.amount)}) is waiting to be checked against the bank.</>, label: 'Clear the payment', onClick: () => go(`money-in/${pending.id}`) }
    : got < billed ? { text: <>{rm(billed - got)} still to come in from the {deal.type === 'rental' ? 'landlord' : 'owner'}.</>, label: 'Record a payment', onClick: () => go(`money-in/new/${deal.id}`) }
    : approved.length < lines.length ? { text: `${lines.length - approved.length} payout lines are waiting for approval.`, label: 'Approve payouts', onClick: () => go('payouts') }
    : requested.length < lines.length ? { text: `${lines.length - requested.length} Ready lines are not in a salary or incentive request yet.`, label: 'Request pay', onClick: () => go('salary/request') }
    : paid.length < lines.length ? { text: `${lines.length - paid.length} lines are requested and wait for the pay day.`, label: 'Open pay requests', onClick: () => go('salary') }
    : { text: 'Everyone on this case is paid.', done: true }

  return (
    <section ref={ref} aria-label="Progress" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: C.shadow, padding: '16px 18px', marginBottom: 16 }}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: narrow ? '1fr' : `repeat(${steps.length}, 1fr)`, gap: narrow ? 10 : 0 }}>
        {steps.map((s, i) => {
          const now = i === at
          const tone = s.done ? C.ok : now ? C.primary : C.faint
          return (
            <li key={s.label} style={{ position: 'relative', display: 'flex', flexDirection: narrow ? 'row' : 'column', alignItems: narrow ? 'center' : 'flex-start', gap: narrow ? 10 : 8, minWidth: 0, paddingRight: narrow ? 0 : 10 }}>
              {!narrow && i < steps.length - 1 && <span aria-hidden style={{ position: 'absolute', top: 13, left: 30, right: 4, height: 2, borderRadius: 1, background: s.done ? C.ok : C.border }} />}
              <span style={{ position: 'relative', width: 28, height: 28, borderRadius: 14, display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 12.5, fontWeight: 700,
                background: s.done ? C.okBg : now ? C.primary : C.grayBg, color: s.done ? C.ok : now ? '#fff' : C.muted, boxShadow: now ? `0 0 0 4px ${C.primaryBg}` : 'none' }}>
                {s.done ? <Icon name="check" size={15} stroke={2.6} /> : i + 1}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 650, color: s.done || now ? C.text : C.muted }}>{s.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: now ? tone : C.muted, fontWeight: now ? 600 : 400, ...tabular }}>{s.sub}</span>
              </span>
            </li>
          )
        })}
      </ol>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14, padding: '10px 12px', borderRadius: 10,
        background: next.done ? C.okBg : '#f9fafb', border: `1px solid ${next.done ? 'transparent' : C.border}` }}>
        <span style={{ display: 'inline-flex', color: next.done ? C.ok : C.primary }}><Icon name={next.done ? 'check' : 'chevron'} size={17} stroke={2.4} /></span>
        <span style={{ flex: '1 1 260px', minWidth: 0, fontSize: 13.5, color: next.done ? C.ok : C.text, fontWeight: next.done ? 600 : 400 }}>
          {!next.done && <b style={{ marginRight: 6 }}>Next:</b>}{next.text}
        </span>
        {next.label && <button style={{ ...(next.primary ? btnPrimary : btn), opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={next.onClick}>{next.label}</button>}
      </div>
    </section>
  )
}

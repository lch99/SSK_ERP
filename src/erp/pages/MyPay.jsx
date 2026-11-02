import { useState } from 'react'
import * as P from '../../../shared/payout.js'
import { C, btn, btnPrimary } from '../../styles.js'
import { nextPayDate } from '../../demo/erpSample.js'
import { useErp } from '../ErpContext.jsx'
import { useList } from '../useList.js'
import { useAccess, useCan } from '../access.jsx'
import { useFeedback } from '../feedback.jsx'
import { PAYOUT_STATUS, REQUEST_STATUS, sum } from '../model.js'
import { Page, Card, DataTable, Stat, Empty, Status, Link, cols, go, mono } from '../ui.jsx'
import { PAGE, CARD } from '../help.js'
import { rm, date } from '../format.js'

// ── My commission (#/my-pay): an agent's own payout lines. Ready lines are
// either claimed (a pay request for the next pay day) or stacked, kept aside
// until the agent claims them. Rules in shared/erpActions.js (claimPay, stackPay).
export default function MyPay() {
  const { m } = useErp()
  const access = useAccess()
  const me = m.staff[access.agentId]
  if (!me) {
    return (
      <Page title="My commission" help={PAGE.myPay}>
        <Card><Empty icon="wallet" title="For agents" text="This page shows an agent's own commission. To see it, view the ERP as an agent (System → Roles & access)."
          action={access.manages && <button style={btnPrimary} onClick={() => go('access/staff')}>View the ERP as an agent</button>} /></Card>
      </Page>
    )
  }
  return <Wallet me={me} />
}

// Ready lines not requested yet; stacked or not.
const OPEN = { status: 'approved', requested: 'false', archived: 'false' }
const none = { n: 0, sum: 0, distinct: 0 }
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`
// Each read is the agent's own, whatever branch the top bar shows; `paged` for its DataTable.
const paging = (list, sort) => ({ total: list.total, sort, onSort: () => {}, onMore: list.more, loading: list.loading })

function Wallet({ me }) {
  const erp = useErp()
  const { m, setup } = erp
  const can = useCan()
  const fb = useFeedback()
  const own = { staffId: me.id }
  const ready = useList('payouts', { ...own, ...OPEN, stacked: 'false', sort: '-date', counts: 'lines' }, { branch: false, pageSize: 50 })
  const stacked = useList('payouts', { ...own, ...OPEN, stacked: 'true', sort: 'stackedOn', counts: 'lines' }, { branch: false, pageSize: 50 })
  const checking = useList('payouts', { ...own, status: 'new,queried', sort: '-date', counts: 'lines' }, { branch: false, pageSize: 20 })
  const requests = useList('requests', { ...own, sort: '-date', counts: 'paidThisYear' }, { branch: false, pageSize: 8 })
  // Claimed and not paid yet, the soonest pay day first.
  const waiting = useList('requests', { ...own, status: 'new,ready', sort: 'payOn', counts: 'unpaid' }, { branch: false, pageSize: 1 })
  // Lines left unticked; everything else is ticked, so new lines start ticked.
  const [offReady, setOffReady] = useState(() => new Set())
  const [offStacked, setOffStacked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)

  const whtPct = setup.dealTypes.whtPct
  const payOn = nextPayDate(setup.approvals, m.today)
  const mayAct = can('salary', 'edit')
  const net = lines => P.payslipTotals(lines.map(l => l.amount), whtPct, me.whtExempt)
  const netOf = r => P.payslipTotals([r.$.gross], whtPct, r.$.staff?.whtExempt ?? me.whtExempt).net
  const r = { ready: ready.counts.lines || none, stacked: stacked.counts.lines || none, checking: checking.counts.lines || none }
  const unpaid = waiting.counts.unpaid || { n: 0, net: 0 }
  const paidYear = requests.counts.paidThisYear || { n: 0, net: 0 }
  const linesOf = (list, ids) => list.rows.filter(l => ids.has(l.id))
  const ticked = (list, off) => new Set(list.rows.filter(l => !off.has(l.id)).map(l => l.id))
  const untick = (list, set) => ids => set(new Set(list.rows.filter(l => !ids.has(l.id)).map(l => l.id)))
  const picked = ticked(ready, offReady), stackPicked = ticked(stacked, offStacked)

  const claim = async lines => {
    const t = net(lines)
    const ok = await fb.confirm({ title: `Get ${rm(t.gross)} paid?`, confirmLabel: 'Get paid',
      body: <>It goes to Accounts as a pay request and is paid on <b>{date(payOn)}</b>, to {me.bank || 'your bank'} {me.account ? `account ending ${String(me.account).replace(/\D/g, '').slice(-4)}` : ''}.
        {t.wht > 0 ? <> After {whtPct}% withholding tax you get <b>{rm(t.net)}</b>.</> : null}</> })
    if (!ok) return
    setBusy(true)
    await fb.run(() => erp.claimPay(me.id, lines.map(l => l.id)), `${rm(t.gross)} claimed · paid on ${date(payOn)}`)
    setBusy(false)
  }
  const stack = async lines => {
    setBusy(true)
    await fb.run(() => erp.stackPay(me.id, lines.map(l => l.id)), `${rm(sum(lines, l => l.amount))} stacked. Claim it whenever you like.`)
    setBusy(false)
  }

  const lineCols = [
    { key: 'deal', label: 'E-Form', render: l => <Link to={`deals/${l.dealId}`} style={mono}>{l.$.deal?.code}</Link> },
    { key: 'prop', label: 'Property', render: l => l.$.deal?.['property.title'] },
    { key: 'type', label: 'For', render: l => m.commType(l) },
    { key: 'date', label: 'Closed', nowrap: true, render: l => date(l.date) },
    { key: 'amount', label: 'Amount', align: 'right', render: l => <b>{rm(l.amount)}</b> },
  ]
  // Only the lines shown can be ticked; "Show more" brings the rest.
  const tick = (list, ids) => `${ids.size} of ${list.total} ticked · ${rm(sum(linesOf(list, ids), l => l.amount))}`

  return (
    <Page title="My commission" help={PAGE.myPay} sub={<>Approved commission from your closed cases. Get it paid on the next pay day ({date(payOn)}), or stack it and claim it later.</>}>
      <div style={{ ...cols(210, 14), marginBottom: 16 }}>
        <Stat icon="wallet" tone="brand" label="Ready to claim" value={rm(r.ready.sum)} sub={r.ready.n ? `${plural(r.ready.n, 'line')} · get paid or stack` : 'Nothing new'} />
        <Stat icon="payRuns" tone="blue" label="Stacked" value={rm(r.stacked.sum)}
          sub={r.stacked.n && stacked.rows[0] ? `Since ${date(stacked.rows[0].stackedOn || stacked.rows[0].approvedOn)}` : 'Nothing stacked'} />
        <Stat icon="clock" tone="amber" label="Claimed, to be paid" value={rm(unpaid.net)}
          sub={unpaid.n && waiting.rows[0] ? `${plural(unpaid.n, 'request')} · ${date(waiting.rows[0].payOn)}` : 'Nothing waiting'} />
        <Stat icon="check" tone="green" label={`Paid in ${m.year}`} value={rm(paidYear.net)} sub={`After tax · ${plural(paidYear.n, 'payment')}`} />
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        <Card title="Ready to claim" help={CARD.readyToClaim} sub={ready.total ? tick(ready, picked) : null}
          actions={ready.total > 0 && mayAct && <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={btn} disabled={busy || !picked.size} onClick={() => stack(linesOf(ready, picked))}>Stack</button>
            <button style={btnPrimary} disabled={busy || !picked.size} onClick={() => claim(linesOf(ready, picked))}>Get paid on {date(payOn, { short: true })}</button>
          </span>}>
          {ready.total
            ? <DataTable columns={lineCols} rows={ready.rows} rowKey={l => l.id} selection={mayAct ? { selected: picked, onChange: untick(ready, setOffReady) } : undefined} narrowAt={640} pageSize={50} paged={paging(ready, '-date')} />
            : <p style={{ margin: 0, fontSize: 13.5, color: C.muted }}>{ready.loading ? 'Loading…' : 'Nothing new to claim. Commission lands here once Accounts approves a closed case.'}</p>}
        </Card>

        {stacked.total > 0 && (
          <Card title="Stacked" help={CARD.stacked} sub={tick(stacked, stackPicked)}
            actions={mayAct && <button style={btnPrimary} disabled={busy || !stackPicked.size} onClick={() => claim(linesOf(stacked, stackPicked))}>
              Claim {stackPicked.size === stacked.total ? 'all' : 'ticked'} · {rm(sum(linesOf(stacked, stackPicked), l => l.amount))}</button>}>
            <DataTable columns={[...lineCols.slice(0, 4), { key: 'since', label: 'Stacked on', nowrap: true, render: l => date(l.stackedOn || l.approvedOn) }, lineCols[4]]}
              rows={stacked.rows} rowKey={l => l.id} selection={mayAct ? { selected: stackPicked, onChange: untick(stacked, setOffStacked) } : undefined} narrowAt={720} pageSize={50} paged={paging(stacked, 'stackedOn')} />
          </Card>
        )}

        {checking.total > 0 && (
          <Card title="Being checked" help={CARD.beingChecked} sub={`${rm(r.checking.sum)} from ${plural(r.checking.distinct, 'closed case')}`}>
            <DataTable rows={checking.rows} rowKey={l => l.id} narrowAt={720} pageSize={20} paged={paging(checking, '-date')} columns={[...lineCols.slice(0, 3),
              { key: 'status', label: 'Status', render: l => <span><Status of={PAYOUT_STATUS} value={l.status} />{l.query && <span style={{ display: 'block', fontSize: 12, color: C.err, marginTop: 3 }}>{l.query}</span>}</span> },
              lineCols[4]]} />
          </Card>
        )}

        <Card title="My pay requests" help={CARD.myRequests} sub={requests.total ? `${requests.total} in all` : null}>
          {requests.total
            ? <DataTable rows={requests.rows} rowKey={x => x.id} onRow={x => go(`salary/${x.id}`)} narrowAt={720} pageSize={8} paged={paging(requests, '-date')} columns={[
              { key: 'code', label: 'Salary ID', render: x => <b style={mono}>{x.code}</b> },
              { key: 'kind', label: 'Type', render: x => (x.kind === 'incentives' ? 'Incentives' : 'Salary') },
              { key: 'date', label: 'Claimed', nowrap: true, render: x => date(x.date) },
              { key: 'pay', label: 'Pay day', nowrap: true, render: x => date(x.status === 'clear' ? x.paidOn : x.payOn) },
              { key: 'status', label: 'Status', render: x => <span><Status of={REQUEST_STATUS} value={x.status} />{x.remark && <span style={{ display: 'block', fontSize: 12, color: C.err, marginTop: 3 }}>{x.remark}</span>}</span> },
              { key: 'net', label: 'Net pay', align: 'right', render: x => <b>{rm(netOf(x))}</b> },
            ]} />
            : <p style={{ margin: 0, fontSize: 13.5, color: C.muted }}>{requests.loading ? 'Loading…' : 'No pay requests yet.'}</p>}
        </Card>
      </div>
    </Page>
  )
}

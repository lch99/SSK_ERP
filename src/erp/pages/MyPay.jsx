import { useState } from 'react'
import * as P from '../../../shared/payout.js'
import { C, btn, btnPrimary } from '../../styles.js'
import { nextPayDate } from '../../demo/erpSample.js'
import { useErp } from '../ErpContext.jsx'
import { useAccess, useCan } from '../access.jsx'
import { useFeedback } from '../feedback.jsx'
import { PAYOUT_STATUS, REQUEST_STATUS, sum } from '../model.js'
import { Page, Card, DataTable, Stat, Empty, Status, Link, cols, go, mono } from '../ui.jsx'
import { PAGE, CARD } from '../help.js'
import { rm, date } from '../format.js'

// ── My commission (#/my-pay): an agent's own payout lines. Ready lines are
// either claimed (a pay request for the next pay day) or stacked, kept aside
// until the agent claims them. Rules in src/demo/erpApi.js (claimPay, stackPay).
export default function MyPay() {
  const erp = useErp()
  const { m, setup } = erp
  const access = useAccess()
  const can = useCan()
  const fb = useFeedback()
  const me = m.staff[access.agentId]
  const w = me ? m.wallet(me.id) : null
  // Lines left unticked; everything else is ticked, so new lines start ticked.
  const [offReady, setOffReady] = useState(() => new Set())
  const [offStacked, setOffStacked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)

  if (!me) {
    return (
      <Page title="My commission" help={PAGE.myPay}>
        <Card><Empty icon="wallet" title="For agents" text="This page shows an agent's own commission. To see it, view the ERP as an agent (System → Roles & access)."
          action={access.manages && <button style={btnPrimary} onClick={() => go('access/staff')}>View the ERP as an agent</button>} /></Card>
      </Page>
    )
  }

  const whtPct = setup.dealTypes.whtPct
  const payOn = nextPayDate(setup.approvals, m.today)
  const mayAct = can('salary', 'edit')
  const net = lines => P.payslipTotals(lines.map(l => l.amount), whtPct, me.whtExempt)
  const requests = m.data.requests.filter(r => r.staffId === me.id).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  const waiting = requests.filter(r => r.status === 'new' || r.status === 'ready')
  const paidYear = requests.filter(r => r.status === 'clear' && r.paidOn?.startsWith(m.year))
  const linesOf = (list, ids) => list.filter(l => ids.has(l.id))
  const ticked = (list, off) => new Set(list.filter(l => !off.has(l.id)).map(l => l.id))
  const untick = (list, set) => ids => set(new Set(list.filter(l => !ids.has(l.id)).map(l => l.id)))
  const picked = ticked(w.ready, offReady), stackPicked = ticked(w.stacked, offStacked)

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
    { key: 'deal', label: 'E-Form', sort: l => m.deals[l.dealId].code, render: l => <Link to={`deals/${l.dealId}`} style={mono}>{m.deals[l.dealId].code}</Link> },
    { key: 'prop', label: 'Property', render: l => m.deals[l.dealId].property.title },
    { key: 'type', label: 'For', render: l => m.commType(l) },
    { key: 'date', label: 'Closed', nowrap: true, sort: l => l.date, render: l => date(l.date) },
    { key: 'amount', label: 'Amount', align: 'right', sort: l => l.amount, render: l => <b>{rm(l.amount)}</b> },
  ]
  const tick = (list, ids) => `${ids.size} of ${list.length} ticked · ${rm(sum(linesOf(list, ids), l => l.amount))}`

  return (
    <Page title="My commission" help={PAGE.myPay} sub={<>Approved commission from your closed cases. Get it paid on the next pay day ({date(payOn)}), or stack it and claim it later.</>}>
      <div style={{ ...cols(210, 14), marginBottom: 16 }}>
        <Stat icon="wallet" tone="brand" label="Ready to claim" value={rm(sum(w.ready, l => l.amount))} sub={w.ready.length ? `${w.ready.length} line${w.ready.length === 1 ? '' : 's'} · get paid or stack` : 'Nothing new'} />
        <Stat icon="payRuns" tone="blue" label="Stacked" value={rm(sum(w.stacked, l => l.amount))}
          sub={w.stacked.length ? `Since ${date(w.stacked.map(l => l.stackedOn || l.approvedOn).sort()[0])}` : 'Nothing stacked'} />
        <Stat icon="clock" tone="amber" label="Claimed, to be paid" value={rm(sum(waiting, r => m.slip(r.id).net))}
          sub={waiting.length ? `${waiting.length} request${waiting.length === 1 ? '' : 's'} · ${date(waiting.map(r => r.payOn).sort()[0])}` : 'Nothing waiting'} />
        <Stat icon="check" tone="green" label={`Paid in ${m.year}`} value={rm(sum(paidYear, r => m.slip(r.id).net))} sub={`After tax · ${paidYear.length} payment${paidYear.length === 1 ? '' : 's'}`} />
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        <Card title="Ready to claim" help={CARD.readyToClaim} sub={w.ready.length ? tick(w.ready, picked) : null}
          actions={w.ready.length > 0 && mayAct && <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={btn} disabled={busy || !picked.size} onClick={() => stack(linesOf(w.ready, picked))}>Stack</button>
            <button style={btnPrimary} disabled={busy || !picked.size} onClick={() => claim(linesOf(w.ready, picked))}>Get paid on {date(payOn, { short: true })}</button>
          </span>}>
          {w.ready.length
            ? <DataTable columns={lineCols} rows={w.ready} rowKey={l => l.id} selection={mayAct ? { selected: picked, onChange: untick(w.ready, setOffReady) } : undefined} narrowAt={640} pageSize={10} defaultSort={{ key: 'date', dir: 'desc' }} />
            : <p style={{ margin: 0, fontSize: 13.5, color: C.muted }}>Nothing new to claim. Commission lands here once Accounts approves a closed case.</p>}
        </Card>

        {w.stacked.length > 0 && (
          <Card title="Stacked" help={CARD.stacked} sub={tick(w.stacked, stackPicked)}
            actions={mayAct && <button style={btnPrimary} disabled={busy || !stackPicked.size} onClick={() => claim(linesOf(w.stacked, stackPicked))}>
              Claim {stackPicked.size === w.stacked.length ? 'all' : 'ticked'} · {rm(sum(linesOf(w.stacked, stackPicked), l => l.amount))}</button>}>
            <DataTable columns={[...lineCols.slice(0, 4), { key: 'since', label: 'Stacked on', nowrap: true, render: l => date(l.stackedOn || l.approvedOn) }, lineCols[4]]}
              rows={w.stacked} rowKey={l => l.id} selection={mayAct ? { selected: stackPicked, onChange: untick(w.stacked, setOffStacked) } : undefined} narrowAt={720} pageSize={10} defaultSort={{ key: 'date', dir: 'desc' }} />
          </Card>
        )}

        {w.checking.length > 0 && (
          <Card title="Being checked" help={CARD.beingChecked} sub={`${rm(sum(w.checking, l => l.amount))} from ${new Set(w.checking.map(l => l.closeId)).size} closed case${new Set(w.checking.map(l => l.closeId)).size === 1 ? '' : 's'}`}>
            <DataTable rows={w.checking} rowKey={l => l.id} narrowAt={720} pageSize={10} columns={[...lineCols.slice(0, 3),
              { key: 'status', label: 'Status', render: l => <span><Status of={PAYOUT_STATUS} value={l.status} />{l.query && <span style={{ display: 'block', fontSize: 12, color: C.err, marginTop: 3 }}>{l.query}</span>}</span> },
              lineCols[4]]} />
          </Card>
        )}

        <Card title="My pay requests" help={CARD.myRequests} sub={requests.length ? `${requests.length} in all` : null}>
          {requests.length
            ? <DataTable rows={requests} rowKey={r => r.id} onRow={r => go(`salary/${r.id}`)} narrowAt={720} pageSize={8} columns={[
              { key: 'code', label: 'Salary ID', render: r => <b style={mono}>{r.code}</b> },
              { key: 'kind', label: 'Type', render: r => (r.kind === 'incentives' ? 'Incentives' : 'Salary') },
              { key: 'date', label: 'Claimed', nowrap: true, render: r => date(r.date) },
              { key: 'pay', label: 'Pay day', nowrap: true, render: r => date(r.status === 'clear' ? r.paidOn : r.payOn) },
              { key: 'status', label: 'Status', render: r => <span><Status of={REQUEST_STATUS} value={r.status} />{r.remark && <span style={{ display: 'block', fontSize: 12, color: C.err, marginTop: 3 }}>{r.remark}</span>}</span> },
              { key: 'net', label: 'Net pay', align: 'right', render: r => <b>{rm(m.slip(r.id).net)}</b> },
            ]} />
            : <p style={{ margin: 0, fontSize: 13.5, color: C.muted }}>No pay requests yet.</p>}
        </Card>
      </div>
    </Page>
  )
}

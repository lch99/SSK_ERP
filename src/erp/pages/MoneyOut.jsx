import { useMemo, useState } from 'react'
import { C, btn, btnPrimary, inp } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { MONEY_OUT_STATUS, MONEY_OUT_TYPES, PARTY, sum } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, DataTable, Status, Link, Drawer, KV, Block, Notice, Stat, cols, go, mono, useRecordNav } from '../ui.jsx'
import { PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { rm, date, maskAcc } from '../format.js'

// Request Form: money paid out of the client account or to other parties.
const TABS = ['new', 'queried', 'ready', 'paid', 'all']

export default function MoneyOut({ parts }) {
  const erp = useErp()
  const { m, scoped: d, setup } = erp
  const [tab, setTab] = useState(() => (d.moneyOut.some(x => x.status === 'new') ? 'new' : 'all'))
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [who, setWho] = useState('')
  const open = parts[1] ? d.moneyOut.find(x => x.id === Number(parts[1])) : null

  const match = useMemo(() => {
    const words = q.trim().toLowerCase()
    return d.moneyOut.filter(x => (!type || x.type === type) && (!who || x.staffId === Number(who)) &&
      (!words || [x.voucherNo, x.payee.name, m.deals[x.dealId].code].join(' ').toLowerCase().includes(words)))
  }, [d.moneyOut, q, type, who, m])
  const rows = tab === 'all' ? match : match.filter(x => x.status === tab)
  const pending = d.moneyOut.filter(x => x.status !== 'paid')
  const ready = d.moneyOut.filter(x => x.status === 'ready')
  const people = [...new Set(d.moneyOut.map(x => x.staffId))].map(id => m.staff[id]).filter(Boolean).sort((a, b) => a.short.localeCompare(b.short))
  const { onOrder, nav } = useRecordNav(open?.id, id => `money-out/${id}`)
  const set = [type, who].filter(Boolean).length
  const clear = () => { setQ(''); setType(''); setWho('') }

  const payeeOf = x => ({ balance: PARTY[m.deals[x.dealId].type].owner, transfer: 'Stakeholder', refund: PARTY[m.deals[x.dealId].type].buyer, cobroke: 'Co-bro agency', referral: 'Introducer', ta: 'Solicitor' })[x.type]
  const columns = [
    { key: 'no', label: 'No. · Date', sort: x => x.id, render: x => <span><b style={mono}>{x.voucherNo}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{date(x.date)}</span></span> },
    { key: 'type', label: 'Type · Form', sort: x => x.type, render: x => <span>{MONEY_OUT_TYPES[x.type]}<span style={{ display: 'block', fontSize: 12 }}><Link to={`deals/${x.dealId}`} style={mono}>{m.deals[x.dealId].code}</Link></span></span> },
    { key: 'staff', label: 'Staff', sort: x => m.staffName(x.staffId), render: x => m.staffName(x.staffId) },
    { key: 'payee', label: 'Pay to · Bank Account', sort: x => x.payee.name, render: x => <span>{x.payee.name}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{payeeOf(x)} · {x.payee.bank} {maskAcc(x.payee.account)}</span></span> },
    { key: 'amount', label: 'Amount', align: 'right', sort: x => x.amount, render: x => <b>{rm(x.amount)}</b> },
    { key: 'paid', label: 'Payment Date', nowrap: true, sort: x => x.paidOn || '', render: x => (x.paidOn ? date(x.paidOn) : <span style={{ color: C.muted }}>—</span>) },
    { key: 'status', label: 'Status', sort: x => x.status, render: x => <Status of={MONEY_OUT_STATUS} value={x.status} /> },
  ]
  return (
    <Page title="Payments out" help={PAGE.moneyOut} sub={<>Request forms for money paid out of the clients account and to other parties. Abort Case refunds are approved by the {setup.approvals?.refundApprover === 'boss' ? 'boss' : 'branch manager'}.</>}>
      <div style={{ ...cols(220, 14), marginBottom: 16 }}>
        <Stat icon="moneyOut" tone="amber" label="Not paid yet" value={rm(sum(pending, x => x.amount))} sub={`${pending.length} request${pending.length === 1 ? '' : 's'}`} onClick={() => setTab('new')} on={tab === 'new'} />
        <Stat icon="check" tone="blue" label="Payment Ready" value={rm(sum(ready, x => x.amount))} sub={`${ready.length} request${ready.length === 1 ? '' : 's'}`} onClick={() => setTab('ready')} on={tab === 'ready'} />
      </div>
      <Card pad={16}>
        <Tabs value={tab} onChange={setTab} tabs={TABS.map(k => ({ key: k, label: k === 'all' ? 'All' : MONEY_OUT_STATUS[k].label, count: k === 'all' ? match.length : match.filter(x => x.status === k).length }))} />
        <Toolbar fold active={set} onClear={clear}>
          <SearchBox value={q} onChange={setQ} placeholder="Voucher, payee or form" />
          <Select label="Type" value={type} onChange={setType} options={[{ value: '', label: 'All six types' }, ...Object.entries(MONEY_OUT_TYPES).map(([value, label]) => ({ value, label: `${label} (${d.moneyOut.filter(x => x.type === value).length})` }))]} />
          <Select label="Staff" value={who} onChange={setWho} options={[{ value: '', label: 'Select staff profile to view' }, ...people.map(s => ({ value: String(s.id), label: `${s.short} ${s.code}` }))]} />
        </Toolbar>
        <DataTable columns={columns} rows={rows} onRow={x => go(`money-out/${x.id}`)} defaultSort={{ key: 'no', dir: 'desc' }} pageSize={20} narrowAt={900}
          empty="No request forms here" onClear={set || q ? clear : undefined} onOrder={onOrder} />
      </Card>
      <Drawer open={!!open} onClose={() => go('money-out')} title={open ? `${MONEY_OUT_TYPES[open.type]} · ${rm(open.amount)}` : ''} sub={open ? `${open.voucherNo} · to ${open.payee.name}` : ''}
        nav={nav} footer={open && <Actions key={open.id} x={open} erp={erp} next={nav?.next} />}>
        {open && (
          <>
            {open.query && <Notice tone="red"><b>Pending Queries:</b> {open.query}</Notice>}
            <Block title="Request" right={<Status of={MONEY_OUT_STATUS} value={open.status} />}>
              <KV min={170} items={[
                ['Payment voucher', <span style={mono}>{open.voucherNo}</span>], ['Date', date(open.date)], ['Amount', <b>{rm(open.amount)}</b>],
                ['Pay to', open.payee.name], ['Bank', open.payee.bank], ['Bank Account Number', open.payee.account],
                ['Method', open.method === 'cheque' ? `Cheque ${open.chequeNo}` : 'Online transfer'],
                ['Paid from', (() => { const a = m.bankAccount(open.from); return a ? `${a.bank} ${maskAcc(a.accountNo)}` : '—' })()],
                ['Requested by', m.staffName(open.staffId)], open.approvedBy && ['Approved by', open.approvedBy], open.paidOn && ['Payment Date', date(open.paidOn)],
              ]} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                <button style={btn} disabled title="Demo only">Download Letter</button>
                <button style={btn} disabled title="Demo only">{open.status === 'paid' ? 'Download Receipt' : 'Upload Receipt'}</button>
              </div>
            </Block>
            <Block title="E-Form">
              <KV min={170} items={[
                ['Form', <Link to={`deals/${open.dealId}`} style={mono}>{m.deals[open.dealId].code}</Link>],
                ['Property', m.deals[open.dealId].property.title], ['Branch', m.branchName(open.branchId)],
              ]} />
            </Block>
          </>
        )}
      </Drawer>
    </Page>
  )
}

function Actions({ x, erp, next }) {
  const fb = useFeedback()
  const [asking, setAsking] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const set = async (status, query) => {
    setBusy(true)
    const ok = await fb.run(() => erp.setMoneyOutStatus(x.id, status, query), `${x.voucherNo}: ${MONEY_OUT_STATUS[status].label}`,
      next ? { action: { label: 'Next', onClick: next } } : undefined)
    if (ok) setAsking(false)
    setBusy(false)
  }
  if (x.status === 'paid') return <span style={{ fontSize: 13, color: C.muted, flex: 1 }}>Payment Clear on {date(x.paidOn)}.</span>
  if (asking) {
    return (
      <>
        <input style={{ ...inp, flex: '1 1 220px' }} autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="Reason" />
        <button style={btn} onClick={() => setAsking(false)}>Cancel</button>
        <button style={btnPrimary} disabled={busy || !text.trim()} onClick={() => set('queried', text)}>Pending Queries</button>
      </>
    )
  }
  return (
    <>
      <button style={btn} onClick={() => setAsking(true)}>Pending Queries…</button>
      {x.status !== 'ready'
        ? <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => set('ready')}>Payment Ready</button>
        : <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => set('paid')}>Payment Clear</button>}
    </>
  )
}

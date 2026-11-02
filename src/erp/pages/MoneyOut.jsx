import { useState } from 'react'
import { C, btn, btnPrimary } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { useList, useRecord, useListDownload } from '../useList.js'
import { MONEY_OUT_STATUS, MONEY_OUT_TYPES, PARTY, isAgent } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, DataTable, Status, Link, Drawer, KV, Block, Notice, Stat, TextArea, FormField, FileInput, cols, go, mono, field, useRecordNav } from '../ui.jsx'
import { BANKS } from './options.js'
import { PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { rm, date, maskAcc } from '../format.js'
import { useCan } from '../access.jsx'

// Request Form: money paid out of the client account or to other parties. A page at a time (useList).
const TABS = ['new', 'queried', 'ready', 'paid', 'all']
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`
// Who the money goes to, by the request's type and its E-Form's type.
const payeeOf = x => ({ balance: PARTY[x.$.deal?.type]?.owner, transfer: 'Stakeholder', refund: PARTY[x.$.deal?.type]?.buyer, cobroke: 'Co-bro agency', referral: 'Introducer', ta: 'Solicitor' })[x.type]

export default function MoneyOut({ parts }) {
  const erp = useErp()
  const { m, scoped: d, setup } = erp
  const fb = useFeedback()
  const openId = Number(parts[1]) || null
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [who, setWho] = useState('')
  const [sort, setSort] = useState('-date')
  const [status, setStatus] = useState('new')
  const [chosen, setChosen] = useState(false)
  const params = { q, type, staffId: who, sort, status: status === 'all' ? '' : status }
  const list = useList('moneyOut', params)
  const saveExcel = useListDownload('moneyOut')
  const { record: open, loading: opening } = useRecord('moneyOut', openId)
  const byStatus = list.counts.status
  // New requests first, when there are any.
  if (!chosen && byStatus) { setChosen(true); if (!byStatus.new) setStatus('all') }
  const pick = k => { setChosen(true); setStatus(k) }
  const unpaid = list.counts.unpaid || { n: 0, sum: 0 }
  const ready = list.counts.ready || { n: 0, sum: 0 }
  const byType = list.counts.type || {}
  const people = d.staff.filter(s => isAgent(s) && s.status !== 'pending').sort((a, b) => a.short.localeCompare(b.short))
  const { onOrder, nav } = useRecordNav(openId, id => `money-out/${id}`)
  const set = [type, who].filter(Boolean).length
  const clear = () => { setQ(''); setType(''); setWho('') }

  const columns = [
    { key: 'no', label: 'No. · Date', sortKey: 'date', render: x => <span><b style={mono}>{x.voucherNo}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{date(x.date)}</span></span> },
    { key: 'type', label: 'Type · Form', sortKey: 'type', render: x => <span>{MONEY_OUT_TYPES[x.type]}<span style={{ display: 'block', fontSize: 12 }}><Link to={`deals/${x.dealId}`} style={mono}>{x.$.deal?.code}</Link></span></span> },
    { key: 'staff', label: 'Staff', render: x => x.$.staff?.short || x.$.staff?.name || '—' },
    { key: 'payee', label: 'Pay to · Bank Account', render: x => <span>{x.payee.name}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{payeeOf(x)} · {x.payee.bank} {maskAcc(x.payee.account)}</span></span> },
    { key: 'amount', label: 'Amount', align: 'right', sortKey: 'amount', render: x => <b>{rm(x.amount)}</b> },
    { key: 'paid', label: 'Payment Date', nowrap: true, sortKey: 'paidOn', render: x => (x.paidOn ? date(x.paidOn) : <span style={{ color: C.muted }}>—</span>) },
    { key: 'status', label: 'Status', sortKey: 'status', render: x => <Status of={MONEY_OUT_STATUS} value={x.status} /> },
  ]
  return (
    <Page title="Payments out" help={PAGE.moneyOut} sub={<>Request forms for money paid out of the clients account and to other parties. Abort Case refunds are approved by the {setup.approvals?.refundApprover === 'boss' ? 'boss' : 'branch manager'}.</>}>
      <div style={{ ...cols(220, 14), marginBottom: 16 }}>
        <Stat icon="moneyOut" tone="amber" label="Not paid yet" value={rm(unpaid.sum)} sub={plural(unpaid.n, 'request')} onClick={() => pick('new')} on={status === 'new'} />
        <Stat icon="check" tone="blue" label="Payment Ready" value={rm(ready.sum)} sub={plural(ready.n, 'request')} onClick={() => pick('ready')} on={status === 'ready'} />
      </div>
      <Card pad={16}>
        <Tabs value={status} onChange={pick} tabs={TABS.map(k => ({ key: k, label: k === 'all' ? 'All' : MONEY_OUT_STATUS[k].label,
          count: k === 'all' ? Object.values(byStatus || {}).reduce((t, n) => t + n, 0) : byStatus?.[k] || 0 }))} />
        <Toolbar fold onClear={clear}>
          <SearchBox value={q} onChange={setQ} placeholder="Voucher, payee or form" />
          <Select label="Type" value={type} onChange={setType} options={[{ value: '', label: 'All six types' }, ...Object.entries(MONEY_OUT_TYPES).map(([value, label]) => ({ value, label: `${label} (${byType[value] || 0})` }))]} />
          <Select label="Staff" value={who} onChange={setWho} options={[{ value: '', label: 'All staff' }, ...people.map(s => ({ value: String(s.id), label: `${s.short} ${s.code}` }))]} />
          <span style={{ flex: 1 }} />
          <button style={{ ...btn, fontSize: 13, padding: '5px 12px' }} disabled={!list.total} onClick={() => fb.run(() => saveExcel(params))}>Download Excel</button>
        </Toolbar>
        {list.error && <Notice tone="red">{list.error}</Notice>}
        <DataTable columns={columns} rows={list.rows} onRow={x => go(`money-out/${x.id}`)} pageSize={20} narrowAt={900}
          paged={{ total: list.total, sort, onSort: setSort, onMore: list.more, loading: list.loading }}
          empty={list.loading ? 'Loading…' : q ? `No request forms match “${q}”` : 'No request forms here'} onClear={set || q ? clear : undefined} onOrder={onOrder} />
      </Card>
      <Drawer open={openId != null} onClose={() => go('money-out')} title={open ? `${MONEY_OUT_TYPES[open.type]} · ${rm(open.amount)}` : opening ? 'Loading…' : 'Not found'} sub={open ? `${open.voucherNo} · to ${open.payee.name}` : ''}
        nav={nav} footer={open && <Actions key={open.id} x={open} erp={erp} next={nav?.next} />}>
        {!open && !opening && <Notice tone="amber">This request form was not found, or it is not one you can see.</Notice>}
        {open && (
          <>
            {open.query && <Notice tone="red"><b>Pending Queries:</b> {open.query}</Notice>}
            <Block title="Request" right={<Status of={MONEY_OUT_STATUS} value={open.status} />}>
              <KV min={170} items={[
                ['Payment voucher', <span style={mono}>{open.voucherNo}</span>], ['Date', date(open.date)], ['Amount', <b>{rm(open.amount)}</b>],
                ['Pay to', open.payee.name], ['Bank', open.payee.bank], ['Bank Account Number', open.payee.account],
                ['Method', open.method === 'cheque' ? `Cheque ${open.chequeNo}` : 'Online transfer'],
                ['Paid from', (() => { const a = m.bankAccount(open.from); return a ? `${a.bank} ${maskAcc(a.accountNo)}` : '—' })()],
                ['Requested by', open.$.staff?.short || open.$.staff?.name || '—'], open.approvedBy && ['Approved by', open.approvedBy], open.paidOn && ['Payment Date', date(open.paidOn)],
              ]} />
            </Block>
            <PaymentDetails key={open.id} x={open} erp={erp} />
            <Block title="E-Form">
              <KV min={170} items={[
                ['Form', <Link to={`deals/${open.dealId}`} style={mono}>{open.$.deal?.code}</Link>],
                ['Property', open.$.deal?.['property.title']], ['Branch', m.branchName(open.branchId)],
              ]} />
            </Block>
          </>
        )}
      </Drawer>
    </Page>
  )
}

function save(name, text, type = 'text/plain') {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type })), download: name })
  a.click()
  URL.revokeObjectURL(a.href)
}

// Payment details, saved as they change (as in the current ERP): payment date,
// cheque no., bank and account, the receipt; plus the letter and Delete.
function PaymentDetails({ x, erp }) {
  const fb = useFeedback()
  const can = useCan()
  const [f, setF] = useState({ chequeNo: x.chequeNo || '', account: x.payee.account || '' })
  const upd = (body, done) => fb.run(() => erp.updateMoneyOut(x.id, body), done)
  const paidOk = x.status === 'ready' || x.status === 'paid'
  const remove = async () => {
    if (await fb.confirm({ title: `Delete ${x.voucherNo}?`, body: `This ${MONEY_OUT_TYPES[x.type]} request of ${rm(x.amount)} is removed.`, confirmLabel: 'Delete', danger: true })
      && await fb.run(() => erp.deleteMoneyOut(x.id), `${x.voucherNo} deleted`)) go('money-out')
  }
  const grid = { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(180px, 100%), 1fr))' }
  const doc = kind => `${kind.toUpperCase()} · ${x.voucherNo}\n${MONEY_OUT_TYPES[x.type]}\nPay to: ${x.payee.name}\nBank: ${x.payee.bank} ${x.payee.account}\nAmount: ${rm(x.amount)}\nDate: ${x.paidOn || x.date}\n`
  return (
    <Block title="Payment">
      {!can('moneyOut', 'edit') ? <KV items={[['Bank', x.payee.bank || '—'], ['Bank Account Number', maskAcc(x.payee.account) || '—'], ['Receipt', x.receipt || 'Not uploaded']]} /> : <div style={grid}>
        <FormField label="Payment Date" help={paidOk ? 'Saves when you pick a date' : 'After Payment Ready'}>
          <input type="date" style={field} value={x.paidOn || ''} disabled={!paidOk} onChange={e => e.target.value && upd({ paidOn: e.target.value }, `${x.voucherNo} payment date set`)} />
        </FormField>
        <FormField label="Method"><Select block plain label="Method" value={x.method} onChange={v => upd({ method: v }, `${x.voucherNo}: ${v === 'cheque' ? 'cheque' : 'online transfer'}`)}
          options={[{ value: 'online', label: 'Online transfer' }, { value: 'cheque', label: 'Cheque' }]} /></FormField>
        {x.method === 'cheque' && <FormField label="Cheque No."><input style={field} value={f.chequeNo} onChange={e => setF({ ...f, chequeNo: e.target.value })}
          onBlur={() => f.chequeNo !== (x.chequeNo || '') && upd({ chequeNo: f.chequeNo }, 'Cheque number saved')} /></FormField>}
        <FormField label="Bank"><Select block plain label="Bank" value={x.payee.bank} onChange={v => upd({ bank: v }, 'Bank saved')} options={[...new Set([x.payee.bank, ...BANKS])].filter(Boolean).map(b => ({ value: b, label: b }))} /></FormField>
        <FormField label="Bank Account Number"><input style={field} value={f.account} onChange={e => setF({ ...f, account: e.target.value })}
          onBlur={() => f.account !== (x.payee.account || '') && upd({ account: f.account }, 'Bank account saved')} /></FormField>
        <FormField label="Receipt" help={x.receipt ? `Uploaded: ${x.receipt}` : 'Upload the bank slip once paid'}>
          <FileInput kind="document" onChange={files => files[0] && upd({ receipt: files[0].name }, 'Receipt uploaded')} />
        </FormField>
      </div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <button style={btn} onClick={() => save(`${x.voucherNo}-letter.txt`, doc('letter'))}>Download Letter{x.letter ? ` (${x.letter})` : ''}</button>
        <button style={btn} disabled={!x.receipt && x.status !== 'paid'} onClick={() => save(`${x.voucherNo}-receipt.txt`, doc('receipt'))}>Download Receipt</button>
        <span style={{ flex: 1 }} />
        {(x.status === 'new' || x.status === 'queried') && can('moneyOut', 'full') && <button style={{ ...btn, color: C.err }} onClick={remove}>Delete</button>}
      </div>
    </Block>
  )
}

function Actions({ x, erp, next }) {
  const fb = useFeedback()
  const can = useCan()
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
  if (!can('moneyOut', 'full')) return <span style={{ fontSize: 13, color: C.muted, flex: 1 }}>Waiting for Accounts to pay it.</span>
  if (asking) {
    return (
      <>
        <TextArea style={{ flex: '1 1 220px', width: 'auto' }} autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="Reason" />
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

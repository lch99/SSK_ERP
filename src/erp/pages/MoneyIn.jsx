import { useMemo, useState } from 'react'
import * as P from '../../../shared/payout.js'
import { C, btn, btnPrimary, sel } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { MONEY_IN_STATUS, PURPOSES, METHODS, CASH_METHODS, sum } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, DataTable, Status, Link, Drawer, KV, Block, Notice, Stat, FormField, FileInput, TextArea, SelectionBar, cols, go, mono, small, field, useRecordNav } from '../ui.jsx'
import { COLUMN, PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { FlowBar } from '../flow.jsx'
import { rm, date, maskAcc, lastMonths, monthName } from '../format.js'
import { localToday } from '../../demo/erpSample.js'
import { useCan } from '../access.jsx'
import { useReview, changedRows, missing, needText, markGaps } from '../review.jsx'

const r2 = n => Math.round(n * 100) / 100

// A cheque's ref is "Cheque <no.>"; cash and online transfers keep the reference as typed.
const chequeNoOf = t => (t.method === 'cheque' ? t.ref.replace(/^Cheque /, '') : '')
const referenceOf = t => (t.method !== 'cheque' && t.ref !== '—' ? t.ref : '')
const methodText = t => (t.method === 'cash' ? `Cash · ${CASH_METHODS[t.cashMethod] || ''}` : METHODS[t.method])

// The same slip recorded twice is the usual mistake: the same reference or
// cheque number, or the same amount banked in on the same day for one E-Form.
function lookalikes(all, p, skipId) {
  const ref = String(p.method === 'cheque' ? p.chequeNo : p.reference || '').trim().toLowerCase()
  return all.filter(t => t.id !== skipId && t.status !== 'invalid' && (
    (ref && (t.method === 'cheque' ? chequeNoOf(t) : referenceOf(t)).trim().toLowerCase() === ref && (t.method === 'cheque') === (p.method === 'cheque')) ||
    (t.dealId === Number(p.dealId) && Math.abs(t.amount - Number(p.amount)) < 0.005 && t.bankOn === p.bankOn)))
}
const lookalikeText = (same, m) => same.length > 0 &&
  `Looks like a payment already recorded: ${same.slice(0, 3).map(t => `${t.code} (${rm(t.amount)}, ${m.deals[t.dealId].code}, ${MONEY_IN_STATUS[t.status].label})`).join('; ')}. Check it is not the same slip.`

// Transactions: money in from buyers, tenants, owners and developers.
export default function MoneyIn({ parts }) {
  if (parts[1] === 'new') return <AddTransaction dealId={Number(parts[2]) || null} />
  if (parts[1] === 'sst') return <SstLedger />
  return <TransactionList openId={Number(parts[1]) || null} />
}

const TABS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'draft', label: 'Draft', test: t => t.status === 'draft' },
  { key: 'cleared', label: 'Clear', test: t => t.status === 'cleared' },
  { key: 'returned', label: 'Return', test: t => t.status === 'returned' },
  { key: 'pending', label: 'Pending', test: t => t.status === 'pending' },
  { key: 'invalid', label: 'Invalid', test: t => t.status === 'invalid' },
]

function TransactionList({ openId }) {
  const erp = useErp()
  const can = useCan()
  const fb = useFeedback()
  const { m, scoped: d } = erp
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const open = openId ? d.moneyIn.find(t => t.id === openId) : null
  const pickedRows = d.moneyIn.filter(t => picked.has(t.id))
  // Accounts ticks the payments found on the bank statement and clears them together.
  const clearPicked = async () => {
    if (await fb.run(() => erp.setMoneyInStatus([...picked], 'cleared'), `${picked.size} payment${picked.size === 1 ? '' : 's'} set to Clear`)) setPicked(new Set())
  }
  const ym = lastMonths(m.today, 1)[0]

  const match = useMemo(() => {
    const words = q.trim().toLowerCase()
    return d.moneyIn.filter(t => !words || [t.code, t.payer, t.ref, t.remark, m.deals[t.dealId].code, m.staffName(m.deals[t.dealId].agentId)].join(' ').toLowerCase().includes(words))
  }, [d.moneyIn, q, m])
  const rows = match.filter(TABS.find(x => x.key === tab).test)
  const toCheck = d.moneyIn.filter(t => t.status === 'pending' || t.status === 'draft')
  const month = d.moneyIn.filter(t => t.status === 'cleared' && t.clearsOn?.startsWith(ym))
  const { onOrder, nav } = useRecordNav(open?.id, id => `money-in/${id}`)

  const columns = [
    { key: 'code', label: 'ID · Date', sort: t => t.id, render: t => <span><b style={mono}>{t.code}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{date(t.date)}</span></span> },
    { key: 'staff', label: 'Staff', sort: t => m.staffName(m.deals[t.dealId].agentId), render: t => m.staffName(m.deals[t.dealId].agentId) },
    { key: 'form', label: 'Form ID', sort: t => m.deals[t.dealId].code, render: t => (
      <span><Link to={`deals/${t.dealId}`} style={mono}>{m.deals[t.dealId].code}</Link><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{m.deals[t.dealId].type === 'rental' ? 'Rental' : 'Sales'} · {t.date.slice(0, 4)}</span></span>
    ) },
    { key: 'amount', label: 'Amount', align: 'right', sort: t => t.amount, render: t => <b>{rm(t.amount)}</b> },
    { key: 'method', label: 'Method', render: t => (
      <span>{METHODS[t.method]}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{t.method === 'cash' ? `${CASH_METHODS[t.cashMethod]} · ${t.ref}` : t.ref}</span></span>
    ) },
    { key: 'purpose', label: 'Purpose · Remark', render: t => <span>{PURPOSES[t.purpose]}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{t.remark}</span></span> },
    { key: 'bank', label: 'Bank-In Date', nowrap: true, sort: t => t.bankOn, render: t => date(t.bankOn) },
    { key: 'status', label: 'Status', help: COLUMN.moneyInStatus, sort: t => t.status, render: t => <Status of={MONEY_IN_STATUS} value={t.status} /> },
  ]
  return (
    <Page title="Money in" help={PAGE.moneyIn} sub="Every payment received (transactions). Only Clear payments count as cleared cash when a case is closed."
      actions={can('moneyIn', 'edit') && <button style={btnPrimary} onClick={() => go('money-in/new')}>Record a payment</button>}>
      <FlowBar here="clear" />
      <div style={{ ...cols(220, 14), marginBottom: 16 }}>
        <Stat icon="moneyIn" tone="amber" label="Draft and Pending" value={rm(sum(toCheck, t => t.amount))} sub={`${toCheck.length} to check against the bank`} onClick={() => setTab('pending')} on={tab === 'pending'} />
        <Stat icon="check" tone="green" label={`Clear in ${monthName(ym)}`} value={rm(sum(month, t => t.amount))} sub={`${month.length} transactions`} onClick={() => setTab('cleared')} on={tab === 'cleared'} />
      </div>
      <Card pad={16}>
        <Tabs value={tab} onChange={setTab} tabs={TABS.map(x => ({ key: x.key, label: x.label, count: match.filter(x.test).length }))} />
        <Toolbar><SearchBox value={q} onChange={setQ} placeholder="ID, form, staff, payer or reference" /><span style={{ flex: 1 }} />
          <button style={{ ...btn, fontSize: 13, padding: '5px 12px' }} onClick={() => downloadCsv(`transactions-${m.today}.csv`, ['ID', 'Staff', 'Date', 'Form ID', 'Amount', 'Method', 'Cash Method', 'Purpose', 'Bank-In Date', 'Remark', 'Status', 'Reason', 'Reference'],
            rows.map(t => [t.code, m.staffName(m.deals[t.dealId].agentId), t.date, m.deals[t.dealId].code, t.amount, METHODS[t.method], t.cashMethod ? CASH_METHODS[t.cashMethod] : '', PURPOSES[t.purpose], t.bankOn, t.remark, MONEY_IN_STATUS[t.status].label, t.reason || '', t.ref]))}>Download</button>
        </Toolbar>
        <DataTable columns={columns} rows={rows} onRow={t => go(`money-in/${t.id}`)} defaultSort={{ key: 'code', dir: 'desc' }} pageSize={20} narrowAt={940}
          empty={q ? `No transactions match “${q}”` : 'No transactions here'} onClear={q ? () => setQ('') : undefined} onOrder={onOrder}
          selection={can('moneyIn', 'full') ? { selected: picked, onChange: setPicked, can: t => t.status === 'draft' || t.status === 'pending' } : null} />
        <SelectionBar count={picked.size} summary={rm(sum(pickedRows, t => t.amount))} onClear={() => setPicked(new Set())}>
          <button style={{ ...small, ...btnPrimary, fontSize: 13, padding: '5px 12px' }} onClick={clearPicked}>Set Clear</button>
        </SelectionBar>
      </Card>
      <Drawer open={!!open} onClose={() => go('money-in')} title={open ? `${open.code} · ${rm(open.amount)}` : ''} sub={open ? `${PURPOSES[open.purpose]} from ${open.payer}` : ''}
        nav={nav} footer={open && <TxActions key={open.id} t={open} erp={erp} next={nav?.next} />}>
        {open && <TxDetails t={open} m={m} />}
        {open && <TxEdit key={open.id} t={open} erp={erp} />}
      </Drawer>
    </Page>
  )
}

function TxDetails({ t, m }) {
  const deal = m.deals[t.dealId]
  const acc = m.clientAccount(t.into)
  return (
    <>
      {t.reason && <Notice tone="red"><b>Invalid reason:</b> {t.reason}</Notice>}
      {(t.status === 'pending' || t.status === 'draft') && <Notice tone="amber">Check this against the bank statement, then set it to Clear. Only Clear transactions can be closed.</Notice>}
      <Block title="Transaction" right={<Status of={MONEY_IN_STATUS} value={t.status} />}>
        <KV min={170} items={[
          ['Amount', <b>{rm(t.amount)}</b>], ['Date', date(t.date)], ['Bank-In Date', date(t.bankOn)],
          ['Method', METHODS[t.method]], t.method === 'cash' && ['Cash Method', CASH_METHODS[t.cashMethod]],
          t.method === 'cheque' ? ['Cheque', chequeNoOf(t)] : ['Recipient Reference', t.ref],
          ['Purpose', PURPOSES[t.purpose]], ['Paid by', t.payer], ['Remark', t.remark], ['File', t.file || 'transfer-slip.pdf'],
          ['Into', acc ? `${acc.bank} ${maskAcc(acc.accountNo)} (${acc.purpose === 'client' ? 'clients account' : 'operating'})` : '—'],
        ]} />
      </Block>
      <Block title="E-Form">
        <KV min={170} items={[
          ['Form ID', <Link to={`deals/${deal.id}`} style={mono}>{deal.code}</Link>], ['Form Type', deal.type === 'rental' ? 'Rental' : 'Sales'],
          ['Staff', m.staffName(deal.agentId)], ['Bill Year', t.date.slice(0, 4)],
          ['Cleared on this form', `${rm(Math.min(m.cleared(deal.id), deal.money.billed))} of ${rm(deal.money.billed)}`],
        ]} />
      </Block>
    </>
  )
}

// Save rows as a CSV file (opens in Excel).
function downloadCsv(name, head, rows) {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([[head, ...rows].map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv' })), download: name })
  a.click()
  URL.revokeObjectURL(a.href)
}

// Update Transaction / Delete: only while the payment has not been paid out on a close.
function TxEdit({ t, erp }) {
  const { m } = erp
  const fb = useFeedback()
  const can = useCan()
  const review = useReview()
  const [f, setF] = useState(null)
  const [error, setError] = useState(null)
  if (!can('moneyIn', 'edit')) return null
  const used = t.status === 'cleared' && (m.closesByDeal[t.dealId] || []).length > 0
  if (used) return <p style={{ fontSize: 12.5, color: C.muted, margin: 0 }}>This payment has been paid out on a close, so it can no longer be edited or deleted.</p>
  if (t.status === 'cleared' && !can('moneyIn', 'full')) return <p style={{ fontSize: 12.5, color: C.muted, margin: 0 }}>Accounts has cleared this payment, so only Accounts can change it now.</p>
  const today = localToday()
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }))
  // Only the E-Forms this viewer may see: an agent can't move a payment onto someone else's deal.
  const forms = erp.scoped.deals.filter(x => x.status === 'submitted' || x.status === 'partial' || x.status === 'closed' || x.id === t.dealId).sort((a, b) => b.date.localeCompare(a.date))
  const before = { dealId: String(t.dealId), date: t.date, bankOn: t.bankOn, amount: String(t.amount), method: t.method, chequeNo: chequeNoOf(t), reference: referenceOf(t),
    cashMethod: t.cashMethod || 'cashtocompany', purpose: t.purpose, remark: t.remark, file: t.file || 'transfer-slip.pdf' }
  const save = async () => {
    setError(null)
    const gaps = missing([['Amount', Number(f.amount) > 0 ? f.amount : ''], ['Bank-In Date', f.bankOn],
      f.method === 'cheque' ? ['Cheque Number', f.chequeNo] : ['Recipient Reference', f.reference], ['Remark', f.remark]])
    if (gaps.length) { setError(needText(gaps)); markGaps(gaps); return }
    const changes = changedRows(before, f, [['dealId', 'E-Form', v => m.deals[v]?.code], ['date', 'Date', date], ['bankOn', 'Bank-In Date', date],
      ['amount', 'Amount', v => rm(Number(v))], ['method', 'Method', v => METHODS[v]], ['cashMethod', 'Cash Option', v => (f.method === 'cash' ? CASH_METHODS[v] : '')],
      ['chequeNo', 'Cheque Number'], ['reference', 'Recipient Reference'], ['purpose', 'Purpose', v => PURPOSES[v]], ['remark', 'Remark'], ['file', 'Attachment']])
    const ok = await review({ title: `Update ${t.code}?`, confirmLabel: 'Save changes', changes,
      warnings: [lookalikeText(lookalikes(m.data.moneyIn, f, t.id), m),
        t.status === 'pending' && 'Accounts is already checking this payment against the bank. Tell them what you changed.'] })
    if (!ok) return
    try { await erp.updateTransaction(t.id, f); fb.toast(`${t.code} updated`); setF(null) } catch (e) { setError(e.message) }
  }
  const remove = async () => {
    if (await fb.confirm({ title: `Delete ${t.code}?`, body: `${rm(t.amount)} from ${t.payer} is removed from ${m.deals[t.dealId].code}. This cannot be undone.`, confirmLabel: 'Delete', danger: true })
      && await fb.run(() => erp.deleteTransaction(t.id), `${t.code} deleted`)) go('money-in')
  }
  if (!f) {
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={btn} onClick={() => setF(before)}>Update Transaction</button>
        {can('moneyIn', 'full') && <button style={{ ...btn, color: C.err }} onClick={remove}>Delete</button>}
      </div>
    )
  }
  const grid = { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(180px, 100%), 1fr))' }
  return (
    <Block title="Update Transaction">
      {error && <Notice tone="red">{error}</Notice>}
      <div style={grid}>
        <FormField label="Select Submission" wide><Select block plain label="E-Form" value={f.dealId} onChange={v => setF({ ...f, dealId: v })} options={forms.map(x => ({ value: String(x.id), label: `${x.code} · ${x.property.title}` }))} /></FormField>
        <FormField label="Date"><input type="date" style={field} max={today} value={f.date} onChange={set('date')} /></FormField>
        <FormField label="Bank-In Date" required><input type="date" style={field} max={today} value={f.bankOn} onChange={set('bankOn')} /></FormField>
        <FormField label="Amount (RM)" required><input type="number" min="0" step="0.01" style={field} value={f.amount} onChange={set('amount')} /></FormField>
        <FormField label="Method"><Select block plain label="Method" value={f.method} onChange={v => setF({ ...f, method: v })} options={Object.entries(METHODS).map(([value, label]) => ({ value, label }))} /></FormField>
        {f.method === 'cash' && <FormField label="Cash Option"><Select block plain label="Cash" value={f.cashMethod} onChange={v => setF({ ...f, cashMethod: v })} options={Object.entries(CASH_METHODS).map(([value, label]) => ({ value, label }))} /></FormField>}
        {f.method === 'cheque'
          ? <FormField label="Cheque Number" required><input style={field} value={f.chequeNo} onChange={set('chequeNo')} /></FormField>
          : <FormField label="Recipient Reference" required><input style={field} value={f.reference} onChange={set('reference')} /></FormField>}
        <FormField label="Purpose"><Select block plain label="Purpose" value={f.purpose} onChange={v => setF({ ...f, purpose: v })} options={Object.entries(PURPOSES).map(([value, label]) => ({ value, label }))} /></FormField>
        <FormField label="Replace attachment" help={`Now: ${before.file}`}><FileInput kind="document" onChange={files => setF(v => ({ ...v, file: files[0]?.name || before.file }))} /></FormField>
        <FormField label="Remark" required wide><TextArea value={f.remark} onChange={set('remark')} /></FormField>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button style={btnPrimary} onClick={save}>Review changes</button>
        <button style={btn} onClick={() => setF(null)}>Cancel</button>
      </div>
    </Block>
  )
}

function TxActions({ t, erp, next }) {
  const fb = useFeedback()
  const can = useCan()
  const [reason, setReason] = useState('')
  const [asking, setAsking] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = async (status, why) => {
    setBusy(true)
    const ok = await fb.run(() => erp.setMoneyInStatus(t.id, status, why), `${t.code} set to ${MONEY_IN_STATUS[status].label}`,
      next ? { action: { label: 'Next', onClick: next } } : undefined)
    if (ok) setAsking(null)
    setBusy(false)
  }
  if (t.status !== 'pending' && t.status !== 'draft') {
    return <span style={{ fontSize: 13, color: C.muted, flex: 1 }}>{t.status === 'cleared' ? `Clear since ${date(t.clearsOn)}.` : 'No further action.'}</span>
  }
  if (!can('moneyIn', 'full')) return <span style={{ fontSize: 13, color: C.muted, flex: 1 }}>Waiting for Accounts to check it against the bank.</span>
  if (asking) {
    return (
      <>
        <TextArea style={{ flex: '1 1 220px', width: 'auto' }} autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Invalid reason" />
        <button style={btn} onClick={() => setAsking(null)}>Cancel</button>
        <button style={btnPrimary} disabled={busy || !reason.trim()} onClick={() => set(asking, reason)}>Set {MONEY_IN_STATUS[asking].label}</button>
      </>
    )
  }
  return (
    <>
      <button style={btn} onClick={() => setAsking('invalid')}>Invalid…</button>
      <button style={btn} onClick={() => setAsking('returned')}>Return…</button>
      {t.status === 'draft' && <button style={btn} disabled={busy} onClick={() => set('pending')}>Pending</button>}
      <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => set('cleared')}>Clear</button>
    </>
  )
}

// Add Transaction: the same fields and rules as the current form.
function AddTransaction({ dealId }) {
  const erp = useErp()
  const { m, scoped: d } = erp
  const today = localToday()
  // Bank In Date starts empty, as in the current form: it is typed from the slip, not assumed.
  const [f, setF] = useState({ date: today, dealId: dealId ? String(dealId) : '', amount: '', bankOn: '', method: 'online', chequeNo: '', reference: '',
    cashMethod: 'cashtocompany', purpose: 'deposit', remark: '', file: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const fb = useFeedback()
  const review = useReview()
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const forms = d.deals.filter(x => x.status === 'submitted' || x.status === 'partial' || x.status === 'closed').sort((a, b) => b.date.localeCompare(a.date))
  const deal = m.deals[Number(f.dealId)]
  const onForm = deal ? m.data.moneyIn.filter(t => t.dealId === deal.id).sort((a, b) => b.id - a.id) : []
  // The buyer or tenant puts down the deposit; the owner (or developer) pays the balance commission.
  const payer = deal && (f.purpose === 'commission' ? deal.owner?.name : deal.buyer?.name)
  const owner = deal?.type === 'rental' ? 'landlord' : deal?.type === 'project' ? 'developer' : 'owner'
  // Before recording: the payment, and where the E-Form will stand with it.
  async function preview() {
    const gaps = missing([['Select Submission', f.dealId], ['Amount', Number(f.amount) > 0 ? f.amount : ''], ['Bank In Date', f.bankOn],
      f.method === 'cheque' ? ['Cheque Number', f.chequeNo] : ['Recipient Reference', f.reference], ['Attachment (transfer slip or cheque copy)', f.file], ['Remarks', f.remark]])
    const late = [f.bankOn > today && 'The Bank In Date cannot be in the future.', f.date > today && 'The Date cannot be in the future.'].filter(Boolean)
    if (gaps.length || late.length) { setError([gaps.length && needText(gaps), ...late].filter(Boolean).join(' ')); if (!(gaps.length && markGaps(gaps))) window.scrollTo({ top: 0, behavior: 'smooth' }); return false }
    const claim = deal.money.billed, before = m.received(deal.id), after = r2(before + Number(f.amount))
    // A deposit or rent above the claim is normal: the rest is the owner's and goes back with Balance to Vendor.
    const over = r2(after - claim)
    return review({
      title: 'Preview the payment', confirmLabel: 'Record payment',
      intro: 'It is saved as Draft. Accounts sets it to Clear after checking the bank statement; only cleared money counts when the case is closed.',
      warnings: [lookalikeText(lookalikes(m.data.moneyIn, f), m),
        f.purpose === 'commission' && over > 0.005 && `Balance Commission takes ${deal.code} to ${rm(after)}, more than its ${rm(claim)} claim. Check the amount, or that it is the right E-Form.`],
      sections: [
        { title: 'Payment', rows: [['Amount', <b key="a">{rm(Number(f.amount))}</b>], ['Purpose', PURPOSES[f.purpose]], ['Paid by', payer], ['Date', date(f.date)], ['Bank In Date', date(f.bankOn)],
          ['Method', f.method === 'cash' ? `Cash · ${CASH_METHODS[f.cashMethod]}` : METHODS[f.method]], f.method === 'cheque' ? ['Cheque Number', f.chequeNo] : ['Recipient Reference', f.reference],
          ['Attachment', f.file], ['Remarks', f.remark]] },
        { title: 'E-Form', rows: [['Code', `${deal.code} · ${deal.property.title}`], ['Sale Staff', m.staffName(deal.agentId)], ['Claim from owner', rm(claim)],
          ['Recorded before this', rm(before)], ['Recorded with this', `${rm(after)} (${Math.round(after / (claim || 1) * 100)}% of the claim)`],
          f.purpose !== 'commission' && over > 0.005 && ['Above the claim', `${rm(over)} is the ${owner}'s money: it stays in the clients account and goes back with Balance to Vendor.`],
          ['Cleared so far', rm(m.cleared(deal.id))]] },
      ],
    })
  }
  async function save() {
    setError(null)
    if (!await preview()) return
    setBusy(true)
    try {
      await erp.addTransaction(f)
      fb.toast(`${rm(f.amount)} added to ${deal.code} as Draft. Accounts clears it after checking the bank.`)
      go(`deals/${f.dealId}`)
    } catch (e) { setError(e.message); window.scrollTo({ top: 0, behavior: 'smooth' }) } finally { setBusy(false) }
  }
  const radio = (name, value, label) => (
    <label key={value} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 14, marginRight: 14 }}>
      <input type="radio" name={name} checked={f[name] === value} onChange={() => setF({ ...f, [name]: value })} style={{ accentColor: C.primary }} />{label}
    </label>
  )
  return (
    <Page title="Record a payment" help={PAGE.recordPayment} back={{ to: 'money-in', label: 'Money in' }} sub="Saved as Draft. Accounts sets it to Clear after checking the bank statement.">
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', alignItems: 'start' }}>
        <Card>
          {error && <Notice tone="red">{error}</Notice>}
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))' }}>
            <FormField label="Date"><input type="date" style={field} max={today} value={f.date} onChange={set('date')} /></FormField>
            <FormField label="Select Submission" required wide>
              <Select block plain label="Submission" value={f.dealId} onChange={v => setF({ ...f, dealId: v })}
                options={[{ value: '', label: 'Please select one.' }, ...forms.map(x => ({ value: String(x.id), label: `${x.code} · ${x.property.title} · ${m.staffName(x.agentId)}` }))]} />
            </FormField>
            <FormField label="Amount (RM)" required><input type="number" min="0" step="0.01" style={field} value={f.amount} onChange={set('amount')} placeholder="Amount..." /></FormField>
            <FormField label="Bank In Date" required help="The date on the slip or bank statement."><input type="date" style={field} max={today} value={f.bankOn} onChange={set('bankOn')} /></FormField>
            <FormField label="Method" wide>
              <div style={{ paddingTop: 4 }}>{radio('method', 'cash', 'Cash')}{radio('method', 'cheque', 'Cheque')}{radio('method', 'online', 'Online Transfer')}</div>
            </FormField>
            {f.method === 'cash' && (
              <FormField label="Transaction Cash Option" wide>
                <div style={{ paddingTop: 4 }}>{radio('cashMethod', 'cashtocompany', 'Cash to Company')}{radio('cashMethod', 'cashbankin', 'Cash Bank In')}</div>
              </FormField>
            )}
            {f.method === 'cheque'
              ? <FormField label="Cheque Number" required><input style={field} value={f.chequeNo} onChange={set('chequeNo')} placeholder="Cheque Number..." /></FormField>
              : <FormField label="Recipient Reference" required help={f.method === 'cash' ? 'The official receipt no., or the cash deposit slip no.' : 'The transfer reference on the slip (e.g. IBG or DuitNow ref.).'}>
                <input style={field} value={f.reference} onChange={set('reference')} placeholder="Recipient Reference..." />
              </FormField>}
            <FormField label="Attachment" required help="The slip must show the recipient reference, the amount and the date of the transaction.">
              <FileInput kind="document" onChange={files => setF(v => ({ ...v, file: files[0]?.name || '' }))} />
            </FormField>
            <FormField label="Purpose" required>
              <select style={{ ...sel, width: '100%' }} value={f.purpose} onChange={set('purpose')}>
                {Object.entries({ deposit: 'Cash Deposit', commission: 'Balance Commission', rental: 'Balance Rent', other: 'Others' }).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </FormField>
            <FormField label="Remarks" required wide><TextArea value={f.remark} onChange={set('remark')} placeholder="Remarks..." /></FormField>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Preview & record'}</button>
            <button style={btn} onClick={() => history.back()}>Cancel</button>
          </div>
        </Card>
        {deal && (
          <Card title="Selected E-Form">
            <KV min={160} items={[
              ['Code', <Link to={`deals/${deal.id}`} style={mono}>{deal.code}</Link>], ['Type', P.DEAL_TYPE_LABELS[deal.type]],
              ['Property', deal.property.address], ['Sale Staff', m.staffName(deal.agentId)],
              ['Claim from owner', rm(deal.money.billed)], ['Recorded so far', rm(m.received(deal.id))], ['Cleared so far', rm(m.cleared(deal.id))],
            ]} />
            <h3 style={{ fontSize: 13, margin: '16px 0 6px' }}>Payments on this E-Form</h3>
            {onForm.length ? onForm.slice(0, 6).map(t => (
              <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, padding: '6px 0', borderTop: `1px solid ${C.border}` }}>
                <span style={{ ...mono, minWidth: 96 }}>{t.code}</span>
                <span style={{ color: C.muted, flex: '1 1 140px' }}>{date(t.bankOn)} · {PURPOSES[t.purpose]} · {methodText(t)}</span>
                <b>{rm(t.amount)}</b>
                <Status of={MONEY_IN_STATUS} value={t.status} />
              </div>
            )) : <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>None recorded yet.</p>}
            {onForm.length > 6 && <p style={{ fontSize: 12.5, color: C.muted, margin: '6px 0 0' }}>and {onForm.length - 6} more.</p>}
          </Card>
        )}
      </div>
    </Page>
  )
}

// SST Account Transactions: the SST on each closed claim.
function SstLedger() {
  const { m, scoped: d } = useErp()
  const rows = [...d.closes].filter(c => c.sst > 0).sort((a, b) => b.date.localeCompare(a.date))
  const ym = lastMonths(m.today, 1)[0]
  return (
    <Page title="SST account" help={PAGE.sst} sub="SST collected on every closed claim, moved to the SST account for LHDN.">
      <div style={{ ...cols(220, 14), marginBottom: 16 }}>
        <Stat label={`SST in ${monthName(ym)}`} value={rm(sum(rows.filter(c => c.date.startsWith(ym)), c => c.sst))} />
        <Stat label={`SST in ${m.year}`} value={rm(sum(rows.filter(c => c.date.startsWith(m.year)), c => c.sst))} />
      </div>
      <Card pad={16}>
        <DataTable rows={rows} pageSize={20} narrowAt={560} columns={[
          { key: 'id', label: 'ID', render: c => <span style={mono}>{c.id}</span> },
          { key: 'date', label: 'Date', nowrap: true, render: c => date(c.date) },
          { key: 'form', label: 'Form', render: c => <Link to={`deals/${c.dealId}`} style={mono}>{m.deals[c.dealId].code}</Link> },
          { key: 'amount', label: 'Amount', align: 'right', render: c => <b>{rm(c.sst)}</b> },
        ]} />
      </Card>
    </Page>
  )
}

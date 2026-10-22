import { useMemo, useState } from 'react'
import * as P from '../../../shared/payout.js'
import { C, btn, btnPrimary, inp, sel } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { MONEY_IN_STATUS, PURPOSES, METHODS, CASH_METHODS, sum } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, DataTable, Status, Link, Drawer, KV, Block, Notice, Stat, FormField, cols, go, mono, field, useRecordNav } from '../ui.jsx'
import { COLUMN, PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { FlowBar } from '../flow.jsx'
import { rm, date, maskAcc, lastMonths, monthName } from '../format.js'
import { localToday } from '../../demo/erpSample.js'

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
  const { m, scoped: d } = erp
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const open = openId ? d.moneyIn.find(t => t.id === openId) : null
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
      <span>{METHODS[t.method]}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{t.method === 'cash' ? CASH_METHODS[t.cashMethod] : t.ref}</span></span>
    ) },
    { key: 'purpose', label: 'Purpose · Remark', render: t => <span>{PURPOSES[t.purpose]}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{t.remark}</span></span> },
    { key: 'bank', label: 'Bank-In Date', nowrap: true, sort: t => t.bankOn, render: t => date(t.bankOn) },
    { key: 'status', label: 'Status', help: COLUMN.moneyInStatus, sort: t => t.status, render: t => <Status of={MONEY_IN_STATUS} value={t.status} /> },
  ]
  return (
    <Page title="Money in" help={PAGE.moneyIn} sub="Every payment received (transactions). Only Clear payments count as cleared cash when a case is closed."
      actions={<button style={btnPrimary} onClick={() => go('money-in/new')}>Record a payment</button>}>
      <FlowBar here="clear" />
      <div style={{ ...cols(220, 14), marginBottom: 16 }}>
        <Stat icon="moneyIn" tone="amber" label="Draft and Pending" value={rm(sum(toCheck, t => t.amount))} sub={`${toCheck.length} to check against the bank`} onClick={() => setTab('pending')} on={tab === 'pending'} />
        <Stat icon="check" tone="green" label={`Clear in ${monthName(ym)}`} value={rm(sum(month, t => t.amount))} sub={`${month.length} transactions`} onClick={() => setTab('cleared')} on={tab === 'cleared'} />
      </div>
      <Card pad={16}>
        <Tabs value={tab} onChange={setTab} tabs={TABS.map(x => ({ key: x.key, label: x.label, count: match.filter(x.test).length }))} />
        <Toolbar><SearchBox value={q} onChange={setQ} placeholder="ID, form, staff, payer or reference" /></Toolbar>
        <DataTable columns={columns} rows={rows} onRow={t => go(`money-in/${t.id}`)} defaultSort={{ key: 'code', dir: 'desc' }} pageSize={20} narrowAt={940}
          empty={q ? `No transactions match “${q}”` : 'No transactions here'} onClear={q ? () => setQ('') : undefined} onOrder={onOrder} />
      </Card>
      <Drawer open={!!open} onClose={() => go('money-in')} title={open ? `${open.code} · ${rm(open.amount)}` : ''} sub={open ? `${PURPOSES[open.purpose]} from ${open.payer}` : ''}
        nav={nav} footer={open && <TxActions key={open.id} t={open} erp={erp} next={nav?.next} />}>
        {open && <TxDetails t={open} m={m} />}
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
          t.method === 'cheque' && ['Cheque', t.ref.replace('Cheque ', '')], t.method === 'online' && ['Recipient Reference', t.ref],
          ['Purpose', PURPOSES[t.purpose]], ['Remark', t.remark], ['File', 'transfer-slip.pdf'],
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

function TxActions({ t, erp, next }) {
  const fb = useFeedback()
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
  if (asking) {
    return (
      <>
        <input style={{ ...inp, flex: '1 1 220px' }} autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Invalid reason" />
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
  const [f, setF] = useState({ date: today, dealId: dealId ? String(dealId) : '', amount: '', bankOn: today, method: 'online', chequeNo: '', reference: '',
    cashMethod: 'cashtocompany', purpose: 'deposit', remark: '', file: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const fb = useFeedback()
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const forms = d.deals.filter(x => x.status === 'submitted' || x.status === 'partial' || x.status === 'closed').sort((a, b) => b.date.localeCompare(a.date))
  const deal = m.deals[Number(f.dealId)]
  async function save() {
    setBusy(true); setError(null)
    try {
      if (!f.file) throw new Error('Attachment is required (a transfer slip or cheque copy).')
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
            <FormField label="Date"><input type="date" style={field} value={f.date} onChange={set('date')} /></FormField>
            <FormField label="Select Submission" required wide>
              <Select block plain label="Submission" value={f.dealId} onChange={v => setF({ ...f, dealId: v })}
                options={[{ value: '', label: 'Please select one.' }, ...forms.map(x => ({ value: String(x.id), label: `${x.code} · ${x.property.title} · ${m.staffName(x.agentId)}` }))]} />
            </FormField>
            <FormField label="Amount (RM)" required><input type="number" min="0" step="0.01" style={field} value={f.amount} onChange={set('amount')} placeholder="Amount..." /></FormField>
            <FormField label="Bank In Date" required><input type="date" style={field} value={f.bankOn} onChange={set('bankOn')} /></FormField>
            <FormField label="Method" wide>
              <div style={{ paddingTop: 4 }}>{radio('method', 'cash', 'Cash')}{radio('method', 'cheque', 'Cheque')}{radio('method', 'online', 'Online Transfer')}</div>
            </FormField>
            {f.method === 'cheque' && <FormField label="Cheque Number" required><input style={field} value={f.chequeNo} onChange={set('chequeNo')} placeholder="Cheque Number..." /></FormField>}
            {f.method === 'online' && <FormField label="Recipient Reference"><input style={field} value={f.reference} onChange={set('reference')} placeholder="Recipient Reference..." /></FormField>}
            {f.method === 'cash' && (
              <FormField label="Transaction Cash Option" wide>
                <div style={{ paddingTop: 4 }}>{radio('cashMethod', 'cashtocompany', 'Cash to Company')}{radio('cashMethod', 'cashbankin', 'Cash Bank In')}</div>
              </FormField>
            )}
            <FormField label="Attachment" required help="Must show the recipient reference, the amount and the date of the transaction.">
              <input type="file" style={{ ...field, padding: 5 }} onChange={e => setF({ ...f, file: e.target.files?.[0]?.name || '' })} />
            </FormField>
            <FormField label="Purpose" required>
              <select style={{ ...sel, width: '100%' }} value={f.purpose} onChange={set('purpose')}>
                {Object.entries({ deposit: 'Cash Deposit', commission: 'Balance Commission', rental: 'Balance Rent', other: 'Others' }).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </FormField>
            <FormField label="Remarks" required wide><input style={field} value={f.remark} onChange={set('remark')} placeholder="Remarks..." /></FormField>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Submit'}</button>
            <button style={btn} onClick={() => history.back()}>Cancel</button>
          </div>
        </Card>
        {deal && (
          <Card title="Selected E-Form">
            <KV min={160} items={[
              ['Code', <Link to={`deals/${deal.id}`} style={mono}>{deal.code}</Link>], ['Type', P.DEAL_TYPE_LABELS[deal.type]],
              ['Property', deal.property.address], ['Sale Staff', m.staffName(deal.agentId)],
              ['Claim from owner', rm(deal.money.billed)], ['Cleared so far', rm(m.cleared(deal.id))],
            ]} />
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

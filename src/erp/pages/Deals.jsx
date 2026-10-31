import { useEffect, useMemo, useState } from 'react'
import * as P from '../../../shared/payout.js'
import { C, btn, btnPrimary } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { DEAL_STATUS, PARTY, readyToClose, isAgent, sum, r2 } from '../model.js'
import { FlowBar } from '../flow.jsx'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, DateFilter, RangeFilter, DataTable, Status, Progress, Menu, Modal, FormField, FileInput, TextArea, Notice, go, mono, tabular, field } from '../ui.jsx'
import { COLUMN, PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { rm, rmShort, date, num, amt } from '../format.js'
import DealPage from './DealPage.jsx'
import { NoAccess, useCan, useGate } from '../access.jsx'
import DealForm from './DealForm.jsx'
import { BANKS } from './options.js'
import { Review, missing, needText, markGaps } from '../review.jsx'
import { maskAcc, maskIc } from '../format.js'

// E-Forms: Personal Sales (every form), Branch Sales (by branch manager) and
// Team Sales (a leader and everyone under them), as in the current ERP.
export default function Deals({ parts }) {
  const can = useCan()
  if (parts[1] === 'new') return <DealForm />
  if (/^\d+$/.test(parts[1] || '')) return parts[2] !== 'edit' ? <DealPage id={Number(parts[1])} /> : can('deals', 'edit') ? <DealForm key={parts[1]} id={Number(parts[1])} /> : <NoAccess />
  return <DealList view={parts[1] || 'personal'} />
}

// "#/deals?staff=12" opens the list on one person's E-Forms (from their profile);
// "#/deals?status=draft" on the drafts (from the Commission flow).
const hashParam = k => new URLSearchParams(window.location.hash.split('?')[1] || '').get(k) || ''

const VIEWS = {
  personal: { title: 'All E-Forms', sub: 'Every sale and rental agents submitted to claim commission' },
  branch: { title: 'E-Forms by branch', sub: 'E-Forms under one branch manager' },
  team: { title: 'E-Forms by team', sub: 'A leader’s E-Forms and everyone under them' },
  ready: { title: 'Ready to close', sub: 'E-Forms whose cash has cleared. Request Close Case on each, so its payouts can be approved' },
}
// A filter field that is set gets the same crimson tint as a set dropdown.
const STATUS_FILTER = [['', 'All'], ['draft', 'Draft'], ['submitted', 'Submitted'], ['cancelled', 'Abort/Cancel'], ['closed', 'Closed Full'], ['partial', 'Closed Partial']]

function DealList({ view }) {
  const can = useCan()
  const { m, scoped: d, setup } = useErp()
  const [status, setStatus] = useState(() => hashParam('status'))
  // The list stays mounted between its views, so follow a ?status= link from another view too.
  useEffect(() => {
    const on = () => { const s = hashParam('status'); if (s) setStatus(s) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const [q, setQ] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [type, setType] = useState('')
  const [who, setWho] = useState(() => hashParam('staff'))
  const [lead, setLead] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const enabled = P.DEAL_TYPES.filter(t => setup.dealTypes[t]?.enabled)
  const v = VIEWS[view] || VIEWS.personal

  // Leaders for Branch / Team Sales.
  const tops = d.staff.filter(s => s.role && (s.uplineId == null || !m.staff[s.uplineId]))
  const leaders = d.staff.filter(s => s.role).sort((a, b) => a.short.localeCompare(b.short))
  const leadId = Number(lead) || (view === 'branch' ? tops[0]?.id : view === 'team' ? leaders[0]?.id : null)
  const byLeader = view === 'branch' || view === 'team'
  const team = useMemo(() => {
    if (!leadId) return null
    const ids = new Set([leadId])
    let grew = true
    while (grew) { grew = false; for (const s of m.data.staff) if (ids.has(s.uplineId) && !ids.has(s.id)) { ids.add(s.id); grew = true } }
    return ids
  }, [leadId, m])

  const base = useMemo(() => {
    const words = q.trim().toLowerCase()
    return d.deals.filter(x => (!type || x.type === type) && (!who || x.agentId === Number(who) || x.holderId === Number(who)) &&
      (!team || view === 'personal' || view === 'ready' || team.has(x.agentId) || team.has(x.holderId)) &&
      (!from || x.date >= from) && (!to || x.date <= to) && (!minPrice || x.price >= Number(minPrice)) && (!maxPrice || x.price <= Number(maxPrice)) &&
      (!words || [x.code, x.property.address, x.property.title].join(' ').toLowerCase().includes(words)))
  }, [d.deals, q, type, who, team, view, from, to, minPrice, maxPrice])
  const rows = (status ? base.filter(x => x.status === status) : base).filter(x => view !== 'ready' || readyToClose(x, m, setup) > 0)
  const people = d.staff.filter(s => isAgent(s) && s.status !== 'pending').sort((a, b) => a.short.localeCompare(b.short))
  const filters = [from, to, minPrice, maxPrice, who, type, status].filter(Boolean).length
  const clear = () => { setQ(''); setFrom(''); setTo(''); setMinPrice(''); setMaxPrice(''); setWho(''); setType(''); setStatus('') }

  const columns = [
    { key: 'code', label: 'Code', sort: x => `${x.date}${x.code}`, render: x => (
      <span style={{ whiteSpace: 'nowrap' }}>
        <span style={{ ...mono, fontWeight: 700, color: C.primaryDark }}>{x.code}</span>
        <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{date(x.date)}</span>
        <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{P.DEAL_TYPE_LABELS[x.type]}{x.listingId ? ` · ${m.listings[x.listingId].code}` : ''}</span>
      </span>
    ) },
    { key: 'people', label: 'Sale Staff · Product Handler', sort: x => m.staffName(x.agentId), render: x => {
      const bm = m.branchManagerOf(x.agentId), am = m.areaManagerOf(x.agentId)
      return (
        <span style={{ display: 'block', fontSize: 13 }}>
          {m.staffName(x.agentId)}
          <span style={{ display: 'block', fontSize: 12, color: C.muted }}>PH {x.holderId != null ? m.staffName(x.holderId) : '—'}</span>
          <span style={{ display: 'block', fontSize: 12, color: C.muted }}>BM {bm?.short}{am ? ` · AM ${am.short}` : ''}</span>
        </span>
      )
    } },
    { key: 'address', label: 'Address', sort: x => x.property.title, render: x => (
      <span style={{ display: 'block', fontSize: 13 }}>{x.property.title}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{x.property.address.split(',')[0]}</span></span>
    ) },
    { key: 'price', label: 'Sell/Rent Price', align: 'right', sort: x => x.price, render: x => rm(x.price) },
    { key: 'total', label: 'Total · Net Total', help: COLUMN.dealTotal, align: 'right', sort: x => x.money.billed, render: x => (
      <span>{rm(r2(x.money.billed - x.money.coBroke - x.money.referral))}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{rm(x.money.net)}</span></span>
    ) },
    { key: 'tx', label: 'Transaction Amount', help: COLUMN.dealTx, sort: x => m.cleared(x.id), render: x => {
      if (x.status === 'draft') return <span style={{ color: C.muted, fontSize: 12 }}>—</span>
      const got = m.cleared(x.id), all = m.received(x.id)
      return (
        <span style={{ display: 'block', minWidth: 0 }}>
          <span style={{ fontSize: 12.5, ...tabular }}>{amt(got)} / {amt(all)}</span>
          <Progress value={Math.min(1, got / x.money.billed)} tone={got >= x.money.billed ? 'green' : 'blue'} height={4} label="Cleared" />
        </span>
      )
    } },
    { key: 'status', label: 'Status', sort: x => x.status, render: x => <Status of={DEAL_STATUS} value={x.status} /> },
    { key: 'actions', label: '', card: false, render: x => <DealActions deal={x} quiet /> },
  ]

  const yearDeals = d.deals.filter(x => x.date.startsWith(m.year) && x.status !== 'cancelled' && x.status !== 'draft')
  return (
    <Page title={v.title} help={PAGE[{ personal: 'deals', branch: 'dealsBranch', team: 'dealsTeam', ready: 'dealsReady' }[view] || 'deals']} sub={view === 'ready' ? `${v.sub}.` : <>{v.sub} · {num(yearDeals.length)} submitted in {m.year} · {rm(sum(yearDeals, x => x.fee))} in fees</>}
      actions={can('deals', 'edit') && <button style={btnPrimary} onClick={() => go('deals/new')}>Submit an E-Form</button>}>
      {view === 'ready' ? <FlowBar here="close" /> : status === 'draft' && <FlowBar here="submit" />}
      <Card pad={16}>
        <Toolbar fold onClear={clear}>
          <SearchBox value={q} onChange={setQ} placeholder="Case number or address" />
          {byLeader && <Select label={view === 'branch' ? 'Branch manager' : 'Leader'} value={String(leadId || '')} onChange={setLead}
            options={(view === 'branch' ? tops : leaders).map(s => ({ value: String(s.id), label: `${view === 'branch' ? 'B.M ' : ''}${s.short} (${s.code})` }))} />}
          <Select label="Staff" value={who} onChange={setWho} options={[{ value: '', label: 'Everyone' }, ...people.map(s => ({ value: String(s.id), label: `${s.short} ${s.code}` }))]} />
          {enabled.length > 1 && <Select label="Form type" value={type} onChange={setType}
            options={[{ value: '', label: 'All types' }, ...enabled.map(t => ({ value: t, label: t === 'sale' ? 'Sales' : P.DEAL_TYPE_LABELS[t] }))]} />}
          <Select label="Form status" value={status} onChange={setStatus} options={STATUS_FILTER.map(([value, label]) => ({ value, label: value ? `${label} (${base.filter(x => x.status === value).length})` : `All statuses (${base.length})` }))} />
          <DateFilter label="Form date" from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b) }} />
          <RangeFilter label="Sell/Rent price" unit="RM" from={minPrice} to={maxPrice} format={rmShort} onChange={(lo, hi) => { setMinPrice(lo); setMaxPrice(hi) }} />
        </Toolbar>
        <DataTable columns={columns} rows={rows} onRow={x => go(`deals/${x.id}`)} defaultSort={{ key: 'code', dir: 'desc' }} pageSize={20} narrowAt={980}
          empty={view === 'ready' && !filters && !q ? 'No deal is ready to close' : 'No E-Forms match'} onClear={filters || q ? clear : undefined} />
      </Card>
    </Page>
  )
}

// Ask, then close: the cleared cash not closed yet becomes case lines for approval.
// The confirm shows the current ERP's "Request for Closing" checklist: both
// parties' details, the documents, and the cleared cash.
export function useCloseDeal(deal) {
  const erp = useErp()
  const fb = useFeedback()
  return async amount => {
    const party = PARTY[deal.type] || PARTY.sale
    const has = p => !!(p?.name && p?.ic && p?.phone)
    const checks = [
      [`${party.owner} name, IC and phone`, has(deal.owner)],
      [`${party.buyer} name, IC and phone`, has(deal.buyer)],
      ...Object.entries(deal.docs || {}).map(([name, ok]) => [name, ok]),
      [`Cleared cash ${rm(erp.m.cleared(deal.id))}`, erp.m.cleared(deal.id) > 0],
    ]
    const missing = checks.filter(c => !c[1]).length
    const ok = await fb.confirm({ title: `Request Close Case for ${deal.code}?`, confirmLabel: 'Request Close Case',
      body: <>
        <p style={{ margin: '0 0 10px' }}>Closes <b>{rm(amount)}</b> of cleared cash. The case lines (everyone this case pays) go to the approver in <b>Payouts</b>.</p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, fontSize: 13 }}>
          {checks.map(([label, done]) => (
            <li key={label} style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}><span>{label}</span>
              <b style={{ color: done ? C.ok : C.warn }}>{done ? 'Done' : 'Missing'}</b></li>
          ))}
        </ul>
        {missing > 0 && <p style={{ margin: '10px 0 0', color: C.warn, fontSize: 13 }}>{missing} item{missing > 1 ? 's are' : ' is'} missing. The approver will see this; upload them on the E-Form.</p>}
      </> })
    if (ok) await fb.run(() => erp.closeDeal(deal.id), `${deal.code} closed for ${rm(amount)} · case lines sent for approval`, { action: { label: 'View', onClick: () => go('payouts') } })
  }
}

// The request forms an E-Form can raise (Actions → Request Form), with their fields.
const REQUESTS = {
  balance: { title: 'Balance to Vendor', done: 'Balance to Vendor request created' },
  transfer: { title: 'Transfer Deposit to Other', done: 'Transfer request created' },
  cobroke: { title: 'Cheque to Co-Bro', done: 'Co-bro cheque request created' },
  referral: { title: 'Introducer Fees', done: 'Introducer fees request created' },
  ta: { title: 'Tenancy Agreement Fees', done: 'Tenancy fees request created' },
}

// The Actions menu on an E-Form (same entries as the current ERP). `quiet` in table rows.
export function DealActions({ deal, quiet }) {
  const erp = useErp()
  const fb = useFeedback()
  const { m, setup } = erp
  const [dialog, setDialog] = useState(null)
  const [form, setForm] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('form')   // request forms: 'form', then 'review' before submitting
  const closeDeal = useCloseDeal(deal)
  const gate = useGate()
  const got = Math.min(m.cleared(deal.id), deal.money.billed)
  const closed = sum(m.closesByDeal[deal.id] || [], c => c.claim)
  const left = r2(got - closed)
  const live = ['submitted', 'partial'].includes(deal.status)
  const closable = readyToClose(deal, m, setup) > 0
  const open = deal.status !== 'draft' && deal.status !== 'cancelled'
  const notOpen = deal.status === 'draft' ? 'Not for drafts' : deal.status === 'cancelled' ? 'This case was aborted' : null
  const closeWhy = deal.status === 'closed' ? 'Closed in full already' : !live ? notOpen
    : left <= 0 ? 'No cleared money to close yet' : `Waiting for ${rm(r2(deal.money.billed - got))} more to clear`
  const outs = m.moneyOutByDeal[deal.id] || []
  const free = r2(m.cleared(deal.id) - sum(outs, x => x.amount))
  const run = async (done, fn) => {
    setBusy(true); setError(null)
    try { await fn(); setDialog(null); setForm({}); fb.toast(done, { action: { label: 'View', onClick: () => go('money-out') } }) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const set = k => e => setForm({ ...form, [k]: e.target.value })
  const print = (label, doc, ok, why) => gate({ label, icon: 'print', disabled: !ok, why, onClick: () => go(`invoices/doc/${deal.id}/${doc}`) }, 'invoices', 'view')
  // Each request form starts with what the E-Form already knows.
  const ask = type => {
    const ta = deal.rental?.taFee || 0
    setError(null)
    setForm({
      balance: { amount: Math.max(0, r2(m.cleared(deal.id) - deal.money.billed - ta)) || '' },
      transfer: {},
      cobroke: { amount: deal.money.coBroke || '' },
      referral: { amount: deal.money.referral || '' },
      ta: { amount: ta || '', payee: deal.buyer.name, ic: deal.buyer.ic },
    }[type] || {})
    setStep('form')
    setDialog(type)
  }
  const request = (type, show) => {
    const done = outs.find(x => x.type === type)
    return show && gate({ label: REQUESTS[type].title, icon: 'moneyOut', disabled: !open || !!done, why: done ? `Requested already (${done.voucherNo})` : notOpen, onClick: () => ask(type) }, 'moneyOut')
  }
  const req = REQUESTS[dialog]
  // A request form's review: who is paid, from where, and what cash is left.
  const payee = { balance: deal.owner?.name, transfer: form.payee, cobroke: deal.coBroke?.agency, referral: deal.referral?.name, ta: form.payee }[dialog]
  const reqReview = () => {
    const needs = { transfer: [['Transfer Deposit Letter', form.letter], ['Transfer to', form.payee], ['IC No.', form.ic], ['Bank Name', form.bank], ['Bank Acc. No.', form.account]],
      cobroke: [['Invoice From Co-Bro Agency', form.letter]], balance: [['Bank Name', form.bank], ['Bank Acc. No.', form.account]], ta: [['Tenant Name', form.payee], ['Tenant IC', form.ic]] }[dialog] || []
    const gaps = missing([['Amount', Number(form.amount) > 0 ? form.amount : ''], ...needs])
    if (gaps.length) { markGaps(gaps); return setError(needText(gaps)) }
    setError(null); setStep('review')
  }
  return (
    <>
      <Menu quiet={quiet} label="Actions" items={[
        deal.status !== 'closed' && deal.status !== 'cancelled' && { note: deal.status === 'draft' ? 'This E-Form is a draft. Edit it and press Submit.' : 'This case is not yet full close!' },
        { section: 'Case' },
        gate({ label: deal.status === 'draft' ? 'Edit & submit E-Form' : 'Edit E-Form', icon: 'edit', disabled: deal.status === 'cancelled', why: 'This case was aborted', onClick: () => go(`deals/${deal.id}/edit`) }, 'deals'),
        gate({ label: 'Add Transaction', icon: 'plus', disabled: !open, why: notOpen, onClick: () => go(`money-in/new/${deal.id}`) }, 'moneyIn'),
        gate({ label: 'Request Close Case', icon: 'payouts', hint: closable ? rm(left) : null, disabled: !closable, why: closeWhy, onClick: () => closeDeal(left) }, 'payouts', 'full'),
        { section: 'Request Form' },
        request('balance', deal.type !== 'project'),
        request('transfer', true),
        request('cobroke', !!deal.coBroke),
        request('referral', !!deal.referral),
        request('ta', deal.type === 'rental'),
        gate({ label: 'Abort Case', icon: 'ban', danger: true, disabled: !open || closed > 0, why: closed > 0 ? 'Part of this case is closed already' : notOpen, onClick: () => { setError(null); setForm({}); setDialog('abort') } }, 'moneyOut'),
        { section: 'Documents' },
        gate({ label: deal.invoiceNo ? `Invoice requested (${deal.invoiceNo})` : 'Request Invoice', icon: 'file', disabled: deal.status === 'draft' || !!deal.invoiceNo, why: deal.invoiceNo ? `On ${date(deal.invoiceOn)}` : 'Not for drafts',
          onClick: () => fb.run(() => erp.requestInvoice(deal.id), `Invoice INV-${deal.code} requested`, { action: { label: 'Open', onClick: () => go(`invoices/doc/${deal.id}/tax-invoice`) } }) }, 'invoices'),
        print('Print Tax Invoice', 'tax-invoice', deal.status !== 'draft', 'Not for drafts'),
        print('Print Tax Receipt', 'tax-receipt', m.cleared(deal.id) > 0, 'No cleared payment yet'),
        print('Print SST Invoice', 'sst-invoice', deal.status !== 'draft', 'Not for drafts'),
        print('Print SST Receipt', 'sst-receipt', m.cleared(deal.id) > 0, 'No cleared payment yet'),
      ]} />
      <Modal open={dialog === 'abort'} onClose={() => setDialog(null)} title={`Abort Case · ${deal.code}`}
        footer={<><button style={btn} onClick={() => setDialog(null)}>Cancel</button>
          <button style={{ ...btn, background: C.err, borderColor: C.err, color: '#fff', opacity: busy ? 0.6 : 1 }} disabled={busy}
            onClick={() => run(`${deal.code} is now Abort/Cancel${free > 0 ? ' · refund request created in Payments out' : ''}`, () => erp.raiseRequest(deal.id, 'refund', form))}>Abort case</button></>}>
        {error && <Notice tone="red">{error}</Notice>}
        <p style={{ fontSize: 13.5, marginTop: 0 }}>The E-Form becomes <b>Abort/Cancel</b>. {free > 0
          ? <>An <b>Abort Case</b> request form returns the {rm(free)} received to {deal.buyer.name}.</> : 'Nothing has been received, so there is nothing to return.'}</p>
        <div style={{ display: 'grid', gap: 10 }}>
          <FormField label="Reason" required><TextArea value={form.reason || ''} onChange={set('reason')} placeholder="e.g. Buyer's loan was rejected" /></FormField>
          {free > 0 && <>
            <FormField label="Abort Letter"><FileInput kind="document" onChange={files => setForm(v => ({ ...v, letter: files[0]?.name || '' }))} /></FormField>
            <FormField label="Return to bank"><Select block plain label="Bank" value={form.bank || ''} onChange={v => setForm(f => ({ ...f, bank: v }))} options={[{ value: '', label: 'Select bank' }, ...BANKS.map(b => ({ value: b, label: b }))]} /></FormField>
            <FormField label="Bank account"><input style={field} value={form.account || ''} onChange={set('account')} placeholder="Purchaser's account no." /></FormField>
          </>}
        </div>
      </Modal>
      <Modal open={!!req} onClose={() => setDialog(null)} title={req ? `${step === 'review' ? 'Review' : req.title} · ${deal.code}` : ''}
        footer={step === 'review' ? <><button style={btn} onClick={() => setStep('form')}>Back to edit</button>
          <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => run(`${req.done} for ${deal.code} · it waits in Payments out`, () => erp.raiseRequest(deal.id, dialog, form))}>Submit request</button></>
          : <><button style={btn} onClick={() => setDialog(null)}>Cancel</button><button style={btnPrimary} onClick={reqReview}>Review</button></>}>
        {error && <Notice tone="red">{error}</Notice>}
        {req && step === 'review' ? (
          <Review intro="Money paid out of the clients account. The request waits in Payments out until accounts pays it."
            warnings={[Number(form.amount) > free + 0.005 && `This is more than the ${rm(Math.max(0, free))} of cash in not yet paid out, so it will be refused.`]}
            sections={[{ title: req.title, rows: [['Amount', <b key="a">{rm(Number(form.amount) || 0)}</b>], ['Pay to', payee], form.ic && ['IC No.', maskIc(form.ic)],
              form.bank && ['Bank', `${form.bank} ${maskAcc(form.account || '')}`], dialog === 'referral' && deal.referral && ['Bank', `${deal.referral.bank} ${maskAcc(deal.referral.account || '')}`],
              form.letter && ['Attachment', form.letter]] },
            { title: 'E-Form', rows: [['Code', `${deal.code} · ${deal.property.title}`], ['Cash in not yet paid out', rm(Math.max(0, free))],
              ['Left after this request', rm(r2(free - (Number(form.amount) || 0)))]] }]} />
        ) : <>
        <p style={{ fontSize: 13, color: C.muted, marginTop: 0 }}>Cash in transactions not yet paid out: <b style={{ color: C.text }}>{rm(Math.max(0, free))}</b>. The amount cannot be more than this.</p>
        <div style={{ display: 'grid', gap: 10 }}>
          {dialog === 'transfer' && <FormField label="Transfer Deposit Letter" required><FileInput kind="document" onChange={files => setForm(v => ({ ...v, letter: files[0]?.name || '' }))} /></FormField>}
          {dialog === 'cobroke' && <FormField label="Invoice From Co-Bro Agency" required help={deal.coBroke?.agency}><FileInput kind="document" onChange={files => setForm(v => ({ ...v, letter: files[0]?.name || '' }))} /></FormField>}
          {dialog === 'referral' && <FormField label="Introducer" help={deal.referral ? `${deal.referral.bank} ${deal.referral.account}` : null}><input style={{ ...field, background: C.bg }} readOnly value={deal.referral?.name || ''} /></FormField>}
          {(dialog === 'transfer' || dialog === 'ta') && <>
            <FormField label={dialog === 'ta' ? 'Tenant Name' : 'Transfer to'} required><input style={field} value={form.payee || ''} onChange={set('payee')} placeholder={dialog === 'ta' ? '' : "e.g. vendor's solicitor (stakeholder)"} /></FormField>
            <FormField label={dialog === 'ta' ? 'Tenant IC' : 'IC No.'} required><input style={field} value={form.ic || ''} onChange={set('ic')} /></FormField>
          </>}
          {['balance', 'transfer', 'ta'].includes(dialog) && <>
            <FormField label="Bank Name" required={dialog !== 'ta'}><Select block plain label="Bank" value={form.bank || ''} onChange={v => setForm(f => ({ ...f, bank: v }))} options={[{ value: '', label: 'Select bank' }, ...BANKS.map(b => ({ value: b, label: b }))]} /></FormField>
            <FormField label="Bank Acc. No." required={dialog !== 'ta'}><input style={field} value={form.account || ''} onChange={set('account')} inputMode="numeric" /></FormField>
          </>}
          <FormField name="Amount" label={{ balance: 'Balance to Vendor (RM)', transfer: 'Amount (RM)', cobroke: 'Co-Bro Fees (RM)', referral: 'Net Introducer Fees (RM)', ta: 'Tenant Fees (RM)' }[dialog] || 'Amount (RM)'} required>
            <input style={field} type="number" min="0" value={form.amount ?? ''} onChange={set('amount')} />
          </FormField>
        </div>
        </>}
      </Modal>
    </>
  )
}

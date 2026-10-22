import { useState } from 'react'
import { C, btn, btnPrimary, sel } from '../../styles.js'
import { CATEGORIES } from '../../demo/erpSample.js'
import { useErp } from '../ErpContext.jsx'
import { PARTY, METHODS, LISTING_CATEGORY, listingCategory, sum } from '../model.js'
import { Page, Card, Tabs, DataTable, Status, Link, Empty, Modal, KV, Notice, FormField, FileInput, Avatar, go, mono, tabular, field } from '../ui.jsx'
import { PAGE } from '../help.js'
import { rm, date, maskAcc, amt } from '../format.js'
import Icon from '../Icon.jsx'
import { TeamTree } from './Staff.jsx'
import { BANKS } from './options.js'

// ── Commission (2020): the old pay-detail confirmation, superseded by Closed Case ──
export function Commission() {
  const head = ['No', 'Form ID', 'Property ID', 'Date', 'Nett Comm', 'Sale Person', 'Sale Comm', 'Sale Upline', 'HQ', 'In-charge Person (AM/PM/PH)', 'Saleking', 'Area Manager', 'Saleking Upline', 'System Tally']
  return (
    <Page title="Old commission page (2020)" help={PAGE.commission} sub="Where pay details were confirmed by hand in 2020. Pay is now worked out from Setup when a case closes.">
      <Card>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>{head.map(h => <span key={h} style={{ fontSize: 11.5, color: C.muted, background: C.grayBg, borderRadius: 4, padding: '2px 6px' }}>{h}</span>)}</div>
        <Empty title="Nothing waiting for confirmation" text="Pay details are now worked out from Setup when a case is closed. See Payouts." />
        <div style={{ textAlign: 'center' }}><button style={btn} onClick={() => go('payouts')}>Open Payouts to approve</button></div>
      </Card>
    </Page>
  )
}

// ── Invoice & Receipt ──
const DOCS = { 'tax-invoice': 'Tax Invoice', 'tax-receipt': 'Official Receipt', 'sst-invoice': 'SST Invoice', 'sst-receipt': 'SST Receipt' }
const invNo = deal => `INV-${deal.code}`
const orNo = t => `OR-${t.code.replace('TRAN#', '')}`

export function Invoices({ parts }) {
  if (parts[1] === 'doc') return <DocView dealId={Number(parts[2])} kind={DOCS[parts[3]] ? parts[3] : 'tax-invoice'} />
  return parts[1] === 'tax' ? <TaxDocs /> : <InvoiceList />
}

function InvoiceList() {
  const { m, scoped: d } = useErp()
  const rows = d.deals.filter(x => x.status !== 'draft').sort((a, b) => b.date.localeCompare(a.date))
  return (
    <Page title="Invoices" help={PAGE.invoices} sub="One invoice per E-Form for the claim from owner (commission + SST).">
      <Card pad={16}>
        <DataTable rows={rows} pageSize={25} narrowAt={820} onRow={x => go(`invoices/doc/${x.id}/tax-invoice`)} columns={[
          { key: 'no', label: 'Invoice No.', render: x => <b style={mono}>{invNo(x)}</b> },
          { key: 'date', label: 'Date', nowrap: true, render: x => date(x.submittedOn || x.date) },
          { key: 'to', label: 'Bill To', render: x => <span>{x.owner.name}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{PARTY[x.type].owner}</span></span> },
          { key: 'form', label: 'E-Form', render: x => <Link to={`deals/${x.id}`} style={mono}>{x.code}</Link> },
          { key: 'amount', label: 'Amount', align: 'right', render: x => <b>{rm(x.money.billed)}</b> },
          { key: 'paid', label: 'Status', render: x => {
            const got = Math.min(m.cleared(x.id), x.money.billed)
            return <Status of={{ paid: { label: 'Paid', tone: 'green' }, part: { label: 'Part paid', tone: 'blue' }, open: { label: x.status === 'cancelled' ? 'Void' : 'Unpaid', tone: x.status === 'cancelled' ? 'gray' : 'amber' } }}
              value={got >= x.money.billed ? 'paid' : got > 0 ? 'part' : 'open'} />
          } },
        ]} />
      </Card>
    </Page>
  )
}

function TaxDocs() {
  const { m, scoped: d } = useErp()
  const [tab, setTab] = useState('invoices')
  const invoices = d.deals.filter(x => x.status !== 'draft' && x.status !== 'cancelled').sort((a, b) => b.date.localeCompare(a.date))
  const receipts = d.moneyIn.filter(t => t.status === 'cleared').sort((a, b) => b.clearsOn.localeCompare(a.clearsOn))
  return (
    <Page title="Tax invoices & receipts" help={PAGE.invoicesTax} sub={`Tax invoices carry SST (${m.setup.company.sstNo || 'SST no. not set'}). Official receipts are issued for cleared transactions.`}>
      <Card pad={16}>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'invoices', label: 'Tax Invoices', count: invoices.length }, { key: 'receipts', label: 'Official Receipts', count: receipts.length }]} />
        {tab === 'invoices' ? (
          <DataTable rows={invoices} pageSize={25} narrowAt={760} onRow={x => go(`invoices/doc/${x.id}/tax-invoice`)} columns={[
            { key: 'no', label: 'Tax Invoice No.', render: x => <b style={mono}>{invNo(x)}</b> },
            { key: 'date', label: 'Date', nowrap: true, render: x => date(x.submittedOn || x.date) },
            { key: 'to', label: 'Bill To', render: x => x.owner.name },
            { key: 'fee', label: 'Fee', align: 'right', render: x => rm(x.money.fee) },
            { key: 'sst', label: 'SST', align: 'right', render: x => rm(x.money.sst) },
            { key: 'total', label: 'Total', align: 'right', render: x => <b>{rm(x.money.billed)}</b> },
          ]} />
        ) : (
          <DataTable rows={receipts} pageSize={25} narrowAt={760} onRow={t => go(`invoices/doc/${t.dealId}/tax-receipt`)} columns={[
            { key: 'no', label: 'Receipt No.', render: t => <b style={mono}>{orNo(t)}</b> },
            { key: 'date', label: 'Date', nowrap: true, render: t => date(t.clearsOn) },
            { key: 'from', label: 'Received From', render: t => t.payer },
            { key: 'form', label: 'E-Form', render: t => <Link to={`deals/${t.dealId}`} style={mono}>{m.deals[t.dealId].code}</Link> },
            { key: 'how', label: 'Method', render: t => METHODS[t.method] },
            { key: 'amount', label: 'Amount', align: 'right', render: t => <b>{rm(t.amount)}</b> },
          ]} />
        )}
      </Card>
    </Page>
  )
}

// A printable tax invoice / receipt / SST document for one E-Form.
function DocView({ dealId, kind }) {
  const { m, setup } = useErp()
  const deal = m.deals[dealId]
  if (!deal) return <Page title="Document not found" back={{ to: 'invoices/tax', label: 'Tax invoices & receipts' }}><Empty title="This E-Form no longer exists" /></Page>
  const co = setup.company
  const receipt = kind.endsWith('receipt')
  const sstOnly = kind.startsWith('sst')
  const txs = (m.moneyInByDeal[deal.id] || []).filter(t => t.status === 'cleared')
  const paid = sum(txs, t => t.amount)
  const desc = deal.type === 'project' ? `Professional fee for the sale of ${deal.property.address} (developer: ${deal.owner.name})`
    : `Professional fee for the ${deal.type === 'sale' ? 'sale' : 'rental'} of ${deal.property.address} at ${rm(deal.price)}${deal.type === 'rental' ? ' per month' : ''}`
  const no = receipt ? (txs[0] ? orNo(txs[0]) : '—') : `${sstOnly ? 'SST-' : ''}${invNo(deal)}`
  const cell = { padding: '8px 6px', borderBottom: `1px solid ${C.border}`, fontSize: 13 }
  return (
    <Page title={`${DOCS[kind]} · ${deal.code}`} back={{ to: 'invoices/tax', label: 'Tax invoices & receipts' }}
      actions={<>{Object.entries(DOCS).map(([k, l]) => <button key={k} style={{ ...btn, fontSize: 13, background: k === kind ? C.primaryBg : '#fff', color: k === kind ? C.primary : C.text }} onClick={() => go(`invoices/doc/${deal.id}/${k}`)}>{l}</button>)}</>}>
      <div style={{ maxWidth: 760, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: 'clamp(16px, 4vw, 32px)', boxShadow: C.shadow }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', borderBottom: `2px solid ${C.primary}`, paddingBottom: 14, marginBottom: 16 }}>
          <div style={{ flex: '1 1 260px' }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{co.name}</div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>{co.regNo} · Estate Agency Licence {co.licenceNo}<br />{co.address}<br />SST No. {co.sstNo || '—'} · {co.phone}</div>
          </div>
          <div style={{ textAlign: 'right', minWidth: 160 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.primary, letterSpacing: 0.5, textTransform: 'uppercase' }}>{DOCS[kind]}</div>
            <div style={{ ...mono, fontWeight: 700, marginTop: 4 }}>{no}</div>
            <div style={{ fontSize: 12.5, color: C.muted }}>Date {date(receipt ? txs[0]?.clearsOn || deal.date : deal.submittedOn || deal.date)}</div>
          </div>
        </div>
        <KV min={200} items={[
          [receipt ? 'Received From' : 'Bill To', receipt ? (txs[0]?.payer || deal.owner.name) : deal.owner.name],
          ['Case', <Link to={`deals/${deal.id}`} style={mono}>{deal.code}</Link>],
          receipt && ['For Invoice', invNo(deal)],
        ]} />
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
          <thead><tr><th style={{ ...cell, textAlign: 'left', fontSize: 12, color: C.muted }}>Description</th><th style={{ ...cell, textAlign: 'right', fontSize: 12, color: C.muted }}>Amount (RM)</th></tr></thead>
          <tbody>
            {receipt ? txs.map(t => (
              <tr key={t.id}><td style={cell}>{t.code} · {METHODS[t.method]} · {t.ref}<div style={{ fontSize: 12, color: C.muted }}>{t.remark}</div></td><td style={{ ...cell, textAlign: 'right', ...tabular }}>{amt(t.amount)}</td></tr>
            )) : (
              <>
                {!sstOnly && <tr><td style={cell}>{desc}</td><td style={{ ...cell, textAlign: 'right', ...tabular }}>{amt(deal.money.fee)}</td></tr>}
                <tr><td style={cell}>SST {deal.sstPct}%{sstOnly ? ` on professional fee of ${rm(deal.money.fee)}` : ''}</td><td style={{ ...cell, textAlign: 'right', ...tabular }}>{amt(deal.money.sst)}</td></tr>
              </>
            )}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <div style={{ minWidth: 240, fontSize: 15, fontWeight: 700, display: 'flex', justifyContent: 'space-between', borderTop: `2px solid ${C.text}`, paddingTop: 8 }}>
            <span>Total</span><span style={tabular}>{rm(receipt ? paid : sstOnly ? deal.money.sst : deal.money.billed)}</span>
          </div>
        </div>
        <p style={{ fontSize: 12, color: C.muted, marginTop: 28, marginBottom: 0 }}>This is a computer-generated document. No signature is required.</p>
      </div>
    </Page>
  )
}

// ── Video Gallery: Meetings and Trainings ──
export function Videos({ parts }) {
  const { m } = useErp()
  const cate = parts[1] === 'meeting' ? 'meeting' : 'training'
  const [open, setOpen] = useState(null)
  const list = m.data.videos.filter(v => v.cate === cate)
  return (
    <Page title={cate === 'meeting' ? 'Meeting recordings' : 'Training videos'} help={PAGE.videos} sub={cate === 'training' ? 'How-to videos for agents and admins.' : 'Recordings of company meetings.'}
      actions={<button style={btnPrimary} disabled title="Demo only">Add</button>}>
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))' }}>
        {list.map(v => (
          <button key={v.id} onClick={() => setOpen(v)} style={{ all: 'unset', cursor: 'pointer', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', boxShadow: C.shadow }}>
            <div style={{ height: 130, background: `linear-gradient(135deg, ${C.side}, ${C.primaryDark})`, display: 'grid', placeItems: 'center', color: '#fff', position: 'relative' }}>
              <span style={{ width: 46, height: 46, borderRadius: 23, background: 'rgba(255,255,255,0.18)', display: 'grid', placeItems: 'center' }}><Icon name="video" size={22} /></span>
              <span style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 11, fontWeight: 600, background: 'rgba(0,0,0,0.45)', borderRadius: 4, padding: '1px 6px' }}>{v.minutes} min</span>
            </div>
            <div style={{ padding: '10px 12px 12px' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{v.title}</div>
              <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{date(v.date)}</div>
            </div>
          </button>
        ))}
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.title} width={640}>
        {open && (
          <>
            <div style={{ aspectRatio: '16 / 9', background: C.side, borderRadius: 8, display: 'grid', placeItems: 'center', color: '#fff' }}><Icon name="video" size={36} /></div>
            <p style={{ fontSize: 13.5, color: C.muted }}>{date(open.date)} · {open.minutes} min · {open.description}</p>
          </>
        )}
      </Modal>
    </Page>
  )
}

// ── Settings (the signed-in user) ──
export function Settings({ me }) {
  const { setup } = useErp()
  return (
    <Page title="My profile & settings" help={PAGE.settings} sub="Your profile, password and personal information.">
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', alignItems: 'start' }}>
        <Card title="Profile">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 14 }}>
            <Avatar name={me?.name || 'Demo'} size={56} />
            <div><b style={{ fontSize: 16 }}>{me?.username || 'demo'}</b><div style={{ fontSize: 13, color: C.muted }}>{me?.role}, {setup.company.name}</div></div>
          </div>
          <FormField label="Upload Profile"><FileInput kind="avatar" disabled /></FormField>
        </Card>
        <Card title="Update Password">
          <Notice tone="blue">Sign-in is off in the demo. Passwords are changed from the user menu once sign-in is on.</Notice>
          <div style={{ display: 'grid', gap: 10 }}>
            <FormField label="Current Password"><input type="password" style={field} disabled /></FormField>
            <FormField label="New Password"><input type="password" style={field} disabled /></FormField>
          </div>
        </Card>
        <Card title="Personal Information">
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(200px, 100%), 1fr))' }}>
            {['IC Name', 'E-Mail', 'Phone', 'House Address'].map(l => <FormField key={l} label={l}><input style={field} defaultValue={l === 'IC Name' ? me?.name : ''} /></FormField>)}
            <FormField label="Bank"><select style={{ ...sel, width: '100%' }}>{BANKS.map(b => <option key={b}>{b}</option>)}</select></FormField>
            <FormField label="Bank Account"><input style={field} /></FormField>
          </div>
          <button style={{ ...btnPrimary, marginTop: 14 }} disabled title="Demo only">Update Information</button>
        </Card>
        <Card title="Your Org Chart"><TeamTree /></Card>
      </div>
    </Page>
  )
}

// ── System Settings: company details (from Setup) and property types ──
export function SystemSettings() {
  const { m, setup } = useErp()
  const co = setup.company
  const counts = {}
  for (const l of m.data.listings) counts[l.category] = (counts[l.category] || 0) + 1
  const types = Object.keys(CATEGORIES).map((name, i) => ({ id: i + 1, name, cate: LISTING_CATEGORY[listingCategory({ category: name })], n: counts[name] || 0 }))
  return (
    <Page title="System settings" help={PAGE.system} sub="Company details print on invoices, receipts and salary slips.">
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(400px, 100%), 1fr))', alignItems: 'start' }}>
        <Card title="Company Details" actions={<button style={btn} onClick={() => go('setup/company')}>Edit in Setup</button>}>
          <KV min={180} items={[['Company Name', co.name], ['Company Reg. Number', co.regNo], ['Estate Agency Licence', co.licenceNo], ['SST Number', co.sstNo], ['Company Address', co.address],
            ['Bank accounts', setup.bankAccounts.map(a => `${a.bank} ${maskAcc(a.accountNo)}`).join(' · ')]]} />
        </Card>
        <Card title="Property Type" sub="Types agents pick on a listing">
          <DataTable rows={types} narrowAt={420} columns={[
            { key: 'no', label: 'No', render: t => t.id },
            { key: 'name', label: 'Type Name', render: t => <span>{t.name}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{t.cate}</span></span> },
            { key: 'n', label: 'Listings', align: 'right', render: t => t.n },
          ]} />
        </Card>
      </div>
    </Page>
  )
}

// ── View Org. Chart ──
export function OrgChart() {
  return (
    <Page title="Org Chart" help={PAGE.orgChart} sub="Branches, leaders and the people under them, with each person's tier.">
      <Card><TeamTree /></Card>
    </Page>
  )
}


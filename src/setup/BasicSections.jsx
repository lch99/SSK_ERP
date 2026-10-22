import { useState } from 'react'
import * as P from '../../shared/payout.js'
import { C, inp, sel, btn } from '../styles.js'
import Section from './Section.jsx'
import { useDraft } from './useDraft.js'
import { Field, Group, Choice, grid } from './ui.jsx'
import { useFeedback } from '../erp/feedback.jsx'

const full = { ...inp, width: '100%' }
const MY_BANKS = ['Maybank', 'CIMB Bank', 'Public Bank', 'RHB Bank', 'Hong Leong Bank', 'AmBank', 'UOB Malaysia', 'OCBC Bank',
  'Bank Islam', 'Bank Rakyat', 'Alliance Bank', 'Affin Bank', 'HSBC Malaysia', 'Standard Chartered', 'BSN', 'Agrobank']

// ── Company and branches ─────────────────────────────────────────────────────
// One page, saved together: who the company is, its offices, and its banks.

export function CompanySection({ setup, save, step, done }) {
  const [d, setD, coDirty, coReset] = useDraft({ ...setup.company, bankAccounts: setup.bankAccounts || [] })
  const [branches, setBranches, brDirty, brReset] = useDraft(setup.branches)
  const set = k => e => setD({ ...d, [k]: e.target.value })
  const accounts = d.bankAccounts
  const setAcc = (i, k, v) => setD({ ...d, bankAccounts: accounts.map((a, j) => (j === i ? { ...a, [k]: v } : a)) })
  const addAcc = () => setD({ ...d, bankAccounts: [...accounts, { id: null, bank: '', accountName: d.name, accountNo: '',
    purpose: accounts.some(a => a.purpose === 'operating') ? 'client' : 'operating' }] })

  return (
    <Section id="company" step={step} title="Company and branches" done={done} dirty={coDirty || brDirty} onReset={() => { coReset(); brReset() }}
      hint="Who the company is and where its offices are. These details print on payment vouchers, statements and receipts."
      errors={[...P.validateCompany(d), ...P.validateBranches(branches), ...P.validateBankAccounts(accounts)]}
      onSave={() => save([['company', d], ['branches', { branches }]])}>

      <Group first title="Company details">
        <div style={grid(240)}>
          <Field title="Company name *"><input style={full} value={d.name} onChange={set('name')} placeholder="e.g. SubSaleKing Sdn Bhd" /></Field>
          <Field title="SSM registration no. *"><input style={full} value={d.regNo} onChange={set('regNo')} placeholder="e.g. 202301011876 (1505798-D)" /></Field>
          <Field title="SST registration no." help="Leave blank if not SST-registered."><input style={full} value={d.sstNo} onChange={set('sstNo')} /></Field>
          <Field title="Phone"><input style={full} value={d.phone} onChange={set('phone')} /></Field>
          <Field title="Email"><input style={full} type="email" value={d.email} onChange={set('email')} /></Field>
        </div>
        <Field title="Address" style={{ marginTop: 12 }}>
          <textarea style={{ ...full, minHeight: 60, resize: 'vertical' }} value={d.address} onChange={set('address')} />
        </Field>
      </Group>

      <Group title="Estate agency licence" note="Required by the Board of Valuers, Appraisers, Estate Agents and Property Managers (BOVAEPM). The firm number and the REA in charge must appear on documents.">
        <div style={grid(240)}>
          <Field title="Firm registration no. *"><input style={full} value={d.licenceNo} onChange={set('licenceNo')} placeholder="e.g. E (1) 1234" /></Field>
          <Field title="Registered Estate Agent in charge *"><input style={full} value={d.reaName} onChange={set('reaName')} placeholder="Full name" /></Field>
          <Field title="REA registration no. *"><input style={full} value={d.reaNo} onChange={set('reaNo')} placeholder="e.g. E 1234" /></Field>
        </div>
      </Group>

      <Group title="Branches" note="Each office. Even a single office counts as one branch. The short code (e.g. TD) goes into case and voucher numbers, so keep it short and don't change it once deals exist.">
        <BranchList setup={setup} list={branches} setList={setBranches} />
      </Group>

      <Group title="Bank accounts" note="Where money comes in and goes out. Agents are paid from the Operating account; clients' deposits sit in the Client account.">
        <datalist id="my-banks">{MY_BANKS.map(b => <option key={b} value={b} />)}</datalist>
        {accounts.map((a, i) => (
          <div key={a.id ?? `new-${i}`} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 8 }}>
            <div style={grid(180)}>
              <Field title="Bank"><input style={full} list="my-banks" value={a.bank} onChange={e => setAcc(i, 'bank', e.target.value)} placeholder="Choose or type" /></Field>
              <Field title="Account name"><input style={full} value={a.accountName} onChange={e => setAcc(i, 'accountName', e.target.value)} /></Field>
              <Field title="Account no."><input style={full} inputMode="numeric" value={a.accountNo} onChange={e => setAcc(i, 'accountNo', e.target.value)} /></Field>
              <Field title="Used for">
                <select style={{ ...sel, width: '100%' }} value={a.purpose} onChange={e => setAcc(i, 'purpose', e.target.value)}>
                  <option value="">Choose…</option>
                  {P.BANK_PURPOSES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: C.muted }}>{P.BANK_PURPOSES.find(p => p.value === a.purpose)?.desc}</span>
              <button style={{ ...btn, fontSize: 13, padding: '4px 10px' }} onClick={() => setD({ ...d, bankAccounts: accounts.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          </div>
        ))}
        <button style={btn} onClick={addAcc}>+ Add bank account</button>
      </Group>
    </Section>
  )
}

function BranchList({ setup, list, setList }) {
  const [open, setOpen] = useState(null)   // which branch shows its details
  const fb = useFeedback()
  const edit = (i, k, v) => setList(list.map((b, j) => (j === i ? { ...b, [k]: v } : b)))
  const remove = async i => {
    const b = list[i]
    const plan = b.id != null ? P.planIndexFor(setup.plans, b.id) : 0
    const agents = (setup.agents || []).filter(a => a.branchId === b.id).length
    const lose = [plan > 0 && `leaves the ${P.planLabel(setup.plans[plan], plan)} tier plan`, agents && `deletes its ${agents} agent${agents === 1 ? '' : 's'}`].filter(Boolean)
    if (lose.length && !(await fb.confirm({ title: `Remove ${b.name}?`, body: `Removing ${b.name} ${lose.join(' and ')} when you save.`, confirmLabel: 'Remove branch', danger: true }))) return
    setList(list.filter((_, j) => j !== i))
  }
  const add = () => { setList([...list, { id: null, name: '', code: '', address: '', phone: '', manager: '' }]); setOpen(list.length) }

  return (
    <>
      {list.map((b, i) => (
        <div key={b.id ?? `new-${i}`} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field title="Branch name" style={{ flex: '1 1 200px' }}>
              <input style={full} value={b.name} onChange={e => edit(i, 'name', e.target.value)} placeholder="e.g. Taman Desa" />
            </Field>
            <Field title="Code" style={{ width: 80 }}>
              <input style={{ ...full, textTransform: 'uppercase' }} maxLength={4} value={b.code} onChange={e => edit(i, 'code', e.target.value.toUpperCase())} placeholder="TD" />
            </Field>
            <button style={btn} onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>{open === i ? 'Hide details' : 'Details'}</button>
            <button style={btn} onClick={() => remove(i)} title="Remove branch" aria-label={`Remove ${b.name || 'branch'}`}>✕</button>
          </div>
          {open !== i && (b.manager || b.phone) && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{[b.manager && `Manager: ${b.manager}`, b.phone].filter(Boolean).join(' · ')}</div>
          )}
          {open === i && (
            <div style={{ ...grid(200), marginTop: 10 }}>
              <Field title="Branch manager"><input style={full} value={b.manager || ''} onChange={e => edit(i, 'manager', e.target.value)} /></Field>
              <Field title="Phone"><input style={full} value={b.phone || ''} onChange={e => edit(i, 'phone', e.target.value)} /></Field>
              <Field title="Address" style={{ gridColumn: '1 / -1' }}>
                <input style={full} value={b.address || ''} onChange={e => edit(i, 'address', e.target.value)} />
              </Field>
            </div>
          )}
        </div>
      ))}
      {!list.length && <p style={{ color: C.muted, fontSize: 14, margin: '0 0 8px' }}>No branches yet.</p>}
      <button style={btn} onClick={add}>+ Add branch</button>
    </>
  )
}

// ── Deal types, tax and sharing ──────────────────────────────────────────────

const RATE_BASIS = { sale: 'of the selling price', rental: "of one month's rent", project: 'of the selling price' }

export function DealTypesSection({ setup, save, step, done }) {
  const [d, setD, dirty, reset] = useDraft(setup.dealTypes)
  const edit = (dt, k, v) => setD({ ...d, [dt]: { ...d[dt], [k]: v } })
  const pct = (k, max = 100) => (
    <span style={{ whiteSpace: 'nowrap' }}>
      <input style={{ ...inp, width: 80 }} type="number" step="0.01" min="0" max={max} value={d[k] ?? ''} onChange={e => setD({ ...d, [k]: e.target.value })} /> %
    </span>
  )
  const sst = Number(d.sstPct) || 0
  return (
    <Section id="dealTypes" step={step} title="Deals, tax and sharing" done={done} dirty={dirty} onReset={reset}
      hint="What kinds of deals the company does, its usual fees, and the tax and sharing rules applied to every deal. All of these can still be changed on a single deal."
      errors={P.validateDealTypes(d)} onSave={() => save('deal-types', d)}>

      <Group first title="Deal types and usual commission">
        {P.DEAL_TYPES.map(dt => (
          <div key={dt} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '0 0 150px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!d[dt]?.enabled} onChange={e => edit(dt, 'enabled', e.target.checked)} style={{ accentColor: C.primary, width: 16, height: 16 }} />
              {P.DEAL_TYPE_LABELS[dt]}
            </label>
            {d[dt]?.enabled ? (
              <span style={{ fontSize: 13, color: C.muted, whiteSpace: 'nowrap' }}>
                <input style={{ ...inp, width: 80 }} type="number" step="0.01" min="0" value={d[dt]?.defaultRate ?? ''}
                  aria-label={`${P.DEAL_TYPE_LABELS[dt]} commission rate`} onChange={e => edit(dt, 'defaultRate', e.target.value)} /> % {RATE_BASIS[dt]}
              </span>
            ) : <span style={{ fontSize: 13, color: C.muted }}>Not used</span>}
          </div>
        ))}
      </Group>

      <Group title="SST on commission" note="Service tax charged on the agency's commission.">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
          <Field title="Rate">{pct('sstPct')}</Field>
        </div>
        <Choice name="sstMode" value={d.sstMode} onChange={v => setD({ ...d, sstMode: v })} recommended="on_top" min={240}
          options={P.SST_MODES.map(m => ({ ...m,
            desc: m.value === 'on_top' ? `Client pays commission + SST (RM 10,000 + RM ${(100 * sst).toLocaleString('en-MY')}).`
              : `The commission already includes SST (RM 10,000 includes RM ${(10000 * sst / (100 + sst)).toFixed(2)}).` }))} />
      </Group>

      <Group title="Withholding tax on agents" note="Under LHDN rules (s.107D), the company withholds tax from commission paid to agents who are not employees and pays it to LHDN. Agents can be exempted one by one later.">
        <Field title="Withholding tax">{pct('whtPct', 10)}</Field>
      </Group>

      <Group title="Sharing with others" note="The usual starting point; each deal can be changed.">
        <div style={grid(240)}>
          <Field title="Co-agency (co-broke) — our share" help="When another agency is on the other side of the deal.">{pct('coaSharePct')}</Field>
          <Field title="Referral fee" help="Paid to an outside person who brought the client, as a % of our commission.">{pct('referralPct')}</Field>
        </div>
      </Group>
    </Section>
  )
}

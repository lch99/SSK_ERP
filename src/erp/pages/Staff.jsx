import { useMemo, useState } from 'react'
import * as P from '../../../shared/payout.js'
import { C, btn, btnPrimary, sel } from '../../styles.js'
import { ROLE_COLORS } from '../../setup/colors.js'
import OutlineTree from '../../setup/OutlineTree.jsx'
import { useErp } from '../ErpContext.jsx'
import { STAFF_STATUS, DEAL_STATUS, PAYOUT_STATUS, ACCOUNT_TYPES, sum } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, Chips, DataTable, Status, Pill, Avatar, Who, Link, Empty, KV, Progress, Stat, Notice, FormField, cols, go, mono, tabular, field } from '../ui.jsx'
import { CARD, COLUMN, PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { rm, date, maskIc, maskAcc, num } from '../format.js'
import { lineRole } from './Payouts.jsx'
import { BANKS } from './options.js'

// Agents & staff ("H.R Portal" in the current ERP): the people, their position (tier), upline and status.
export default function Staff({ parts }) {
  if (parts[1] === 'new') return <AddStaff />
  if (parts[1]) return <Profile id={Number(parts[1])} />
  return <StaffList />
}

const roleTone = (setup, code) => ROLE_COLORS[Math.max(0, setup.roles.findIndex(r => r.code === code)) % ROLE_COLORS.length]
export function RoleTag({ code, setup }) {
  if (!code) return null
  const color = roleTone(setup, code)
  return <span style={{ fontSize: 11.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999, color, background: `${color}14`, border: `1px solid ${color}40`, whiteSpace: 'nowrap' }}>{code}</span>
}

function StaffList() {
  const { m, scoped: d, setup } = useErp()
  const [tab, setTab] = useState('all')
  const [view, setView] = useState('list')
  const [q, setQ] = useState('')
  const match = useMemo(() => {
    const words = q.trim().toLowerCase()
    return d.staff.filter(s => !words || [s.name, s.short, s.code, s.phone, s.email, s.username, s.ic].join(' ').toLowerCase().includes(words))
  }, [d.staff, q])
  const rows = tab === 'all' ? match : match.filter(s => s.status === tab)

  const columns = [
    { key: 'who', label: 'Staff-ID · User Name', sort: s => s.code, render: s => <Who name={s.short} sub={`${s.code} · ${s.username}`} size={30} /> },
    { key: 'ic', label: 'IC Name · IC No', sort: s => s.name, render: s => <span style={{ fontSize: 13 }}>{s.name}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{maskIc(s.ic)}</span></span> },
    { key: 'contact', label: 'Phone 1 · E-Mail', render: s => <span style={{ fontSize: 13 }}>{s.phone}<span style={{ display: 'block', fontSize: 12, color: C.muted, overflowWrap: 'anywhere' }}>{s.email}</span></span> },
    { key: 'level', label: 'Position Request', help: COLUMN.staffPosition, sort: s => m.tierInfo(s.id).idx, render: s => {
      const t = m.tierInfo(s.id)
      return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><Pill tone="gray" dot={false}>{P.tierLabel(t.tier)}</Pill><RoleTag code={s.role} setup={setup} /></span>
    } },
    { key: 'closing', label: 'Closing Amount', help: COLUMN.staffClosing, align: 'right', sort: s => m.credit(s.id).lifetime, render: s => rm(m.credit(s.id).lifetime) },
    { key: 'upline', label: 'Upline', sort: s => m.staffName(s.uplineId), render: s => (s.uplineId ? m.staffName(s.uplineId) : <span style={{ color: C.muted }}>{m.branchName(s.branchId)}</span>) },
    { key: 'status', label: 'Status', render: s => <Status of={STAFF_STATUS} value={s.status} /> },
  ]
  const active = d.staff.filter(s => s.status === 'active')
  return (
    <Page title="Agents & staff" help={PAGE.staff} sub={<>{active.length} active · position (tier), upline and pay come from Setup</>}
      actions={<button style={btnPrimary} onClick={() => go('staff/new')}>Add agent or staff</button>}>
      <Card pad={16}>
        <Tabs value={view} onChange={setView} tabs={[{ key: 'list', label: 'Staff list' }, { key: 'tree', label: 'Org chart' }]} />
        {view === 'tree' ? <TeamTree /> : (
          <>
            <Toolbar>
              <SearchBox value={q} onChange={setQ} placeholder="Name, code, phone or email" />
              <Chips label="Status" value={tab} onChange={setTab} options={['all', 'active', 'inactive', 'pending'].map(k => ({
                key: k, label: k === 'all' ? 'All' : STAFF_STATUS[k].label, count: k === 'all' ? match.length : match.filter(s => s.status === k).length }))} />
            </Toolbar>
            <DataTable columns={columns} rows={rows} onRow={s => go(`staff/${s.id}`)} defaultSort={{ key: 'who', dir: 'asc' }} narrowAt={980}
              empty={q ? `No one matches “${q}”` : 'No one here'} onClear={q || tab !== 'all' ? () => { setQ(''); setTab('all') } : undefined} />
          </>
        )}
      </Card>
    </Page>
  )
}

export function TeamTree() {
  const { m, scoped: d, setup } = useErp()
  const ids = new Set(d.staff.map(s => s.id))
  const node = s => {
    const t = m.tierInfo(s.id)
    const kids = (m.downline[s.id] || []).filter(k => ids.has(k.id) && k.status !== 'inactive')
    return {
      key: `s${s.id}`, open: !!s.role && kids.some(k => k.role), tone: s.role ? roleTone(setup, s.role) : C.border,
      label: <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Link to={`staff/${s.id}`} style={{ color: C.text }}>{s.short}</Link><RoleTag code={s.role} setup={setup} />
        <Pill tone="gray" dot={false}>{t.tier.name} · {t.tier.agentRate}%</Pill>
        {s.status === 'pending' && <Pill tone="amber">New joiner</Pill>}
      </span>,
      meta: <>{s.role ? `${m.roleName(s.role)} · ` : ''}{rm(m.credit(s.id).year)} commission in {m.year}{kids.length ? ` · ${kids.length} directly under` : ''}</>,
      children: kids.sort((a, b) => (b.role ? 1 : 0) - (a.role ? 1 : 0) || a.short.localeCompare(b.short)).map(node),
    }
  }
  const nodes = m.setup.branches.filter(b => d.staff.some(s => s.branchId === b.id)).map(b => ({
    key: `b${b.id}`, label: <>{b.name} <span style={{ color: C.muted, fontWeight: 400 }}>({b.code})</span></>,
    meta: `${d.staff.filter(s => s.branchId === b.id && s.status !== 'inactive').length} people${b.manager ? ` · manager ${b.manager}` : ''}`,
    children: d.staff.filter(s => s.branchId === b.id && s.status !== 'inactive' && (s.uplineId == null || !ids.has(s.uplineId))).map(node),
  }))
  return (
    <div>
      {setup.roles.length > 0 && (
        <p style={{ fontSize: 13, color: C.muted, margin: '0 0 10px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          Upline levels: {[...setup.roles].reverse().map(r => <span key={r.code} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><RoleTag code={r.code} setup={setup} />{r.name}</span>)}
        </p>
      )}
      <OutlineTree nodes={nodes} />
    </div>
  )
}

function Profile({ id }) {
  const fb = useFeedback()
  const erp = useErp()
  const { m, setup } = erp
  const s = m.staff[id]
  if (!s) return <Page title="Not found" back={{ to: 'staff', label: 'Agents & staff' }}><Empty title="This person no longer exists" /></Page>
  const t = m.tierInfo(id)
  const chain = m.chain(id)
  const deals = m.dealsOf(id).sort((a, b) => b.date.localeCompare(a.date))
  const lines = (m.payoutsByStaff[id] || []).slice().sort((a, b) => b.date.localeCompare(a.date))
  const holders = P.uplineHolders(m.staff, id, setup.roles)
  const downline = (m.downline[id] || []).filter(k => k.status !== 'inactive')
  const yearDeals = deals.filter(d => d.date.startsWith(m.year) && d.status !== 'cancelled' && d.status !== 'draft')

  return (
    <Page back={{ to: 'staff', label: 'Agents & staff' }} help={PAGE.profile}
      actions={<>
        <Select plain label="Enable/Unlock Staff" value={s.status} onChange={v => fb.run(() => erp.setStaffStatus(s.id, v), `${s.short} is now ${STAFF_STATUS[v].label}`)}
          options={[{ value: 'active', label: 'Enabled (Active)' }, { value: 'inactive', label: 'Disabled (Inactive)' }, { value: 'pending', label: 'Pending' }]} />
        <button style={btn} onClick={() => go(`deals/team`)}>E-Forms</button>
      </>}
      title={<span style={{ display: 'inline-flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><Avatar name={s.short} size={42} />{s.short}<Status of={STAFF_STATUS} value={s.status} /></span>}
      sub={<>{s.name} · {s.code} · {m.branchName(s.branchId)}{s.role ? ` · ${m.roleName(s.role)}` : ''} · joined {date(s.joined)}{s.leftOn ? ` · left ${date(s.leftOn)}` : ''}</>}>
      <div style={{ ...cols(210, 14), marginBottom: 16 }}>
        <Stat label="Tier now" value={P.tierLabel(t.tier)} sub={`Agent rate ${t.tier.agentRate}%${t.kept ? ' · kept from last year' : ''}`} tone="brand" icon="reports" />
        <Stat label={`Commission in ${m.year}`} value={rm(t.yearly)} sub={`Lifetime ${rm(t.lifetime)}`} />
        <Stat label={`Earned in ${m.year}`} value={rm(m.earned(id, { thisYear: true }))} sub="Own deals and upline overrides" />
        <Stat label={`Deals in ${m.year}`} value={num(yearDeals.length)} sub={`${yearDeals.filter(d => d.agentId === id).length} closed by them · ${yearDeals.filter(d => d.holderId === id && d.agentId !== id).length} on their listings`} />
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          <Card title="Tier progress" help={CARD.tierProgress} sub={t.next ? `Next: ${P.tierLabel(t.next)} at ${t.next.agentRate}%` : 'At the top tier'}>
            {t.next && (
              <>
                <Progress value={t.progress} height={10} label="Progress to next tier" />
                <p style={{ fontSize: 13, margin: '8px 0 14px', color: C.muted }}>
                  <b style={{ color: C.text }}>{rm(t.toNext)}</b> more {t.next.basis === 'yearly' ? `commission in ${m.year}` : 'lifetime commission'} to reach {t.next.name}
                  {' '}(at {rm(t.next.threshold)}{t.next.basis === 'yearly' ? ' this year' : ''}).
                </p>
              </>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {t.tiers.map((x, i) => (
                <span key={x.id} title={`${P.tierLabel(x)} · from ${rm(x.threshold)} ${x.basis}`} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, fontWeight: i === t.idx ? 700 : 500,
                  background: i === t.idx ? C.primary : i < t.idx ? C.primaryBg : C.grayBg, color: i === t.idx ? '#fff' : i < t.idx ? C.primary : C.muted }}>
                  {x.name} · {x.agentRate}%
                </span>
              ))}
            </div>
          </Card>
          <Card title="Recent deals" sub="Closed by them, or on a listing they hold">
            <DataTable rows={deals} pageSize={8} narrowAt={380} empty="No deals yet" onRow={d => go(`deals/${d.id}`)} columns={[
              { key: 'code', label: 'Case', render: d => <span><b style={{ ...mono, color: C.primaryDark }}>{d.code}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{date(d.date)}</span></span> },
              { key: 'prop', label: 'Property', render: d => <span>{d.property.title}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{d.agentId === id ? (d.holderId === id || d.holderId == null ? 'Both sides' : 'Sales side') : 'Listing side'}</span></span> },
              { key: 'fee', label: 'Fee', align: 'right', render: d => rm(d.fee) },
              { key: 'status', label: 'Status', render: d => <Status of={DEAL_STATUS} value={d.status} /> },
            ]} />
          </Card>
          <Card title="Payout lines" help={CARD.payoutLines} sub={`${rm(sum(lines.filter(l => l.status === 'paid'), l => l.amount))} paid to date`}>
            <DataTable rows={lines} pageSize={8} narrowAt={380} empty="No payouts yet" columns={[
              { key: 'deal', label: 'Deal', render: l => <span><Link to={`deals/${l.dealId}`} style={mono}>{m.deals[l.dealId].code}</Link><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{lineRole(l, m)}</span></span> },
              { key: 'date', label: 'Closed', nowrap: true, render: l => date(l.date, { short: true }) },
              { key: 'amount', label: 'Amount', align: 'right', render: l => <b>{rm(l.amount)}</b> },
              { key: 'status', label: 'Status', render: l => <Status of={PAYOUT_STATUS} value={l.status} /> },
            ]} />
          </Card>
        </div>
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          <Card title="Uplines" help={CARD.uplines} sub={setup.roles.length ? 'Who shares the upline pool on their deals' : 'No upline levels in Setup'}>
            {chain.length ? (
              <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {[...chain].reverse().map(p => (
                  <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ flex: 1, minWidth: 0 }}><Who name={p.short} to={`staff/${p.id}`} size={26} sub={p.role ? m.roleName(p.role) : 'Negotiator'} /></span>
                    <RoleTag code={p.role} setup={setup} />
                    {p.role && holders[p.role] === p.id ? <Pill tone="green" dot={false}>Gets {p.role} share</Pill> : <span style={{ fontSize: 12, color: C.muted }}>—</span>}
                  </li>
                ))}
                <li style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                  <span style={{ flex: 1 }}><Who name={s.short} size={26} sub="This person" /></span>
                </li>
              </ol>
            ) : <p style={{ margin: 0, color: C.muted, fontSize: 13.5 }}>Nobody above. On their deals the company keeps whatever their tier doesn’t pay.</p>}
          </Card>
          {downline.length > 0 && (
            <Card title={`Directly under ${s.short}`} help={CARD.downline} sub={`${downline.length} people`}>
              {downline.map(k => (
                <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ flex: 1, minWidth: 0 }}><Who name={k.short} to={`staff/${k.id}`} size={26} sub={P.tierLabel(m.tierInfo(k.id).tier)} /></span>
                  <RoleTag code={k.role} setup={setup} />
                  <span style={{ fontSize: 12.5, ...tabular }}>{rm(m.credit(k.id).year)}</span>
                </div>
              ))}
            </Card>
          )}
          <Card title="Details">
            <KV min={170} items={[
              ['User Name', s.username], ['Account Type', ACCOUNT_TYPES[s.type] || 'Agent'], ['IC Name', s.name], ['IC No', maskIc(s.ic)],
              ['NameCard Name', s.short], ['Phone 1', s.phone], ['E-Mail', s.email], ['Birthday', s.birthday ? date(s.birthday) : '—'],
              ['Language', s.language], ['Education', s.education], ['Address', s.address],
              ['REN', s.renNo], ['Bank', `${s.bank} ${maskAcc(s.account)}`],
              ['Withholding tax', s.whtExempt ? 'Exempt' : `${setup.dealTypes.whtPct}% on each payslip`],
            ]} />
          </Card>
        </div>
      </div>
    </Page>
  )
}

// Add New Agent/Staff: the current form's fields, grouped. Saved as Pending.
function AddStaff() {
  const fb = useFeedback()
  const erp = useErp()
  const { m, setup } = erp
  const [f, setF] = useState({ branchId: String(setup.branches[0]?.id || ''), type: 'staff', sex: 'male', smoker: 'no', marital: 'single', houseOwner: 'own', transportOwn: 'yes' })
  const [error, setError] = useState(null)
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const branchId = Number(f.branchId)
  const uplines = m.data.staff.filter(s => s.branchId === branchId && s.status !== 'inactive').sort((a, b) => (b.role ? 1 : 0) - (a.role ? 1 : 0) || a.short.localeCompare(b.short))
  const tiers = P.tiersFor(setup, branchId)
  const radio = (k, opts) => (
    <div style={{ display: 'flex', gap: 14, paddingTop: 6, flexWrap: 'wrap' }}>
      {opts.map(([v, l]) => <label key={v} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 14 }}><input type="radio" checked={f[k] === v} onChange={() => setF({ ...f, [k]: v })} style={{ accentColor: C.primary }} />{l}</label>)}
    </div>
  )
  const text = (k, label, props = {}) => <FormField label={label} required={props.required} wide={props.wide}><input style={field} value={f[k] || ''} onChange={set(k)} type={props.type || 'text'} placeholder={props.placeholder} /></FormField>
  const select = (k, label, options, props = {}) => (
    <FormField label={label} required={props.required}>
      <select style={{ ...sel, width: '100%' }} value={f[k] || ''} onChange={set(k)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </FormField>
  )
  const section = (title, children) => (
    <Card title={title}><div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))' }}>{children}</div></Card>
  )
  async function save() {
    setError(null)
    try {
      await erp.addStaff({ ...f, name: f.icName, short: f.nameCard, ic: [f.ic1, f.ic2, f.ic3].filter(Boolean).join('-'), sex: f.sex })
      fb.toast(`${f.nameCard || f.icName} added as Pending. Enable them on their profile when HR is done.`)
      go('staff')
    } catch (e) { setError(e.message); window.scrollTo(0, 0) }
  }
  return (
    <Page title="Add agent or staff" help={PAGE.staffNew} back={{ to: 'staff', label: 'Agents & staff' }} sub="New staff start as Pending at the first tier, until HR enables them.">
      {error && <Notice tone="red">{error}</Notice>}
      <div style={{ display: 'grid', gap: 16 }}>
        {section('Account', <>
          {text('username', 'User Name', { required: true })}
          {text('password', 'Password', { type: 'password', required: true })}
          {select('type', 'Account Type', Object.entries(ACCOUNT_TYPES))}
          {select('branchId', 'Branch', setup.branches.map(b => [String(b.id), b.name]), { required: true })}
          {select('position', 'Position Request', tiers.map(t => [String(t.id), P.tierLabel(t)]))}
          {select('uplineId', 'Upline Agent', [['', 'No upline'], ...uplines.map(s => [String(s.id), `${s.short}${s.role ? ` (${s.role})` : ''} ${s.code}`])])}
          {setup.roles.length > 0 && select('role', 'Upline level they hold', [['', 'None (negotiator)'], ...setup.roles.map(r => [r.code, `${r.code} · ${r.name}`])])}
        </>)}
        {section('Personal Details', <>
          {text('icName', 'IC Name', { required: true })}
          <FormField label="IC No">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input style={{ ...field, flex: 3 }} maxLength={6} placeholder="000000" value={f.ic1 || ''} onChange={set('ic1')} aria-label="IC first part" />–
              <input style={{ ...field, flex: 1.4 }} maxLength={2} placeholder="00" value={f.ic2 || ''} onChange={set('ic2')} aria-label="IC middle part" />–
              <input style={{ ...field, flex: 2 }} maxLength={4} placeholder="0000" value={f.ic3 || ''} onChange={set('ic3')} aria-label="IC last part" />
            </div>
          </FormField>
          {text('nameCard', 'NameCard Name')}
          {text('phone', 'Phone Number 1')}{text('phone2', 'Phone Number 2')}{text('email', 'E-Mail', { type: 'email' })}{text('facebook', 'Facebook')}
          {text('birthday', 'Birthday', { type: 'date' })}
          <FormField label="Sex">{radio('sex', [['male', 'Male'], ['female', 'Female']])}</FormField>
          <FormField label="Smoker">{radio('smoker', [['yes', 'Yes'], ['no', 'No']])}</FormField>
          <FormField label="Marital Status">{radio('marital', [['single', 'Single'], ['married', 'Married']])}</FormField>
          {text('children', 'No. of Children', { type: 'number' })}
          {text('address', 'House Address', { wide: true })}
          <FormField label="House">{radio('houseOwner', [['own', 'Own'], ['rent', 'Rent']])}</FormField>
          <FormField label="Own Transport">{radio('transportOwn', [['yes', 'Yes'], ['no', 'No']])}</FormField>
          {text('transportType', 'Transport Type')}{text('transportModel', 'Transport Model')}
        </>)}
        {section('Background', <>
          {select('language', 'Language', [['', 'Select'], ['English', 'English'], ['Malay', 'Malay'], ['Chinese', 'Chinese'], ['Indian', 'Indian'], ['Others', 'Others']])}
          {text('education', 'Education Level')}{text('prevJob', 'Previous Job')}{text('prevPosition', 'Previous Job Position')}
          {text('prevIncome', 'Previous Job Income (RM)', { type: 'number' })}{text('expIncome', 'Expected Income (RM)', { type: 'number' })}{text('expPosition', 'Expected Position')}
        </>)}
        {section('Bank and Documents', <>
          {select('bank', 'Bank Name', [['', 'Select'], ...BANKS.map(b => [b, b])])}
          {text('account', 'Bank Account')}
          {['Application Document', 'IC Copy', 'Joining Fee P.o.P'].map(d => <FormField key={d} label={d}><input type="file" style={{ ...field, padding: 5 }} /></FormField>)}
        </>)}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        <button style={btnPrimary} onClick={save}>Submit</button>
        <button style={btn} onClick={() => go('staff')}>Cancel</button>
      </div>
    </Page>
  )
}

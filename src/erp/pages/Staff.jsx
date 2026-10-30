import { useMemo, useState } from 'react'
import * as P from '../../../shared/payout.js'
import * as A from '../../../shared/access.js'
import { C, btn, btnPrimary, sel } from '../../styles.js'
import { ROLE_COLORS } from '../../setup/colors.js'
import { useErp } from '../ErpContext.jsx'
import { STAFF_STATUS, DEAL_STATUS, PAYOUT_STATUS, ACCOUNT_TYPES, AGENT_TYPES, isAgent, sum } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, Chips, DataTable, Status, Pill, Avatar, Who, Link, Empty, KV, Progress, Stat, Notice, FormField, FileInput, TextArea, Menu, Modal, cols, go, mono, small, tabular, field } from '../ui.jsx'
import { ACCESS } from '../../demo/erpSample.js'
import Icon from '../Icon.jsx'
import { CARD, COLUMN, PAGE } from '../help.js'
import { useFeedback } from '../feedback.jsx'
import { rm, date, maskIc, maskAcc, num, ago } from '../format.js'
import { lineRole } from './Payouts.jsx'
import { BANKS } from './options.js'
import { OrgTree } from './OrgChart.jsx'
import { buildOrg } from '../org.js'
import { useNarrow } from '../../setup/useNarrow.js'
import { makeXlsx, download, XLSX_TYPE } from '../../setup/sheet.js'
import { NoAccess, useAccess, useCan, useGate } from '../access.jsx'
import { useReview, changedRows, missing, needText, markGaps } from '../review.jsx'

// Agents and office staff ("H.R Portal" in the current ERP is one list for both).
// Agents (Agents module): position (tier), upline and status. Office staff
// (System → Users, #/staff/office): admins, accounting and marketing.
export default function Staff({ parts }) {
  const can = useCan()
  if (parts[1] === 'new') return <StaffForm office={parts[2] === 'office'} />
  if (parts[1] === 'office') return <StaffList key="office" office />
  const id = Number(parts[1])
  if (id) {
    if (parts[2] === 'edit') return can('staff', 'edit') ? <StaffForm key={id} id={id} /> : <NoAccess />
    if (parts[2] === 'marketing') return can('staff', 'full') ? <MarketingStaffs id={id} /> : <NoAccess />
    if (parts[2] === 'chart') return <StaffChart id={id} />
    if (parts[2] === 'profile-doc') return <ProfileDoc id={id} />
    return <Profile id={id} />
  }
  return <StaffList key="agents" />
}

const roleTone = (setup, code) => ROLE_COLORS[Math.max(0, setup.roles.findIndex(r => r.code === code)) % ROLE_COLORS.length]
export function RoleTag({ code, setup }) {
  if (!code) return null
  const color = roleTone(setup, code)
  return <span style={{ fontSize: 11.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999, color, background: `${color}14`, border: `1px solid ${color}40`, whiteSpace: 'nowrap' }}>{code}</span>
}

// Built for thousands of people: counts at the top (each one a filter),
// filters for upline level, tier and a leader's team, 25 rows at a time, and
// the whole filtered list as an Excel file.
function StaffList({ office = false }) {
  const { m, scoped: d, setup } = useErp()
  const can = useCan()
  const [tab, setTab] = useState('all')
  const [view, setView] = useState('list')
  const [q, setQ] = useState('')
  const [level, setLevel] = useState('')     // '' · 'leaders' · a level code · 'none' (no upline level)
  const [tier, setTier] = useState('')       // a tier code (T1…)
  const [leader, setLeader] = useState('')   // a leader's id: only the people under them
  const [quick, setQuick] = useState('')     // 'new' (joined this month) · 'expiring' (within 30 days)
  const [kind, setKind] = useState('')       // office staff: an account type
  // Phones: the counts sit two by two, without icons, so the list starts on the first screen.
  const [statsBox, narrow] = useNarrow(560)

  // Agents or office staff, never both (see isAgent in model.js).
  const people = useMemo(() => d.staff.filter(s => isAgent(s) !== office), [d.staff, office])
  const org = useMemo(() => buildOrg(people), [people])
  const tierOf = useMemo(() => new Map(people.map(s => [s.id, m.tierInfo(s.id).tier])), [people, m])
  const month = m.today.slice(0, 7)
  const soon = addDaysIso(m.today, 30)
  const joinedNow = s => String(s.joined || '').startsWith(month)
  const expiring = s => s.status !== 'inactive' && !!s.expiresOn && s.expiresOn < soon
  const leaders = people.filter(s => s.role)

  const match = useMemo(() => {
    const words = q.trim().toLowerCase()
    const lead = leader ? Number(leader) : null
    return people.filter(s => (!words || [s.name, s.short, s.code, s.phone, s.email, s.username, s.ic].join(' ').toLowerCase().includes(words))
      && (!level || (level === 'leaders' ? !!s.role : level === 'none' ? !s.role : s.role === level))
      && (!tier || tierOf.get(s.id)?.name === tier)
      && (lead == null || (s.id !== lead && org.within(s.id, lead)))
      && (!quick || (quick === 'new' ? joinedNow(s) : expiring(s)))
      && (!kind || s.type === kind))
  }, [people, q, level, tier, leader, quick, kind, org, tierOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = tab === 'all' ? match : match.filter(s => s.status === tab)
  const set = [level, tier, leader, quick, kind].filter(Boolean).length + (tab !== 'all' ? 1 : 0)
  const clear = () => { setQ(''); setTab('all'); setLevel(''); setTier(''); setLeader(''); setQuick(''); setKind('') }

  const count = (list, f) => list.filter(f).length
  const levelOptions = [{ value: '', label: 'All levels' },
    ...(setup.roles.length ? [{ value: 'leaders', label: `All leaders (${num(leaders.length)})` }] : []),
    ...[...setup.roles].reverse().map(r => ({ value: r.code, label: `${r.code} · ${r.name} (${num(count(people, s => s.role === r.code))})` })),
    ...(setup.roles.length ? [{ value: 'none', label: `No upline level (${num(count(people, s => !s.role))})` }] : [])]
  const tierNames = [...new Set(people.map(s => tierOf.get(s.id)?.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const tierOptions = [{ value: '', label: 'All tiers' }, ...tierNames.map(t => ({ value: t, label: `${t} (${num(count(people, s => tierOf.get(s.id)?.name === t))})` }))]
  const rank = s => setup.roles.findIndex(r => r.code === s.role)
  const leaderOptions = [{ value: '', label: 'Anyone' }, ...[...leaders].sort((a, b) => rank(b) - rank(a) || a.short.localeCompare(b.short))
    .map(s => ({ value: String(s.id), label: `${s.short} · ${s.role} (${num(org.team(s.id))})` }))]

  const kindOptions = [{ value: '', label: 'All account types' }, ...Object.entries(ACCOUNT_TYPES).filter(([k]) => !AGENT_TYPES.includes(k))
    .map(([value, label]) => ({ value, label: `${label} (${num(count(people, s => s.type === value))})` }))]

  // The filtered list, every row (not just the page on screen), for Excel.
  const exportRows = () => {
    if (office) {
      const head = ['Staff ID', 'Name', 'IC name', 'User name', 'Account type', 'Branch', 'Phone', 'Email', 'IC no.', 'Status', 'Joined', 'Account expiry', 'Last activity']
      const body = rows.map(s => [s.code, s.short, s.name, s.username, ACCOUNT_TYPES[s.type] || s.type, m.branchName(s.branchId), s.phone, s.email, maskIc(s.ic),
        STAFF_STATUS[s.status]?.label || s.status, s.joined || '', s.expiresOn || '', s.lastActive ? String(s.lastActive).slice(0, 10) : ''])
      download(makeXlsx([{ name: 'Office staff', rows: [head, ...body], widths: [14, 22, 26, 14, 18, 16, 14, 28, 18, 10, 12, 14, 14] }]), `office-staff-${m.today}.xlsx`, XLSX_TYPE)
      return
    }
    const head = ['Staff ID', 'Name', 'IC name', 'User name', 'Branch', 'Upline level', 'Tier', 'Agent rate %', 'Upline', 'Upline staff ID',
      'Direct', 'In team', 'Phone', 'Email', 'IC no.', 'Status', 'Joined', 'Account expiry', 'Closing, lifetime (RM)', `Commission ${m.year} (RM)`, 'Last activity']
    const body = rows.map(s => {
      const t = tierOf.get(s.id), up = s.uplineId ? m.staff[s.uplineId] : null
      return [s.code, s.short, s.name, s.username, m.branchName(s.branchId), s.role ? `${s.role} · ${m.roleName(s.role)}` : '', t?.name || '', t ? Number(t.agentRate) : '',
        up?.short || '', up?.code || '', org.under(s.id).length, org.team(s.id), s.phone, s.email, maskIc(s.ic), STAFF_STATUS[s.status]?.label || s.status,
        s.joined || '', s.expiresOn || '', m.credit(s.id).lifetime, m.credit(s.id).year, s.lastActive ? String(s.lastActive).slice(0, 10) : '']
    })
    const widths = [14, 22, 26, 14, 16, 24, 8, 10, 22, 14, 8, 8, 14, 28, 18, 10, 12, 14, 18, 18, 14]
    download(makeXlsx([{ name: 'Agents', rows: [head, ...body], widths }]), `agents-${m.today}.xlsx`, XLSX_TYPE)
  }

  const columns = [
    { key: 'who', label: 'Staff-ID · User Name', sort: s => s.code, render: s => <Who name={s.short} sub={`${s.code} · ${s.username}`} size={30} /> },
    { key: 'ic', label: 'IC Name · IC No', sort: s => s.name, render: s => <span style={{ fontSize: 13 }}>{s.name}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{maskIc(s.ic)}</span></span> },
    { key: 'contact', label: 'Phone 1 · E-Mail', render: s => <span style={{ fontSize: 13 }}>{s.phone}<span style={{ display: 'block', fontSize: 12, color: C.muted, overflowWrap: 'anywhere' }}>{s.email}</span></span> },
    { key: 'level', label: 'Position Request', help: COLUMN.staffPosition, sort: s => m.tierInfo(s.id).idx, render: s => {
      const t = m.tierInfo(s.id)
      return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><Pill tone="gray" dot={false}>{P.tierLabel(t.tier)}</Pill><RoleTag code={s.role} setup={setup} /></span>
    } },
    { key: 'closing', label: 'Closing Amount', help: COLUMN.staffClosing, align: 'right', sort: s => m.credit(s.id).lifetime, render: s => rm(m.credit(s.id).lifetime) },
    { key: 'upline', label: 'Upline · Branch', sort: s => m.staffName(s.uplineId), render: s => (
      <span>{s.uplineId ? m.staffName(s.uplineId) : <span style={{ color: C.muted }}>No upline</span>}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{m.branchName(s.branchId)}{org.team(s.id) ? ` · ${num(org.team(s.id))} in team` : ''}</span></span>
    ) },
    { key: 'status', label: 'Status · Expiry', help: COLUMN.staffExpiry, sort: s => s.expiresOn || '', render: s => (
      <span><Status of={STAFF_STATUS} value={s.status} />
        {s.expiresOn && s.status !== 'inactive' && <span style={{ display: 'block', fontSize: 12, color: s.expiresOn < addDaysIso(m.today, 30) ? C.warn : C.muted, marginTop: 3 }}>until {date(s.expiresOn, { short: true })}</span>}</span>
    ) },
    { key: 'seen', label: 'Last Login/Activity', sort: s => s.lastActive || '', render: s => <span style={{ fontSize: 12.5, color: C.muted }}>{s.lastActive ? ago(s.lastActive, m.today) : 'Never'}</span> },
    { key: 'actions', label: '', card: false, render: s => <StaffMenu s={s} /> },
  ].flatMap(c => (!office ? [c] : c.key === 'level' ? [
    { key: 'type', label: 'Account Type', sort: s => ACCOUNT_TYPES[s.type] || '', render: s => <Pill tone="violet" dot={false}>{ACCOUNT_TYPES[s.type] || s.type}</Pill> },
    { key: 'branch', label: 'Branch', sort: s => m.branchName(s.branchId), render: s => m.branchName(s.branchId) },
  ] : c.key === 'closing' || c.key === 'upline' ? [] : [c]))
  const active = people.filter(s => s.status === 'active')
  const newNow = people.filter(joinedNow)
  const soonList = people.filter(expiring)
  const levelsLine = [...setup.roles].reverse().map(r => `${num(count(leaders, s => s.role === r.code))} ${r.code}`).join(' · ')
  const pick = (k, v) => () => { clear(); if (k === 'level') setLevel(v); else if (k === 'quick') setQuick(v) }
  return (
    <Page title={office ? 'Office staff' : 'Agents'} help={office ? PAGE.officeStaff : PAGE.staff}
      sub={office ? <>{num(active.length)} active · admins, accounting and marketing. Their account type sets what they can do (Roles & access).</> : <>{num(active.length)} active · position (tier), upline and pay come from Setup</>}
      actions={can('staff', 'edit') && <button style={btnPrimary} onClick={() => go(office ? 'staff/new/office' : 'staff/new')}>{office ? 'Add office staff' : 'Add an agent'}</button>}>
      {(office || view === 'list') && (
        <div ref={statsBox} style={{ ...cols(narrow ? 140 : 210, narrow ? 10 : 14), marginBottom: 16 }}>
          <Stat icon={narrow ? null : 'staff'} label={office ? 'Office staff' : 'Agents'} value={num(people.length)} sub={`${num(active.length)} active · ${num(count(people, s => s.status === 'inactive'))} left`} onClick={clear} on={!set && !q} />
          {!office && setup.roles.length > 0 && <Stat icon={narrow ? null : 'crown'} tone="violet" label="Leaders" value={num(leaders.length)} sub={levelsLine || 'No upline levels'} onClick={pick('level', 'leaders')} on={level === 'leaders'} />}
          <Stat icon={narrow ? null : 'plus'} tone="blue" label="Joined this month" value={num(newNow.length)} sub={`${num(count(people, s => s.status === 'pending'))} waiting for HR to enable`} onClick={pick('quick', 'new')} on={quick === 'new'} />
          <Stat icon={narrow ? null : 'clock'} tone={soonList.length ? 'amber' : 'gray'} label="Expiring in 30 days" value={num(soonList.length)} sub="Accounts to renew" onClick={pick('quick', 'expiring')} on={quick === 'expiring'} />
        </div>
      )}
      <Card pad={16}>
        {!office && <Tabs value={view} onChange={setView} tabs={[{ key: 'list', label: 'List' }, { key: 'tree', label: 'Org chart' }]} />}
        {!office && view === 'tree' ? <OrgTree /> : (
          <>
            <Toolbar fold active={set} onClear={clear}>
              <SearchBox value={q} onChange={setQ} placeholder="Name, code, phone or email" />
              {office && <Select label="Account type" value={kind} onChange={setKind} options={kindOptions} />}
              {!office && setup.roles.length > 0 && <Select label="Level" value={level} onChange={setLevel} options={levelOptions} />}
              {!office && tierNames.length > 1 && <Select label="Tier" value={tier} onChange={setTier} options={tierOptions} />}
              {!office && leaders.length > 0 && <Select label="In the team of" value={leader} onChange={setLeader} options={leaderOptions} />}
              {quick && <Pill tone={quick === 'new' ? 'blue' : 'amber'}>{quick === 'new' ? 'Joined this month' : 'Expiring in 30 days'}</Pill>}
            </Toolbar>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 12 }}>
              <Chips label="Status" value={tab} onChange={setTab} options={['all', 'active', 'inactive', 'pending'].map(k => ({
                key: k, label: k === 'all' ? 'All' : STAFF_STATUS[k].label, count: k === 'all' ? match.length : match.filter(s => s.status === k).length }))} />
              <button style={{ ...btn, fontSize: 13, padding: '5px 12px' }} onClick={exportRows} disabled={!rows.length}
                title="Every row that matches the filters, not just the page on screen">
                <Icon name="file" size={15} />Download Excel ({num(rows.length)})
              </button>
            </div>
            <DataTable columns={columns} rows={rows} onRow={s => go(`staff/${s.id}`)} defaultSort={{ key: 'who', dir: 'asc' }} narrowAt={980}
              empty={q ? `No one matches “${q}”` : 'No one here'} onClear={q || set ? clear : undefined} />
          </>
        )}
      </Card>
    </Page>
  )
}

function Profile({ id }) {
  const fb = useFeedback()
  const erp = useErp()
  const can = useCan()
  const access = useAccess()
  const { m, setup } = erp
  const s = m.staff[id]
  if (!s) return <Page title="Not found" back={{ to: 'staff', label: 'All agents' }}><Empty title="This person no longer exists" /></Page>
  const agent = isAgent(s)
  const t = m.tierInfo(id)
  const chain = m.chain(id)
  const deals = m.dealsOf(id).sort((a, b) => b.date.localeCompare(a.date))
  const lines = (m.payoutsByStaff[id] || []).slice().sort((a, b) => b.date.localeCompare(a.date))
  const holders = P.uplineHolders(m.staff, id, setup.roles)
  const downline = (m.downline[id] || []).filter(k => k.status !== 'inactive')
  const yearDeals = deals.filter(d => d.date.startsWith(m.year) && d.status !== 'cancelled' && d.status !== 'draft')

  return (
    <Page back={agent ? { to: 'staff', label: 'All agents' } : { to: 'staff/office', label: 'Office staff' }} help={agent ? PAGE.profile : PAGE.officeProfile}
      actions={<>
        {can('staff', 'edit') && <Select plain label="Enable/Unlock Staff" value={s.status} onChange={v => fb.run(() => erp.setStaffStatus(s.id, v), `${s.short} is now ${STAFF_STATUS[v].label}`)}
          options={[{ value: 'active', label: 'Enabled (Active)' }, { value: 'inactive', label: 'Disabled (Inactive)' }, { value: 'pending', label: 'Pending' }]} />}
        {can('staff', 'edit') && <button style={btn} onClick={() => go(`staff/${s.id}/edit`)}>Edit</button>}
        <StaffMenu s={s} label="More" />
      </>}
      title={<span style={{ display: 'inline-flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><Avatar name={s.short} size={42} photo={s.photo} />{s.short}<Status of={STAFF_STATUS} value={s.status} /></span>}
      sub={<>{s.name} · {s.code} · {agent ? '' : `${ACCOUNT_TYPES[s.type] || s.type} · `}{m.branchName(s.branchId)}{s.role ? ` · ${m.roleName(s.role)}` : ''} · joined {date(s.joined)}{s.leftOn ? ` · left ${date(s.leftOn)}` : ''}</>}>
      {agent && <div style={{ ...cols(210, 14), marginBottom: 16 }}>
        <Stat label="Tier now" value={P.tierLabel(t.tier)} sub={`Agent rate ${t.tier.agentRate}%${t.kept ? ' · kept from last year' : ''}`} tone="brand" icon="reports" />
        <Stat label={`Commission in ${m.year}`} value={rm(t.yearly)} sub={`Lifetime ${rm(t.lifetime)}`} />
        <Stat label={`Earned in ${m.year}`} value={rm(m.earned(id, { thisYear: true }))} sub="Own deals and upline overrides" />
        <Stat label={`Deals in ${m.year}`} value={num(yearDeals.length)} sub={`${yearDeals.filter(d => d.agentId === id).length} closed by them · ${yearDeals.filter(d => d.holderId === id && d.agentId !== id).length} on their listings`} />
      </div>}

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', alignItems: 'start' }}>
        {agent ? <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
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
        </div> : (
          <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
            <Card title="What they can do" help={CARD.officeRole}>
              <p style={{ margin: '0 0 10px', fontSize: 13.5, lineHeight: 1.5 }}>
                As <b>{ACCOUNT_TYPES[s.type] || s.type}</b>, what they can open and change, and whose records they see, is set for the whole account type in Roles & access.
              </p>
              {access.opens('access') && <Link to={`access/${A.roleForType(s.type)}`} style={{ fontSize: 13.5 }}>Open {ACCOUNT_TYPES[s.type] || s.type} in Roles & access</Link>}
            </Card>
          </div>
        )}
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          {agent && <Card title="Uplines" help={CARD.uplines} sub={setup.roles.length ? 'Who shares the upline pool on their deals' : 'No upline levels in Setup'}>
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
          </Card>}
          {agent && downline.length > 0 && (
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
          <Card title="Details" actions={<Link to={`staff/${s.id}/edit`} style={{ fontSize: 13 }}>Edit</Link>}>
            <KV min={170} items={[
              ['User Name', s.username], ['Account Type', ACCOUNT_TYPES[s.type] || 'Agent'], ['Full Name (IC)', s.name], ['NRIC No', maskIc(s.ic)],
              ['Namecard Name', s.short], ['Phone', s.phone], ['E-Mail', s.email], ['Gender', s.sex === 'F' ? 'Female' : 'Male'], ['Date of Birth', s.birthday ? date(s.birthday) : '—'],
              ...(agent ? [['Registration (LPPEH)', s.regNo ? `${s.regType || 'REN'} ${s.regNo}` : s.renNo || '—']] : []), ['Bank', `${s.bank} ${maskAcc(s.account)}${s.accountName ? ` · ${s.accountName}` : ''}`],
              ['Active Status Expiry', s.expiresOn ? date(s.expiresOn) : '—'], ['Last Login/Activity', s.lastActive ? date(s.lastActive) : 'Never'],
              ...(agent ? [['Withholding tax', s.whtExempt ? 'Exempt' : `${setup.dealTypes.whtPct}% on each payslip`]] : []),
            ]} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
              {Object.entries(s.docs || {}).map(([k, ok]) => <Pill key={k} tone={ok ? 'green' : 'amber'}>{k}{ok ? '' : ' missing'}</Pill>)}
            </div>
          </Card>
          <Card title="Access & Permissions" help={CARD.access}>
            <div style={{ display: 'grid', gap: 6 }}>
              {[['active', 'Active Staff Account', s.status === 'active'], ...Object.entries(agent ? ACCESS : {}).map(([k, label]) => [k, label, !!s.access?.[k]])].map(([k, label, on]) => (
                <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
                  <span style={{ color: on ? C.ok : C.faint, display: 'inline-flex' }}><Icon name={on ? 'check' : 'close'} size={15} /></span>{label}
                </div>
              ))}
            </div>
          </Card>
          {agent && <Card title="Public profile" help={CARD.publicProfile} actions={<Link to={`staff/${s.id}/profile-doc`} style={{ fontSize: 13 }}>Profile PDF</Link>}>
            {s.access?.profilePage ? <p style={{ margin: '0 0 8px', fontSize: 13, color: C.ok }}>Shown at subsaleking.com/property-agents/{s.username}</p>
              : <p style={{ margin: '0 0 8px', fontSize: 13, color: C.muted }}>The profile page is switched off (Access & Permissions).</p>}
            {s.bio ? <p style={{ margin: '0 0 8px', fontSize: 13.5 }}>{s.bio}</p> : <p style={{ margin: '0 0 8px', fontSize: 13, color: C.muted }}>No bio yet.</p>}
            {Object.entries(s.socials || {}).filter(([, v]) => v).length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>{Object.entries(s.socials).filter(([, v]) => v).map(([k]) => <Pill key={k} tone="blue" dot={false}>{SOCIALS.find(x => x[0] === k)?.[1] || k}</Pill>)}</div>
            )}
            {(s.awards || []).length > 0 && <div style={{ fontSize: 13 }}>{s.awards.map((a, i) => <div key={i}><Icon name="medal" size={14} /> {a.name} · {a.org} · {date(a.date)}</div>)}</div>}
          </Card>}
        </div>
      </div>
    </Page>
  )
}

// The row menu on the staff list, and "More" on a profile (the new HR's row menu).
function StaffMenu({ s, label }) {
  const erp = useErp()
  const fb = useFeedback()
  const gate = useGate()
  const remove = async () => {
    const ok = await fb.confirm({ title: `Delete ${s.short}?`, body: 'Only someone with no deals, listings, customers or team can be deleted. Otherwise set them Inactive.', confirmLabel: 'Delete', danger: true })
    if (ok && await fb.run(() => erp.deleteStaff(s.id), `${s.short} deleted`)) go(isAgent(s) ? 'staff' : 'staff/office')
  }
  // Charts, marketing staffs, E-Forms and the profile PDF are for agents only.
  const agentOnly = isAgent(s) ? [
    { label: 'View Chart', icon: 'staff', onClick: () => go(`staff/${s.id}/chart`) },
    gate({ label: 'Manage Marketing Staffs', icon: 'customers', hint: s.marketing?.length ? String(s.marketing.length) : null, onClick: () => go(`staff/${s.id}/marketing`) }, 'staff', 'full'),
    gate({ label: 'E-Forms', icon: 'deals', onClick: () => go(`deals?staff=${s.id}`) }, 'deals', 'view'),
    { label: 'Agent Profile PDF', icon: 'print', onClick: () => go(`staff/${s.id}/profile-doc`) },
  ] : []
  return (
    <Menu quiet={!label} label={label || 'Actions'} items={[
      gate({ label: 'Edit', icon: 'edit', onClick: () => go(`staff/${s.id}/edit`) }, 'staff'),
      ...agentOnly,
      '-',
      gate({ label: 'Delete', icon: 'trash', danger: true, onClick: remove }, 'staff', 'full'),
    ]} />
  )
}

const addDaysIso = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10)
export const SOCIALS = [['facebook', 'Facebook', 'https://www.facebook.com/username'], ['instagram', 'Instagram', 'https://www.instagram.com/username'],
  ['tiktok', 'TikTok', 'https://www.tiktok.com/@username'], ['twitter', 'X (formerly Twitter)', 'https://www.x.com/username'],
  ['xiaohongshu', 'Xiaohongshu', 'https://www.xiaohongshu.com/username'], ['lemon8', 'Lemon8', 'https://www.lemon8.com/username'], ['linkedin', 'LinkedIn', 'https://www.linkedin.com/in/username']]
const STAFF_DOCS = ['NRIC Copy', 'Application Form', 'Joining Fee Receipt']

// The edit form's starting values for a person (also what Review changes compares against).
function StaffFormStart(s) {
  return {
    type: s.type || 'staff', tierFloorId: s.tierFloorId || '', branchId: String(s.branchId), uplineId: s.uplineId ? String(s.uplineId) : '', role: s.role || '',
    username: s.username, password: '', name: s.name, ic: String(s.ic || '').replace(/\D/g, ''), sex: s.sex === 'F' ? 'female' : 'male', birthday: s.birthday || '',
    short: s.short, phone: s.phone, phone2: s.phone2 || '', email: s.email, bio: s.bio || '', socials: { ...(s.socials || {}) }, regType: s.regType || 'REN', regNo: s.regNo || '',
    bank: s.bank || '', account: s.account || '', accountName: s.accountName || '', docs: { ...(s.docs || {}) }, awards: [...(s.awards || [])], active: s.status === 'active',
    access: { ...(s.access || {}) }, expiresOn: s.expiresOn || '', address: s.address || '', language: s.language || '', education: s.education || '', extra: { ...(s.extra || {}) },
  }
}

// Add / Edit staff, in the sections of the client's new HR form. The old form's
// extra questions (smoker, transport, previous job…) sit under "More details".
function StaffForm({ id, office = false }) {
  const fb = useFeedback()
  const review = useReview()
  const erp = useErp()
  const { m, setup } = erp
  const s = id ? m.staff[id] : null
  const [f, setF] = useState(() => s ? StaffFormStart(s) : {
    type: office ? 'admin-staff2' : 'staff', tierFloorId: '', branchId: String(setup.branches[0]?.id || ''), uplineId: '', role: '', username: '', password: '', name: '', ic: '', sex: 'male', birthday: '',
    short: '', phone: '', phone2: '', email: '', bio: '', socials: {}, regType: 'REN', regNo: '', bank: '', account: '', accountName: '', docs: {}, awards: [], active: false,
    access: { agent: !office, profilePage: false, profileDoc: false, addListing: !office, landlordVerify: false, vendorRequests: false, tripIncentive: false },
    expiresOn: addDaysIso(m.today, 365), address: '', language: '', education: '', extra: {},
  })
  const [error, setError] = useState(null)
  const [award, setAward] = useState(null)
  const [busy, setBusy] = useState(false)
  if (id && !s) return <Page title="Not found" back={{ to: 'staff', label: 'All agents' }}><Empty title="This person no longer exists" /></Page>
  // Office staff have no tier, upline, public profile or agent features.
  const agentForm = isAgent({ type: f.type })
  const listPath = agentForm ? 'staff' : 'staff/office'
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }))
  const setX = k => e => setF(v => ({ ...v, extra: { ...v.extra, [k]: e.target.value } }))
  const branchId = Number(f.branchId)
  const uplines = m.data.staff.filter(x => x.branchId === branchId && x.status !== 'inactive' && x.id !== id).sort((a, b) => (b.role ? 1 : 0) - (a.role ? 1 : 0) || a.short.localeCompare(b.short))
  const tiers = P.tiersFor(setup, branchId)
  const grid = { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))' }
  const section = (title, sub, children, help) => <Card title={title} sub={sub} help={help}><div style={grid}>{children}</div></Card>
  const text = (k, label, props = {}) => <FormField label={label} required={props.required} wide={props.wide} help={props.help}><input style={field} value={f[k] || ''} onChange={set(k)} type={props.type || 'text'} placeholder={props.placeholder} inputMode={props.inputMode} /></FormField>
  const pick = (k, label, options, props = {}) => <FormField label={label} required={props.required} help={props.help}><Select block plain label={label} value={f[k]} onChange={v => setF(x => ({ ...x, [k]: v }))} options={options} /></FormField>
  const toggle = (on, onChange, label) => (
    <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, padding: '6px 0' }}>
      <input type="checkbox" checked={!!on} onChange={e => onChange(e.target.checked)} style={{ accentColor: C.primary, width: 18, height: 18 }} />{label}
    </label>
  )
  // Before saving: a new person in full, or what an edit changes.
  const tierName = tid => P.tierLabel(tiers.find(t => t.id === tid) || tiers[0] || { name: '—' })
  const view = x => ({ type: ACCOUNT_TYPES[x.type] || x.type, branch: m.branchName(Number(x.branchId)), tier: agentForm ? tierName(x.tierFloorId) : '',
    role: agentForm && x.role ? `${x.role} · ${m.roleName(x.role)}` : '', upline: agentForm && x.uplineId ? m.staffName(Number(x.uplineId)) : '',
    username: x.username, name: x.name, ic: x.ic, short: x.short, phone: x.phone, email: x.email, bank: x.bank, account: x.account, accountName: x.accountName, reg: agentForm && x.regNo ? `${x.regType} ${x.regNo}` : '',
    expiresOn: x.expiresOn, active: x.active ? 'Active' : 'Not active' })
  async function preview() {
    const gaps = missing([['Username', f.username], ['Full Name', f.name], ['Branch', f.branchId], ...(s ? [] : [['Password', f.password]]),
      ...(f.account ? [['Account Holder Name', f.accountName]] : [])])
    if (gaps.length) { setError(needText(gaps)); if (!markGaps(gaps)) window.scrollTo({ top: 0, behavior: 'smooth' }); return false }
    const who = office || !agentForm ? 'office staff' : 'agent'
    if (s) {
      return review({ title: `Review changes · ${s.code}`, confirmLabel: 'Save changes', intro: `Check what changes for ${s.short}.`,
        changes: changedRows(view(StaffFormStart(s)), view(f), [['type', 'Account Type'], ['branch', 'Branch'], ['tier', 'Rank (position)'], ['role', 'Upline level'], ['upline', 'Upline'],
          ['username', 'Username'], ['name', 'Full Name'], ['ic', 'NRIC Number', maskIc], ['short', 'Namecard Name'], ['phone', 'Phone Number'], ['email', 'Email Address'],
          ['bank', 'Bank'], ['account', 'Bank Account', maskAcc], ['accountName', 'Account Holder Name'], ['reg', 'Registration'], ['expiresOn', 'Active Status Expiry', date], ['active', 'Account']]) })
    }
    const digits = v => String(v || '').replace(/\D/g, '')
    const twin = m.data.staff.find(x => (digits(f.ic).length >= 6 && digits(x.ic) === digits(f.ic)) || (digits(f.phone).length >= 7 && digits(x.phone) === digits(f.phone)))
    const up = f.uplineId ? m.staff[Number(f.uplineId)] : null
    const chain = up ? [...m.chain(up.id)].reverse().concat(up).map(x => `${x.short}${x.role ? ` (${x.role})` : ''}`).join(' › ') : ''
    const on = Object.entries(ACCESS).filter(([k]) => f.access[k]).map(([, label]) => label.replace(/^Enable /, '').replace(/ Features$/, ''))
    return review({
      title: `Preview the ${who}`, confirmLabel: office || !agentForm ? 'Add office staff' : 'Add agent',
      intro: f.active ? 'They can sign in as soon as they are added.' : 'They are added as Pending, and can sign in once Active Staff Account is switched on.',
      warnings: [twin && `${twin.short} (${twin.code}) already has this ${digits(twin.ic) === digits(f.ic) ? 'NRIC number' : 'phone number'}. Add them again only if this is a different person.`,
        !f.ic && 'No NRIC number yet.'],
      sections: [
        { title: 'Account', rows: [['Account Type', ACCOUNT_TYPES[f.type]], ['Branch', m.branchName(branchId)], ['Username', f.username], ['Account', f.active ? 'Active' : 'Pending'],
          ['Active Status Expiry', f.expiresOn ? date(f.expiresOn) : '']] },
        agentForm && { title: 'Agent', rows: [['Starts at', tierName(f.tierFloorId)], ['Upline level they hold', f.role ? `${f.role} · ${m.roleName(f.role)}` : 'None (negotiator)'],
          ['Upline', chain || 'No upline'], ['Registration', f.regNo ? `${f.regType} ${f.regNo}` : ''], ['Agent features', on.join(', ') || 'None']] },
        { title: 'Personal and contact', rows: [['Full Name', f.name], ['NRIC Number', maskIc(f.ic)], ['Gender', f.sex === 'female' ? 'Female' : 'Male'], ['Date of Birth', f.birthday ? date(f.birthday) : ''],
          ['Namecard Name', f.short || f.name], ['Phone Number', f.phone], ['Email Address', f.email], ['Bank', f.bank ? `${f.bank} ${maskAcc(f.account)}${f.accountName ? ` · ${f.accountName}` : ''}` : '']] },
      ],
    })
  }
  async function save() {
    setError(null)
    if (!await preview()) return
    setBusy(true)
    const agentOnly = v => (agentForm ? v : null)
    const body = { type: f.type, tierFloorId: agentOnly(f.tierFloorId || null), branchId, uplineId: agentOnly(f.uplineId || null), role: agentOnly(f.role || null), username: f.username, name: f.name, ic: f.ic,
      sex: f.sex === 'female' ? 'F' : 'M', birthday: f.birthday, short: f.short || f.name, phone: f.phone, phone2: f.phone2, email: f.email, bio: f.bio,
      socials: Object.fromEntries(Object.entries(f.socials).filter(([, v]) => v)), regType: f.regType, regNo: f.regNo, bank: f.bank, account: f.account, accountName: f.accountName, docs: f.docs,
      awards: f.awards, access: agentForm ? f.access : Object.fromEntries(Object.keys(ACCESS).map(k => [k, false])), expiresOn: f.expiresOn, address: f.address, language: f.language, education: f.education, extra: f.extra }
    try {
      if (s) {
        await erp.updateStaff(s.id, body)
        const status = f.active ? 'active' : s.status === 'active' ? 'inactive' : s.status
        if (status !== s.status) await erp.setStaffStatus(s.id, status)
        fb.toast(`${body.short} saved`)
        go(`staff/${s.id}`)
      } else {
        if (!f.password) throw new Error('Password is required.')
        const st = await erp.addStaff({ ...body, nameCard: body.short })
        const made = st.data.staff.at(-1)
        if (f.active) await erp.setStaffStatus(made.id, 'active')
        fb.toast(`${body.short} added${f.active ? '' : ' as Pending. Switch on Active Staff Account when HR is done'}`)
        go(`staff/${made.id}`)
      }
    } catch (e) { setError(e.message); window.scrollTo({ top: 0, behavior: 'smooth' }) } finally { setBusy(false) }
  }
  return (
    <Page title={s ? `Edit Staff · ${s.code}` : office ? 'Add office staff' : 'Add an agent'} help={s ? PAGE.staffEdit : PAGE.staffNew}
      back={s ? { to: `staff/${s.id}`, label: s.short } : office ? { to: 'staff/office', label: 'Office staff' } : { to: 'staff', label: 'All agents' }}
      sub={s ? 'Manage the details for this staff member.' : `${office ? 'An admin, accountant or marketing person.' : 'A new agent.'} They stay Pending until Active Staff Account is switched on.`}
      actions={<><button style={btn} onClick={() => go(s ? `staff/${s.id}` : listPath)}>Cancel</button><button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>{s ? 'Review changes' : 'Preview & add'}</button></>}>
      {error && <Notice tone="red">{error}</Notice>}
      <div style={{ display: 'grid', gap: 16 }}>
        {section('Account Details', 'The staff member’s role and type within the organisation.', <>
          {pick('type', 'Account Type', Object.entries(ACCOUNT_TYPES).map(([value, label]) => ({ value, label })), { required: true })}
          {pick('branchId', 'Branch', setup.branches.map(b => ({ value: String(b.id), label: b.name })), { required: true })}
          {agentForm && pick('tierFloorId', 'Rank (position)', [{ value: '', label: `${tiers[0] ? P.tierLabel(tiers[0]) : 'First tier'} (start)` }, ...tiers.slice(1).map(t => ({ value: t.id, label: P.tierLabel(t) }))], { help: 'The tier they start at. They move up as they earn.' })}
          {agentForm && setup.roles.length > 0 && pick('role', 'Upline level they hold', [{ value: '', label: 'None (negotiator)' }, ...setup.roles.map(r => ({ value: r.code, label: `${r.code} · ${r.name}` }))])}
          {agentForm && pick('uplineId', 'Upline', [{ value: '', label: 'No upline' }, ...uplines.map(x => ({ value: String(x.id), label: `${x.code} (${x.short})${x.role ? ` · ${x.role}` : ''}` }))], { help: 'An existing staff member to be the upline for this agent.' })}
          {text('username', 'Username', { required: true })}
          {!s && text('password', 'Password', { type: 'password', required: true })}
        </>)}
        {section('Personal Information', 'Personal identification details.', <>
          {text('name', 'Full Name', { required: true, help: 'Legal name as per identification documents.' })}
          {text('ic', 'NRIC Number', { help: 'NRIC number without dashes.', inputMode: 'numeric' })}
          {pick('sex', 'Gender', [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }])}
          {text('birthday', 'Date of Birth', { type: 'date' })}
        </>)}
        {section('Contact Information', 'Contact details for the staff member.', <>
          {text('short', 'Namecard Name', { help: 'Name displayed in namecards and public profiles.' })}
          {text('phone', 'Phone Number', { help: 'Primary contact phone number. eg: 01XXXXXXXXX', inputMode: 'tel' })}
          {text('email', 'Email Address', { type: 'email', help: 'eg: example@domain.com' })}
          {text('phone2', 'Phone Number 2')}
        </>)}
        {agentForm && <>
        <Card title="Profile Information" sub="Displayed publicly on the agent's profile page." help={CARD.publicProfile}>
          <FormField label="Bio"><TextArea rows={3} value={f.bio} onChange={set('bio')} placeholder="Brief biography displayed on the agent profile" /></FormField>
        </Card>
        {section('Social Links', 'Displayed publicly on profile pages.', SOCIALS.map(([k, label, ph]) => (
          <FormField key={k} label={label}><input style={field} value={f.socials[k] || ''} placeholder={ph} onChange={e => setF(x => ({ ...x, socials: { ...x.socials, [k]: e.target.value } }))} /></FormField>
        )))}
        {section('Professional Information', 'Registration details for agents, issued by LPPEH.', <>
          {pick('regType', 'Registration', ['REN', 'REA', 'PEA'].map(v => ({ value: v, label: v })))}
          {text('regNo', 'Registration Number', { placeholder: 'Enter certification number', inputMode: 'numeric' })}
        </>)}
        </>}
        {section('Bank Information', 'Bank account details for the staff member.', <>
          {pick('bank', 'Bank', [{ value: '', label: 'Select bank' }, ...BANKS.map(b => ({ value: b, label: b }))])}
          {text('account', 'Bank Account Number', { inputMode: 'numeric' })}
          {text('accountName', 'Account Holder Name', { required: !!f.account, placeholder: f.name || undefined, help: 'Exactly as the bank has it.' })}
          <FormField label="Profile Picture"><FileInput kind="avatar" /></FormField>
        </>)}
        {section('Documents', 'For staff verification and record-keeping.', STAFF_DOCS.map(d => (
          <FormField key={d} label={d} help={f.docs[d] ? 'Uploaded' : 'Not uploaded yet'}><FileInput kind="document" onChange={files => setF(x => ({ ...x, docs: { ...x.docs, [d]: files.length > 0 || !!s?.docs?.[d] } }))} /></FormField>
        )))}
        {agentForm && <Card title="Awards" help={CARD.awards} actions={<button style={small} onClick={() => setAward({ name: '', org: '', date: '' })}>Add Award</button>}>
          {!f.awards.length ? <p style={{ margin: 0, fontSize: 13.5, color: C.muted }}>No awards yet.</p> : f.awards.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13.5 }}>
              <Icon name="medal" size={16} /><span style={{ flex: 1 }}><b>{a.name}</b> · {a.org}{a.date ? ` · ${date(a.date)}` : ''}</span>
              <button style={{ ...small, color: C.err }} onClick={() => setF(x => ({ ...x, awards: x.awards.filter((_, j) => j !== i) }))}>Remove</button>
            </div>
          ))}
        </Card>}
        <Card title="Access & Permissions" sub={agentForm ? 'Access rights assigned to the staff member.' : 'What they can open and change comes from their account type (System → Roles & access).'} help={CARD.access}>
          {toggle(f.active, v => setF(x => ({ ...x, active: v })), 'Active Staff Account')}
          {agentForm && Object.entries(ACCESS).map(([k, label]) => <div key={k}>{toggle(f.access[k], v => setF(x => ({ ...x, access: { ...x.access, [k]: v } })), label)}</div>)}
          <div style={{ ...grid, marginTop: 10 }}>{text('expiresOn', 'Active Status Expiry Date', { type: 'date', help: 'When the account is due for renewal.' })}</div>
        </Card>
        <details style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 18px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>More details (from the old form)</summary>
          <div style={{ ...grid, marginTop: 14 }}>
            <FormField label="House Address" wide><input style={field} value={f.address} onChange={set('address')} /></FormField>
            {pick('language', 'Language', ['', 'English', 'Malay', 'Chinese', 'Indian', 'Others'].map(v => ({ value: v, label: v || 'Select' })))}
            <FormField label="Education Level"><input style={field} value={f.education} onChange={set('education')} /></FormField>
            {[['smoker', 'Smoker', ['No', 'Yes']], ['marital', 'Marital Status', ['Single', 'Married']], ['house', 'House', ['Own', 'Rent']], ['transportOwn', 'Own Transport', ['Yes', 'No']]].map(([k, label, opts]) => (
              <FormField key={k} label={label}><Select block plain label={label} value={f.extra[k] || opts[0]} onChange={v => setF(x => ({ ...x, extra: { ...x.extra, [k]: v } }))} options={opts.map(o => ({ value: o, label: o }))} /></FormField>
            ))}
            {[['children', 'No. of Children'], ['transportType', 'Transport Type'], ['transportModel', 'Transport Model'], ['prevJob', 'Previous Job'], ['prevPosition', 'Previous Job Position'],
              ['prevIncome', 'Previous Job Income (RM)'], ['expIncome', 'Expected Income (RM)'], ['expPosition', 'Expected Position']].map(([k, label]) => (
              <FormField key={k} label={label}><input style={field} value={f.extra[k] || ''} onChange={setX(k)} /></FormField>
            ))}
          </div>
        </details>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>{s ? 'Review changes' : 'Preview & add'}</button>
        <button style={btn} onClick={() => go(s ? `staff/${s.id}` : listPath)}>Cancel</button>
      </div>
      <Modal open={!!award} onClose={() => setAward(null)} title="Add Award"
        footer={<><button style={btn} onClick={() => setAward(null)}>Cancel</button>
          <button style={{ ...btnPrimary, opacity: award?.name ? 1 : 0.5 }} disabled={!award?.name} onClick={() => { setF(x => ({ ...x, awards: [...x.awards, award] })); setAward(null) }}>Save</button></>}>
        {award && (
          <div style={{ display: 'grid', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Manage the details of the award here. Click Save when you're done.</p>
            <FormField label="Award Name" required><input style={field} autoFocus value={award.name} onChange={e => setAward({ ...award, name: e.target.value })} /></FormField>
            <FormField label="Awarding Organization"><input style={field} value={award.org} onChange={e => setAward({ ...award, org: e.target.value })} /></FormField>
            <FormField label="Date Received"><input type="date" style={field} value={award.date} max={m.today} onChange={e => setAward({ ...award, date: e.target.value })} /></FormField>
          </div>
        )}
      </Modal>
    </Page>
  )
}

// Marketing Staffs: assistants who may work on this person's customers and listings.
function MarketingStaffs({ id }) {
  const erp = useErp()
  const fb = useFeedback()
  const { m } = erp
  const s = m.staff[id]
  const [rows, setRows] = useState(() => (s?.marketing || []).map(r => ({ ...r, staffId: String(r.staffId) })))
  const [adding, setAdding] = useState('')
  if (!s) return <Page title="Not found" back={{ to: 'staff', label: 'All agents' }}><Empty title="This person no longer exists" /></Page>
  const others = m.data.staff.filter(x => x.id !== id && x.status !== 'inactive' && !rows.some(r => r.staffId === String(x.id))).sort((a, b) => a.short.localeCompare(b.short))
  const dirty = JSON.stringify(rows.map(r => ({ ...r, staffId: Number(r.staffId) }))) !== JSON.stringify(s.marketing || [])
  const flip = (i, k) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [k]: !r[k] } : r)))
  const check = (r, i, k) => <input type="checkbox" checked={!!r[k]} onChange={() => flip(i, k)} aria-label={k} style={{ accentColor: C.primary, width: 17, height: 17 }} />
  return (
    <Page title={`Marketing Staffs · ${s.code}`} help={PAGE.marketingStaffs} back={{ to: `staff/${s.id}`, label: s.short }} sub="Manage marketing staff access and controls."
      actions={<button style={{ ...btnPrimary, opacity: dirty ? 1 : 0.5 }} disabled={!dirty} onClick={() => fb.run(() => erp.setMarketingStaffs(id, rows), 'Marketing staffs saved')}>Save</button>}>
      <Card pad={16}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <Select label="Add Staff" value={adding} onChange={setAdding} options={[{ value: '', label: 'Select staff to add' }, ...others.map(x => ({ value: String(x.id), label: `${x.short} (${x.code})` }))]} />
          <button style={small} disabled={!adding} onClick={() => { setRows(rs => [...rs, { staffId: adding, customers: true, listings: true, shared: false }]); setAdding('') }}>Add Staff</button>
        </div>
        <DataTable rows={rows.map((r, i) => ({ ...r, i, id: r.staffId }))} narrowAt={560} empty="No staffs found." columns={[
          { key: 'staff', label: 'Staff', render: r => <Who name={m.staffName(Number(r.staffId))} sub={m.staff[Number(r.staffId)]?.code} size={26} /> },
          { key: 'customers', label: 'Customer Data Access', render: r => check(r, r.i, 'customers') },
          { key: 'listings', label: 'Listings Access', render: r => check(r, r.i, 'listings') },
          { key: 'shared', label: 'Shared Saleking Listings Access', render: r => check(r, r.i, 'shared') },
          { key: 'del', label: '', render: r => <button style={{ ...small, color: C.err }} onClick={() => setRows(rs => rs.filter((_, j) => j !== r.i))}>Remove</button> },
        ]} />
      </Card>
    </Page>
  )
}

// Staff Chart: the uplines above (as a trail), then everyone under this person.
function StaffChart({ id }) {
  const { m } = useErp()
  const s = m.staff[id]
  if (!s) return <Page title="Not found" back={{ to: 'staff', label: 'All agents' }}><Empty title="This person no longer exists" /></Page>
  return (
    <Page title={`Staff Chart · ${s.code}`} help={PAGE.staffChart} back={{ to: `staff/${s.id}`, label: s.short }} sub="View the staff organisational chart.">
      <Card pad={16}><OrgTree focus={id} /></Card>
    </Page>
  )
}
const countTeam = (m, id) => (m.downline[id] || []).filter(k => k.status !== 'inactive').reduce((n, k) => n + 1 + countTeam(m, k.id), 0)

// Agent Profile Generator: a one-page profile with featured listings, to print or save as PDF.
function ProfileDoc({ id }) {
  const { m, setup } = useErp()
  const s = m.staff[id]
  const own = s ? m.data.listings.filter(l => l.holderId === id && l.status === 'active').sort((a, b) => b.updated.localeCompare(a.updated)) : []
  const [picked, setPicked] = useState(() => own.slice(0, 4).map(l => l.id))
  if (!s) return <Page title="Not found" back={{ to: 'staff', label: 'All agents' }}><Empty title="This person no longer exists" /></Page>
  const all = m.data.listings.filter(l => l.holderId === id)
  const areas = [...new Set(all.map(l => l.area))].slice(0, 4)
  const cats = [...new Set(all.map(l => l.category))].slice(0, 4)
  const years = Math.max(1, Math.round((new Date(`${m.today}T00:00:00Z`) - new Date(`${s.joined}T00:00:00Z`)) / (365 * 86400000)))
  const t = m.tierInfo(id)
  const featured = own.filter(l => picked.includes(l.id))
  return (
    <Page title="Agent Profile Generator" help={PAGE.profileDoc} back={{ to: `staff/${s.id}`, label: s.short }}
      sub="Generate a PDF showcasing the agent's profile and featured listings to share with clients." actions={<button style={btnPrimary} onClick={() => window.print()}>Print / Save as PDF</button>}>
      {!s.access?.profileDoc && <Notice tone="amber">Profile document generation is switched off for {s.short} (Access & Permissions). Admins can still print it here.</Notice>}
      <Card title="Featured listings" sub={own.length ? 'Pick up to 6 of their active listings.' : 'No active listings: the document is made without featured listings.'} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {own.map(l => (
            <label key={l.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, border: `1px solid ${picked.includes(l.id) ? C.primary : C.border}`, borderRadius: 8, padding: '5px 9px' }}>
              <input type="checkbox" checked={picked.includes(l.id)} disabled={!picked.includes(l.id) && picked.length >= 6} style={{ accentColor: C.primary }}
                onChange={() => setPicked(p => (p.includes(l.id) ? p.filter(x => x !== l.id) : [...p, l.id]))} />{l.code} · {l.title}
            </label>
          ))}
        </div>
      </Card>
      <div style={{ maxWidth: 780, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: 'clamp(16px, 4vw, 32px)', boxShadow: C.shadow }}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', borderBottom: `2px solid ${C.primary}`, paddingBottom: 16 }}>
          <Avatar name={s.short} size={72} photo={s.photo} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontFamily: C.fontHead, fontSize: 22, fontWeight: 700 }}>{s.short}</div>
            <div style={{ fontSize: 13.5, color: C.muted }}>{s.role ? m.roleName(s.role) : P.tierLabel(t.tier)} · {s.regNo ? `${s.regType || 'REN'} ${s.regNo}` : s.renNo}</div>
            <div style={{ fontSize: 13.5, marginTop: 4 }}>{s.phone} · {s.email}</div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 12.5, color: C.muted }}><b style={{ color: C.text }}>{setup.company.name}</b><br />{setup.company.licenceNo}<br />Joined {date(s.joined)}</div>
        </div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', margin: '16px 0' }}>
          <KV min={150} items={[['Experience', `${years} year${years > 1 ? 's' : ''}`], ['Areas Expertise', areas.join(' | ') || '—'], ['Categories Expertise', cats.join(' | ') || '—']]} />
          {(s.awards || []).length > 0 && <div style={{ fontSize: 13 }}><b style={{ display: 'block', marginBottom: 4 }}>Awards</b>{s.awards.map((a, i) => <div key={i}>{a.name} · {a.org}</div>)}</div>}
        </div>
        {s.bio && <p style={{ fontSize: 14, lineHeight: 1.55, margin: '0 0 16px' }}>{s.bio}</p>}
        {featured.length > 0 && (
          <>
            <div style={{ fontFamily: C.fontHead, fontWeight: 700, fontSize: 15, margin: '6px 0 10px' }}>Featured listings</div>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))' }}>
              {featured.map(l => (
                <div key={l.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.primary }}>{l.type === 'sale' ? 'FOR SALE' : 'FOR RENT'} · #{l.code}</div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{l.title}, {l.category}</div>
                  <div style={{ fontSize: 12.5, color: C.muted }}>{l.area} · {l.beds ? `${l.beds}bd / ${l.baths}ba · ` : ''}{num(l.builtUp)} sq ft</div>
                  <div style={{ fontWeight: 700, marginTop: 4 }}>{rm(l.askPrice)}{l.type === 'rental' ? ' /month' : ''}</div>
                </div>
              ))}
            </div>
          </>
        )}
        {Object.values(s.socials || {}).some(Boolean) && <p style={{ fontSize: 12.5, color: C.muted, margin: '16px 0 0' }}>{Object.values(s.socials).filter(Boolean).join(' · ')}</p>}
      </div>
    </Page>
  )
}

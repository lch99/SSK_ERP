import { useEffect, useState } from 'react'
import { getMyBranch, saveMyBranchDetails, importMyBranchAgents, saveMyBranchBm, downloadAllLinks } from '../api.js'
import * as P from '../../shared/payout.js'
import { standardOf, branchRulesOf } from '../../shared/standard.js'
import BranchCommission from './BranchCommission.jsx'
import { C, inp, sel, btn, label } from '../styles.js'
import Section, { ErrorList } from '../setup/Section.jsx'
import AgentsSection from '../setup/AgentsSection.jsx'
import { download } from '../setup/sheet.js'
import { useErp } from '../erp/ErpContext.jsx'
import { useFeedback } from '../erp/feedback.jsx'
import { errorText } from '../errors.js'

// A Branch Partner sets up their own branch here, without the office or IT: its details, its agents
// (from Excel, or one by one), its office staff and everyone's sign-in. Name, code and payout plan are
// the Superadmin's (Users → New branch and partner).
export default function MyBranchPage() {
  const erp = useErp()
  const fb = useFeedback()
  const [setup, setSetup] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { getMyBranch().then(setSetup).catch(e => setError(errorText(e))) }, [])

  if (error) return <div style={{ padding: 24 }}><ErrorList errors={[error]} /></div>
  if (!setup) return <p style={{ padding: 24, color: C.muted }}>Loading your branch…</p>
  const branch = setup.branches[0]
  if (!branch) return <div style={{ padding: 24 }}><ErrorList errors={['Your branch no longer exists. Ask the Superadmin.']} /></div>

  const plan = setup.plans?.[P.planIndexFor(setup.plans, branch.id)]
  const paysOn = standardOf(setup).kind === 'existing'
    ? (branchRulesOf(setup.standard, branch.id) ? `${branch.name}'s own rates` : "the company's rates")
    : plan ? P.planLabel(plan, setup.plans.indexOf(plan)) : P.STANDARD_PLAN
  const fresh = s => { setSetup(s); erp?.reload?.() }
  async function links() {
    // As on Users: a fresh link cancels the one sent before, so ask first.
    const ok = await fb.confirm({ title: `Sign-in links for ${branch.name}?`, confirmLabel: 'Make the file',
      body: 'Every Active person in your branch without an account gets one, and everyone who has not set a password yet gets a fresh link: links sent to them before stop working. Each link works once, for 7 days. The file holds working links: keep it safe, and delete it once they are sent.' })
    if (!ok) return
    let r
    try { r = await downloadAllLinks() } catch (e) { return fb.error(e) }
    download(r.bytes, r.name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    fb.toast(`${r.links} link${r.links === 1 ? '' : 's'} in the file${r.made ? `; ${r.made} new account${r.made === 1 ? '' : 's'}` : ''}`)
  }

  const steps = [
    ['Check your branch details', 'Below: address, phone and the name that signs off approvals.', null],
    ['Bring in your agents', 'Below, from Excel in one go, or one at a time.', ['#/staff/new', 'Add one agent']],
    ['Add your office staff', 'Admins who key in the day-to-day work.', ['#/staff/new/office', 'Add office staff']],
    ['Get everyone signed in', 'One Excel file with each person\'s username and a link to set their password.', [links, 'Download sign-in links']],
  ]
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>My branch: {branch.name} <span style={{ color: C.muted, fontWeight: 500 }}>({branch.code})</span></h1>
      <p style={{ fontSize: 13, color: C.muted, margin: '0 0 16px' }}>
        Commission: <b>{paysOn}</b> · {setup.agents.length} agent{setup.agents.length === 1 ? '' : 's'}.
        The branch name and code are set by the company; ask the Superadmin to change them.
      </p>

      <ol style={{ listStyle: 'none', margin: '0 0 16px', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(230px, 100%), 1fr))', gap: 10 }}>
        {steps.map(([title, text, action], i) => (
          <li key={title} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: C.radius, padding: '12px 14px', fontSize: 13.5, lineHeight: 1.45 }}>
            <b>{i + 1}. {title}</b>
            <div style={{ color: C.muted, margin: '2px 0 8px' }}>{text}</div>
            {action && (typeof action[0] === 'string'
              ? <a href={action[0]} style={{ ...btn, display: 'inline-block', textDecoration: 'none', fontSize: 13, padding: '5px 11px' }}>{action[1]}</a>
              : <button style={{ ...btn, fontSize: 13, padding: '5px 11px' }} onClick={action[0]}>{action[1]}</button>)}
          </li>
        ))}
      </ol>
      <p style={{ fontSize: 13, color: C.muted, margin: '0 0 16px' }}>
        Office sign-in accounts (Admin, Office Staff) are on <a href="#/users">Sign-in accounts</a>.
      </p>

      <DetailsSection branch={branch} onSaved={fresh} />
      {/* Keyed by the count so a saved upload starts the section afresh (Setup's wizard moves on instead). */}
      <AgentsSection key={setup.agents.length} setup={setup} step={2} done={setup.agents.length > 0} addOnly
        hint={<>Bring in your whole team at once from Excel. Everyone goes into {branch.name}; positions, uplines and tiers are matched to the company's. You can also add agents one at a time in All agents.</>}
        save={async (_step, body) => { fresh(await importMyBranchAgents(body.rows)); fb.toast(`${body.rows.length} agent${body.rows.length === 1 ? '' : 's'} added`) }} />
      {/* Keyed by the saved values so a save (or reload) starts the editor from what was saved. */}
      <BranchCommission key={JSON.stringify([setup.standard?.branchRules, setup.plans?.map(p => p.id), setup.rulesSince])} setup={setup} branch={branch} onSaved={fresh} />
      {standardOf(setup).kind === 'existing' && <BmSection setup={setup} branch={branch} onSaved={fresh} />}
    </div>
  )
}

// Who receives this branch's BM profit: one of its own agents (usually the partner's own agent
// record, which holds their bank details), or nobody, and then the company keeps it.
function BmSection({ setup, branch, onSaved }) {
  const saved = setup.standard?.branchManagers?.[branch.id] ?? ''
  const [pick, setPick] = useState(saved)
  return (
    <Section id="bm" step={3} title="BM profit" done={saved !== ''} dirty={String(pick) !== String(saved)} onReset={() => setPick(saved)}
      hint={<>The Branch Manager's share of each case is paid to this account, only from {branch.name}'s cases: on the closing agent's side when they are one of your agents, and on the listing side for cases in your branch.</>}
      onSave={async () => onSaved(await saveMyBranchBm(pick === '' ? null : Number(pick)))}>
      <label style={{ display: 'block', maxWidth: 420 }}><span style={label}>Paid to</span>
        <select style={{ ...sel, width: '100%' }} value={pick} onChange={e => setPick(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">Nobody (the company keeps it)</option>
          {setup.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 4 }}>
          {setup.agents.length ? 'To be paid yourself, add yourself as an agent of this branch (with your bank details) and pick your name.' : 'Add your agents first; this lists them.'}
        </span>
      </label>
    </Section>
  )
}

function DetailsSection({ branch, onSaved }) {
  const start = { address: branch.address || '', phone: branch.phone || '', manager: branch.manager || '' }
  const [d, setD] = useState(start)
  const dirty = Object.keys(start).some(k => d[k] !== start[k])
  const full = { ...inp, width: '100%' }
  const field = (k, title, note) => (
    <label style={{ display: 'block', marginBottom: 12 }}><span style={label}>{title}</span>
      <input style={full} value={d[k]} onChange={e => setD({ ...d, [k]: e.target.value })} />
      {note && <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 4 }}>{note}</span>}
    </label>
  )
  return (
    <Section id="company" step={1} title="Branch details" done={!!(branch.address && branch.phone)} dirty={dirty} onReset={() => setD(start)}
      hint="These print on the branch's documents."
      onSave={async () => onSaved(await saveMyBranchDetails(d))}>
      <div style={{ maxWidth: 560 }}>
        {field('address', 'Address')}
        {field('phone', 'Phone')}
        {field('manager', 'Name that signs off approvals', 'Shown as the approver on this branch\'s payouts. Usually your own name.')}
      </div>
    </Section>
  )
}

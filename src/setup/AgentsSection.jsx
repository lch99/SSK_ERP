import { useRef, useState } from 'react'
import * as P from '../../shared/payout.js'
import * as A from '../../shared/agents.js'
import { DEMO } from '../api.js'
import { C, inp, sel, btn, btnPrimary, label } from '../styles.js'
import Section from './Section.jsx'
import OutlineTree from './OutlineTree.jsx'
import { roleColor } from './colors.js'
import { readSheetFile, parseDelimited, makeXlsx, download, XLSX_TYPE } from './sheet.js'
import { Avatar } from '../erp/ui.jsx'
import { useFeedback } from '../erp/feedback.jsx'

const TONES = ['brand', 'blue', 'violet', 'green', 'amber']
const toneOf = name => TONES[[...String(name)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % TONES.length]
const ddmmyyyy = iso => (iso ? iso.split('-').reverse().join('/') : '')

// ── Agents ───────────────────────────────────────────────────────────────────
// The whole team in one go: download the template (or use an existing staff
// list), fill it in Excel, upload it. Rows are checked against Setup before
// anything is saved; problems point at the spreadsheet's own row numbers.

export default function AgentsSection({ setup, save, step, done }) {
  const fb = useFeedback()
  const saved = setup.agents || []
  // An upload being looked at: { source, table: readAgentTable() result, mode }.
  const [pending, setPending] = useState(null)
  const [readError, setReadError] = useState(null)
  const [paste, setPaste] = useState(false)

  const take = (source, table) => {
    setReadError(null)
    const read = A.readAgentTable(table)
    if (read.error) return setReadError(read.error)
    if (!read.rows.length) return setReadError(`${source} has the column names but no agents under them.`)
    setPending({ source, read, mode: 'replace' })
    setPaste(false)
  }
  const openFile = async file => {
    if (!file) return
    try { take(file.name, await readSheetFile(file)) } catch (e) { setReadError(e.message) }
  }

  const checked = pending && A.checkAgents(pending.read.rows, setup, pending.mode === 'add' ? saved : [])
  const badLines = new Set(checked?.errors.map(e => e.line))
  const ready = checked ? checked.agents.filter(a => !badLines.has(a.line)).length : 0
  const leaveOut = () => setPending({ ...pending, read: { ...pending.read, rows: pending.read.rows.filter(r => !badLines.has(r.line)) } })

  const removeAll = async () => {
    if (!(await fb.confirm({ title: `Remove all ${saved.length} agents?`, body: 'The list is emptied. You can upload it again at any time.', confirmLabel: 'Remove all', danger: true }))) return
    await save('agents', { mode: 'replace', rows: [] })
    fb.toast('Agents removed')
  }

  const roleName = code => setup.roles.find(r => r.code === code)?.name
  return (
    <Section id="agents" step={step} title="Agents" done={done} dirty={!!pending} onReset={() => setPending(null)}
      hint={<>Bring in your whole team at once from Excel, instead of keying in each person. Positions, uplines and tiers are matched to what you set up in the previous steps. You can also skip this and add agents later in H.R Portal.</>}
      errors={checked?.errors.length ? [`${checked.errors.length} row${checked.errors.length === 1 ? '' : 's'} to fix (listed above), or leave them out.`] : []}
      onSave={() => save('agents', pending ? { mode: pending.mode, rows: pending.read.rows } : { mode: 'add', rows: [] })}>

      {!pending && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(250px, 100%), 1fr))', gap: 12 }}>
            <StepCard n={1} title="Get the template" text="An Excel file with the right columns, drop-down lists for branch, position and tier, and a filled-in example sheet.">
              <button style={btn} onClick={() => download(template(setup), 'Agents template.xlsx', XLSX_TYPE)}>Download Excel template</button>
            </StepCard>
            <StepCard n={2} title="Upload it" text="Your own staff list works too, if it has a Name column. Excel (.xlsx) or CSV.">
              <DropZone onFile={openFile} />
              <button style={{ ...btn, border: 'none', boxShadow: 'none', color: C.primary, padding: '6px 0', marginTop: 4 }} onClick={() => setPaste(!paste)}>
                {paste ? 'Hide paste box' : 'or paste rows copied from Excel'}
              </button>
            </StepCard>
          </div>
          {paste && (
            <label style={{ display: 'block', marginTop: 12 }}>
              <span style={label}>Paste here: select the rows in Excel including the column names, copy, then paste</span>
              <textarea autoFocus style={{ ...inp, width: '100%', minHeight: 120, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }}
                placeholder={'Name\tBranch\tPosition\tUpline\nTan Wei Ming\tTaman Desa\tTL\t'}
                onPaste={e => { e.preventDefault(); take('The pasted rows', parseDelimited(e.clipboardData.getData('text'))) }}
                onChange={e => e.target.value.includes('\n') && take('The pasted rows', parseDelimited(e.target.value))} />
            </label>
          )}
          {readError && <p role="alert" style={{ margin: '12px 0 0', padding: '10px 12px', borderRadius: 6, background: C.errBg, color: C.err, fontSize: 13 }}>{readError}</p>}
          {DEMO && !saved.length && (
            <p style={{ fontSize: 13, color: C.muted, margin: '12px 0 0' }}>
              Demo: <button style={{ ...btn, border: 'none', boxShadow: 'none', padding: 0, color: C.primary, fontSize: 13 }}
                onClick={() => take('The example list', [AGENT_HEADERS, ...A.exampleAgents(setup).map(toCells)])}>try it with an example team</button> for this Setup.
            </p>
          )}

          <div style={{ marginTop: 22 }}>
            {saved.length ? (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  <h3 style={{ fontSize: 15, margin: 0, flex: '1 1 200px' }}>Your team <span style={{ fontWeight: 500, color: C.muted, fontSize: 13 }}>· {saved.length} agent{saved.length === 1 ? '' : 's'}</span></h3>
                  <button style={{ ...btn, fontSize: 13, padding: '5px 11px' }} onClick={() => download(exportList(setup), 'Agents.xlsx', XLSX_TYPE)}>Download as Excel</button>
                  <button style={{ ...btn, fontSize: 13, padding: '5px 11px' }} onClick={removeAll}>Remove all</button>
                </div>
                <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 8px' }}>To change many at once: download, edit in Excel, and upload it again to replace the list.</p>
                <TeamTree setup={setup} people={saved.map(a => ({ ...a, key: a.id, upline: a.uplineId }))} roleName={roleName} />
              </>
            ) : (
              <p style={{ fontSize: 14, color: C.muted, margin: 0 }}>No agents yet.</p>
            )}
          </div>
        </>
      )}

      {pending && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', borderRadius: 8, background: C.bg, fontSize: 13.5 }}>
            <span style={{ flex: '1 1 260px', lineHeight: 1.5 }}>
              <b>{pending.source}</b>: {pending.read.rows.length} row{pending.read.rows.length === 1 ? '' : 's'} ·{' '}
              <span style={{ color: C.ok, fontWeight: 600 }}>{ready} ready</span>
              {checked.errors.length > 0 && <> · <span style={{ color: C.err, fontWeight: 600 }}>{badLines.size} to fix</span></>}
              {pending.read.unknown.length > 0 && <span style={{ color: C.muted }}> · not used: {pending.read.unknown.join(', ')}</span>}
            </span>
            {saved.length > 0 && (
              <select style={sel} value={pending.mode} aria-label="What to do with the saved agents" onChange={e => setPending({ ...pending, mode: e.target.value })}>
                <option value="replace">Replace the {saved.length} saved agents</option>
                <option value="add">Add to the {saved.length} saved agents</option>
              </select>
            )}
            <button style={{ ...btn, fontSize: 13, padding: '5px 11px' }} onClick={() => setPending(null)}>Cancel</button>
          </div>

          {checked.errors.length > 0 && (
            <div style={{ marginTop: 12, border: `1px solid ${C.err}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', background: C.errBg }}>
                <b style={{ flex: '1 1 220px', fontSize: 13.5, color: C.err }}>Fix these in your file and upload it again, or leave them out</b>
                <button style={{ ...btn, fontSize: 13, padding: '4px 10px' }} onClick={leaveOut}>Leave out {badLines.size} row{badLines.size === 1 ? '' : 's'}</button>
              </div>
              <ul style={{ margin: 0, padding: '6px 12px 8px 30px', fontSize: 13, lineHeight: 1.6, maxHeight: 220, overflowY: 'auto' }}>
                {checked.errors.slice(0, 200).map((e, i) => {
                  const who = pending.read.rows.find(r => r.line === e.line)?.cells.name
                  return <li key={i}><b>Row {e.line}</b>{who ? ` · ${who}` : ''}: {e.text}</li>
                })}
              </ul>
            </div>
          )}

          <h3 style={{ fontSize: 15, margin: '18px 0 8px' }}>Preview</h3>
          <TeamTree setup={setup} people={[...(pending.mode === 'add' ? saved.map(a => ({ ...a, key: a.id, upline: a.uplineId, old: true })) : []),
            ...checked.agents.map(a => ({ ...a, key: a.ref, bad: badLines.has(a.line) }))]} roleName={roleName} />
          <p style={{ fontSize: 12.5, color: C.muted, margin: '10px 0 0' }}>Nothing is saved until you press Save &amp; continue.</p>
        </>
      )}
    </Section>
  )
}

function StepCard({ n, title, text, children }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
        <span style={{ width: 24, height: 24, borderRadius: 12, background: C.primaryBg, color: C.primary, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>{n}</span>
        <b style={{ fontSize: 14.5 }}>{title}</b>
      </div>
      <p style={{ fontSize: 13, color: C.muted, margin: '0 0 10px', lineHeight: 1.45 }}>{text}</p>
      {children}
    </div>
  )
}

function DropZone({ onFile }) {
  const input = useRef(null)
  const [over, setOver] = useState(false)
  return (
    <div onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files?.[0]) }}
      style={{ border: `1.5px dashed ${over ? C.primary : C.borderStrong}`, background: over ? C.primaryBg : '#fff', borderRadius: 8, padding: 12,
        display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button style={btnPrimary} onClick={() => input.current?.click()}>Choose file</button>
      <span style={{ fontSize: 13, color: C.muted }}>or drop it here</span>
      <input ref={input} type="file" hidden accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        onChange={e => { onFile(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}

// people: [{ key, upline, name, branchId, position, tierId, lifetime, phone, bad?, old? }].
// One tree per branch: leaders with their people under them, most senior first.
function TeamTree({ setup, people, roleName }) {
  const byKey = new Map(people.map(p => [p.key, p]))
  const rank = p => (p.position ? setup.roles.findIndex(r => r.code === p.position) : -1)
  const kids = new Map()
  for (const p of people) {
    const up = byKey.get(p.upline)
    const parent = up && up.branchId === p.branchId ? up.key : null
    kids.set(parent, [...(kids.get(parent) || []), p])
  }
  const order = list => [...list].sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name))
  const tiersOf = id => setup.plans[P.planIndexFor(setup.plans, id)]?.tiers || []
  const node = (p, seen = new Set()) => {
    const tier = tiersOf(p.branchId).find(t => t.id === p.tierId)
    const under = seen.has(p.key) ? [] : order(kids.get(p.key) || [])
    const up = byKey.get(p.upline)
    seen.add(p.key)
    return {
      key: `p${p.key}`, open: under.length < 12,
      label: (
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', opacity: p.old ? 0.6 : 1 }}>
          <Avatar name={p.name || '?'} size={26} tone={p.bad ? 'red' : toneOf(p.name)} />
          <span style={{ color: p.bad ? C.err : C.text }}>{p.name || <i>No name</i>}</span>
          {p.position && <span title={roleName(p.position)} style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 10,
            color: roleColor(setup.roles, p.position), background: `${roleColor(setup.roles, p.position)}1a` }}>{p.position}</span>}
          {p.bad && <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: C.errBg, color: C.err }}>row {p.line} to fix</span>}
        </span>
      ),
      meta: [tier ? `Tier ${P.tierLabel(tier)}` : p.lifetime !== '' && p.lifetime != null ? `RM ${Number(p.lifetime).toLocaleString('en-MY')} lifetime` : null,
        up && up.branchId !== p.branchId ? `upline ${up.name} (${setup.branches.find(b => b.id === up.branchId)?.name})` : null,
        under.length ? `${under.length} under` : null, p.phone || null].filter(Boolean).join(' · ') || null,
      children: under.map(c => node(c, seen)),
    }
  }
  const roots = order(kids.get(null) || [])
  const branches = setup.branches.map(b => ({ b, roots: roots.filter(p => p.branchId === b.id) })).filter(x => x.roots.length)
  const lost = roots.filter(p => !setup.branches.some(b => b.id === p.branchId))
  const count = id => people.filter(p => p.branchId === id).length
  const nodes = [
    ...branches.map(({ b, roots: list }, i) => ({
      key: `b${b.id}`, open: i === 0 || people.length <= 40,
      label: <>{b.name} <span style={{ fontWeight: 500, color: C.muted, fontSize: 13 }}>· {count(b.id)} agent{count(b.id) === 1 ? '' : 's'}</span></>,
      children: list.map(p => node(p)),
    })),
    ...(lost.length ? [{ key: 'none', label: <span style={{ color: C.err }}>No branch yet</span>, children: lost.map(p => node(p)) }] : []),
  ]
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 14px', maxHeight: 520, overflowY: 'auto' }}>
      <OutlineTree nodes={nodes} />
    </div>
  )
}

// ── The Excel files ──────────────────────────────────────────────────────────

const AGENT_HEADERS = A.AGENT_COLUMNS.map(A.templateHeader)
const toCells = row => A.AGENT_COLUMNS.map(c => row[c.key] ?? '')

function template(setup) {
  const codes = [...new Set((setup.plans || []).flatMap(p => p.tiers.map(t => t.name)))]
  const roles = setup.roles.map(r => `${r.code} (${r.name})`).join(', ')
  const widths = A.AGENT_COLUMNS.map(c => c.width)
  const help = [
    ['Column', 'What to put in it'],
    ['Name *', 'Full name. Uplines point to people by this name.'],
    ['Branch *', `${setup.branches.map(b => `${b.name} (${b.code})`).join(', ') || 'Your branch'}. The name or the code.`],
    ['Position', roles ? `Leave blank for a negotiator, or an upline level: ${roles}.` : 'Leave blank: there are no upline levels in Setup.'],
    ['Upline', 'The name of the person they report to, written as in the Name column. Blank for the most senior.'],
    ['Tier', `Optional. The tier they start on: ${codes.join(', ') || 'T1, T2…'}. Blank: placed by lifetime commission.`],
    ['Lifetime commission (RM)', 'Optional. Commission earned since joining; it sets which tier they reach.'],
    ['Phone, Email, IC no., REN no.', 'As usual. The columns are Text, so leading zeros stay.'],
    ['Joined', 'The date they joined, e.g. 15/03/2024.'],
    ['Bank, Account no.', 'Where their commission is paid.'],
    ['', ''],
    ['', 'Only the first sheet (Agents) is read. The Example sheet shows a filled-in team.'],
  ]
  return makeXlsx([
    { name: 'Agents', rows: [AGENT_HEADERS], widths, lists: { 1: setup.branches.map(b => b.name), 2: setup.roles.map(r => r.code), 4: codes } },
    { name: 'Example', rows: [AGENT_HEADERS, ...A.exampleAgents(setup, 5).map(toCells)], widths },
    { name: 'How to fill', rows: help, widths: [28, 100] },
  ])
}

// The saved list in the template's layout, ready to edit and upload again.
function exportList(setup) {
  const agents = setup.agents || []
  const byId = new Map(agents.map(a => [a.id, a]))
  const named = name => agents.filter(a => a.name.toLowerCase() === name.toLowerCase()).length
  const rows = agents.map(a => {
    const up = byId.get(a.uplineId)
    const tier = (setup.plans[P.planIndexFor(setup.plans, a.branchId)]?.tiers || []).find(t => t.id === a.tierId)
    return toCells({ ...a, branch: setup.branches.find(b => b.id === a.branchId)?.name, position: a.position || '',
      upline: up ? (named(up.name) > 1 && up.ic ? up.ic : up.name) : '', tier: tier?.name || '', lifetime: a.lifetime === '' ? '' : String(a.lifetime),
      joined: ddmmyyyy(a.joined) })
  })
  return makeXlsx([{ name: 'Agents', rows: [AGENT_HEADERS, ...rows], widths: A.AGENT_COLUMNS.map(c => c.width),
    lists: { 1: setup.branches.map(b => b.name), 2: setup.roles.map(r => r.code) } }])
}

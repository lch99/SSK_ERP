import { useEffect, useMemo, useState } from 'react'
import * as A from '../../../shared/access.js'
import { C, btn, btnPrimary } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { useAccess, samplePerson } from '../access.jsx'
import { useFeedback } from '../feedback.jsx'
import { Page, Card, DataTable, Pill, Chips, Segmented, Select, Notice, go } from '../ui.jsx'
import { CARD, PAGE } from '../help.js'
import { ACCESS_GROUPS } from '../modules.js'

// System → Roles & access: what each account type may do in each area, and
// whose records it sees (rules in shared/access.js). Only the Superadmin
// opens it. "View as" shows the ERP as a person with that role would see it.
const TONE = { none: 'gray', view: 'blue', edit: 'green', full: 'violet' }
const LevelPill = ({ level }) => <Pill tone={TONE[level]} title={A.LEVEL_HELP[level]}>{A.LEVEL_LABEL[level]}</Pill>
// The areas, under the module they belong to (src/erp/modules.js).
const GROUPS = ACCESS_GROUPS.map(g => ({ label: g.label, areas: g.areas.map(k => A.AREAS.find(a => a.key === k)) }))

export default function Access({ parts }) {
  const { m } = useErp()
  const access = useAccess()
  const fb = useFeedback()
  const [draft, setDraft] = useState(access.policy)
  useEffect(() => setDraft(access.policy), [access.policy])
  const role = A.roleOf(parts[1]) ? parts[1] : 'admin-staff'
  const meta = A.roleOf(role)
  const dirty = JSON.stringify(draft) !== JSON.stringify(access.policy)

  const people = useMemo(() => {
    const n = {}
    for (const s of m.data.staff) { const r = A.roleForType(s.type); n[r] = (n[r] || 0) + 1 }
    return n
  }, [m])
  const [person, setPerson] = useState(null)
  const as = person ?? samplePerson(m.data.staff, role, draft)
  const staffOptions = useMemo(() => [...m.data.staff].sort((a, b) => a.name.localeCompare(b.name))
    .map(s => ({ value: s.id, label: `${s.name} · ${m.branchName(s.branchId)}` })), [m])

  const setLevel = (area, level) => setDraft({ ...draft, [role]: { ...draft[role], levels: { ...draft[role].levels, [area]: level } } })
  const setScope = scope => setDraft({ ...draft, [role]: { ...draft[role], scope } })
  const recommended = A.defaultPolicy()[role]
  const isRecommended = JSON.stringify(draft[role]) === JSON.stringify(recommended)
  const pick = key => { setPerson(null); go(`access/${key}`) }

  const save = () => fb.run(async () => { const r = await access.savePolicy(draft); setDraft(r.policy) }, 'Roles & access saved')
  const viewAs = async () => {
    if (dirty && !(await fb.confirm({ title: 'View with the saved rules?', body: 'Your changes are not saved yet, so the ERP will follow the rules as they were. Save first to try the new ones.', confirmLabel: 'View anyway' }))) return
    access.viewAs({ role, staffId: as })
    go('dashboard')
  }

  const overview = [
    { id: 'scope', label: 'Whose records', cells: r => <span style={{ fontSize: 13 }}>{A.SCOPE_LABEL[draft[r].scope]}</span> },
    ...GROUPS.flatMap(g => g.areas.map(a => ({ id: a.key, label: a.label, module: g.label, cells: r => <LevelPill level={draft[r].levels[a.key]} /> }))),
    { id: 'setup', label: 'Setup, Roles & access', cells: r => <LevelPill level={A.managesAccess(r) ? 'full' : 'none'} /> },
  ]
  const columns = [
    { key: 'area', label: 'Area', render: x => <span><b style={{ fontWeight: 600 }}>{x.label}</b>{x.module && <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{x.module}</span>}</span> },
    ...A.ROLES.map(r => ({ key: r.key, label: r.label, render: x => x.cells(r.key) })),
  ]

  return (
    <Page title="Roles & access" help={PAGE.access}
      sub="What each account type can do, and whose records it sees. Everyone gets the role of their Account Type (Agents & staff → edit a person).">
      <Card title="Edit a role" help={CARD.accessRole} style={{ marginBottom: 16 }}>
        <Chips label="Role" value={role} onChange={pick}
          options={A.ROLES.map(r => ({ key: r.key, label: r.label, count: r.locked ? null : people[r.key] || 0 }))} />

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', margin: '16px 0 14px' }}>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <h3 style={{ margin: '0 0 2px', fontSize: 17 }}>{meta.label}</h3>
            <p style={{ margin: 0, fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>{meta.desc}</p>
          </div>
          {!meta.locked && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {draft[role].scope !== 'all' && <Select label="As" value={as ?? ''} onChange={v => setPerson(Number(v))} options={staffOptions} />}
              <button style={btn} onClick={viewAs} disabled={as == null && draft[role].scope !== 'all'}>View the ERP as {meta.label}</button>
            </div>
          )}
        </div>

        {meta.locked ? (
          <Notice tone="blue">The Superadmin always has full access to everything, in every branch, so the company can never lock itself out. Only the Superadmin changes Setup and these roles.</Notice>
        ) : (
          <>
            <Row label="Whose records" text={A.SCOPE_HELP[draft[role].scope]}>
              <Segmented label="Whose records" value={draft[role].scope} onChange={setScope} options={A.SCOPES.map(s => ({ key: s, label: A.SCOPE_LABEL[s] }))} />
            </Row>
            {GROUPS.map(g => (
              <div key={g.label}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '.07em', padding: '16px 0 6px', borderTop: `1px solid ${C.border}` }}>{g.label}</div>
                {g.areas.map(a => {
                  const level = draft[role].levels[a.key]
                  return (
                    <Row key={a.key} label={a.label} text={level === 'edit' ? a.edit : level === 'full' ? `${a.edit}. ${a.full}.` : A.LEVEL_HELP[level]}
                      changed={level !== recommended.levels[a.key]}>
                      <Segmented label={a.label} value={level} onChange={v => setLevel(a.key, v)} options={A.LEVELS.map(l => ({ key: l, label: A.LEVEL_LABEL[l] }))} />
                    </Row>
                  )
                })}
              </div>
            ))}
            <Row label="Setup, Roles & access" text="The company rules and these roles.">
              <span style={{ fontSize: 13, color: C.muted }}>Superadmin only</span>
            </Row>
          </>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          <button style={{ ...btnPrimary, opacity: dirty ? 1 : 0.5 }} disabled={!dirty} onClick={save}>Save changes</button>
          {!meta.locked && <button style={btn} disabled={isRecommended} onClick={() => setDraft({ ...draft, [role]: recommended })}>Use the recommended {meta.label} access</button>}
          {dirty && <button style={{ ...btn, border: 'none', boxShadow: 'none', color: C.muted }} onClick={() => setDraft(access.policy)}>Discard changes</button>}
        </div>
      </Card>

      <Card title="Who can do what" help={CARD.accessOverview} pad={0}>
        <DataTable columns={columns} rows={overview} narrowAt={900} pageSize={50} />
      </Card>
    </Page>
  )
}

function Row({ label, text, changed, children }) {
  return (
    <div style={{ display: 'flex', gap: '6px 16px', alignItems: 'center', flexWrap: 'wrap', padding: '11px 0', borderTop: `1px solid ${C.border}` }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{label}{changed && <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 600, color: C.warn }}>changed</span>}</div>
        <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.45 }}>{text}</div>
      </div>
      {children}
    </div>
  )
}

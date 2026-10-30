import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import * as A from '../../shared/access.js'
import * as api from '../api.js'
import { AGENT_TYPES } from './model.js'
import { C, btn, btnPrimary } from '../styles.js'
import { Card, Empty, go, small } from './ui.jsx'
import Icon from './Icon.jsx'

// Who is using the ERP and what their role lets them do (the rules are in
// shared/access.js). `me` is the signed-in account: the Superadmin while
// sign-in is off. The Superadmin can "view as" another role and person, to
// check what they would see; that lasts until the page is reloaded.
const Ctx = createContext(null)
export const useAccess = () => useContext(Ctx)
// (area, level) → may the viewer? Everything is open outside the ERP shell.
export const useCan = () => useAccess()?.can || (() => true)
// For menus: (item, area, level) → the item, greyed out with the reason when
// the viewer's role lacks the level (Menu shows `why` on disabled items).
export function useGate() {
  const a = useAccess()
  return (item, area, level = 'edit') => {
    if (!item || !a || a.can(area, level)) return item
    return { ...item, disabled: true, why: `Needs ${A.LEVEL_LABEL[level]} on ${A.AREAS.find(x => x.key === area)?.label || area}` }
  }
}

export function AccessProvider({ me, children }) {
  const [policy, setPolicy] = useState(A.defaultPolicy)
  const [viewAs, setViewAs] = useState(null)   // { role, staffId } or null
  useEffect(() => { api.getAccess().then(r => setPolicy(r.policy)).catch(() => { /* recommended policy stays */ }) }, [])

  const value = useMemo(() => {
    const real = { role: A.roleForUser(me), staffId: me?.staffId ?? null, branchId: me?.branchId ?? null }
    const who = viewAs && A.managesAccess(real.role) ? viewAs : real
    const role = A.roleOf(who.role)
    return {
      policy, real, who, viewing: who !== real,
      role,
      // The viewer's own staff id when they sign in as an agent: they get the
      // agent dashboard and My commission.
      agentId: AGENT_TYPES.includes(role?.type) ? who.staffId ?? null : null,
      scope: A.scopeOf(policy, who.role),
      can: (area, level = 'view') => A.allows(policy, who.role, area, level),
      opens: path => A.opens(policy, who.role, path),
      refusal: action => A.refusal(policy, who.role, action),
      manages: A.managesAccess(who.role),
      viewAs: setViewAs,
      savePolicy: async p => { const r = await api.saveAccessPolicy(p); setPolicy(r.policy); return r },
    }
  }, [me, policy, viewAs])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// A person to view the ERP as, for a role: someone of that account type if
// there is one; for "own and downline", a leader with a small team, so the
// limit shows.
export function samplePerson(staff, role, policy) {
  const live = staff.filter(s => s.status !== 'locked')
  const typed = live.filter(s => A.roleForType(s.type) === role && s.type)
  const pool = typed.length ? typed : live
  if (A.scopeOf(policy, role) !== 'team') return pool[0]?.id ?? null
  const size = s => A.teamOf(s.id, staff).size
  return [...pool].sort((a, b) => Math.abs(size(a) - 6) - Math.abs(size(b) - 6))[0]?.id ?? null
}

// Is the address a record (#/deals/42) that exists but is outside the
// viewer's reach? Pages look records up by id, so the shell checks first.
const RECORDS = { deals: 'deals', staff: 'staff', customers: 'customers', listings: 'listings', 'money-in': 'moneyIn', 'money-out': 'moneyOut' }
export function outOfReach(route, erp, scope) {
  const list = RECORDS[route[0]]
  if (scope === 'all' || !list || !/^\d+$/.test(route[1] || '') || !erp.m || !erp.scoped) return false
  const id = Number(route[1])
  return erp.m.data[list].some(x => x.id === id) && !erp.scoped[list].some(x => x.id === id)
}

// Shown in place of a page the viewer's role does not open.
export function NoAccess({ text }) {
  const a = useAccess()
  return (
    <Card>
      <Empty icon="lock" title={`Not open to ${a.role?.label || 'your role'}`}
        text={text || 'This page is not part of your role. Ask the Superadmin if you need it.'}
        action={<span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {a.viewing && <button style={btn} onClick={() => a.viewAs(null)}>Back to Superadmin</button>}
          <button style={btnPrimary} onClick={() => go('dashboard')}>Go to the dashboard</button>
        </span>} />
    </Card>
  )
}

// While the Superadmin views as someone else: who, what they see, and the way back.
export function ViewAsBar({ m }) {
  const a = useAccess()
  if (!a?.viewing) return null
  const person = m?.staff[a.who.staffId]
  const reach = a.scope === 'team' && person ? `${A.SCOPE_LABEL.team.toLowerCase()} (${A.teamOf(person.id, m.data.staff).size} people)`
    : a.scope === 'branch' && person ? `${m.branchName(person.branchId)} branch` : A.SCOPE_LABEL[a.scope].toLowerCase()
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16, padding: '9px 12px 9px 14px',
      borderRadius: 12, background: C.violetBg, color: C.violet, border: `1px solid color-mix(in srgb, ${C.violet} 22%, transparent)`, fontSize: 13.5 }}>
      <Icon name="eye" size={16} />
      <span style={{ flex: '1 1 260px', minWidth: 0, color: C.text }}>
        Viewing as <b>{person ? person.name : a.role.label}</b> · {a.role.label} · sees {reach}
      </span>
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button style={{ ...small, background: 'transparent' }} onClick={() => { const r = a.who.role; a.viewAs(null); go(`access/${r}`) }}>Change</button>
        <button style={{ ...small, borderColor: C.violet, color: C.violet }} onClick={() => a.viewAs(null)}>Back to Superadmin</button>
      </span>
    </div>
  )
}

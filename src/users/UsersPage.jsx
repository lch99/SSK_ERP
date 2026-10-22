import { useEffect, useState } from 'react'
import { listUsers, createUser, updateUser, resetUserPassword, unlockUser, getBranches } from '../api.js'
import { ROLES, roleMeta, validateUser, validatePassword, PASSWORD_MIN } from '../../shared/roles.js'
import { C, inp, sel, btn, btnPrimary, th, td, label } from '../styles.js'
import { ErrorList } from '../setup/Section.jsx'
import { Dialog } from '../auth/AuthScreens.jsx'
import { useFeedback } from '../erp/feedback.jsx'

const fmtWhen = s => (s ? new Date(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')).toLocaleString() : 'Never')

export default function UsersPage({ me }) {
  const fb = useFeedback()
  const [data, setData] = useState(null)
  const [branches, setBranches] = useState([])
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)      // user object, or {} for new
  const [resetting, setResetting] = useState(null)
  const [showInactive, setShowInactive] = useState(false)

  const load = () => Promise.all([listUsers(), getBranches()])
    .then(([u, b]) => { setData(u); setBranches(b.branches) })
    .catch(e => setError(e.message))
  useEffect(() => { load() }, [])

  if (error) return <div style={{ padding: 24 }}><ErrorList errors={[error]} /></div>
  if (!data) return <p style={{ padding: 24, color: C.muted }}>Loading accounts…</p>

  const branchName = id => branches.find(b => b.id === id)?.name || '—'
  const users = data.users.filter(u => showInactive || u.isActive)
  const hiddenCount = data.users.length - data.users.filter(u => u.isActive).length

  async function unlock(u) {
    if (await fb.run(() => unlockUser(u.id), `${u.name || u.username} unlocked`)) load()
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Users</h1>
          <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
            {me.role === 'superadmin' ? 'Everyone who can sign in.' : `Admin and Staff accounts for ${branchName(me.branchId)}.`}
          </p>
        </div>
        {hiddenCount > 0 && (
          <label style={{ fontSize: 13, color: C.muted }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show deactivated ({hiddenCount})
          </label>
        )}
        <button style={btnPrimary} onClick={() => setEditing({})}>+ Add user</button>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: C.radius, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
          <thead><tr>
            <th style={th}>Name</th><th style={th}>Username</th><th style={th}>Role</th><th style={th}>Branch</th>
            <th style={th}>Status</th><th style={th}>Last sign-in</th><th style={th} />
          </tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ opacity: u.isActive ? 1 : 0.55 }}>
                <td style={td}><b>{u.name}</b>{u.id === me.id && <span style={{ color: C.muted, fontSize: 12 }}> (you)</span>}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{u.username}</td>
                <td style={td}>{roleMeta(u.role).label}</td>
                <td style={td}>{u.branchId == null ? <span style={{ color: C.muted }}>All branches</span> : branchName(u.branchId)}</td>
                <td style={td}><Status u={u} /></td>
                <td style={{ ...td, fontSize: 13, color: C.muted, whiteSpace: 'nowrap' }}>{fmtWhen(u.lastLoginAt)}</td>
                <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {data.assignableRoles.includes(u.role) && (
                    <>
                      {u.locked && <button style={{ ...btn, marginRight: 6 }} onClick={() => unlock(u)}>Unlock</button>}
                      <button style={{ ...btn, marginRight: 6 }} onClick={() => setResetting(u)}>Set password</button>
                      <button style={btn} onClick={() => setEditing(u)}>Edit</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!users.length && <tr><td style={{ ...td, color: C.muted }} colSpan={7}>No accounts yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && <UserDialog me={me} user={editing} branches={branches} assignable={data.assignableRoles}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
      {resetting && <ResetDialog user={resetting} onClose={() => setResetting(null)} onSaved={() => { setResetting(null); load() }} />}
    </div>
  )
}

function Status({ u }) {
  const [text, color, bg] = !u.isActive ? ['Deactivated', C.muted, C.bg] : u.locked ? ['Locked', C.err, C.errBg] : ['Active', C.ok, C.okBg]
  return <span style={{ fontSize: 12, fontWeight: 600, color, background: bg, padding: '2px 8px', borderRadius: 10 }}>{text}</span>
}

function UserDialog({ me, user, branches, assignable, onClose, onSaved }) {
  const isNew = user.id == null
  const [f, setF] = useState({
    name: user.name || '', username: user.username || '', password: '',
    role: user.role || assignable[assignable.length - 1],
    branchId: user.branchId ?? (me.role === 'superadmin' ? '' : me.branchId),
    isActive: user.isActive ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [serverErrors, setServerErrors] = useState([])
  const scoped = roleMeta(f.role).branchScoped
  const self = user.id === me.id
  const body = { ...f, username: f.username.trim().toLowerCase(), branchId: scoped ? (f.branchId === '' ? null : Number(f.branchId)) : null }
  const errors = validateUser(isNew ? body : { ...body, password: undefined }, { isNew })

  async function save() {
    setBusy(true)
    setServerErrors([])
    try {
      if (isNew) await createUser(body)
      else await updateUser(user.id, { name: body.name, role: body.role, branchId: body.branchId, isActive: body.isActive })
      onSaved()
    } catch (e) {
      setServerErrors(e.errors || [e.message])
    } finally {
      setBusy(false)
    }
  }

  const row = { display: 'block', marginBottom: 12 }
  return (
    <Dialog onClose={onClose} width={440}>
      <h2 style={{ fontSize: 18, margin: '0 0 14px' }}>{isNew ? 'Add user' : `Edit ${user.name}`}</h2>
      <label style={row}><span style={label}>Name</span>
        <input style={{ ...inp, width: '100%' }} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoFocus /></label>
      <label style={row}><span style={label}>Username {isNew ? '' : '(cannot be changed)'}</span>
        <input style={{ ...inp, width: '100%' }} value={f.username} disabled={!isNew} autoCapitalize="none"
          onChange={e => setF({ ...f, username: e.target.value.toLowerCase() })} /></label>
      <label style={row}><span style={label}>Role</span>
        <select style={{ ...sel, width: '100%' }} value={f.role} disabled={self} onChange={e => setF({ ...f, role: e.target.value })}>
          {ROLES.filter(r => assignable.includes(r.value)).map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.4 }}>{roleMeta(f.role).desc}</span>
      </label>
      {scoped && (
        <label style={row}><span style={label}>Branch</span>
          <select style={{ ...sel, width: '100%' }} value={f.branchId ?? ''} disabled={me.role !== 'superadmin'}
            onChange={e => setF({ ...f, branchId: e.target.value === '' ? '' : Number(e.target.value) })}>
            <option value="">Choose…</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {!branches.length && <span style={{ display: 'block', fontSize: 12, color: C.warn, marginTop: 4 }}>Add branches on the Setup page first.</span>}
        </label>
      )}
      {isNew && (
        <label style={row}><span style={label}>Starting password (at least {PASSWORD_MIN} characters)</span>
          <input style={{ ...inp, width: '100%' }} type="text" value={f.password} autoComplete="off" onChange={e => setF({ ...f, password: e.target.value })} />
          <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 4 }}>Give it to them privately; they can change it after signing in.</span>
        </label>
      )}
      {!isNew && !self && (
        <label style={{ ...row, fontSize: 14 }}>
          <input type="checkbox" checked={!f.isActive} onChange={e => setF({ ...f, isActive: !e.target.checked })} /> Deactivated (can't sign in)
        </label>
      )}
      {self && <p style={{ fontSize: 12, color: C.muted, margin: '0 0 12px' }}>You can't change your own role or deactivate yourself.</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={{ ...btnPrimary, opacity: errors.length || busy ? 0.5 : 1 }} disabled={errors.length > 0 || busy} onClick={save}>
          {busy ? 'Saving…' : isNew ? 'Create account' : 'Save'}
        </button>
        <button style={btn} onClick={onClose}>Cancel</button>
      </div>
      <ErrorList errors={[...(f.name || f.username ? errors : []), ...serverErrors]} />
    </Dialog>
  )
}

function ResetDialog({ user, onClose, onSaved }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState([])
  const err = validatePassword(pw)
  async function save() {
    setBusy(true)
    try { await resetUserPassword(user.id, pw); onSaved() } catch (e) { setErrors(e.errors || [e.message]) } finally { setBusy(false) }
  }
  return (
    <Dialog onClose={onClose}>
      <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>Set a new password for {user.name}</h2>
      <p style={{ fontSize: 13, color: C.muted, margin: '0 0 14px', lineHeight: 1.45 }}>This also unlocks the account and signs it out everywhere.</p>
      <input style={{ ...inp, width: '100%' }} type="text" value={pw} autoComplete="off" autoFocus onChange={e => setPw(e.target.value)} placeholder={`At least ${PASSWORD_MIN} characters`} />
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button style={{ ...btnPrimary, opacity: err || busy ? 0.5 : 1 }} disabled={!!err || busy} onClick={save}>{busy ? 'Saving…' : 'Set password'}</button>
        <button style={btn} onClick={onClose}>Cancel</button>
      </div>
      <ErrorList errors={errors} />
    </Dialog>
  )
}

import { useState } from 'react'
import { login, createFirstUser, changePassword } from '../api.js'
import { PASSWORD_MIN } from '../../shared/roles.js'
import { C, inp, btn, btnPrimary, label } from '../styles.js'
import { ErrorList } from '../setup/Section.jsx'

const card = { maxWidth: 380, margin: '72px auto', padding: 28, background: C.card, border: `1px solid ${C.border}`, borderRadius: C.radius }
const field = { display: 'block', marginBottom: 12 }

function Field({ title, ...props }) {
  return <label style={field}><span style={label}>{title}</span><input style={{ ...inp, width: '100%' }} {...props} /></label>
}

function useSubmit(fn) {
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState([])
  const submit = async e => {
    e.preventDefault()
    setBusy(true)
    setErrors([])
    try { await fn() } catch (err) { setErrors(err.errors || [err.message]) } finally { setBusy(false) }
  }
  return { busy, errors, setErrors, submit }
}

export function LoginScreen({ onSignedIn, notice }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const { busy, errors, submit } = useSubmit(async () => onSignedIn(await login(username, password)))
  return (
    <form style={card} onSubmit={submit}>
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>SubSaleKing ERP</h1>
      <p style={{ fontSize: 13, color: C.muted, margin: '0 0 18px' }}>Sign in to continue.</p>
      {notice && <p style={{ fontSize: 13, color: C.warn, background: C.warnBg, padding: '8px 10px', borderRadius: 6, margin: '0 0 14px' }}>{notice}</p>}
      <Field title="Username" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus />
      <Field title="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
      <button style={{ ...btnPrimary, width: '100%' }} disabled={busy} type="submit">{busy ? 'Signing in…' : 'Sign in'}</button>
      <ErrorList errors={errors} />
    </form>
  )
}

export function FirstUserScreen({ onSignedIn }) {
  const [f, setF] = useState({ name: '', username: '', password: '', confirm: '' })
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const { busy, errors, setErrors, submit } = useSubmit(async () => {
    if (f.password !== f.confirm) return setErrors(["The two passwords don't match."])
    onSignedIn(await createFirstUser({ name: f.name, username: f.username.trim().toLowerCase(), password: f.password }))
  })
  return (
    <form style={card} onSubmit={submit}>
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Welcome to SubSaleKing ERP</h1>
      <p style={{ fontSize: 13, color: C.muted, margin: '0 0 18px', lineHeight: 1.45 }}>
        Create the first account. It will be a <b>superadmin</b>, able to complete Setup and add everyone else.
      </p>
      <Field title="Your name" value={f.name} onChange={set('name')} autoFocus />
      <Field title="Username" value={f.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" placeholder="e.g. jonathan" />
      <Field title={`Password (at least ${PASSWORD_MIN} characters)`} type="password" value={f.password} onChange={set('password')} autoComplete="new-password" />
      <Field title="Password again" type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" />
      <button style={{ ...btnPrimary, width: '100%' }} disabled={busy} type="submit">{busy ? 'Creating…' : 'Create account'}</button>
      <ErrorList errors={errors} />
    </form>
  )
}

export function ChangePasswordDialog({ onClose }) {
  const [f, setF] = useState({ current: '', password: '', confirm: '' })
  const [done, setDone] = useState(false)
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const { busy, errors, setErrors, submit } = useSubmit(async () => {
    if (f.password !== f.confirm) return setErrors(["The two new passwords don't match."])
    await changePassword(f.current, f.password)
    setDone(true)
  })
  return (
    <Dialog onClose={onClose}>
      <h2 style={{ fontSize: 18, margin: '0 0 14px' }}>Change password</h2>
      {done ? (
        <>
          <p style={{ fontSize: 14, margin: '0 0 16px' }}>Password changed. Any other device signed in with your account has been signed out.</p>
          <button style={btnPrimary} onClick={onClose}>Close</button>
        </>
      ) : (
        <form onSubmit={submit}>
          <Field title="Current password" type="password" value={f.current} onChange={set('current')} autoComplete="current-password" autoFocus />
          <Field title={`New password (at least ${PASSWORD_MIN} characters)`} type="password" value={f.password} onChange={set('password')} autoComplete="new-password" />
          <Field title="New password again" type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnPrimary} disabled={busy} type="submit">{busy ? 'Saving…' : 'Change password'}</button>
            <button style={btn} type="button" onClick={onClose}>Cancel</button>
          </div>
          <ErrorList errors={errors} />
        </form>
      )}
    </Dialog>
  )
}

export function Dialog({ onClose, children, width = 400 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,20,30,0.45)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 50 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" style={{ background: C.card, borderRadius: C.radius, padding: 24, width: '100%', maxWidth: width, maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box' }}>
        {children}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { login, createFirstUser, forgotPassword, linkInfo, setPasswordByLink } from '../api.js'
import { PASSWORD_MIN } from '../../shared/roles.js'
import { C, inp, btnPrimary, label } from '../styles.js'
import { ErrorList } from '../setup/Section.jsx'
import Footer from '../brand/Footer.jsx'

const card = { maxWidth: 380, margin: '72px auto', padding: 28, background: C.card, border: `1px solid ${C.border}`, borderRadius: C.radius }
const field = { display: 'block', marginBottom: 12 }
// Under the sign-in card: the copyright line, centred.
const footer = { maxWidth: 380, margin: '-48px auto 24px', padding: '0 16px', borderTop: 'none', justifyContent: 'center', textAlign: 'center' }

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
  const [forgot, setForgot] = useState(false)
  const { busy, errors, submit } = useSubmit(async () => onSignedIn(await login(username, password)))
  if (forgot) return <ForgotScreen username={username} onBack={() => setForgot(false)} />
  return (
    <>
    <form style={card} onSubmit={submit}>
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>SubSaleKing ERP</h1>
      <p style={{ fontSize: 13, color: C.muted, margin: '0 0 18px' }}>Sign in to continue.</p>
      {notice && <p style={{ fontSize: 13, color: C.warn, background: C.warnBg, padding: '8px 10px', borderRadius: 6, margin: '0 0 14px' }}>{notice}</p>}
      <Field title="Username" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus />
      <Field title="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
      <button style={{ ...btnPrimary, width: '100%' }} disabled={busy} type="submit">{busy ? 'Signing in…' : 'Sign in'}</button>
      <ErrorList errors={errors} />
      <button type="button" onClick={() => setForgot(true)} style={linkBtn}>Forgot password, or never set one?</button>
    </form>
    <Footer style={footer} />
    </>
  )
}

const linkBtn = { display: 'block', margin: '14px auto 0', background: 'none', border: 'none', color: C.primaryDark, fontWeight: 600, fontSize: 13.5, cursor: 'pointer', fontFamily: C.font, padding: 6 }

// Forgot password: the person's branch office is asked to send them a new link.
function ForgotScreen({ username: typed, onBack }) {
  const [username, setUsername] = useState(typed)
  const [sent, setSent] = useState(null)
  const { busy, errors, submit } = useSubmit(async () => setSent((await forgotPassword(username.trim().toLowerCase())).message))
  return (
    <>
    <form style={card} onSubmit={submit}>
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>A new password link</h1>
      {sent ? <p style={{ fontSize: 14, lineHeight: 1.5, margin: '8px 0 16px' }}>{sent} When it comes, open it on this phone or computer and choose your password.</p> : (
        <>
          <p style={{ fontSize: 13, color: C.muted, margin: '0 0 18px', lineHeight: 1.45 }}>Type your username. Your branch office is told, and sends you a link to choose a new password.</p>
          <Field title="Username" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus />
          <button style={{ ...btnPrimary, width: '100%' }} disabled={busy || !username.trim()} type="submit">{busy ? 'Asking…' : 'Ask for a new link'}</button>
          <ErrorList errors={errors} />
        </>
      )}
      <button type="button" onClick={onBack} style={linkBtn}>Back to sign in</button>
    </form>
    <Footer style={footer} />
    </>
  )
}

// #/password?t=…: choose a password from the link the office sent, then straight in.
export function SetPasswordScreen({ token, onSignedIn, onDone }) {
  const [info, setInfo] = useState(null)
  const [problem, setProblem] = useState(null)
  const [f, setF] = useState({ password: '', confirm: '' })
  useEffect(() => { linkInfo(token).then(setInfo, e => setProblem(e.message)) }, [token])
  const { busy, errors, setErrors, submit } = useSubmit(async () => {
    if (f.password !== f.confirm) return setErrors(["The two passwords don't match."])
    onSignedIn(await setPasswordByLink(token, f.password))
  })
  return (
    <>
    <form style={card} onSubmit={submit}>
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>{info?.purpose === 'reset' ? 'Choose a new password' : 'Welcome to SubSaleKing ERP'}</h1>
      {problem ? <><ErrorList errors={[problem]} /><button type="button" onClick={onDone} style={linkBtn}>Go to sign in</button></>
        : !info ? <p style={{ fontSize: 13, color: C.muted }}>Checking your link…</p> : (
          <>
            <p style={{ fontSize: 13, color: C.muted, margin: '0 0 18px', lineHeight: 1.45 }}>
              {info.name}, your username is <b style={{ color: C.text }}>{info.username}</b>. Choose a password you will remember: you sign in with these two from now on.
            </p>
            <input type="hidden" name="username" value={info.username} autoComplete="username" readOnly />
            <Field title={`Password (at least ${PASSWORD_MIN} characters)`} type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} autoComplete="new-password" autoFocus />
            <Field title="Password again" type="password" value={f.confirm} onChange={e => setF({ ...f, confirm: e.target.value })} autoComplete="new-password" />
            <button style={{ ...btnPrimary, width: '100%' }} disabled={busy} type="submit">{busy ? 'Saving…' : 'Save and sign in'}</button>
            <ErrorList errors={errors} />
          </>
        )}
    </form>
    <Footer style={footer} />
    </>
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
    <>
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
    <Footer style={footer} />
    </>
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

import { useEffect, useState } from 'react'
import { authStatus, getMe, getToken, signOut, SIGNED_OUT_EVENT } from './api.js'
import { C, btn } from './styles.js'
import { LoginScreen, FirstUserScreen, SetPasswordScreen } from './auth/AuthScreens.jsx'
import { ErrorList } from './setup/Section.jsx'
import Shell from './erp/Shell.jsx'

// #/password?t=… : the one-time link the office sent to set a password.
const linkToken = () => (/^#\/password\?/.test(window.location.hash) ? new URLSearchParams(window.location.hash.split('?')[1]).get('t') : null)

export default function App() {
  const [phase, setPhase] = useState('loading')   // loading | first | login | in | error
  const [token, setLinkToken] = useState(linkToken)
  const [me, setMe] = useState(null)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [authDisabled, setAuthDisabled] = useState(false)

  async function boot() {
    setPhase('loading')
    try {
      const status = await authStatus()
      if (status.authDisabled) {
        setAuthDisabled(true)
        setMe((await getMe()).user)
        return setPhase('in')
      }
      if (getToken()) {
        try { setMe((await getMe()).user); return setPhase('in') } catch { /* fall through to sign-in */ }
      }
      setPhase(status.needsFirstUser ? 'first' : 'login')
    } catch (e) {
      setError(e.message)
      setPhase('error')
    }
  }
  useEffect(() => { boot() }, [])
  useEffect(() => {
    const onOut = e => { setMe(null); setNotice(e.detail || 'Please sign in again.'); setPhase('login') }
    window.addEventListener(SIGNED_OUT_EVENT, onOut)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onOut)
  }, [])

  const signedIn = user => { setMe(user); setNotice(null); setPhase('in') }
  const leaveLink = () => { setLinkToken(null); window.history.replaceState(null, '', '#/dashboard') }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: C.font }}>
      {phase === 'loading' && <p style={{ padding: 24, color: C.muted }}>Loading…</p>}
      {phase === 'error' && (
        <div style={{ maxWidth: 480, margin: '72px auto', padding: 16 }}>
          <ErrorList errors={[error]} />
          <button style={{ ...btn, marginTop: 12 }} onClick={boot}>Try again</button>
        </div>
      )}
      {token && phase !== 'loading' && phase !== 'error' && !authDisabled && (
        <SetPasswordScreen token={token} onSignedIn={user => { leaveLink(); signedIn(user) }} onDone={() => { leaveLink(); if (phase === 'in') return; setPhase('login') }} />
      )}
      {!(token && !authDisabled) && phase === 'first' && <FirstUserScreen onSignedIn={signedIn} />}
      {!(token && !authDisabled) && phase === 'login' && <LoginScreen onSignedIn={signedIn} notice={notice} />}
      {!(token && !authDisabled) && phase === 'in' && me && (
        <Shell me={me} authDisabled={authDisabled}
          onSignOut={() => { signOut(); setMe(null); setNotice(null); setPhase('login') }} />
      )}
    </div>
  )
}

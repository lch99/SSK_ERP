import { useEffect, useState } from 'react'
import { authStatus, getMe, getToken, signOut, SIGNED_OUT_EVENT } from './api.js'
import { C, btn } from './styles.js'
import { LoginScreen, FirstUserScreen, ChangePasswordDialog } from './auth/AuthScreens.jsx'
import { ErrorList } from './setup/Section.jsx'
import Shell from './erp/Shell.jsx'

export default function App() {
  const [phase, setPhase] = useState('loading')   // loading | first | login | in | error
  const [me, setMe] = useState(null)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [authDisabled, setAuthDisabled] = useState(false)
  const [changingPw, setChangingPw] = useState(false)

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

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: C.font }}>
      {phase === 'loading' && <p style={{ padding: 24, color: C.muted }}>Loading…</p>}
      {phase === 'error' && (
        <div style={{ maxWidth: 480, margin: '72px auto', padding: 16 }}>
          <ErrorList errors={[error]} />
          <button style={{ ...btn, marginTop: 12 }} onClick={boot}>Try again</button>
        </div>
      )}
      {phase === 'first' && <FirstUserScreen onSignedIn={signedIn} />}
      {phase === 'login' && <LoginScreen onSignedIn={signedIn} notice={notice} />}
      {phase === 'in' && me && (
        <Shell me={me} authDisabled={authDisabled} onChangePassword={() => setChangingPw(true)}
          onSignOut={() => { signOut(); setMe(null); setNotice(null); setPhase('login') }} />
      )}
      {changingPw && <ChangePasswordDialog onClose={() => setChangingPw(false)} />}
    </div>
  )
}

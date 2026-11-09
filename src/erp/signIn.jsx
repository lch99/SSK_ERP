import { useEffect, useState } from 'react'
import { C, btn, btnPrimary } from '../styles.js'
import { DEMO, accountOf, makeAccountLink, emailAccountLink, passwordLink } from '../api.js'
import { useFeedback } from './feedback.jsx'
import { Card, Modal, Pill, field } from './ui.jsx'
import { date } from './format.js'
import Icon from './Icon.jsx'

// A person's sign-in on their page (Agents & staff): their username, whether
// they have set a password, and a one-time link to set one, which the office
// sends them by WhatsApp or copies. Everyone signs in with their own account
// (the user's call, 2026-11-08).

// A phone number for wa.me: digits with the country code. A number written the local way
// (012-345 6789) is Malaysian; an 8-digit one starting with 8 or 9 is Singaporean.
export function waNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('60') || d.startsWith('65')) return d
  if (d.startsWith('0')) return `60${d.slice(1)}`
  if (d.length === 8 && /^[89]/.test(d)) return `65${d}`
  return d
}

export function SignInCard({ s, canEdit }) {
  const fb = useFeedback()
  const [acc, setAcc] = useState(null)
  const [link, setLink] = useState(null)
  const load = () => accountOf(s.id).then(setAcc, () => setAcc({ error: true }))
  useEffect(() => { if (!DEMO) load() }, [s.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (DEMO) {
    return (
      <Card title="Sign-in">
        <p style={{ margin: 0, fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>
          In the live ERP {s.short} signs in with their own username{s.username ? <> (<b style={{ color: C.text }}>{String(s.username).toLowerCase()}</b>)</> : ''} and a password they choose from a one-time link the office sends them here, by WhatsApp or copied.
        </p>
      </Card>
    )
  }
  if (!acc || acc.error) return null
  const send = async () => {
    try {
      setLink(await makeAccountLink(s.id))
      load()
    } catch (e) { fb.error(e) }
  }
  const byEmail = async () => {
    try {
      const r = await emailAccountLink(s.id, link.token)
      fb.toast(`Link sent to ${r.to}`)
    } catch (e) { fb.error(e) }
  }
  const url = link && passwordLink(link.token)
  const wa = link && waNumber(s.phone)
  const text = link && `Hi ${s.short}, here is your link to ${link.purpose === 'reset' ? 'choose a new' : 'set your'} SubSaleKing ERP password. Your username is ${link.username}. The link works once, until ${date(link.expiresAt.slice(0, 10))}: ${url}`
  const state = !acc.hasAccount ? ['gray', 'No account yet'] : !acc.hasPassword ? ['amber', 'No password yet'] : acc.locked ? ['red', 'Locked: wrong passwords'] : ['green', 'Signs in']
  return (
    <Card title="Sign-in" actions={canEdit && acc.staffActive && <button style={btn} onClick={send}><Icon name="lock" size={15} />{acc.hasPassword ? 'Send a new password link' : 'Send a link to set the password'}</button>}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13.5 }}>
        <Pill tone={state[0]}>{state[1]}</Pill>
        {acc.username && <span>Username <b>{acc.username}</b></span>}
        {acc.lastSignIn && <span style={{ color: C.muted }}>· last signed in {date(acc.lastSignIn.slice(0, 10))}</span>}
        {acc.linkOpen && <span style={{ color: C.muted }}>· a link was sent, open until {date(acc.linkOpen.expiresAt.slice(0, 10))}</span>}
      </div>
      {!acc.staffActive && <p style={{ margin: '8px 0 0', fontSize: 13, color: C.muted }}>Only Active people sign in: set {s.short} Enabled (Active) first.</p>}
      <Modal open={!!link} onClose={() => setLink(null)} title={`Password link for ${s.short}`} width={520}
        footer={<>
          <button style={btn} onClick={() => navigator.clipboard?.writeText(text).then(() => fb.toast('Message and link copied'), () => fb.toast('Select the link and copy it'))}>Copy message</button>
          {acc.canEmail && <button style={btn} onClick={byEmail}>Send by e-mail</button>}
          {wa && <a href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" style={{ ...btnPrimary, textDecoration: 'none' }}>Send by WhatsApp</a>}
        </>}>
        {link && (
          <div style={{ display: 'grid', gap: 10, fontSize: 13.5, lineHeight: 1.5 }}>
            {link.made && <p style={{ margin: 0 }}>An account was made for {s.short} with the username <b>{link.username}</b>.</p>}
            <p style={{ margin: 0 }}>Send this to {s.short}{wa ? ` (${s.phone})` : ''}. It works once, until <b>{date(link.expiresAt.slice(0, 10))}</b>{link.purpose === 'reset' ? '; their old password stops working when they choose a new one' : ''}. Making another link cancels this one.</p>
            <input readOnly value={url} onFocus={e => e.target.select()} style={{ ...field, fontSize: 12.5 }} aria-label="Password link" />
          </div>
        )}
      </Modal>
    </Card>
  )
}

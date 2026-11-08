import { useEffect, useState } from 'react'
import { C, btn, btnPrimary } from '../styles.js'
import Icon from './Icon.jsx'
import { Modal } from './ui.jsx'

// The ERP as an app on a phone or tablet. Added to the home screen it opens
// full screen from its own icon, with no address bar, like any other app.
// Android (Chrome, Edge, Samsung) offers its own "Install" prompt, kept here
// when it comes; iPhone and iPad have none, so we show the two taps it takes.

let deferred = null
const subs = new Set()
const tell = () => subs.forEach(f => f())
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; tell() })
  window.addEventListener('appinstalled', () => { deferred = null; tell() })
}

// Opened from its home-screen icon.
export const isInstalled = () => typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true)
const isApple = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

// { can, how: 'prompt' | 'apple', install() }: install() shows the browser's prompt
// (Android) or returns false so the page shows the how-to (iPhone, iPad).
export function useInstall() {
  const [, tick] = useState(0)
  useEffect(() => {
    const f = () => tick(n => n + 1)
    subs.add(f)
    return () => subs.delete(f)
  }, [])
  if (isInstalled()) return { can: false }
  if (deferred) {
    return {
      can: true, how: 'prompt',
      install: async () => {
        const e = deferred
        deferred = null
        tell()
        await e.prompt()
        return true
      },
    }
  }
  if (isApple()) return { can: true, how: 'apple', install: async () => false }
  return { can: false }
}

// The how-to for iPhone and iPad (Safari has no install prompt).
export function AppleHowTo({ open, onClose }) {
  const step = (n, text, icon) => (
    <li style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
      <span style={{ width: 28, height: 28, borderRadius: 14, background: C.primaryBg, color: C.primaryDark, fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{n}</span>
      <span style={{ flex: 1, fontSize: 14.5, lineHeight: 1.45 }}>{text}</span>
      {icon && <span style={{ color: C.muted, display: 'inline-flex' }}><Icon name={icon} size={20} /></span>}
    </li>
  )
  return (
    <Modal open={open} onClose={onClose} title="Add SubSaleKing to your home screen" footer={<button style={btnPrimary} onClick={onClose}>Got it</button>}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {step(1, <>In Safari, tap the <b>Share</b> button (the square with an arrow, at the bottom or top of the screen).</>, 'upload')}
        {step(2, <>Scroll down and tap <b>Add to Home Screen</b>.</>, 'plus')}
        {step(3, <>Tap <b>Add</b>. SubSaleKing is now an app on your home screen: open it from there.</>, 'check')}
      </ol>
      <p style={{ fontSize: 13, color: C.muted, margin: '12px 0 0', lineHeight: 1.5 }}>Using Chrome on iPhone? Tap the Share button beside the address bar, then Add to Home Screen.</p>
    </Modal>
  )
}

// A card on phones (Home) offering the app, until it is installed or put off for two weeks.
const LATER_KEY = 'ssk-install-later'
const LATER_DAYS = 14
export function InstallCard() {
  const app = useInstall()
  const [how, setHow] = useState(false)
  const [later, setLater] = useState(() => {
    try { return Date.now() - Number(localStorage.getItem(LATER_KEY) || 0) < LATER_DAYS * 86400000 } catch { return false }
  })
  if (!app.can || later) return null
  const putOff = () => {
    setLater(true)
    try { localStorage.setItem(LATER_KEY, String(Date.now())) } catch { /* shown again next visit */ }
  }
  return (
    <div className="ssk-page" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, marginBottom: 14, borderRadius: 12, background: C.card, border: `1px solid ${C.border}`, boxShadow: C.shadow }}>
      <img src="icons/icon-192.png" alt="" width={44} height={44} style={{ borderRadius: 10, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: 'block', fontSize: 14.5 }}>Use SubSaleKing as an app</b>
        <span style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.4 }}>Opens from your home screen, full screen.</span>
      </div>
      <button style={{ ...btnPrimary, padding: '8px 14px' }} onClick={async () => { if (!(await app.install())) setHow(true) }}>{app.how === 'apple' ? 'How' : 'Install'}</button>
      <button aria-label="Not now" onClick={putOff} style={{ ...btn, padding: 6, boxShadow: 'none', border: 'none', background: 'transparent', color: C.muted }}><Icon name="close" size={16} /></button>
      <AppleHowTo open={how} onClose={() => setHow(false)} />
    </div>
  )
}

// Online or not (the browser's own sense of it), for the "you're offline" line.
export function useOnline() {
  const [on, setOn] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  return on
}

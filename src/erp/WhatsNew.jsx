import { useEffect, useState } from 'react'
import { C, btn, btnPrimary } from '../styles.js'
import { RELEASES, unseen } from '../releases.js'
import { useAccess } from './access.jsx'
import { Page, Card, Modal, Pill, go } from './ui.jsx'
import { PAGE } from './help.js'
import { date } from './format.js'
import Icon from './Icon.jsx'

// What's new: the release notes (src/releases.js) in plain words. They pop
// up once after an update, the new ones since the person's last visit, and
// stay under Home → What's new. Agents don't see notes meant for the office.
const SEEN_KEY = 'ssk-seen-release'
const readSeen = () => { try { return localStorage.getItem(SEEN_KEY) } catch { return null } }
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, RELEASES[0].version) } catch { /* shown again next time */ } }
const WHO = { agents: 'For agents', office: 'For the office' }

function useItemsFor() {
  const a = useAccess()
  return r => r.items.filter(i => !(a?.agentId != null && i.who === 'office'))
}

// One release: its title, date and what changed, each with "Show me" when the
// viewer opens that page. `all` shows every item whoever is looking.
export function Release({ r, onGo, all = false, first = false }) {
  const a = useAccess()
  const itemsFor = useItemsFor()
  const items = all ? r.items : itemsFor(r)
  if (!items.length) return null
  return (
    <section style={{ paddingTop: first ? 0 : 16, marginTop: first ? 0 : 16, borderTop: first ? 'none' : `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{r.title}</h3>
        <span style={{ fontSize: 12.5, color: C.muted }}>Version {r.version} · {date(r.date)}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 10 }}>
        {items.map((i, n) => (
          <li key={n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.55 }}>
            <span aria-hidden style={{ color: C.primary, marginTop: 3, flexShrink: 0 }}><Icon name="check" size={16} stroke={2.2} /></span>
            <span style={{ flex: 1 }}>
              {i.text}
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginLeft: 6, verticalAlign: 'middle' }}>
                {i.who && <Pill tone={i.who === 'agents' ? 'blue' : 'violet'} dot={false} style={{ fontSize: 11 }}>{WHO[i.who]}</Pill>}
                {i.to && (!a || a.opens(i.to)) && <a href={`#/${i.to}`} onClick={onGo} style={{ fontSize: 13, fontWeight: 600, color: C.primaryDark, whiteSpace: 'nowrap' }}>Show me →</a>}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Opens by itself when there is something new since this person's last look
// (`show` is false while the ERP is not ready, e.g. during maintenance).
// `preview` opens it on demand, with the latest release, for the technical team.
export function WhatsNewPopup({ show = true, preview = false, onClose }) {
  const itemsFor = useItemsFor()
  const [list, setList] = useState(() => (preview ? RELEASES.slice(0, 1) : unseen(readSeen()).filter(r => itemsFor(r).length)))
  useEffect(() => { if (preview) setList(RELEASES.slice(0, 1)) }, [preview])
  const close = () => { if (!preview) markSeen(); setList([]); onClose?.() }
  if (!show || !list.length) return null
  return (
    <Modal open onClose={close} width={620} title={list.length > 1 ? `What's new: ${list.length} updates since your last visit` : `What's new in version ${list[0].version}`}
      footer={<>
        <button style={btn} onClick={() => { close(); go('whats-new') }}>All updates</button>
        <button style={btnPrimary} onClick={close} autoFocus>Got it</button>
      </>}>
      {list.map((r, i) => <Release key={r.version} r={r} first={i === 0} all={preview} onGo={close} />)}
    </Modal>
  )
}

// Home → What's new: every release, newest first.
export function WhatsNew() {
  useEffect(() => { markSeen() }, [])
  return (
    <Page title="What's new" help={PAGE.whatsNew} sub="Every update to the ERP, newest first, in plain words.">
      <Card>{RELEASES.map((r, i) => <Release key={r.version} r={r} first={i === 0} />)}</Card>
    </Page>
  )
}

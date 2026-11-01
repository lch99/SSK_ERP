import { useState } from 'react'
import * as M from '../../../shared/maintenance.js'
import { C, btn, btnPrimary } from '../../styles.js'
import { useErp } from '../ErpContext.jsx'
import { useCan } from '../access.jsx'
import { useFeedback } from '../feedback.jsx'
import { Page, Card, FormField, TextArea, Notice, DataTable, Status, Stat, cols, small, field } from '../ui.jsx'
import { PAGE, CARD } from '../help.js'
import { RELEASES } from '../../releases.js'
import { Release, WhatsNewPopup } from '../WhatsNew.jsx'
import { useNow } from '../maintenance.jsx'
import { useViewer } from '../listingLife.jsx'

// System → Technical, for the technical team: planned downtime and the
// release history (#/technical/downtime, #/technical/releases).
export default function Technical({ parts }) {
  return parts[1] === 'releases' ? <Releases /> : <Downtime />
}

const MESSAGE = 'We are updating the ERP to a new version.'
const LENGTHS = [[30, '30 min'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours']]
const local = stamp => stamp.replace(' ', 'T')
const plusMinutes = (stamp, n) => {
  const d = new Date(`${stamp.slice(0, 10)}T${stamp.slice(11, 16)}:00`)
  d.setMinutes(d.getMinutes() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
// Tonight at 10 pm (or tomorrow's, if that has passed): the usual quiet time.
const tonight = now => { const day = now.slice(11) < '21:00' ? now.slice(0, 10) : plusMinutes(`${now.slice(0, 10)} 12:00`, 24 * 60).slice(0, 10); return `${day} 22:00` }

function Downtime() {
  const erp = useErp()
  const { m } = erp
  const can = useCan()
  const fb = useFeedback()
  const me = useViewer()
  const now = useNow()
  const manage = can('technical', 'full')
  const start0 = tonight(now)
  const [f, setF] = useState({ start: start0, end: plusMinutes(start0, 120), message: MESSAGE, closes: true })
  const [error, setError] = useState(null)
  const windows = [...(m.data.downtime || [])].sort((a, b) => b.start.localeCompare(a.start))
  const { live, upcoming } = M.downtimeAt(windows, now)
  const draft = { ...f, start: f.start.replace('T', ' '), end: f.end.replace('T', ' ') }
  const length = draft.start && draft.end && draft.end > draft.start ? M.hoursBetween(draft.start, draft.end) : null
  const plan = async () => {
    const why = M.checkWindow(draft, now, windows)
    if (why) { setError(why); return }
    setError(null)
    const ok = await fb.confirm({ title: `Plan downtime for ${M.whenText(draft)}?`, confirmLabel: 'Plan it and tell everyone',
      body: `Everyone gets a notification now, and a notice shows at the top of every page from ${M.NOTICE_DAYS} days before.${draft.closes ? ' While it runs, everyone except the technical team and the Superadmin sees a "back soon" page.' : ''}` })
    if (ok && await fb.run(() => erp.scheduleDowntime({ ...draft, by: me.key }), 'Downtime planned; everyone is told')) {
      const next = tonight(plusMinutes(now, 24 * 60))
      setF({ start: next, end: plusMinutes(next, 120), message: MESSAGE, closes: true })
    }
  }
  const cancel = async w => {
    if (await fb.confirm({ title: `Cancel the downtime on ${M.whenText(w)}?`, body: 'Everyone is told it is off.', confirmLabel: 'Cancel it', danger: true })) fb.run(() => erp.cancelDowntime(w.id), 'Cancelled; everyone is told')
  }
  return (
    <Page title="Planned downtime" help={PAGE.downtime} sub="Plan the times the ERP goes offline for updates. Everyone is told beforehand, in plain words.">
      <div style={{ ...cols(240, 14), marginBottom: 16 }}>
        <Stat label="Now" value={live ? 'Maintenance in progress' : 'Open as usual'} sub={live ? `Until ${M.whenText(live).split('–').pop().trim()}` : null} tone={live ? 'amber' : 'green'} />
        <Stat label="Next planned" value={upcoming ? M.whenText(upcoming) : 'Nothing planned'} sub={upcoming ? (upcoming.closes ? 'The ERP closes' : 'Notice only') : null} tone="blue" />
      </div>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(440px, 100%), 1fr))', alignItems: 'start' }}>
        {manage && (
          <Card title="Plan downtime" help={CARD.planDowntime}>
            {error && <Notice tone="red">{error}</Notice>}
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(200px, 100%), 1fr))' }}>
              <FormField label="Starts"><input type="datetime-local" style={field} value={local(f.start)} min={local(now)} onChange={e => setF(x => ({ ...x, start: e.target.value.replace('T', ' ') }))} /></FormField>
              <FormField label="Ends" help={length ? `${length < 1 ? `${Math.round(length * 60)} minutes` : `${Math.round(length * 10) / 10} hours`}` : null}>
                <input type="datetime-local" style={field} value={local(f.end)} min={local(f.start)} onChange={e => setF(x => ({ ...x, end: e.target.value.replace('T', ' ') }))} />
              </FormField>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
              {LENGTHS.map(([n, label]) => <button key={n} type="button" style={{ ...small, fontSize: 12.5 }} onClick={() => setF(x => ({ ...x, end: plusMinutes(x.start, n) }))}>{label}</button>)}
            </div>
            <FormField label="What people will read" required><TextArea rows={2} value={f.message} onChange={e => setF(x => ({ ...x, message: e.target.value }))} /></FormField>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, marginTop: 12 }}>
              <input type="checkbox" checked={f.closes} onChange={e => setF(x => ({ ...x, closes: e.target.checked }))} style={{ accentColor: C.primary, marginTop: 3 }} />
              <span>Close the ERP while it runs<span style={{ display: 'block', fontSize: 12.5, color: C.muted }}>People see a "back soon" page. Untick for work that only slows things down.</span></span>
            </label>
            <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: C.warnBg, border: '1px solid #f5dca6', fontSize: 13.5 }}>
              <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: C.warn, marginBottom: 2 }}>WHAT EVERYONE SEES</span>
              <b>Planned maintenance: {draft.start && draft.end > draft.start ? M.whenText(draft) : '…'}.</b> {f.closes ? 'The ERP will be offline then; please finish and save your work before it starts.' : ''} {f.message}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}><button style={btnPrimary} onClick={plan}>Plan downtime</button></div>
          </Card>
        )}
        <Card title="All downtime" pad={16}>
          <DataTable rows={windows} narrowAt={560} empty="Nothing planned yet" columns={[
            { key: 'when', label: 'When', render: w => <span style={{ fontSize: 13 }}><b>{M.whenText(w)}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{w.closes ? 'ERP closed' : 'Notice only'} · planned {w.created.slice(0, 10)}</span></span> },
            { key: 'msg', label: 'Message', render: w => <span style={{ fontSize: 13 }}>{w.message}</span> },
            { key: 'status', label: 'Status', render: w => <Status of={M.DOWNTIME_STATUS} value={M.statusOf(w, now)} /> },
            { key: 'act', label: '', card: false, render: w => manage && (
              M.statusOf(w, now) === 'scheduled' ? <button style={{ ...btn, fontSize: 12.5, padding: '4px 10px', color: C.err }} onClick={() => cancel(w)}>Cancel</button>
                : M.statusOf(w, now) === 'live' ? <button style={{ ...btn, fontSize: 12.5, padding: '4px 10px' }} onClick={() => fb.run(() => erp.endDowntime(w.id), 'Maintenance ended; everyone is told')}>End now</button> : null) },
          ]} />
        </Card>
      </div>
    </Page>
  )
}

function Releases() {
  const [preview, setPreview] = useState(false)
  return (
    <Page title="Releases" help={PAGE.releases} sub="Every version of the ERP and what it told people. A new version's notes pop up once for everyone after the update."
      actions={<button style={btn} onClick={() => setPreview(true)}>Preview the pop-up</button>}>
      <Card>{RELEASES.map((r, i) => <Release key={r.version} r={r} first={i === 0} all />)}</Card>
      {preview && <WhatsNewPopup preview onClose={() => setPreview(false)} />}
    </Page>
  )
}

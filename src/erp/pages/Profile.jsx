import { useEffect, useRef, useState } from 'react'
import { C, btn, btnPrimary } from '../../styles.js'
import { roleMeta, PASSWORD_MIN } from '../../../shared/roles.js'
import { PROFILE_FIELDS, checkProfile } from '../../../shared/profile.js'
import { DEMO, PROFILE_EVENT, getMyProfile, saveMyProfile, changeMyPassword } from '../../api.js'
import { useErp } from '../ErpContext.jsx'
import { useFeedback } from '../feedback.jsx'
import { Page, Card, Modal, Notice, FormField, FileInput, Select, Avatar, TextArea, small, field } from '../ui.jsx'
import { PAGE, CARD } from '../help.js'
import { date } from '../format.js'
import Icon from '../Icon.jsx'
import { OrgTree } from './OrgChart.jsx'
import { BANKS } from './options.js'

// The signed-in person's profile; updates the moment it is saved anywhere.
export function useProfile() {
  const [p, setP] = useState(null)
  useEffect(() => {
    let live = true
    const read = () => getMyProfile().then(x => { if (live) setP(x) }, () => { if (live) setP({}) })
    read()
    window.addEventListener(PROFILE_EVENT, read)
    return () => { live = false; window.removeEventListener(PROFILE_EVENT, read) }
  }, [])
  return p
}

// A picked photo, cut to a centred square and shrunk, so it stays small.
async function squarePhoto(file, size = 256) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((ok, bad) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => bad(new Error('That photo could not be read. Try another JPG or PNG.'))
      i.src = url
    })
    const s = Math.min(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    canvas.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

const grid = { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', alignItems: 'start' }
const problem = text => <span style={{ color: C.err }}>{text}</span>

// ── My profile (avatar menu → My profile): your details, photo and password ──
export default function Profile({ me }) {
  const profile = useProfile()
  return (
    <Page title="My profile" help={PAGE.settings} sub="How you show in the ERP, where your pay goes, and your password.">
      <div style={grid}>
        {profile
          // A fresh form after each save, so "unsaved changes" starts again from what was kept.
          ? <Details key={profile.updatedAt || 'new'} me={me} saved={profile} />
          : <div className="ssk-skeleton" style={{ height: 460, borderRadius: 12 }} />}
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          <Card title="Password" help={CARD.password}>{profile && <PasswordForm profile={profile} />}</Card>
          <Card title="Your org chart" help={CARD.myTeam}><OrgTree /></Card>
        </div>
      </div>
    </Page>
  )
}

function Details({ me, saved }) {
  const { setup } = useErp()
  const fb = useFeedback()
  const [d, setD] = useState(saved)
  const [shown, setShown] = useState({})   // fields whose problems show: left once, or all after trying to save
  const [busy, setBusy] = useState(false)
  const [photoKey, setPhotoKey] = useState(0)
  const errors = checkProfile(d)
  const changed = PROFILE_FIELDS.some(k => (d[k] || '') !== (saved[k] || ''))
  const set = k => e => setD(x => ({ ...x, [k]: e.target.value }))
  const left = k => () => setShown(s => ({ ...s, [k]: true }))
  const bad = k => shown[k] && errors[k]

  const pickPhoto = async files => {
    if (!files.length) return setD(x => ({ ...x, photo: saved.photo }))
    try {
      const photo = await squarePhoto(files[0])
      setD(x => ({ ...x, photo }))
    } catch (e) { fb.error(e) }
  }
  const removePhoto = () => { setD(x => ({ ...x, photo: '' })); setPhotoKey(k => k + 1) }
  const undo = () => { setD(saved); setShown({}); setPhotoKey(k => k + 1) }

  const save = async e => {
    e.preventDefault()
    if (Object.keys(errors).length) {
      setShown(Object.fromEntries(Object.keys(errors).map(k => [k, true])))
      return fb.toast('Some details need fixing first. They are marked in red.', { tone: 'red' })
    }
    setBusy(true)
    const ok = await fb.run(() => saveMyProfile(d), 'Profile saved')
    if (!ok) setBusy(false)
  }

  const input = (k, label, { required, help, ...attrs } = {}) => (
    <FormField label={label} required={required} help={bad(k) ? problem(errors[k]) : help}>
      <input value={d[k]} onChange={set(k)} onBlur={left(k)} aria-invalid={!!bad(k)} style={{ ...field, borderColor: bad(k) ? C.err : undefined }} {...attrs} />
    </FormField>
  )
  const branch = me.branchId ? setup.branches.find(b => b.id === me.branchId)?.name : 'All branches'

  return (
    <Card title="Your details" help={CARD.myDetails}>
      <form onSubmit={save} noValidate>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 14 }}>
          <Avatar name={d.name || me.name} photo={d.photo} size={64} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 17, overflowWrap: 'anywhere' }}>{d.name || 'No name yet'}</div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
              {DEMO ? 'demo' : me.username} · <span style={{ color: C.primaryDark, fontWeight: 600 }}>{roleMeta(me.role).label}</span>{branch && ` · ${branch}`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}><FileInput key={photoKey} kind="avatar" onChange={pickPhoto} placeholder="Choose a photo" /></div>
          {d.photo && <button type="button" style={small} onClick={removePhoto}>Remove photo</button>}
        </div>
        <div style={{ fontSize: 12, color: errors.photo ? C.err : C.muted, marginBottom: 16 }}>
          {errors.photo || 'Cut to a square and shown wherever your name appears. Without one you get a drawn face.'}
        </div>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(210px, 100%), 1fr))' }}>
          {input('name', 'Display name', { required: true, autoComplete: 'name', help: 'Shown in the top bar and on your records.' })}
          {input('icName', 'Name as in IC', { help: 'Printed on payslips and pay vouchers.' })}
          {input('email', 'E-mail', { type: 'email', autoComplete: 'email', inputMode: 'email' })}
          {input('phone', 'Phone', { type: 'tel', autoComplete: 'tel', inputMode: 'tel', placeholder: '012-345 6789' })}
          <FormField label="House address" wide help={bad('address') && problem(errors.address)}>
            <TextArea value={d.address} onChange={set('address')} onBlur={left('address')} autoComplete="street-address" />
          </FormField>
          <FormField label="Bank" help={bad('bank') ? problem(errors.bank) : null}>
            <Select plain block label="Bank" value={d.bank} onChange={v => { setD(x => ({ ...x, bank: v })); left('bank')() }}
              options={[{ value: '', label: 'Pick a bank' }, ...BANKS.map(b => ({ value: b, label: b }))]} />
          </FormField>
          {input('bankAccount', 'Bank account no.', { inputMode: 'numeric', autoComplete: 'off', help: 'Commission and salary are paid here.' })}
          {input('bankHolder', 'Account holder name', { required: !!d.bankAccount.trim(), autoComplete: 'off', placeholder: d.icName || undefined, help: 'Exactly as the bank has it, or the payment bounces.' })}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 18 }}>
          <button type="submit" style={btnPrimary} disabled={!changed || busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          {changed && !busy && <button type="button" style={btn} onClick={undo}>Undo changes</button>}
          <span style={{ fontSize: 12.5, color: C.muted }}>
            {changed ? 'You have unsaved changes.' : saved.updatedAt ? `Last saved ${date(saved.updatedAt.slice(0, 10))}.` : ''}
          </span>
        </div>
      </form>
    </Card>
  )
}

// Change (or, in the demo, first set) your password. Used on the page and in
// the dialog opened from the avatar menu.
export function PasswordForm({ profile, onDone, onCancel, autoFocus }) {
  const fb = useFeedback()
  const needCurrent = !DEMO || !!profile?.hasPassword
  const empty = { current: '', password: '', confirm: '' }
  const [f, setF] = useState(empty)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const first = useRef(null)
  useEffect(() => { if (autoFocus) first.current?.focus() }, [autoFocus])
  const set = k => e => { setF(x => ({ ...x, [k]: e.target.value })); setError('') }
  const long = f.password.length >= PASSWORD_MIN
  // A password you can see needs no second copy to catch typos.
  const same = show || (!!f.password && f.password === f.confirm)
  const ready = (!needCurrent || !!f.current) && long && same

  const submit = async e => {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    try {
      await changeMyPassword(f.current, f.password)
      setF(empty)
      fb.toast(!needCurrent ? 'Password set' : DEMO ? 'Password changed' : 'Password changed. Other devices were signed out.')
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const box = (k, label, auto, ref) => (
    <FormField label={label}>
      <input ref={ref} type={show ? 'text' : 'password'} value={f[k]} onChange={set(k)} autoComplete={auto} style={field} />
    </FormField>
  )
  const check = (ok, text) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: ok ? C.ok : C.muted }}>
      <Icon name="check" size={14} style={{ opacity: ok ? 1 : 0.35 }} />{text}
    </span>
  )
  return (
    <form onSubmit={submit}>
      {!needCurrent && <Notice tone="blue">Sign-in is off in the demo, so there is no password yet. Set one here to try it out: it is kept in this browser only.</Notice>}
      <div style={{ display: 'grid', gap: 12 }}>
        {needCurrent && box('current', 'Current password', 'current-password', first)}
        {box('password', 'New password', 'new-password', needCurrent ? null : first)}
        {!show && box('confirm', 'New password again', 'new-password')}
      </div>
      <div style={{ display: 'flex', gap: '6px 16px', flexWrap: 'wrap', fontSize: 12.5, margin: '10px 0 0' }}>
        {check(long, `At least ${PASSWORD_MIN} characters`)}
        {!show && check(same, 'Both new passwords match')}
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: C.muted, marginTop: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={show} onChange={e => { setShow(e.target.checked); setF(x => ({ ...x, confirm: '' })) }} /> {needCurrent ? 'Show passwords' : 'Show password'}
      </label>
      {error && <div style={{ marginTop: 12 }}><Notice tone="red">{error}</Notice></div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
        <button type="submit" style={btnPrimary} disabled={!ready || busy}>{busy ? 'Saving…' : needCurrent ? 'Change password' : 'Set password'}</button>
        {onCancel && <button type="button" style={btn} onClick={onCancel}>Cancel</button>}
        {profile?.passwordChangedAt && <span style={{ fontSize: 12.5, color: C.muted }}>Last changed {date(profile.passwordChangedAt.slice(0, 10))}.</span>}
      </div>
    </form>
  )
}

// The same form in a dialog, straight from the avatar menu.
export function ChangePasswordModal({ open, onClose, profile }) {
  const setting = DEMO && profile && !profile.hasPassword
  return (
    <Modal open={open} onClose={onClose} title={setting ? 'Set a password' : 'Change password'} width={440}>
      {profile && <PasswordForm profile={profile} onDone={onClose} onCancel={onClose} autoFocus />}
    </Modal>
  )
}

import { useState } from 'react'
import * as P from '../../shared/payout.js'
import { C, inp, btn, th, td, label } from '../styles.js'
import { NumberAnatomy } from './visuals.jsx'

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }

// ── Case and voucher numbering (part of the Approvals step) ──────────────────
// The defaults work for most agencies, so this starts folded up as one line.

export function NumberingFields({ setup, d, setD, errors = [] }) {
  const enabled = P.DEAL_TYPES.filter(dt => setup.dealTypes?.[dt]?.enabled)
  const kinds = [...enabled, 'voucher']
  const sample = setup.branches[0] || { id: null, code: 'TD' }
  const num = v => (v === '' ? '' : Number(v))
  const custom = setup.branches.filter(b => d.branches?.[b.id])
  const [open, setOpen] = useState(() => errors.length > 0 || custom.length > 0)

  const setBranch = (branchId, part, kind, value) => {
    const cur = d.branches?.[branchId] || { prefixes: {}, starts: {} }
    setD({ ...d, branches: { ...d.branches, [branchId]: { ...cur, [part]: { ...cur[part], [kind]: value } } } })
  }
  const clearBranch = branchId => {
    const next = { ...d.branches }
    delete next[branchId]
    setD({ ...d, branches: next })
  }

  const anatomy = <NumberAnatomy numbering={d} branches={setup.branches} enabled={enabled} />
  if (!open) {
    return (
      <>
      {anatomy}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13.5 }}>
        <span style={{ flex: '1 1 260px', lineHeight: 1.5 }}>
          {sample.name || 'A branch'}'s first numbers: <code style={mono}>{kinds.map(k => P.formatNumber(d, k, sample)).join(' · ')}</code>
          <span style={{ color: C.muted }}>{custom.length ? ` · ${custom.length} branch${custom.length === 1 ? ' has its' : 'es have their'} own` : ' · same format for every branch'}</span>
        </span>
        <button style={{ ...btn, fontSize: 13, padding: '5px 11px' }} onClick={() => setOpen(true)}>Change numbering</button>
      </div>
      </>
    )
  }

  return (
    <>
      {anatomy}
      <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Default format</h3>
      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 520 }}>
        <thead><tr><th style={th}>Number for</th><th style={th}>Letter(s)</th><th style={th}>Example</th></tr></thead>
        <tbody>
          {enabled.map(dt => (
            <tr key={dt}>
              <td style={td}>{P.DEAL_TYPE_LABELS[dt]} case</td>
              <td style={td}><input style={{ ...inp, width: 64 }} maxLength={3} value={d.letters?.[dt] ?? ''} aria-label={`${P.DEAL_TYPE_LABELS[dt]} letter`}
                onChange={e => setD({ ...d, letters: { ...d.letters, [dt]: e.target.value.toUpperCase() } })} /></td>
              <td style={{ ...td, ...mono }}>{P.previewCaseNo(d, dt, sample.code)}</td>
            </tr>
          ))}
          <tr>
            <td style={td}>Payment voucher</td>
            <td style={td}><input style={{ ...inp, width: 64 }} maxLength={4} value={d.voucherPrefix ?? ''} aria-label="Voucher prefix"
              onChange={e => setD({ ...d, voucherPrefix: e.target.value.toUpperCase() })} /></td>
            <td style={{ ...td, ...mono }}>{P.previewVoucherNo(d, sample.code)}</td>
          </tr>
          {!enabled.length && <tr><td style={{ ...td, color: C.muted }} colSpan={3}>Turn on a deal type to number its cases.</td></tr>}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
        <label><span style={label}>Case number digits</span>
          <input style={{ ...inp, width: 80 }} type="number" min="2" max="8" value={d.caseDigits} onChange={e => setD({ ...d, caseDigits: num(e.target.value) })} /></label>
        <label><span style={label}>Voucher number digits</span>
          <input style={{ ...inp, width: 80 }} type="number" min="2" max="8" value={d.voucherDigits} onChange={e => setD({ ...d, voucherDigits: num(e.target.value) })} /></label>
      </div>

      <h3 style={{ fontSize: 14, margin: '22px 0 4px' }}>Each branch</h3>
      <p style={{ fontSize: 13, color: C.muted, margin: '0 0 10px', lineHeight: 1.45 }}>
        The first number each branch will issue. Click <b>Customise</b> to give a branch its own prefix, or to carry on from the
        numbers it already uses (e.g. if its last case was 1250, start at 1251). Each prefix counts on its own.
      </p>
      {!setup.branches.length && <p style={{ fontSize: 13, color: C.muted }}>Add branches to see their numbers.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(290px, 100%), 1fr))', gap: 10, alignItems: 'start' }}>
        {setup.branches.map(b => (
          <BranchCard key={b.id} branch={b} numbering={d} kinds={kinds}
            onEdit={(part, kind, v) => setBranch(b.id, part, kind, v)} onClear={() => clearBranch(b.id)} />
        ))}
      </div>
    </>
  )
}

function BranchCard({ branch, numbering, kinds, onEdit, onClear }) {
  const own = numbering.branches?.[branch.id]
  const custom = !!own && kinds.some(k => own.prefixes?.[k] || (own.starts?.[k] !== '' && own.starts?.[k] != null))
  const [open, setOpen] = useState(false)

  return (
    <div style={{ border: `1px solid ${custom ? C.primary : C.border}`, borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <b style={{ fontSize: 14, flex: 1, minWidth: 0 }}>{branch.name}</b>
        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
          background: custom ? C.primaryBg : C.bg, color: custom ? C.primary : C.muted }}>{custom ? 'Custom' : 'Default'}</span>
        <button style={{ ...btn, fontSize: 13, padding: '4px 10px' }} onClick={() => setOpen(!open)}>{open ? 'Done' : 'Customise'}</button>
      </div>

      {!open && (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {kinds.map(k => (
              <tr key={k}>
                <td style={{ fontSize: 13, color: C.muted, padding: '3px 0' }}>{P.NUMBER_KIND_LABELS[k]}</td>
                <td style={{ ...mono, fontSize: 13, padding: '3px 0', textAlign: 'right' }}>{P.formatNumber(numbering, k, branch)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {open && (
        <>
          {kinds.map(k => (
            <div key={k} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap', padding: '6px 0', borderTop: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 13, fontWeight: 600, flex: '1 1 100%' }}>{P.NUMBER_KIND_LABELS[k]}</span>
              <label><span style={label}>Prefix</span>
                <input style={{ ...inp, width: 90, ...mono }} maxLength={8} placeholder={P.defaultPrefix(numbering, k, branch.code)}
                  value={own?.prefixes?.[k] ?? ''} onChange={e => onEdit('prefixes', k, e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></label>
              <label><span style={label}>First no.</span>
                <input style={{ ...inp, width: 90 }} type="number" min="1" placeholder="1"
                  value={own?.starts?.[k] ?? ''} onChange={e => onEdit('starts', k, e.target.value === '' ? '' : Number(e.target.value))} /></label>
              <span style={{ ...mono, fontSize: 13, padding: '0 0 8px', marginLeft: 'auto' }}>→ {P.formatNumber(numbering, k, branch)}</span>
            </div>
          ))}
          <p style={{ fontSize: 12, color: C.muted, margin: '6px 0 0' }}>Leave a box blank to use the default.</p>
          {custom && <button style={{ ...btn, fontSize: 13, padding: '4px 10px', marginTop: 8 }} onClick={onClear}>Use default for this branch</button>}
        </>
      )}
    </div>
  )
}

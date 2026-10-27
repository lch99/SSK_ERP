import * as P from '../../shared/payout.js'
import { C, inp, btn, label } from '../styles.js'
import Section from './Section.jsx'
import { useDraft } from './useDraft.js'
import HierarchyPreview, { EXAMPLE_CHAIN } from './HierarchyPreview.jsx'
import { SplitBar } from './visuals.jsx'

// ── Uplines and split ────────────────────────────────────────────────────────

export default function UplinesSection({ setup, save, step, done }) {
  const [d, setD, dirty, reset] = useDraft({ roles: setup.roles, splits: setup.splits })
  // Renaming a level keeps the shares as typed; adding, removing or recoding one re-checks them.
  const codesOf = rs => rs.filter(r => r.code).map(r => r.code).join('+')
  const setRoles = roles => setD({ roles, splits: codesOf(roles) === codesOf(d.roles) ? d.splits : P.normalizeSplits(d.splits, roles.filter(r => r.code)) })
  const editRole = (i, k, v) => setRoles(d.roles.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const move = (i, by) => {
    const next = [...d.roles]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    setRoles(next)
  }
  const editSplit = (code, v) => setD({ ...d, splits: { ...d.splits, [code]: v } })

  const addLevel = () => setRoles([...d.roles, { code: '', name: '' }])
  const roles = d.roles.filter(r => r.code)
  // The diagram keeps showing while a level is half-typed: first use of each code only.
  const previewRoles = roles.filter((r, i) => roles.findIndex(x => x.code === r.code) === i)
  const roleErrors = P.validateRoles(d.roles)
  const codes = roleErrors.length || roles.length < 2 ? [] : roles.map(r => r.code)
  const sum = codes.reduce((s, c) => s + (Number(d.splits?.[c]) || 0), 0)
  const ok = Math.round(sum * 100) === 10000
  const errors = [...roleErrors, ...(roleErrors.length ? [] : P.validateSplits(d.splits, roles))]

  return (
    <Section id="uplines" step={step} title="Uplines and split" done={done} dirty={dirty} onReset={reset}
      hint={<>The leaders above a negotiator, from most junior to most senior (e.g. TL → UM → BM). Each level gets its own share of the <b>upline pool</b> (total payout − agent rate). When a negotiator has nobody at a level, or that person has left, that share stays with the company: the other uplines don't get more.</>}
      errors={errors} onSave={() => save('uplines', { roles: d.roles, splits: d.splits })}>
      {/* One row per level; wraps on narrow screens instead of scrolling. */}
      <div style={{ maxWidth: 620 }}>
        {d.roles.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
            <span style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
              <button style={{ ...btn, padding: '3px 7px' }} disabled={i === 0} onClick={() => move(i, -1)} title="More junior">↑</button>
              <button style={{ ...btn, padding: '3px 7px' }} disabled={i === d.roles.length - 1} onClick={() => move(i, 1)} title="More senior">↓</button>
              <span style={{ fontSize: 12, color: C.muted, marginLeft: 2, width: 44 }}>{i === d.roles.length - 1 && i > 0 ? 'senior' : i === 0 ? 'junior' : ''}</span>
            </span>
            <input style={{ ...inp, width: 72 }} maxLength={10} value={r.code} placeholder="TSM" aria-label="Code" onChange={e => editRole(i, 'code', e.target.value.toUpperCase())} />
            <input style={{ ...inp, flex: '1 1 160px' }} value={r.name} placeholder="Team Sales Manager" aria-label="Title" onChange={e => editRole(i, 'name', e.target.value)} />
            <button style={btn} onClick={() => setRoles(d.roles.filter((_, j) => j !== i))} title="Remove">✕</button>
          </div>
        ))}
        {!d.roles.length && <p style={{ color: C.muted, fontSize: 14, margin: 0 }}>No upline levels. Negotiators keep their tier rate and the rest stays with the company.</p>}
      </div>
      <button style={{ ...btn, marginTop: 10 }} disabled={d.roles.length >= 4} onClick={addLevel}>+ Add upline level</button>

      <HierarchyPreview setup={setup} roles={previewRoles} splits={d.splits} onAddLevel={d.roles.length < 4 ? addLevel : null}
        onUseExample={() => setRoles(EXAMPLE_CHAIN.map(r => ({ ...r })))} />

      {codes.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, margin: '20px 0 4px' }}>How the pool splits</h3>
          <p style={{ fontSize: 13, color: C.muted, margin: '0 0 10px' }}>Each level's share of the upline pool, adding up to 100%. A level missing from a deal leaves its share with the company.</p>
          <div style={{ border: `1px solid ${ok ? C.border : C.err}`, borderRadius: 8, padding: 12, maxWidth: 620 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <b style={{ fontSize: 14 }}>{codes.join(' + ')}</b>
              <span style={{ fontSize: 13, fontWeight: 600, color: ok ? C.ok : C.err }}>{Math.round(sum * 100) / 100}%</span>
            </div>
            <div style={{ marginBottom: 10 }}><SplitBar roles={roles} combo={codes} split={d.splits} /></div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {codes.map(c => (
                <label key={c} style={{ whiteSpace: 'nowrap' }}>
                  <span style={label}>{c}</span>
                  <input style={{ ...inp, width: 64 }} type="number" min="0" max="100" step="0.01" value={d.splits?.[c] ?? ''}
                    onChange={e => editSplit(c, e.target.value)} /> %
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </Section>
  )
}

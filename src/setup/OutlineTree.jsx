import { useState } from 'react'
import { C } from '../styles.js'

// A collapsible tree with connector lines.
// node: { key, label, meta?, tone?, open?, children? } — label/meta may be JSX.
export default function OutlineTree({ nodes }) {
  return <div role="tree">{nodes.map((n, i) => <Branch key={n.key} n={n} last={i === nodes.length - 1} root />)}</div>
}

function Branch({ n, last, root }) {
  const kids = n.children || []
  const [open, setOpen] = useState(n.open ?? true)
  return (
    <div role="treeitem" aria-expanded={kids.length ? open : undefined} style={{ position: 'relative', paddingLeft: root ? 0 : 22 }}>
      {!root && (
        <>
          <div aria-hidden style={{ position: 'absolute', left: 8, top: 0, width: 2, height: last ? 19 : '100%', background: C.border }} />
          <div aria-hidden style={{ position: 'absolute', left: 8, top: 18, width: 12, height: 2, background: C.border }} />
        </>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 0' }}>
        {kids.length > 0 ? (
          <button onClick={() => setOpen(!open)} aria-label={open ? 'Collapse' : 'Expand'}
            style={{ width: 22, height: 22, flexShrink: 0, border: `1px solid ${C.border}`, borderRadius: 5, background: '#fff', cursor: 'pointer',
              fontSize: 11, lineHeight: 1, color: C.muted, padding: 0, marginTop: 1 }}>{open ? '▾' : '▸'}</button>
        ) : <span style={{ width: 8, height: 8, borderRadius: 4, background: n.tone || C.border, flexShrink: 0, margin: '8px 7px 0' }} aria-hidden />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: kids.length ? 600 : 500, lineHeight: 1.4 }}>{n.label}</div>
          {n.meta && <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.45, marginTop: 1 }}>{n.meta}</div>}
        </div>
      </div>
      {open && kids.length > 0 && (
        <div role="group" style={{ position: 'relative', marginLeft: root ? 2 : 0 }}>
          {kids.map((c, i) => <Branch key={c.key} n={c} last={i === kids.length - 1} />)}
        </div>
      )}
    </div>
  )
}

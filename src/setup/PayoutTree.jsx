import { C } from '../styles.js'
import { AGENT_COLOR, COMPANY_COLOR, roleColor } from './colors.js'

const r2 = n => Math.round(n * 100) / 100
const fmtRM = n => `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const ROW = 46   // node height; connector lines are drawn against it

// Where one deal's commission goes, as a tree:
//   Commission → Paid out (Negotiator, Upline pool → each upline) + Company keeps.
// `out` is distribute()'s result; `roles` gives names and order.
export default function PayoutTree({ amount, out, roles, tier }) {
  const comm = Number(amount) || 0
  const node = (label, sub, pct, color, children = []) => ({ label, sub, pct, color, children })
  const uplineNodes = [...roles].reverse().filter(r => out.uplines[r.code] != null)
    .map(r => node(r.code, r.name, out.uplines[r.code], roleColor(roles, r.code)))
  const pool = r2(uplineNodes.reduce((s, n) => s + n.pct, 0))
  const paidOut = r2(out.agent + pool)
  const tree = node('Commission', 'from the deal', 100, C.primary, [
    node('Paid out', 'to the people on the deal', paidOut, '#475467', [
      node('Negotiator', tier ? tier : '', out.agent, AGENT_COLOR),
      ...(uplineNodes.length ? [node('Upline pool', 'shared by the uplines', pool, '#7a4fc9', uplineNodes)] : []),
    ]),
    node('Company keeps', '', out.company, COMPANY_COLOR),
  ])
  return <div role="tree" aria-label="Where the commission goes"><Node n={tree} comm={comm} /></div>
}

function Node({ n, comm }) {
  return (
    <div role="treeitem" aria-expanded={n.children.length ? true : undefined}>
      <NodeRow n={n} comm={comm} />
      {n.children.length > 0 && (
        <div role="group">
          {n.children.map((c, i) => (
            <div key={c.label} style={{ position: 'relative', paddingLeft: 26 }}>
              {/* vertical line down from the parent; stops at the last child */}
              <div aria-hidden style={{ position: 'absolute', left: 11, top: 0, width: 2, background: C.border,
                height: i === n.children.length - 1 ? ROW / 2 + 4 : '100%' }} />
              {/* tick across to this child */}
              <div aria-hidden style={{ position: 'absolute', left: 11, top: ROW / 2 + 3, width: 13, height: 2, background: C.border }} />
              <div style={{ paddingTop: 6 }}><Node n={c} comm={comm} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NodeRow({ n, comm }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: ROW, boxSizing: 'border-box', padding: '6px 10px',
      background: '#fff', border: `1px solid ${C.border}`, borderLeft: `4px solid ${n.color}`, borderRadius: 8, maxWidth: 520 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{n.label}</div>
        {n.sub && <div style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.sub}</div>}
      </div>
      <div style={{ flex: '0 1 70px', minWidth: 0, height: 6, background: C.bg, borderRadius: 3, overflow: 'hidden' }} aria-hidden>
        <div style={{ width: `${Math.max(0, Math.min(100, n.pct))}%`, height: '100%', background: n.color }} />
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 84 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: n.color === COMPANY_COLOR ? C.text : n.color }}>{r2(n.pct)}%</div>
        <div style={{ fontSize: 12, color: C.muted }}>{fmtRM(r2(comm * n.pct / 100))}</div>
      </div>
    </div>
  )
}

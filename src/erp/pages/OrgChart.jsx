import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../../styles.js'
import { useNarrow } from '../../setup/useNarrow.js'
import { useErp } from '../ErpContext.jsx'
import { Page, Card, SearchBox, Segmented, Pill, Avatar, Link, Notice, go, small, tabular } from '../ui.jsx'
import Icon from '../Icon.jsx'
import { PAGE } from '../help.js'
import { rm, num } from '../format.js'
import { buildOrg, findPeople } from '../org.js'
import { RoleTag } from './Staff.jsx'

// The org chart, built for agencies with thousands of agents: only what is
// open is drawn, a big team shows 20 at a time, a search finds anyone, and any
// leader's team opens on its own with the uplines as a trail back up.
//   #/org-chart                 every branch
//   #/org-chart/b<id>           one branch
//   #/org-chart/<id>            one person and their team
//   #/org-chart/<id>/<person>   …with `person` picked out (from a search)

const FIRST = 20        // people shown under one leader before "Show more"
const MORE = 50         // added by each "Show more"
const SMALL = 60        // a view this small opens fully
const OPEN_ALL = 300    // "Open all" is offered up to this many people

export default function OrgChart({ parts }) {
  return (
    <Page title="Org Chart" help={PAGE.orgChart} sub="Branches, leaders and the people under them. Search for anyone, or open one leader's team.">
      <Card pad={16}><OrgTree focus={parts[1] ?? null} highlight={Number(parts[2]) || null} /></Card>
    </Page>
  )
}

// focus: null (every branch), 'b<id>' (one branch) or a person's id.
export function OrgTree({ focus = null, highlight = null }) {
  const { m, scoped: d, setup } = useErp()
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const [leaders, setLeaders] = useState(false)
  const [left, setLeft] = useState(false)
  const hlRef = useRef(null)
  // Narrow boxes (phones): no photos, smaller steps in, and icon buttons.
  const [box, narrow] = useNarrow(560)

  const rank = useMemo(() => {
    const codes = setup.roles.map(r => r.code)
    return p => (p.role ? codes.indexOf(p.role) : -1)
  }, [setup.roles])
  const people = useMemo(() => d.staff.filter(s => left || s.status !== 'inactive'), [d.staff, left])
  const org = useMemo(() => buildOrg(people, { rank }), [people, rank])
  // Head counts per branch, and per upline level in each.
  const counts = useMemo(() => {
    const out = new Map()
    for (const p of people) {
      const c = out.get(p.branchId) || { total: 0, roles: {} }
      c.total++
      if (p.role) c.roles[p.role] = (c.roles[p.role] || 0) + 1
      out.set(p.branchId, c)
    }
    return out
  }, [people])

  const branchFocus = /^b\d+$/.test(String(focus)) ? Number(String(focus).slice(1)) : null
  const personFocus = focus != null && branchFocus == null ? Number(focus) || null : null
  const root = personFocus != null ? org.byId.get(personFocus) : null
  const branches = setup.branches.filter(b => (branchFocus == null || b.id === branchFocus) && org.top(b.id).length)
  const inView = root ? 1 + org.team(root.id) : branches.reduce((t, b) => t + (counts.get(b.id)?.total || 0), 0)
  const kidsOf = id => (leaders ? org.under(id).filter(k => k.role) : org.under(id))
  const topsOf = id => (leaders ? org.top(id).filter(k => k.role) : org.top(id))

  // What starts open: the first level, everything in a small view, and the
  // way down to a person picked from a search.
  const everything = () => {
    const keys = new Set(branches.map(b => `b${b.id}`))
    const stack = root ? [root] : branches.flatMap(b => topsOf(b.id))
    while (stack.length) { const p = stack.pop(); const k = kidsOf(p.id); if (k.length) { keys.add(p.id); stack.push(...k) } }
    return keys
  }
  const firstOpen = () => {
    const keys = inView <= SMALL ? everything() : new Set(root ? [root.id] : branches.map(b => `b${b.id}`))
    const h = highlight && org.byId.get(highlight)
    if (h) { keys.add(`b${(org.chain(h.id)[0] || h).branchId}`); for (const p of org.chain(h.id)) keys.add(p.id) }
    return keys
  }
  const view = `${focus}|${highlight}|${leaders}|${left}`
  const [open, setOpen] = useState(firstOpen)
  const [limits, setLimits] = useState(() => new Map())
  const shownView = useRef(view)
  useEffect(() => {
    if (shownView.current === view) return
    shownView.current = view
    setOpen(firstOpen())
    setLimits(new Map())
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps
  // Scroll to a person picked from a search once their row is drawn (a frame
  // later, after the page itself has gone back to the top).
  const scrolled = useRef(null)
  useEffect(() => {
    if (!highlight || scrolled.current === view || !hlRef.current) return
    scrolled.current = view
    requestAnimationFrame(() => hlRef.current?.scrollIntoView({ block: 'center' }))
  })

  const toggle = key => setOpen(o => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const showMore = (key, total, all) => setLimits(l => new Map(l).set(key, all ? total : Math.min(total, (l.get(key) || FIRST) + MORE)))

  // Search: up to 8 people; picking one opens their upline's team with them picked out.
  const found = useMemo(() => findPeople(people, q, org), [people, q, org])
  useEffect(() => setAt(0), [q])
  const reveal = p => { setQ(''); go(`org-chart/${org.upline(p.id) ?? `b${p.branchId}`}/${p.id}`) }
  const onSearchKey = e => {
    if (!found.hits.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt(i => Math.min(found.hits.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); reveal(found.hits[at]) }
  }
  const trail = p => [m.branchName((org.chain(p.id)[0] || p).branchId), ...org.chain(p.id).map(x => x.short)].join(' › ')

  // A long list shows its first rows; a person picked from a search further
  // down (or their leader on the way to them) is shown just after those.
  const list = (key, rows, depth) => {
    const limit = rows.length <= FIRST + 5 ? rows.length : limits.get(key) || FIRST
    const target = highlight ? rows.findIndex(p => org.within(highlight, p.id)) : -1
    const pinned = target >= limit ? rows[target] : null
    const rest = rows.length - limit - (pinned ? 1 : 0)
    return (
      <div role="group" style={depth ? { marginLeft: narrow ? 10 : 13, paddingLeft: narrow ? 6 : 12, borderLeft: `2px solid ${C.grayBg}` } : null}>
        {rows.slice(0, limit).map(p => person(p, depth))}
        {pinned && (
          <>
            <div aria-hidden style={{ padding: '0 8px 0 38px', fontSize: 12, color: C.faint, ...tabular }}>⋯ {num(target - limit)} more before {pinned.short}</div>
            {person(pinned, depth)}
          </>
        )}
        {rest > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 8px 8px 38px', fontSize: 12.5, color: C.muted }}>
            <button style={small} onClick={() => showMore(key, rows.length)}>Show {num(Math.min(MORE, rest))} more</button>
            {rows.length <= 500 && rest > MORE && <button style={{ ...small, background: 'transparent', boxShadow: 'none', borderColor: 'transparent' }} onClick={() => showMore(key, rows.length, true)}>Show all {num(rows.length)}</button>}
            <span>{num(rest)} not shown</span>
          </div>
        )}
      </div>
    )
  }

  const person = (p, depth) => {
    const kids = kidsOf(p.id)
    const isOpen = open.has(p.id)
    const t = m.tierInfo(p.id)
    const team = org.team(p.id)
    const direct = org.under(p.id).length
    const picked = p.id === highlight
    return (
      <div key={p.id} role="treeitem" aria-expanded={kids.length ? isOpen : undefined}>
        <div ref={picked ? hlRef : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 9,
          background: picked ? C.primaryBg : undefined, boxShadow: picked ? 'inset 0 0 0 1px #f7a3b8' : undefined }}>
          <Toggle has={kids.length > 0} open={isOpen} onClick={() => toggle(p.id)} label={p.short} />
          {!narrow && <Avatar name={p.name} size={28} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', lineHeight: 1.35 }}>
              <Link to={`staff/${p.id}`} style={{ color: C.text, fontWeight: 600 }}>{p.short}</Link>
              <RoleTag code={p.role} setup={setup} />
              <Pill tone="gray" dot={false}>{t.tier.name} · {t.tier.agentRate}%</Pill>
              {p.status === 'pending' && <Pill tone="amber">New joiner</Pill>}
              {p.status === 'inactive' && <Pill tone="gray">Left</Pill>}
            </div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.45, ...tabular }}>
              {[p.role && m.roleName(p.role), team ? `${num(direct)} direct · ${num(team)} in team` : null, `${rm(m.credit(p.id).year)} in ${m.year}`].filter(Boolean).join(' · ')}
            </div>
          </div>
          {team > 0 && p.id !== root?.id && (
            <button style={{ ...small, flexShrink: 0, ...(narrow && { padding: 6 }) }} onClick={() => go(`org-chart/${p.id}`)} title={`Open ${p.short}'s team on its own`}
              aria-label={`View ${p.short}'s team`}>{narrow ? <Icon name="chevron" size={15} /> : 'View team'}</button>
          )}
        </div>
        {isOpen && kids.length > 0 && list(p.id, kids, depth + 1)}
      </div>
    )
  }

  const branchRow = b => {
    const key = `b${b.id}`
    const isOpen = open.has(key)
    const c = counts.get(b.id) || { total: 0, roles: {} }
    const levels = [...setup.roles].reverse().filter(r => c.roles[r.code]).map(r => `${num(c.roles[r.code])} ${r.code}`)
    return (
      <div key={key} role="treeitem" aria-expanded={isOpen}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px' }}>
          <Toggle has open={isOpen} onClick={() => toggle(key)} label={b.name} />
          {!narrow && <span aria-hidden style={{ width: 28, height: 28, borderRadius: 8, background: C.primaryBg, color: C.primary, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="listings" size={16} /></span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>{b.name} <span style={{ color: C.muted, fontWeight: 400 }}>({b.code})</span></div>
            <div style={{ fontSize: 12, color: C.muted, ...tabular }}>{[`${num(c.total)} people`, ...levels, b.manager && `manager ${b.manager}`].filter(Boolean).join(' · ')}</div>
          </div>
          {branchFocus == null && branches.length > 1 && (
            <button style={{ ...small, flexShrink: 0, ...(narrow && { padding: 6 }) }} onClick={() => go(`org-chart/b${b.id}`)} aria-label={`View ${b.name} only`}>
              {narrow ? <Icon name="chevron" size={15} /> : 'View branch'}
            </button>
          )}
        </div>
        {isOpen && list(key, topsOf(b.id), 1)}
      </div>
    )
  }

  // The trail back up: all branches › branch › each upline › this person.
  const crumbs = root
    ? [{ label: 'All branches', to: 'org-chart' }, { label: m.branchName((org.chain(root.id)[0] || root).branchId), to: `org-chart/b${(org.chain(root.id)[0] || root).branchId}` },
      ...org.chain(root.id).map(p => ({ label: p.short, to: `org-chart/${p.id}` })), { label: root.short }]
    : branchFocus != null ? [{ label: 'All branches', to: 'org-chart' }, { label: m.branchName(branchFocus) }] : null
  const allOpen = open.size >= everything().size
  const levelsInView = root ? null : setup.roles.length > 0 && [...setup.roles].reverse()
    .map(r => [r, branches.reduce((t, b) => t + (counts.get(b.id)?.roles[r.code] || 0), 0)]).filter(([, n]) => n)

  return (
    <div ref={box}>
      {crumbs && (
        <nav aria-label="Uplines" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 4px', fontSize: 13, marginBottom: 12 }}>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {i > 0 && <Icon name="chevron" size={13} style={{ color: C.faint }} />}
              {c.to ? <Link to={c.to} style={{ color: C.muted }}>{c.label}</Link> : <b style={{ fontWeight: 650 }}>{c.label}</b>}
            </span>
          ))}
        </nav>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div onKeyDown={onSearchKey} style={{ position: 'relative', flex: '1 1 260px', minWidth: 0, maxWidth: 420, display: 'flex' }}>
          <SearchBox value={q} onChange={setQ} placeholder="Find a person: name, code or phone" />
          {q.trim() && (
            <div role="listbox" aria-label="People found" className="ssk-pop" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 30, background: '#fff',
              border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: C.shadowLg, padding: 6, maxHeight: 380, overflowY: 'auto' }}>
              {!found.hits.length && <div style={{ padding: '12px 10px', fontSize: 13, color: C.muted }}>Nobody matches “{q.trim()}”.</div>}
              {found.hits.map((p, i) => (
                <div key={p.id} role="option" aria-selected={i === at} onMouseMove={() => setAt(i)} onMouseDown={e => e.preventDefault()} onClick={() => reveal(p)}
                  style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 8px', borderRadius: 8, cursor: 'pointer', background: i === at ? C.primaryBg : undefined }}>
                  <Avatar name={p.name} size={28} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13.5, fontWeight: 600 }}>{p.short}<RoleTag code={p.role} setup={setup} /></span>
                    <span style={{ display: 'block', fontSize: 12, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{trail(p)}</span>
                  </span>
                  {org.team(p.id) > 0 && <span style={{ fontSize: 12, color: C.muted, flexShrink: 0, ...tabular }}>{num(org.team(p.id))} in team</span>}
                </div>
              ))}
              {found.more > 0 && <div style={{ padding: '6px 10px 4px', fontSize: 12, color: C.muted }}>{num(found.more)} more match. Type more of the name to narrow it down.</div>}
            </div>
          )}
        </div>
        {setup.roles.length > 0 && (
          <Segmented label="Show" value={leaders ? 'leaders' : 'all'} onChange={v => setLeaders(v === 'leaders')}
            options={[{ key: 'all', label: 'Everyone' }, { key: 'leaders', label: 'Leaders only' }]} />
        )}
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, color: C.muted, cursor: 'pointer' }}>
          <input type="checkbox" checked={left} onChange={e => setLeft(e.target.checked)} />People who left
        </label>
        <span style={{ flex: 1 }} />
        {allOpen
          ? <button style={small} onClick={() => setOpen(new Set(root ? [root.id] : branches.map(b => `b${b.id}`)))}>Close all</button>
          : <button style={small} disabled={inView > OPEN_ALL} onClick={() => setOpen(everything())}
            title={inView > OPEN_ALL ? `${num(inView)} people is too many to open at once. Open one leader's team, or search.` : undefined}>Open all</button>}
      </div>

      <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 8px', display: 'flex', gap: '4px 10px', flexWrap: 'wrap', alignItems: 'center', ...tabular }}>
        {root
          ? <span><b style={{ color: C.text }}>{num(inView - 1)}</b> people in {root.short}’s team · {num(org.under(root.id).length)} direct</span>
          : <span><b style={{ color: C.text }}>{num(inView)}</b> people in {branches.length === 1 ? branches[0].name : `${branches.length} branches`}</span>}
        {levelsInView && levelsInView.map(([r, n]) => <span key={r.code} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><RoleTag code={r.code} setup={setup} />{num(n)} {r.name}</span>)}
      </p>

      {personFocus != null && !root ? (
        <Notice tone="amber">This person is not in your view: they may have left (tick “People who left”), or be outside the branches you can see. <Link to="org-chart">Back to every branch</Link></Notice>
      ) : !inView ? (
        <p style={{ margin: '12px 0', color: C.muted, fontSize: 13.5 }}>Nobody to show yet.</p>
      ) : (
        <div role="tree" aria-label="Org chart">{root ? person(root, 0) : branches.map(branchRow)}</div>
      )}
    </div>
  )
}

function Toggle({ has, open, onClick, label }) {
  if (!has) return <span aria-hidden style={{ width: 22, flexShrink: 0 }} />
  return (
    <button onClick={onClick} aria-label={`${open ? 'Close' : 'Open'} ${label}`} aria-expanded={open}
      style={{ width: 22, height: 22, flexShrink: 0, border: `1px solid ${C.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', color: C.muted, padding: 0, display: 'grid', placeItems: 'center' }}>
      <Icon name={open ? 'down' : 'chevron'} size={13} stroke={2.2} />
    </button>
  )
}


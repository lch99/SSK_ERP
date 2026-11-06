import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../styles.js'
import { DEAL_STATUS } from './model.js'
import { go, Pill } from './ui.jsx'
import Icon from './Icon.jsx'
import { rm } from './format.js'
import { useAccess } from './access.jsx'
import { useList, useRecordReader } from './useList.js'

// The last pages and records opened, for "Recent" when the search is empty.
const RECENT_KEY = 'ssk-erp-recent'
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] } }
export function rememberVisit(path) {
  if (!path) return
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([path, ...readRecent().filter(p => p !== path)].slice(0, 8))) } catch { /* not kept */ }
}

// Quick search (⌘K / Ctrl+K, or "/"): jump to any page, E-Form, staff member
// or project by typing a few letters. Arrow keys move, Enter opens, Esc closes.
export function useCommandKey(onOpen) {
  useEffect(() => {
    const on = e => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); onOpen() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onOpen])
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export default function CommandPalette({ open, onClose, leaves, erp }) {
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const access = useAccess()
  const input = useRef(null)
  const list = useRef(null)
  useEffect(() => { if (open) { setQ(''); setAt(0); setTimeout(() => input.current?.focus(), 0) } }, [open])

  // Where a page sits: its module, and the heading it is under there.
  const groupOf = path => {
    const l = leaves.find(x => x.path === path)
    return l && [l.moduleLabel, l.section !== l.moduleLabel && l.section].filter(Boolean).join(' · ')
  }
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  // Records the server finds (the viewer's reach, whatever branch the top bar shows), only in areas their role opens.
  const idle = !open || !words.length || !erp.m
  const found = (key, params, size) => useList(key, { q, counts: '0', ...params }, { pageSize: size, branch: false, skip: idle || !access.can(key === 'staff' ? 'staff' : key) }).rows
  const deals = found('deals', { sort: '-date' }, 6)
  const staff = found('staff', { sort: 'name' }, 5)
  const projects = found('projects', {}, 4)
  // What was opened last (not this page), each record read once to name it; one gone or out of reach drops out.
  const [recent, setRecent] = useState([])
  const readRecord = useRecordReader()
  useEffect(() => {
    if (!open) return undefined
    let live = true
    const here = window.location.hash.replace(/^#\/?/, '')
    const paths = readRecent().filter(p => p !== here && access.opens(p))
    Promise.all(paths.map(p => recentItem(p, erp.m, leaves, groupOf, readRecord))).then(items => { if (live) setRecent(items.filter(Boolean).slice(0, 5)) })
    return () => { live = false }
  }, [open, erp.m]) // eslint-disable-line react-hooks/exhaustive-deps
  const results = useMemo(() => {
    if (!open) return []
    const hit = text => words.every(w => text.toLowerCase().includes(w))
    // Pages match their old menu name too ("H.R Portal", "Request Form"…), and say so.
    const pages = leaves.filter(l => !words.length || hit(`${l.label} ${groupOf(l.path) || ''} ${l.was || ''}`))
      .map(l => {
        const byOld = words.length && l.was && !hit(`${l.label} ${groupOf(l.path) || ''}`)
        return { key: `p-${l.path}`, group: 'Pages', icon: l.icon || 'chevron', title: l.label, sub: byOld ? `${groupOf(l.path) || 'Page'} · old name “${l.old || l.was}”` : groupOf(l.path), to: l.path }
      })
    const m = erp.m
    // Nothing typed: what you opened last, then the pages.
    if (!words.length) return [...recent, ...pages.filter(p => !recent.some(r => r.to === p.to)).slice(0, recent.length ? 5 : 8)]
    if (!m) return pages.slice(0, 8)
    return [...pages.slice(0, 5),
      ...deals.map(d => ({ key: `d-${d.id}`, group: 'E-Forms', icon: 'deals', title: `${d.code} · ${d.property.title}`, sub: `${m.staffName(d.agentId)} · ${m.branchName(d.branchId)}`,
        tag: DEAL_STATUS[d.status], to: `deals/${d.id}` })),
      ...staff.map(s => ({ key: `s-${s.id}`, group: 'Staff', icon: 'staff', title: s.name, sub: `${s.code || ''} · ${m.branchName(s.branchId)}`, to: `staff/${s.id}` })),
      ...projects.map(p => ({ key: `j-${p.id}`, group: 'Projects', icon: 'project', title: p.name, sub: `${p.developer} · ${p.location}`, to: `projects/${p.id}` }))]
  }, [open, q, leaves, erp, recent, deals, staff, projects]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setAt(0) }, [q])
  useEffect(() => { list.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: 'nearest' }) }, [at])
  if (!open) return null

  const pick = r => { onClose(); go(r.to) }
  const onKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt(i => Math.min(results.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && results[at]) pick(results[at])
    else if (e.key === 'Escape') onClose()
  }
  let lastGroup = null

  return (
    <div className="ssk-fade" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(16,24,40,.42)', backdropFilter: 'blur(2px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '10vh 16px 16px' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label="Quick search"
        style={{ width: '100%', maxWidth: 620, background: '#fff', borderRadius: 14, boxShadow: C.shadowLg, overflow: 'hidden', border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${C.border}` }}>
          <span style={{ color: C.muted, display: 'inline-flex' }}><Icon name="search" size={20} /></span>
          <input ref={input} className="ssk-bare" value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search pages, E-Forms, staff, projects…"
            aria-label="Search" role="combobox" aria-expanded="true" aria-controls="ssk-cmd-list" aria-activedescendant={results[at] ? `cmd-${at}` : undefined}
            style={{ flex: 1, border: 'none', outline: 'none', boxShadow: 'none', fontSize: 16, fontFamily: C.font, color: C.text, background: 'transparent', padding: 0 }} />
          <kbd style={kbd}>Esc</kbd>
        </div>
        <div ref={list} id="ssk-cmd-list" role="listbox" style={{ maxHeight: '56vh', overflowY: 'auto', padding: 6 }}>
          {!results.length && <div style={{ padding: '28px 12px', textAlign: 'center', color: C.muted, fontSize: 14 }}>Nothing matches "{q}"</div>}
          {results.map((r, i) => {
            const head = r.group !== lastGroup ? r.group : null
            lastGroup = r.group
            const on = i === at
            return (
              <div key={r.key}>
                {head && <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.06em', padding: '10px 10px 4px' }}>{head}</div>}
                <div id={`cmd-${i}`} data-i={i} role="option" aria-selected={on} onMouseEnter={() => setAt(i)} onClick={() => pick(r)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px', borderRadius: 9, cursor: 'pointer',
                    background: on ? C.primaryBg : 'transparent' }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0,
                    background: on ? '#fff' : C.grayBg, color: on ? C.primary : C.muted }}><Icon name={r.icon} size={17} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
                    {r.sub && <span style={{ display: 'block', fontSize: 12.5, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</span>}
                  </span>
                  {r.tag && <Pill tone={r.tag.tone}>{r.tag.label}</Pill>}
                  {on && <span style={{ color: C.primary, fontSize: 12, fontWeight: 600 }}>↵</span>}
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 14, padding: '9px 14px', borderTop: `1px solid ${C.border}`, background: '#fafbfc', fontSize: 12, color: C.muted, flexWrap: 'wrap' }}>
          <span><kbd style={kbd}>↑</kbd> <kbd style={kbd}>↓</kbd> to move</span>
          <span><kbd style={kbd}>↵</kbd> to open</span>
          <span><kbd style={kbd}>{isMac ? '⌘' : 'Ctrl'}</kbd> <kbd style={kbd}>K</kbd> anywhere</span>
        </div>
      </div>
    </div>
  )
}

// A remembered address as a result row, or null if the record has gone (or is not the viewer's to see).
// People come from the staff directory; other records are read one at a time (read: useRecordReader).
const RECORD_LISTS = { deals: 'deals', 'money-in': 'moneyIn', 'money-out': 'moneyOut', customers: 'customers' }
async function recentItem(path, m, leaves, groupOf, read) {
  const [page, raw] = path.split('/')
  const id = Number(raw)
  const base = { key: `r-${path}`, group: 'Recent', to: path }
  if (m && id) {
    if (page === 'staff' && m.staff[id]) return { ...base, icon: 'staff', title: m.staff[id].name, sub: `Agent/Staff · ${m.branchName(m.staff[id].branchId)}` }
    const r = RECORD_LISTS[page] ? await read(RECORD_LISTS[page], id).catch(() => null) : null
    if (r && page === 'deals') return { ...base, icon: 'deals', title: `${r.code} · ${r.property.title}`, sub: `E-Form · ${m.staffName(r.agentId)}`, tag: DEAL_STATUS[r.status] }
    if (r && page === 'money-in') return { ...base, icon: 'moneyIn', title: `${r.code} · ${rm(r.amount)}`, sub: `Transaction · ${r.payer}` }
    if (r && page === 'money-out') return { ...base, icon: 'moneyOut', title: `${r.voucherNo} · ${rm(r.amount)}`, sub: `Request Form · ${r.payee.name}` }
    if (r && page === 'customers') return { ...base, icon: 'customers', title: r.name, sub: 'Customer' }
  }
  const leaf = leaves.find(l => l.path === path)
  return leaf ? { ...base, icon: leaf.icon || 'chevron', title: leaf.label, sub: groupOf(leaf.path) || 'Page' } : null
}

export const kbd = { fontFamily: C.font, fontSize: 11, fontWeight: 600, color: C.muted, background: '#fff', border: `1px solid ${C.borderStrong}`,
  borderBottomWidth: 2, borderRadius: 5, padding: '1px 5px', lineHeight: '16px' }

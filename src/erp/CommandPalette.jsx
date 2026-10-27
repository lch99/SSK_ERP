import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../styles.js'
import { getProjects } from '../demo/projectsApi.js'
import { DEAL_STATUS } from './model.js'
import { go, Pill } from './ui.jsx'
import Icon from './Icon.jsx'
import { rm } from './format.js'
import { outOfReach, useAccess } from './access.jsx'

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
  const results = useMemo(() => {
    if (!open) return []
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const hit = text => words.every(w => text.toLowerCase().includes(w))
    // Pages match their old menu name too ("H.R Portal", "Request Form"…), and say so.
    const pages = leaves.filter(l => !words.length || hit(`${l.label} ${groupOf(l.path) || ''} ${l.was || ''}`))
      .map(l => {
        const byOld = words.length && l.was && !hit(`${l.label} ${groupOf(l.path) || ''}`)
        return { key: `p-${l.path}`, group: 'Pages', icon: l.icon || 'chevron', title: l.label, sub: byOld ? `${groupOf(l.path) || 'Page'} · old name “${l.old || l.was}”` : groupOf(l.path), to: l.path }
      })
    const m = erp.m
    if (!words.length) {
      // What you opened last (not the page you are on), then the pages.
      const here = window.location.hash.replace(/^#\/?/, '')
      const recent = readRecent().filter(p => p !== here && access.opens(p) && !outOfReach(p.split('/'), erp, access.scope))
        .map(p => recentItem(p, m, leaves, groupOf)).filter(Boolean).slice(0, 5)
      return [...recent, ...pages.filter(p => !recent.some(r => r.to === p.to)).slice(0, recent.length ? 5 : 8)]
    }
    if (!m) return pages.slice(0, 8)
    // Records only from the viewer's reach, and only in areas their role opens.
    const reach = access.scope === 'all' ? m.data : erp.scoped
    const deals = (access.can('deals') ? reach.deals : []).filter(d => hit(`${d.code} ${d.property.title} ${d.property.address} ${d.buyer?.name || ''} ${m.staffName(d.agentId)}`)).slice(0, 6)
      .map(d => ({ key: `d-${d.id}`, group: 'E-Forms', icon: 'deals', title: `${d.code} · ${d.property.title}`, sub: `${m.staffName(d.agentId)} · ${m.branchName(d.branchId)}`,
        tag: DEAL_STATUS[d.status], to: `deals/${d.id}` }))
    const staff = (access.can('staff') ? reach.staff : []).filter(s => hit(`${s.name} ${s.short || ''} ${s.code || ''}`)).slice(0, 5)
      .map(s => ({ key: `s-${s.id}`, group: 'Staff', icon: 'staff', title: s.name, sub: `${s.code || ''} · ${m.branchName(s.branchId)}`, to: `staff/${s.id}` }))
    const projects = (access.can('projects') ? getProjects(m.data, erp.setup).projects : []).filter(p => hit(`${p.name} ${p.developer} ${p.location}`)).slice(0, 4)
      .map(p => ({ key: `j-${p.id}`, group: 'Projects', icon: 'project', title: p.name, sub: `${p.developer} · ${p.location}`, to: `projects/${p.id}` }))
    return [...pages.slice(0, 5), ...deals, ...staff, ...projects]
  }, [open, q, leaves, erp, access]) // eslint-disable-line react-hooks/exhaustive-deps

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

// A remembered address as a result row, or null if the record has gone.
function recentItem(path, m, leaves, groupOf) {
  const [page, raw] = path.split('/')
  const id = Number(raw)
  const base = { key: `r-${path}`, group: 'Recent', to: path }
  if (m && id) {
    if (page === 'deals' && m.deals[id]) {
      const d = m.deals[id]
      return { ...base, icon: 'deals', title: `${d.code} · ${d.property.title}`, sub: `E-Form · ${m.staffName(d.agentId)}`, tag: DEAL_STATUS[d.status] }
    }
    if (page === 'staff' && m.staff[id]) return { ...base, icon: 'staff', title: m.staff[id].name, sub: `Agent/Staff · ${m.branchName(m.staff[id].branchId)}` }
    if (page === 'money-in') { const t = m.data.moneyIn.find(x => x.id === id); if (t) return { ...base, icon: 'moneyIn', title: `${t.code} · ${rm(t.amount)}`, sub: `Transaction · ${t.payer}` } }
    if (page === 'money-out') { const x = m.data.moneyOut.find(y => y.id === id); if (x) return { ...base, icon: 'moneyOut', title: `${x.voucherNo} · ${rm(x.amount)}`, sub: `Request Form · ${x.payee.name}` } }
    if (page === 'customers') { const c = m.data.customers.find(y => y.id === id); if (c) return { ...base, icon: 'customers', title: c.name, sub: 'Customer' } }
  }
  const leaf = leaves.find(l => l.path === path)
  return leaf ? { ...base, icon: leaf.icon || 'chevron', title: leaf.label, sub: groupOf(leaf.path) || 'Page' } : null
}

export const kbd = { fontFamily: C.font, fontSize: 11, fontWeight: 600, color: C.muted, background: '#fff', border: `1px solid ${C.borderStrong}`,
  borderBottomWidth: 2, borderRadius: 5, padding: '1px 5px', lineHeight: '16px' }

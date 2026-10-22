import { useCallback, useEffect, useRef, useState } from 'react'
import { can, roleMeta } from '../../shared/roles.js'
import { C, btn, btnPrimary } from '../styles.js'
import LogoMark from '../brand/Logo.jsx'
import { DEMO, loadSampleSetup } from '../api.js'
import SetupPage from '../setup/SetupPage.jsx'
import UsersPage from '../users/UsersPage.jsx'
import { ErrorList } from '../setup/Section.jsx'
import { ErpProvider, useErp, useRoute, useMedia } from './ErpContext.jsx'
import { readyToClose } from './model.js'
import { MENU } from './help.js'
import { FeedbackProvider, useFeedback } from './feedback.jsx'
import Icon from './Icon.jsx'
import { Avatar, Card, Modal, Select, go, small, isTyping } from './ui.jsx'
import { date } from './format.js'
import Dashboard from './pages/Dashboard.jsx'
import Customers from './pages/Customers.jsx'
import Listings from './pages/Listings.jsx'
import ListingNew from './pages/ListingNew.jsx'
import { VendorRequests, Appointments, Enquiries, Titles, Areas } from './pages/Property.jsx'
import Deals from './pages/Deals.jsx'
import Reports from './pages/Reports.jsx'
import MoneyIn from './pages/MoneyIn.jsx'
import Payouts from './pages/Payouts.jsx'
import MoneyOut from './pages/MoneyOut.jsx'
import Staff from './pages/Staff.jsx'
import Salary from './pages/Salary.jsx'
import { Commission, Invoices, Videos, SystemSettings, OrgChart } from './pages/Misc.jsx'
import Projects from './pages/Projects.jsx'
import OldRecords from './pages/OldRecords.jsx'
import Profile, { ChangePasswordModal, useProfile } from './pages/Profile.jsx'
import CommandPalette, { useCommandKey, isMac, kbd, rememberVisit } from './CommandPalette.jsx'
import Access from './pages/Access.jsx'
import { AccessProvider, NoAccess, ViewAsBar, outOfReach, useAccess } from './access.jsx'

// Pages by the first part of the address (#/<page>/…). `own` pages bring their own layout.
const PAGES = {
  dashboard: Dashboard, customers: Customers, listings: Listings, 'listing-new': ListingNew, 'listing-roles': Listings,
  'vendor-requests': VendorRequests, appointments: Appointments, enquiries: Enquiries, titles: Titles, areas: Areas,
  deals: Deals, projects: Projects, commission: Commission, reports: Reports, 'money-in': MoneyIn, payouts: Payouts, 'money-out': MoneyOut,
  staff: Staff, invoices: Invoices, salary: Salary, videos: Videos, settings: Profile, system: SystemSettings, 'org-chart': OrgChart, 'old-records': OldRecords, access: Access,
}
const OWN = { setup: SetupPage, users: UsersPage }

const todo = {
  toClose: (d, m, setup) => d.deals.filter(x => readyToClose(x, m, setup) > 0).length,
  moneyIn: d => d.moneyIn.filter(t => t.status === 'pending' || t.status === 'draft').length,
  cases: d => d.payouts.filter(p => !p.archiveId && (p.status === 'new' || p.status === 'queried')).length,
  requests: d => d.moneyOut.filter(x => x.status === 'new' || x.status === 'queried').length,
  salary: d => d.requests.filter(r => r.status === 'new').length,
  vendor: d => d.vendorRequests.filter(v => v.status === 0).length,
}

// The menu, in plain words and grouped by the kind of work. `was` is the name
// in the current ERP (erp.subsaleking.com): quick search still finds it, so
// staff who know the old menu are not lost. { section } rows are headings.
const NAV = [
  { label: 'Dashboard', icon: 'home', path: 'dashboard' },
  { section: 'Sales' },
  { label: 'Customers', was: 'Customer Database', icon: 'customers', path: 'customers' },
  { label: 'Properties', was: 'Property', icon: 'listings', items: [
    { label: 'Add a listing', was: 'Add Property List', path: 'listing-new' },
    { label: 'All listings', was: 'My Property Listing', path: 'listings' },
    { label: 'Owner requests', was: 'Vendor Requests', path: 'vendor-requests', badge: todo.vendor },
    { label: 'Viewings', was: 'Appointment', path: 'appointments' },
    { label: 'Enquiries', was: 'Check Enquiry', path: 'enquiries' },
    { label: 'Buildings & estates', was: 'Title Management', path: 'titles' },
    { label: 'Areas', was: 'Area Management', path: 'areas' },
  ] },
  { label: 'Listings by role', was: 'Listing', icon: 'map', items: [
    { label: 'Branch managers', was: 'Branch Manager', path: 'listing-roles/bm' },
    { label: 'Area managers', was: 'Area Manager', path: 'listing-roles/am' },
    { label: 'Project handlers', was: 'Project Handler', path: 'listing-roles/project' },
    { label: 'Product handlers', was: 'Product Handler', path: 'listing-roles/product' },
    { label: 'Outdated listings', was: 'Outdated Listing', path: 'listing-roles/outdated' },
    { label: 'From owner requests', was: 'Vendor Listing', path: 'listing-roles/vendor' },
  ] },
  { label: 'Deals (E-Forms)', was: 'E-Forms', icon: 'deals', items: [
    { label: 'All deals', was: 'Personal Sales', path: 'deals' },
    { label: 'Add a deal', was: 'Submit New Case / Add Sales Record / Add Rental Record', path: 'deals/new' },
    { label: 'Ready to close', path: 'deals/ready', badge: todo.toClose },
    { label: 'By branch', was: 'Branch Sales', path: 'deals/branch' },
    { label: 'By team', was: 'Team Sales', path: 'deals/team' },
  ] },
  { label: 'Projects', icon: 'project', items: [
    { label: 'All projects', path: 'projects' },
    { label: 'Developer incentives', path: 'projects/incentives' },
    { label: 'Add a project', was: 'Add Project', path: 'projects/new' },
  ] },
  { section: 'Money' },
  { label: 'Money in', was: 'Transactions', icon: 'moneyIn', items: [
    { label: 'Record a payment', was: 'Add Transaction', path: 'money-in/new' },
    { label: 'All payments in', was: 'All Transactions', path: 'money-in', badge: todo.moneyIn },
    { label: 'SST account', was: 'SST Account Transactions', path: 'money-in/sst' },
  ] },
  { label: 'Payouts', was: 'Closed Case', icon: 'payouts', items: [
    { label: 'To approve', was: 'Close Case List', path: 'payouts', badge: todo.cases },
    { label: 'Archived', was: 'Archived Case', path: 'payouts/archived' },
    { label: '2020 commission page', was: 'Commission', path: 'commission' },
  ] },
  { label: 'Payments out', was: 'Request Form', icon: 'moneyOut', path: 'money-out', badge: todo.requests },
  { label: 'Salary', was: 'Salary / Incentives', icon: 'payRuns', items: [
    { label: 'Request salary', was: 'Request Salary', path: 'salary/request' },
    { label: 'Request incentives', was: 'Request Incentives', path: 'salary/incentives' },
    { label: 'Request creator fees', was: 'Request Creator Fees', path: 'salary/creator' },
    { label: 'Pay requests', was: 'All List / S.A.P List', path: 'salary', badge: todo.salary },
  ] },
  { label: 'Invoices & receipts', was: 'Invoice & Receipt', icon: 'file', items: [
    { label: 'Tax invoices & receipts', was: 'Tax Invoice & Official Receipts', path: 'invoices/tax' },
    { label: 'Invoices', path: 'invoices' },
  ] },
  { section: 'People' },
  { label: 'Agents & staff', was: 'H.R Portal', icon: 'staff', items: [
    { label: 'All agents & staff', was: 'All Agent/Staff', path: 'staff' },
    { label: 'Add agent or staff', was: 'Add New Agent/Staff', path: 'staff/new' },
    { label: 'Org chart', was: 'View Org. Chart', path: 'org-chart' },
  ] },
  { label: 'Training videos', was: 'Video Gallery', icon: 'video', items: [
    { label: 'Trainings', path: 'videos/training' },
    { label: 'Meetings', path: 'videos/meeting' },
  ] },
  { section: 'Reports' },
  { label: 'Reports', was: 'Report', icon: 'reports', items: [
    { label: 'Agent totals', was: 'Total Report', path: 'reports/total' },
    { label: 'Staff pay summary', was: 'Staff Summary', path: 'reports/staff' },
    { label: 'Top sellers', was: 'Sales Over Agents', path: 'reports/agents' },
    { label: 'Deal activity by person', was: 'E-Forms Summary Report', path: 'reports/summary' },
    { label: 'Deal change log', was: 'E-Forms Update Tracker', path: 'reports/tracker' },
    { label: 'Payout calculator', was: 'E-Forms Case Summary', path: 'reports/cases' },
    { label: 'Landlord checks', was: 'Archived Case Landlord', path: 'reports/landlord' },
    { label: 'Old records (V1)', was: 'Show more / E-Forms (Old) / Overide Module / Downline\'s E-Forms', path: 'old-records' },
  ] },
  { section: 'System' },
  { label: 'System', icon: 'setup', items: [
    { label: 'Setup', path: 'setup', perm: 'setup.edit' },
    { label: 'Settings', was: 'System Settings / System Preference Portal', path: 'system' },
    { label: 'Roles & access', was: 'Access & Permissions / Account Type', path: 'access' },
    { label: 'Users (sign-in)', was: 'Users', path: 'users', perm: 'users.manage', needsSignIn: true },
  ] },
]

// "g" then a letter jumps to a page (shown in the shortcuts list, "?").
const JUMPS = [
  ['d', 'dashboard', 'Dashboard'], ['u', 'customers', 'Customers'], ['l', 'listings', 'All listings'],
  ['e', 'deals', 'Deals (E-Forms)'], ['p', 'projects', 'Projects'], ['m', 'money-in', 'Money in'], ['c', 'payouts', 'Payouts to approve'],
  ['o', 'money-out', 'Payments out'], ['s', 'salary', 'Pay requests'], ['a', 'staff', 'Agents & staff'], ['r', 'reports/total', 'Reports'],
]

// The menu entry for an address: the longest path it starts with.
function activePath(parts, leaves) {
  const here = parts.join('/')
  let best = null
  for (const l of leaves) if ((here === l.path || here.startsWith(`${l.path}/`)) && (!best || l.path.length > best.length)) best = l.path
  return best
}

const RAIL_KEY = 'ssk-erp-rail'
const SIDE_W = 248, RAIL_W = 72

export default function Shell(props) {
  const parts = useRoute()
  return (
    <AccessProvider me={props.me}>
      <ErpProvider reloadKey={parts[0] === 'setup' ? 'setup' : 'erp'}>
        <FeedbackProvider>
          <Layout {...props} parts={parts} />
        </FeedbackProvider>
      </ErpProvider>
    </AccessProvider>
  )
}

function Layout({ me, authDisabled, onSignOut, parts }) {
  const erp = useErp()
  const wide = useMedia('(min-width: 1080px)')
  const profile = useProfile()
  const [menuOpen, setMenuOpen] = useState(false)
  const [finder, setFinder] = useState(false)
  const [help, setHelp] = useState(false)
  const [pw, setPw] = useState(false)
  // Desktop: the menu can fold down to an icon rail, for more room on wide tables.
  const [rail, setRailState] = useState(() => { try { return localStorage.getItem(RAIL_KEY) === '1' } catch { return false } })
  const setRail = v => { setRailState(v); try { localStorage.setItem(RAIL_KEY, v ? '1' : '0') } catch { /* not kept */ } }
  const railOn = wide && rail
  useCommandKey(useCallback(() => setFinder(true), []))
  // The menu shows only what the viewer's role opens (shared/access.js).
  const access = useAccess()
  const allowed = i => (!i.perm || can(me, i.perm)) && !(authDisabled && i.needsSignIn) && access.opens(i.path)
  const visible = NAV.map(g => (g.items ? { ...g, items: g.items.filter(allowed) } : g)).filter(g => g.section || (g.items ? g.items.length : allowed(g)))
  // A heading with nothing left under it goes too.
  const nav = visible.filter((g, i) => !g.section || (visible[i + 1] && !visible[i + 1].section))
  const leaves = nav.filter(g => !g.section).flatMap(g => g.items || [g])
  // Sub-pages show their group's icon in quick search, and match the group's old name too.
  const findable = nav.filter(g => !g.section).flatMap(g => (g.items ? g.items.map(i => ({ ...i, icon: g.icon, old: i.was, was: [i.was, g.was].filter(Boolean).join(' / ') })) : [{ ...g, old: g.was }]))

  // No page in the address: Setup until it is finished, then the dashboard.
  const setupDone = erp.setup?.checklist?.every(i => i.done)
  const key = parts[0] && (PAGES[parts[0]] || OWN[parts[0]]) ? parts[0]
    : erp.setup ? (!setupDone && leaves.some(l => l.path === 'setup') ? 'setup' : 'dashboard') : null
  const Own = OWN[key], Page = PAGES[key]
  const route = parts[0] === key ? parts : [key]
  const active = activePath(route, leaves)
  // A page the role does not open, or a record outside its reach, shows why instead.
  const blocked = !!key && (!access.opens(route.join('/')) || outOfReach(route, erp, access.scope))

  // New page (or a new record page) starts at the top; drawers keep the scroll.
  const detail = ['deals', 'staff', 'reports', 'salary', 'listing-roles', 'videos', 'invoices'].includes(parts[0]) ? parts.slice(0, 3).join('/') : parts.slice(0, 2).join('/')
  const last = useRef(detail)
  useEffect(() => {
    if (last.current !== detail) window.scrollTo(0, 0)
    last.current = detail
    setMenuOpen(false)
  }, [detail])
  // Remember record pages and pages for "Recent" in quick search.
  const here = route.join('/')
  useEffect(() => { if (key && key !== 'setup') rememberVisit(here) }, [here, key])

  // Keyboard: "?" lists the shortcuts, "[" folds the menu, "g" + letter jumps.
  useEffect(() => {
    let pending = false, timer = null
    const on = e => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping() || document.querySelector('[aria-modal="true"]')) return
      if (pending) {
        pending = false
        const j = JUMPS.find(x => x[0] === e.key.toLowerCase())
        if (j) { e.preventDefault(); go(j[1]) }
        return
      }
      if (e.key === 'g') { pending = true; clearTimeout(timer); timer = setTimeout(() => { pending = false }, 1200) }
      else if (e.key === '?') { e.preventDefault(); setHelp(true) }
      else if (e.key === '[' && wide) { e.preventDefault(); setRail(!rail) }
    }
    window.addEventListener('keydown', on)
    return () => { window.removeEventListener('keydown', on); clearTimeout(timer) }
  }, [wide, rail]) // eslint-disable-line react-hooks/exhaustive-deps

  // Phones: Esc closes the menu.
  useEffect(() => {
    if (!menuOpen) return
    const on = e => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [menuOpen])

  const palette = <CommandPalette open={finder} onClose={() => setFinder(false)} leaves={findable} nav={nav} erp={erp} />
  const shortcuts = <ShortcutsSheet open={help} onClose={() => setHelp(false)} />

  // Setup is its own full page: no ERP menu or top bar until you open the ERP.
  if (key === 'setup' && !blocked) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg }}>
        <SetupHeader erp={erp} canOpen={leaves.some(l => l.path === 'dashboard')} />
        <div style={{ minWidth: 0 }}><Own me={me} /></div>
        {palette}{shortcuts}
      </div>
    )
  }

  const sideW = railOn ? RAIL_W : SIDE_W
  const sidebar = railOn
    ? <Rail nav={nav} active={active} erp={erp} />
    : <Sidebar nav={nav} active={active} erp={erp} onPick={() => setMenuOpen(false)} />
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {wide && <div style={{ width: sideW, flexShrink: 0, transition: 'width .18s ease' }}><div style={{ position: 'fixed', top: 0, bottom: 0, width: sideW, zIndex: 25, transition: 'width .18s ease' }}>{sidebar}</div></div>}
      {!wide && menuOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
          <div className="ssk-fade" onClick={() => setMenuOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(15,17,23,.45)' }} aria-hidden />
          <div className="ssk-menu-in" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 'min(290px, 86vw)' }}>
            <Sidebar nav={nav} active={active} erp={erp} onPick={() => setMenuOpen(false)} onClose={() => setMenuOpen(false)} />
          </div>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar wide={wide} me={me} profile={profile} authDisabled={authDisabled} erp={erp} onMenu={() => setMenuOpen(true)} onSignOut={onSignOut} onChangePassword={() => setPw(true)}
          onFind={() => setFinder(true)} onHelp={() => setHelp(true)} rail={railOn} onRail={() => setRail(!rail)} />
        {palette}{shortcuts}
        <ChangePasswordModal open={pw} onClose={() => setPw(false)} profile={profile} />
        {!key ? <PageSkeleton wide={wide} />
          // A plain block, so pages centred with margin: auto still fill the width.
          : Own && !blocked ? <div style={{ minWidth: 0 }}><Own me={me} /></div>
            : (
              <main style={{ padding: wide ? '22px 28px 40px' : '16px 16px 32px', width: '100%', maxWidth: railOn ? 1480 : 1320, margin: '0 auto', boxSizing: 'border-box' }}>
                <ViewAsBar m={erp.m} />
                {blocked ? <NoAccess /> : <ErpGate erp={erp} wide={wide}><Page key={access.who.role + access.who.staffId} parts={route} me={me} /></ErpGate>}
              </main>
            )}
      </div>
    </div>
  )
}

// Setup's own slim header: the brand, and the way into the ERP.
function SetupHeader({ erp, canOpen }) {
  const company = erp.setup?.company?.name
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(255,255,255,0.9)', backdropFilter: 'saturate(180%) blur(12px)',
      WebkitBackdropFilter: 'saturate(180%) blur(12px)', borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 60, padding: '0 16px', maxWidth: 1180, margin: '0 auto' }}>
        <span style={{ color: C.primary, display: 'inline-flex' }}><LogoMark size={26} /></span>
        <span style={{ minWidth: 0, lineHeight: 1.2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ fontFamily: C.fontHead, fontSize: 14.5, letterSpacing: 0.4, textTransform: 'uppercase' }}>SubSaleKing</b>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.primaryDark, background: C.primaryBg, borderRadius: 5, padding: '1px 7px', whiteSpace: 'nowrap' }}>System Setup</span>
          </span>
          {company && <span style={{ display: 'block', fontSize: 12, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '46vw' }}>{company}</span>}
        </span>
        <span style={{ flex: 1 }} />
        {canOpen && <button style={btnPrimary} onClick={() => go('dashboard')}>Open the ERP <Icon name="chevron" size={15} /></button>}
      </div>
    </header>
  )
}

function Sidebar({ nav, active, erp, onPick, onClose }) {
  const d = erp.scoped
  const fb = useFeedback()
  const groupOf = label => nav.find(g => g.items?.some(i => i.path === active))?.label === label
  const [open, setOpen] = useState(() => new Set(nav.filter(g => g.items && groupOf(g.label)).map(g => g.label)))
  // One group open at a time (as in the current ERP): the one holding the page.
  useEffect(() => {
    const g = nav.find(x => x.items?.some(i => i.path === active))
    if (g) setOpen(new Set([g.label]))
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps
  const count = item => (d && item.badge ? item.badge(d, erp.m, erp.setup) : 0)
  // Hovering a menu entry (with a mouse) says what the page is for.
  const [tip, setTip] = useState(null)
  const tipTimer = useRef(null)
  useEffect(() => () => clearTimeout(tipTimer.current), [])
  const tipOn = (e, text) => {
    if (!text || !window.matchMedia('(hover: hover)').matches) return
    const r = e.currentTarget.getBoundingClientRect()
    clearTimeout(tipTimer.current)
    tipTimer.current = setTimeout(() => setTip({ text, mid: r.top + r.height / 2, left: r.right + 10 }), 450)
  }
  const tipOff = () => { clearTimeout(tipTimer.current); setTip(null) }
  const tips = { onTip: tipOn, onTipOff: tipOff }
  const reset = async () => {
    const ok = await fb.confirm({ title: 'Reset the sample records?', body: 'Every change made in the demo (closed cases, cleared transactions, new names…) is lost, and the records are made up again from your Setup.', confirmLabel: 'Reset sample data', danger: true })
    if (ok && await fb.run(erp.reset, 'Sample records rebuilt from your Setup')) onPick?.()
  }
  return (
    <nav aria-label="Main menu" onScroll={tipOff} style={{ height: '100%', background: `linear-gradient(180deg, #191c25 0%, ${C.side} 40%, #111319 100%)`, color: C.sideText,
      display: 'flex', flexDirection: 'column', overflowY: 'auto', boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.04)' }}>
      {tip && <MenuTip tip={tip} />}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <a href="#/dashboard" onClick={onPick} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9, padding: '16px 18px 12px', textDecoration: 'none' }}>
          <span style={{ color: C.primary, display: 'inline-flex' }}><LogoMark size={28} /></span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', color: '#fff', fontWeight: 700, fontSize: 15, letterSpacing: 0.4, textTransform: 'uppercase', fontFamily: C.fontHead }}>SubSaleKing</span>
            <span style={{ display: 'block', fontSize: 11, color: C.sideHead, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 170 }}>
              {erp.setup?.company?.name || 'E.R.P'}
            </span>
          </span>
        </a>
        {onClose && (
          <button onClick={onClose} aria-label="Close menu" style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: '#fff', borderRadius: 8, padding: 7, marginRight: 12, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      <div style={{ flex: 1, padding: '0 10px 12px' }}>
        {nav.map(g => {
          if (g.section) return <div key={`s-${g.section}`} style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.9, textTransform: 'uppercase', color: C.sideHead, padding: '14px 10px 5px' }}>{g.section}</div>
          if (!g.items) return <NavRow key={g.label} icon={g.icon} label={g.label} to={g.path} on={active === g.path} count={count(g)} onPick={onPick} tip={MENU[g.path]} {...tips} />
          const isOpen = open.has(g.label)
          const total = g.items.reduce((t, i) => t + count(i), 0)
          const inside = g.items.some(i => i.path === active)
          return (
            <div key={g.label}>
              <NavRow icon={g.icon} label={g.label} on={false} within={inside} count={isOpen ? 0 : total} chevron={isOpen ? 'down' : 'chevron'} tip={MENU[g.label]} {...tips}
                onClick={() => { tipOff(); setOpen(o => (o.has(g.label) ? new Set() : new Set([g.label]))) }} />
              {isOpen && (
                <div className="ssk-fade" style={{ margin: '0 0 4px 21px', borderLeft: '1px solid rgba(255,255,255,0.08)', paddingLeft: 8 }}>
                  {g.items.map(i => <NavRow key={i.path} label={i.label} to={i.path} on={active === i.path} count={count(i)} onPick={onPick} small tip={MENU[i.path]} {...tips} />)}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {DEMO && erp.m && (
        <div style={{ margin: 12, padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.05)', fontSize: 12, lineHeight: 1.45 }}>
          <div style={{ color: '#fff', fontWeight: 700, marginBottom: 2 }}>Demo data</div>
          Made up from your Setup, as of {date(erp.m.today)}. Changes stay in this browser.
          <button onClick={reset}
            style={{ ...small, marginTop: 8, width: '100%', background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,0.2)' }}>Reset sample data</button>
        </div>
      )}
    </nav>
  )
}

// The description beside a hovered menu entry.
function MenuTip({ tip }) {
  return (
    <div role="tooltip" className="ssk-fade" style={{ position: 'fixed', left: tip.left, top: tip.mid, transform: 'translateY(-50%)', zIndex: 96, maxWidth: 260,
      background: '#fff', color: C.text, border: `1px solid ${C.border}`, borderRadius: 9, boxShadow: C.shadowLg, padding: '7px 10px', fontSize: 12.5, lineHeight: 1.45, pointerEvents: 'none' }}>
      {tip.title && <b style={{ display: 'block', marginBottom: 1 }}>{tip.title}</b>}{tip.text}
    </div>
  )
}

function NavRow({ icon, label, to, on, within, count, onClick, onPick, chevron, small: sm, tip, onTip, onTipOff }) {
  const [hover, setHover] = useState(false)
  const style = {
    display: 'flex', alignItems: 'center', gap: 11, width: '100%', boxSizing: 'border-box', padding: sm ? '6px 10px' : '8px 10px', borderRadius: 8,
    textDecoration: 'none', fontSize: sm ? 13.5 : 14, marginBottom: 1, border: 'none', cursor: 'pointer', fontFamily: C.font, textAlign: 'left',
    color: on || within ? '#fff' : hover ? '#e4e7ec' : C.sideText, fontWeight: on ? 600 : 500,
    background: on ? C.sideActive : hover ? C.sideHover : 'transparent', boxShadow: on ? `inset 3px 0 0 ${C.primary}` : 'none',
  }
  const inner = (
    <>
      {icon && <span style={{ color: on || within ? C.primary : 'inherit', display: 'inline-flex' }}><Icon name={icon} size={18} /></span>}
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {count > 0 && <span style={{ fontSize: 11, fontWeight: 700, padding: '0 7px', lineHeight: '18px', borderRadius: 9, background: C.primary, color: '#fff' }}>{count}</span>}
      {chevron && <Icon name={chevron} size={14} style={{ opacity: 0.6 }} />}
    </>
  )
  const ev = { onMouseEnter: e => { setHover(true); onTip?.(e, tip) }, onMouseLeave: () => { setHover(false); onTipOff?.() } }
  return to
    ? <a href={`#/${to}`} onClick={onPick} aria-current={on ? 'page' : undefined} style={style} {...ev}>{inner}</a>
    : <button type="button" onClick={onClick} aria-expanded={chevron === 'down'} style={style} {...ev}>{inner}</button>
}

// The folded menu: one icon per group. Hover shows the name; a group opens its
// pages beside the rail.
function Rail({ nav, active, erp }) {
  const d = erp.scoped
  const [tip, setTip] = useState(null)
  const [fly, setFly] = useState(null)
  const flyRef = useRef(null)
  // (Labels and descriptions for the folded rail come from help.js too.)
  const count = item => (d && item.badge ? item.badge(d, erp.m, erp.setup) : 0)
  useEffect(() => { setFly(null) }, [active])
  useEffect(() => {
    if (!fly) return
    const out = e => { if (!flyRef.current?.contains(e.target) && !e.target.closest?.('[data-rail]')) setFly(null) }
    const esc = e => { if (e.key === 'Escape') setFly(null) }
    document.addEventListener('mousedown', out)
    window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', out); window.removeEventListener('keydown', esc) }
  }, [fly])
  const at = (e, extra) => { const r = e.currentTarget.getBoundingClientRect(); return { top: r.top, mid: r.top + r.height / 2, ...extra } }
  const group = fly && nav.find(g => g.label === fly.label)
  return (
    <nav aria-label="Main menu" style={{ height: '100%', background: `linear-gradient(180deg, #191c25 0%, ${C.side} 40%, #111319 100%)`, color: C.sideText,
      display: 'flex', flexDirection: 'column', alignItems: 'center', overflowY: 'auto', overflowX: 'hidden', boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.04)', paddingBottom: 12 }}>
      <a href="#/dashboard" aria-label="SubSaleKing · Dashboard" style={{ color: C.primary, display: 'grid', placeItems: 'center', height: 64, flexShrink: 0 }}><LogoMark size={28} /></a>
      {nav.map(g => {
        if (g.section) return <span key={`s-${g.section}`} aria-hidden style={{ width: 28, height: 1, background: 'rgba(255,255,255,0.1)', margin: '8px 0', flexShrink: 0 }} />
        const on = g.path ? active === g.path : g.items.some(i => i.path === active)
        const n = g.items ? g.items.reduce((t, i) => t + count(i), 0) : count(g)
        const look = {
          position: 'relative', width: 44, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', marginBottom: 2, flexShrink: 0, border: 'none', cursor: 'pointer',
          color: on ? C.primary : fly?.label === g.label ? '#fff' : C.sideText, background: on ? C.sideActive : fly?.label === g.label ? C.sideHover : 'transparent',
          boxShadow: on ? `inset 3px 0 0 ${C.primary}` : 'none', textDecoration: 'none',
        }
        const badge = n > 0 && <span style={{ position: 'absolute', top: 3, right: 2, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: C.primary, color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: '16px', boxSizing: 'border-box' }}>{n}</span>
        const desc = MENU[g.path || g.label]
        const hover = { onMouseEnter: e => !fly && setTip(at(e, { label: g.label, desc })), onMouseLeave: () => setTip(null), onFocus: e => setTip(at(e, { label: g.label, desc })), onBlur: () => setTip(null) }
        return g.path
          ? <a key={g.label} href={`#/${g.path}`} aria-label={g.label} aria-current={on ? 'page' : undefined} style={look} className="ssk-rail-btn" {...hover}><Icon name={g.icon} size={19} />{badge}</a>
          : (
            <button key={g.label} type="button" data-rail aria-label={g.label} aria-expanded={fly?.label === g.label} style={look} className="ssk-rail-btn" {...hover}
              onClick={e => { setTip(null); setFly(f => (f?.label === g.label ? null : at(e, { label: g.label }))) }}>
              <Icon name={g.icon} size={19} />{badge}
            </button>
          )
      })}
      {tip && !fly && (
        <div role="tooltip" style={{ position: 'fixed', left: RAIL_W + 6, top: tip.mid, transform: 'translateY(-50%)', zIndex: 96, background: '#17191f', color: '#fff',
          fontSize: 12.5, fontWeight: 600, padding: '6px 10px', borderRadius: 7, maxWidth: 240, boxShadow: '0 6px 18px rgba(0,0,0,.25)', pointerEvents: 'none' }}>
          {tip.label}{tip.desc && <span style={{ display: 'block', fontWeight: 400, color: 'rgba(255,255,255,.72)', marginTop: 1, lineHeight: 1.4 }}>{tip.desc}</span>}
        </div>
      )}
      {group && (
        <div ref={flyRef} className="ssk-pop" style={{ position: 'fixed', left: RAIL_W + 6, top: Math.max(8, Math.min(fly.top - 6, window.innerHeight - 40 - group.items.length * 52)), zIndex: 96, minWidth: 230, maxWidth: 300,
          background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: C.shadowLg, padding: 6, color: C.text }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '.07em', padding: '6px 10px 4px' }}>{group.label}</div>
          {group.items.map(i => {
            const on = active === i.path
            return (
              <a key={i.path} href={`#/${i.path}`} className="ssk-menu-item" onClick={() => setFly(null)} aria-current={on ? 'page' : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, fontSize: 13.5, textDecoration: 'none',
                  color: on ? C.primaryDark : C.text, fontWeight: on ? 650 : 500, background: on ? C.primaryBg : undefined }}>
                <span style={{ flex: 1, minWidth: 0 }}>{i.label}{MENU[i.path] && <span style={{ display: 'block', fontSize: 11.5, color: C.muted, fontWeight: 400, lineHeight: 1.35, marginTop: 1 }}>{MENU[i.path]}</span>}</span>
                {count(i) > 0 && <span style={{ fontSize: 11, fontWeight: 700, padding: '0 7px', lineHeight: '18px', borderRadius: 9, background: C.primary, color: '#fff' }}>{count(i)}</span>}
              </a>
            )
          })}
        </div>
      )}
    </nav>
  )
}

function TopBar({ wide, me, profile, authDisabled, erp, onMenu, onSignOut, onChangePassword, onFind, onHelp, rail, onRail }) {
  const branches = erp.setup?.branches || []
  // Roles that see one branch or one team stay in their own branch: no picker.
  const access = useAccess()
  const iconBtn = { ...btn, padding: 8, boxShadow: 'none' }
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(255,255,255,0.86)', backdropFilter: 'saturate(180%) blur(12px)',
      WebkitBackdropFilter: 'saturate(180%) blur(12px)', borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 60, padding: wide ? '0 28px 0 20px' : '0 12px', flexWrap: 'wrap' }}>
        {!wide && (
          <>
            <button onClick={onMenu} aria-label="Open menu" style={iconBtn}><Icon name="menu" size={18} /></button>
            <a href="#/dashboard" aria-label="Dashboard" style={{ color: C.primary, display: 'inline-flex' }}><LogoMark size={24} /></a>
          </>
        )}
        {wide && (
          <button key="rail" onClick={onRail} aria-label={rail ? 'Expand the menu ( [ )' : 'Collapse the menu ( [ )'} title={rail ? 'Expand the menu  [' : 'Collapse the menu  ['}
            style={{ ...iconBtn, border: 'none', background: 'transparent', color: C.muted }}>
            <Icon name="sidebar" size={18} />
          </button>
        )}
        {/* Keys keep the two buttons separate, so their styles never get merged. */}
        {wide ? (
          <button key="find-wide" onClick={onFind} aria-label="Quick search"
            style={{ ...btn, justifyContent: 'flex-start', fontWeight: 500, color: C.faint, width: 'min(420px, 40vw)', background: '#f9fafb', boxShadow: 'none', borderColor: C.border, gap: 10 }}>
            <Icon name="search" size={17} />
            <span style={{ flex: 1, textAlign: 'left' }}>Search pages, E-Forms, staff…</span>
            <span style={{ display: 'inline-flex', gap: 3 }}><kbd style={kbd}>{isMac ? '⌘' : 'Ctrl'}</kbd><kbd style={kbd}>K</kbd></span>
          </button>
        ) : <button key="find-narrow" onClick={onFind} aria-label="Quick search" style={{ ...iconBtn, marginLeft: 'auto' }}><Icon name="search" size={18} /></button>}
        {/* The branch picker takes all the free space (pushed right), so the name only shortens when the bar is truly full. */}
        {erp.m && branches.length > 1 && access.scope === 'all' ? (
          <span style={{ flex: '1 1 0', display: 'flex', justifyContent: 'flex-end', minWidth: 0 }}>
            <Select label="Branch" prefix={wide} value={erp.branchId ?? ''} onChange={v => erp.setBranchId(v ? Number(v) : null)}
              options={[{ value: '', label: 'All branches' }, ...branches.map(b => ({ value: b.id, label: b.name }))]} />
          </span>
        ) : <span style={{ flex: 1 }} />}
        <UserMenu wide={wide} me={me} profile={profile} authDisabled={authDisabled} onSignOut={onSignOut} onChangePassword={onChangePassword} onHelp={onHelp} />
      </div>
    </header>
  )
}

// Avatar menu, as in the current ERP: user, server time, member type, org chart,
// settings; plus your own profile and password (pages/Profile.jsx).
function UserMenu({ wide, me, profile, authDisabled, onSignOut, onChangePassword, onHelp }) {
  const [open, setOpen] = useState(false)
  const [time, setTime] = useState(() => new Date())
  const ref = useRef(null)
  const panel = useRef(null)
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => setTime(new Date()), 1000)
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = e => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus() } }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    panel.current?.querySelector('a, button')?.focus({ preventScroll: true })
    return () => { clearInterval(t); document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc) }
  }, [open])
  const onKey = e => {
    const els = [...panel.current.querySelectorAll('a, button')]
    const i = els.indexOf(document.activeElement)
    const to = { ArrowDown: els[(i + 1) % els.length], ArrowUp: els[(i - 1 + els.length) % els.length] }[e.key]
    if (to) { e.preventDefault(); to.focus() }
  }
  const name = profile?.name || (authDisabled ? 'Demo user' : me.name)
  const photo = profile?.photo
  const role = roleMeta(me.role).label
  const item = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', fontSize: 13.5, color: C.text, textDecoration: 'none', borderRadius: 8,
    background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: C.font, fontWeight: 500 }
  const ic = n => <span style={{ color: C.muted, display: 'inline-flex' }}><Icon name={n} size={16} /></span>
  const link = (to, icon, label) => <a href={`#/${to}`} role="menuitem" className="ssk-menu-item" style={item} onClick={() => setOpen(false)}>{ic(icon)}{label}</a>
  const act = (icon, label, fn) => <button role="menuitem" className="ssk-menu-item" style={item} onClick={() => { setOpen(false); fn() }}>{ic(icon)}{label}</button>
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label="User menu"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: open ? C.grayBg : 'none', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: C.font, padding: '4px 6px' }}>
        <Avatar name={me.name} photo={photo} size={30} />
        {wide && (
          <span style={{ lineHeight: 1.2, textAlign: 'left' }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.text }}>{name}</span>
            <span style={{ display: 'block', fontSize: 11.5, color: C.muted }}>{role}</span>
          </span>
        )}
        <Icon name="down" size={14} style={{ color: C.muted, transition: 'transform .15s ease', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div ref={panel} role="menu" onKeyDown={onKey} className="ssk-pop" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 268, background: '#fff', border: `1px solid ${C.border}`,
          borderRadius: 12, boxShadow: C.shadowLg, padding: 6, zIndex: 30 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px 10px' }}>
            <Avatar name={me.name} photo={photo} size={36} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{authDisabled ? 'demo' : me.username} · <span style={{ color: C.primaryDark, fontWeight: 600 }}>{role}</span></div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, padding: '7px 10px', margin: '0 0 4px', background: '#f9fafb', borderRadius: 8 }}>
            <Icon name="clock" size={13} />Server time <b style={{ color: C.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{time.toLocaleTimeString('en-MY')}</b>
            <span style={{ flex: 1 }} />member_type: {me.role}
          </div>
          {link('settings', 'users', 'My profile')}
          {act('lock', 'Change password', onChangePassword)}
          <div role="separator" style={{ height: 1, background: C.border, margin: '5px 4px' }} />
          {link('org-chart', 'staff', 'View Org. Chart')}
          {link('system', 'setup', 'System Settings')}
          {act('keyboard', 'Keyboard shortcuts', onHelp)}
          {!authDisabled && (
            <>
              <div role="separator" style={{ height: 1, background: C.border, margin: '5px 4px' }} />
              {act('logout', 'Logout', onSignOut)}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// "?" anywhere: every shortcut on one card.
function ShortcutsSheet({ open, onClose }) {
  const k = (...keys) => <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>{keys.map(x => <kbd key={x} style={{ ...kbd, minWidth: 18, textAlign: 'center' }}>{x}</kbd>)}</span>
  const row = (keys, text) => (
    <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between', padding: '6px 0', fontSize: 13.5, borderBottom: `1px solid ${C.grayBg}` }}>
      <span>{text}</span>{keys}
    </div>
  )
  const head = t => <div style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '.07em', margin: '14px 0 4px' }}>{t}</div>
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" width={560}>
      <div style={{ display: 'grid', gap: '0 28px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(230px, 100%), 1fr))', marginTop: -14 }}>
        <div>
          {head('Anywhere')}
          {row(k(isMac ? '⌘' : 'Ctrl', 'K'), 'Quick search')}
          {row(k('/'), 'Quick search')}
          {row(k('['), 'Fold or unfold the menu')}
          {row(k('?'), 'This list')}
          {row(k('Esc'), 'Close a panel or dialog')}
          {head('Lists and panels')}
          {row(k('Tab'), 'Reach the rows')}
          {row(k('↑', '↓'), 'Move between rows')}
          {row(k('↵'), 'Open the row')}
          {row(k('J'), 'Next record in a panel')}
          {row(k('K'), 'Previous record in a panel')}
        </div>
        <div>
          {head('Go to (press G, then…)')}
          {JUMPS.map(([key, , label]) => row(k('G', key.toUpperCase()), label))}
        </div>
      </div>
    </Modal>
  )
}

// ERP pages need branches, tiers and a deal type from Setup first.
function ErpGate({ erp, wide, children }) {
  if (erp.error) return <><ErrorList errors={[erp.error]} /><button style={{ ...btn, marginTop: 12 }} onClick={erp.reload}>Try again</button></>
  if (erp.loading) return <PageSkeleton wide={wide} bare />
  if (!erp.m) {
    return (
      <div style={{ maxWidth: 560, margin: '40px auto' }}>
        <Card>
          <p style={{ fontSize: 13, fontWeight: 600, color: C.primary, margin: 0 }}>Almost there</p>
          <h1 style={{ fontSize: 22, margin: '6px 0 8px' }}>Finish Setup to open the ERP</h1>
          <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.5, margin: '0 0 12px' }}>
            E-Forms, close cases and salary follow the rules in Setup, so it needs a few things first:
          </p>
          <ul style={{ margin: '0 0 18px', paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}>{erp.blockers.map(b => <li key={b}>{b}</li>)}</ul>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button style={btnPrimary} onClick={() => go('setup')}>Go to Setup</button>
            {DEMO && <button style={btn} onClick={async () => { await loadSampleSetup(); erp.reload() }}>Use the sample setup</button>}
          </div>
        </Card>
      </div>
    )
  }
  return children
}

// Shown while the ERP records load: the shape of a page, not a blank screen.
function PageSkeleton({ wide, bare }) {
  const bar = (w, h = 14, extra) => <div className="ssk-skeleton" style={{ width: w, height: h, ...extra }} />
  return (
    <div aria-busy="true" aria-label="Loading" style={bare ? null : { padding: wide ? '26px 28px' : '16px', maxWidth: 1320, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
      {bar(220, 26)}{bar(360, 14, { marginTop: 10, maxWidth: '100%' })}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginTop: 24 }}>
        {[0, 1, 2, 3].map(i => <div key={i} className="ssk-skeleton" style={{ height: 96, borderRadius: 12 }} />)}
      </div>
      <div className="ssk-skeleton" style={{ height: 300, borderRadius: 12, marginTop: 16 }} />
    </div>
  )
}

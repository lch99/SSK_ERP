import { readyToClose } from './model.js'

// The ERP's modules: one per kind of work, each with its own pages. It stays
// one ERP (one sign-in, one set of records, one quick search); a module only
// decides which pages sit together in the menu, so each team works in its own
// space. Page addresses (#/<page>/…) don't change with the module.
//
// Items: { label, path, was?, badge?, add? } is a page (`was` is its name in the
// current ERP, which quick search still finds; `add` shows it as the module's
// "new" button). { section, was? } is a heading (its `was` counts for the pages
// under it). { note } is a line of grey text. Each path is in one module only.

const todo = {
  toClose: (d, m, setup) => d.deals.filter(x => readyToClose(x, m, setup) > 0).length,
  moneyIn: d => d.moneyIn.filter(t => t.status === 'pending' || t.status === 'draft').length,
  cases: d => d.payouts.filter(p => !p.archiveId && (p.status === 'new' || p.status === 'queried')).length,
  requests: d => d.moneyOut.filter(x => x.status === 'new' || x.status === 'queried').length,
  salary: d => d.requests.filter(r => r.status === 'new').length,
  vendor: d => d.vendorRequests.filter(v => v.status === 0).length,
}

export const MODULES = [
  { key: 'home', label: 'Home', icon: 'home', home: 'dashboard', items: [
    { label: 'Dashboard', path: 'dashboard' },
    { label: 'My profile', path: 'settings' },
  ] },
  { key: 'listings', label: 'Listings', icon: 'building', home: 'listings', items: [
    { label: 'Add a listing', was: 'Add Property List', path: 'listing-new', add: true },
    { section: 'Properties', was: 'Property' },
    { label: 'All listings', was: 'My Property Listing', path: 'listings' },
    { label: 'Owner requests', was: 'Vendor Requests', path: 'vendor-requests', badge: todo.vendor },
    { label: 'Viewings', was: 'Appointment', path: 'appointments' },
    { label: 'Enquiries', was: 'Check Enquiry', path: 'enquiries' },
    { section: 'Customers', was: 'Customer Database' },
    { label: 'All customers', path: 'customers' },
    { label: 'Add a customer', path: 'customers/new' },
    { section: 'Projects' },
    { label: 'All projects', path: 'projects' },
    { label: 'Developer incentives', path: 'projects/incentives' },
    { label: 'Add a project', was: 'Add Project', path: 'projects/new' },
    { section: 'By role', was: 'Listing' },
    { label: 'Branch managers', was: 'Branch Manager', path: 'listing-roles/bm' },
    { label: 'Area managers', was: 'Area Manager', path: 'listing-roles/am' },
    { label: 'Project handlers', was: 'Project Handler', path: 'listing-roles/project' },
    { label: 'Product handlers', was: 'Product Handler', path: 'listing-roles/product' },
    { label: 'Outdated listings', was: 'Outdated Listing', path: 'listing-roles/outdated' },
    { label: 'From owner requests', was: 'Vendor Listing', path: 'listing-roles/vendor' },
    { section: 'Lists', was: 'Property' },
    { label: 'Buildings & estates', was: 'Title Management', path: 'titles' },
    { label: 'Areas', was: 'Area Management', path: 'areas' },
  ] },
  // Agents claim their commission here: an E-Form is one sale or rental they
  // submit; once its money clears it is closed, the payouts are approved and paid.
  { key: 'commission', label: 'Commission', icon: 'wallet', home: 'deals', items: [
    { label: 'Submit an E-Form', was: 'Submit New Case / Add Sales Record / Add Rental Record / Add a deal', path: 'deals/new', add: true },
    { section: 'E-Forms', was: 'E-Forms / Deals' },
    { label: 'All E-Forms', was: 'Personal Sales / All deals', path: 'deals' },
    { label: 'Ready to close', path: 'deals/ready', badge: todo.toClose },
    { label: 'By branch', was: 'Branch Sales', path: 'deals/branch' },
    { label: 'By team', was: 'Team Sales', path: 'deals/team' },
    { section: 'Approve payouts', was: 'Closed Case' },
    { label: 'To approve', was: 'Close Case List', path: 'payouts', badge: todo.cases },
    { label: 'Archived', was: 'Archived Case', path: 'payouts/archived' },
    { section: 'Pay agents', was: 'Salary / Incentives' },
    { label: 'Request salary', was: 'Request Salary', path: 'salary/request' },
    { label: 'Request incentives', was: 'Request Incentives', path: 'salary/incentives' },
    { label: 'Request creator fees', was: 'Request Creator Fees', path: 'salary/creator' },
    { label: 'Pay requests', was: 'All List / S.A.P List', path: 'salary', badge: todo.salary },
    { section: 'Reports', was: 'Report' },
    { label: 'Agent totals', was: 'Total Report', path: 'reports/total' },
    { label: 'Top sellers', was: 'Sales Over Agents', path: 'reports/agents' },
    { label: 'E-Forms by person', was: 'E-Forms Summary Report / Deal activity by person', path: 'reports/summary' },
    { label: 'E-Form change log', was: 'E-Forms Update Tracker / Deal change log', path: 'reports/tracker' },
    { label: 'Staff pay summary', was: 'Staff Summary', path: 'reports/staff' },
    { label: 'Payout calculator', was: 'E-Forms Case Summary', path: 'reports/cases' },
    { label: 'Landlord checks', was: 'Archived Case Landlord', path: 'reports/landlord' },
    { label: '2020 commission page', was: 'Commission', path: 'commission' },
    { label: 'Old records (V1)', was: 'Show more / E-Forms (Old) / Overide Module / Downline\'s E-Forms', path: 'old-records' },
  ] },
  { key: 'accounts', label: 'Accounts', icon: 'bank', home: 'money-in', items: [
    { label: 'Record a payment', was: 'Add Transaction', path: 'money-in/new', add: true },
    { section: 'Money in', was: 'Transactions' },
    { label: 'All payments in', was: 'All Transactions', path: 'money-in', badge: todo.moneyIn },
    { label: 'SST account', was: 'SST Account Transactions', path: 'money-in/sst' },
    { section: 'Money out' },
    { label: 'Payments out', was: 'Request Form', path: 'money-out', badge: todo.requests },
    { section: 'Invoices & receipts', was: 'Invoice & Receipt' },
    { label: 'Tax invoices & receipts', was: 'Tax Invoice & Official Receipts', path: 'invoices/tax' },
    { label: 'Invoices', path: 'invoices' },
  ] },
  // Agent management: the sales force (account types Agent and Sales Agent).
  { key: 'agents', label: 'Agents', icon: 'staff', home: 'staff', items: [
    { label: 'Add an agent', was: 'Add New Agent/Staff', path: 'staff/new', add: true },
    { section: 'Agents', was: 'H.R Portal / HR / People' },
    { label: 'All agents', was: 'All Agent/Staff / Agents & staff', path: 'staff' },
    { label: 'Org chart', was: 'View Org. Chart', path: 'org-chart' },
    { section: 'Training', was: 'Video Gallery' },
    { label: 'Training videos', path: 'videos/training' },
    { label: 'Meeting recordings', path: 'videos/meeting' },
  ] },
  // System, with user management: the office staff (admins, accounting,
  // marketing), what each account type may do, and sign-in accounts.
  { key: 'system', label: 'System', icon: 'setup', home: 'system', items: [
    { label: 'Settings', was: 'System Settings / System Preference Portal', path: 'system' },
    { label: 'Setup', path: 'setup', perm: 'setup.edit' },
    { section: 'Users', was: 'H.R Portal' },
    { label: 'Office staff', was: 'All Agent/Staff / Admin / Accounting', path: 'staff/office' },
    { label: 'Add office staff', was: 'Add New Agent/Staff', path: 'staff/new/office' },
    { label: 'Roles & access', was: 'Access & Permissions / Account Type', path: 'access' },
    { label: 'Sign-in accounts', was: 'Users', path: 'users', perm: 'users.manage', needsSignIn: true },
  ] },
]

// Roles & access lists each access area under the module it belongs to
// (reports cover several modules, so they go with the system settings).
export const ACCESS_GROUPS = [
  { label: 'Listings', areas: ['listings', 'customers', 'projects'] },
  { label: 'Commission', areas: ['deals', 'payouts', 'salary'] },
  { label: 'Accounts', areas: ['moneyIn', 'moneyOut', 'invoices'] },
  { label: 'Agents & users', areas: ['staff', 'videos'] },
  { label: 'Reports & system', areas: ['reports', 'system'] },
]

export const isPage = i => !!i.path

// The modules a viewer sees: pages they may open (`allowed`), and modules
// with at least one page left. Headings with nothing under them go too.
export function visibleModules(allowed) {
  return MODULES.map(mod => {
    const items = mod.items.filter(i => !isPage(i) || allowed(i))
    const kept = items.filter((i, n) => !i.section || items.slice(n + 1).find(x => isPage(x) || x.section)?.path)
    return { ...mod, items: kept }
  }).filter(mod => mod.items.some(isPage))
}

// Every page of these modules, each with its module, its section and the old
// names it is found by in quick search.
export function modulePages(mods) {
  return mods.flatMap(mod => {
    let section = null
    return mod.items.flatMap(i => {
      if (i.section) { section = i; return [] }
      if (!isPage(i)) return []
      return [{ ...i, module: mod.key, moduleLabel: mod.label, icon: mod.icon, section: i.add ? null : section?.section,
        old: i.was, was: [i.was, !i.add && section?.was].filter(Boolean).join(' / ') }]
    })
  })
}

// Where clicking a module goes: its home page, or its first page this viewer opens.
export function moduleHome(mod) {
  const pages = mod.items.filter(isPage)
  return (pages.find(i => i.path === mod.home) || pages.find(i => !i.add) || pages[0])?.path
}

// The menu entry for an address: the longest page path it starts with.
export function activePath(parts, pages) {
  const here = parts.join('/')
  let best = null
  for (const l of pages) if ((here === l.path || here.startsWith(`${l.path}/`)) && (!best || l.path.length > best.length)) best = l.path
  return best
}

// How many things wait in a module (the badge on its icon).
export const waiting = (mod, d, m, setup) => (d ? mod.items.reduce((t, i) => t + (i.badge ? i.badge(d, m, setup) : 0), 0) : 0)

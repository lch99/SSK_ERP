import { useMemo, useState } from 'react'
import { C, btn } from '../../styles.js'
import { LISTING_SETTINGS, FOLLOW_UP_ACTIONS } from '../../demo/erpSample.js'
import { useErp } from '../ErpContext.jsx'
import { LISTING_STATUS, LISTING_CATEGORY, DEAL_STATUS, listingCategory } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, Chips, Segmented, DataTable, Status, Pill, Who, Link, Drawer, KV, Block, Empty, go, mono, small, useRecordNav } from '../ui.jsx'
import { COLUMN, PAGE } from '../help.js'
import { rm, rm0, date, num, ago, maskIc } from '../format.js'
import Icon from '../Icon.jsx'

// My Property Listing (Property menu) and the same list by role (Listing menu).
const VIEWS = [
  ['all', 'All'], ['today', 'Added Today'], ['price', 'Latest Price Updated'], ['creator', 'Creator Listing'], ['sold', 'Sold Out'],
  ['rent', 'Rent Out'], ['outdated', 'Outdated'], ['photos', 'Last Upload Photo'], ['followup', 'Last Follow-Up'],
]
const ROLES = {
  bm: 'Branch Manager', am: 'Area Manager', project: 'Project Handler', product: 'Product Handler', outdated: 'Outdated Listing', vendor: 'Vendor Listing',
}
const ROLE_TITLES = {
  bm: 'Listings by branch manager', am: 'Listings by area manager', project: 'Listings by project handler', product: 'Listings by product handler',
  outdated: 'Outdated listings', vendor: 'Listings from owner requests',
}
const SHADES = { 2: ['#fde2e8', '#f7c4d1'], 1: ['#e3edfb', '#c9dbf5'], 3: ['#efe8fb', '#ddd0f6'] }
const lastFollow = l => l.followUps[l.followUps.length - 1] || null

export default function Listings({ parts }) {
  const { m, scoped: d, setup } = useErp()
  const byRole = parts[0] === 'listing-roles'
  const role = byRole ? (ROLES[parts[1]] ? parts[1] : 'bm') : null
  const openId = Number(byRole ? parts[2] : parts[1]) || null
  const [view, setView] = useState('all')
  const [cate, setCate] = useState('')
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [mv, setMv] = useState('')
  const [flag, setFlag] = useState('')
  const [follow, setFollow] = useState('')
  const [track, setTrack] = useState('')
  const [who, setWho] = useState('')
  const [layout, setLayout] = useState('table')
  const open = openId ? m.listings[openId] : null
  const base = byRole ? `listing-roles/${role}` : 'listings'

  // Whose listings, for the Listing menu: branch manager / area manager / title's project handler / product handler.
  const ownerOf = l => ({ bm: m.branchManagerOf(l.holderId)?.id, am: m.areaManagerOf(l.holderId)?.id, project: m.titles[l.titleId]?.handlerId, product: l.holderId })[role]
  const owners = byRole && ['bm', 'am', 'project', 'product'].includes(role)
    ? [...new Set(d.listings.map(ownerOf).filter(Boolean))].map(id => m.staff[id]).sort((a, b) => a.short.localeCompare(b.short)) : []
  const fromVendor = new Set(m.data.vendorRequests.filter(v => v.listingId).map(v => v.listingId))

  const scoped = useMemo(() => d.listings.filter(l => {
    if (byRole) {
      if (role === 'outdated') return l.status === 'outdated'
      if (role === 'vendor') return fromVendor.has(l.id)
      return !who || ownerOf(l) === Number(who)
    }
    return { all: true, today: l.created === m.today, price: !!l.priceBefore, creator: true, sold: l.status === 'sold', rent: l.status === 'rented',
      outdated: l.status === 'outdated', photos: l.photos > 0, followup: l.followUps.length > 0 }[view]
  }), [d.listings, byRole, role, who, view, m]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const words = q.trim().toLowerCase()
    return scoped.filter(l => (!cate || listingCategory(l) === Number(cate)) && (!type || l.type === type) &&
      (!mv || (mv === 'complete' ? l.marketValue : !l.marketValue)) && (!flag || l.flags.includes(flag)) &&
      (follow === '' || lastFollow(l)?.action === Number(follow)) && (!track || l.status === track) &&
      (byRole || !who || l.holderId === Number(who)) &&
      (!words || [l.code, l.title, l.area, l.address, m.staff[l.holderId]?.short].join(' ').toLowerCase().includes(words)))
  }, [scoped, cate, type, mv, flag, follow, track, who, byRole, q, m])
  const sortKey = { price: 'price', followup: 'follow', creator: 'creator' }[view] || 'updated'

  const columns = [
    { key: 'updated', label: 'Listing · C.Date / U.Date', help: COLUMN.listingDates, sort: l => (view === 'photos' ? l.photosOn || '' : l.updated), render: l => (
      <span><b style={{ ...mono, color: C.primaryDark }}>{l.code}</b>
        <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{date(l.created, { short: true })} / {date(l.updated, { short: true })}</span>
        {l.photos > 0 && <span style={{ display: 'block', fontSize: 11.5, color: C.muted }}>{l.photos} photos{view === 'photos' ? ` · ${date(l.photosOn, { short: true })}` : ''}</span>}</span>
    ) },
    { key: 'title', label: 'Title · Area · Category', sort: l => l.title, render: l => (
      <span style={{ fontSize: 13 }}><b>{l.title}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{l.area} · {l.category} · {l.type === 'sale' ? 'Sale' : 'Rent'}</span></span>
    ) },
    { key: 'unit', label: 'Unit Number / Size', render: l => <span style={{ fontSize: 12.5 }}>{l.address.split(',')[0]}<span style={{ display: 'block', color: C.muted }}>{num(l.builtUp)} sq ft{l.beds ? ` · ${l.beds}R${l.baths}B` : ''}</span></span> },
    { key: 'price', label: 'Ad · Best · M. Value', help: COLUMN.listingPrice, align: 'right', sort: l => (view === 'price' ? l.priceUpdated : l.askPrice), render: l => (
      <span style={{ fontSize: 13 }}>{rm0(l.askPrice)}
        {l.priceBefore && view === 'price' && <span style={{ display: 'block', fontSize: 11.5, color: C.muted }}>was {rm0(l.priceBefore)} · {date(l.priceUpdated, { short: true })}</span>}
        <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{rm0(l.bestPrice)} · {l.marketValue ? rm0(l.marketValue) : 'no M.V.'}</span></span>
    ) },
    { key: 'creator', label: 'Product Handler · Creator', help: COLUMN.listingHolder, sort: l => m.staffName(l.creatorId), render: l => (
      <span style={{ fontSize: 13 }}>{m.staffName(l.holderId)}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{l.creatorId !== l.holderId ? `by ${m.staffName(l.creatorId)}` : 'own listing'}</span></span>
    ) },
    { key: 'owner', label: 'Owner Contact', render: l => <span style={{ fontSize: 12.5 }}>{l.owner.name}<span style={{ display: 'block', color: C.muted }}>{l.owner.phone}</span></span> },
    { key: 'follow', label: 'Settings · Follow-Up', help: COLUMN.listingFollow, sort: l => lastFollow(l)?.date || '', render: l => (
      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {l.flags.slice(0, 2).map(f => <Pill key={f} tone={f === 'Process Deal' ? 'blue' : 'gray'} dot={false} style={{ fontSize: 11 }}>{f}</Pill>)}
        {lastFollow(l) && <span style={{ fontSize: 11.5, color: C.muted, width: '100%' }}>{FOLLOW_UP_ACTIONS[lastFollow(l).action]} · {date(lastFollow(l).date, { short: true })}</span>}
      </span>
    ) },
    { key: 'status', label: 'Status', render: l => <Status of={LISTING_STATUS} value={l.status} /> },
  ]
  const cats = Object.entries(LISTING_CATEGORY).map(([k, label]) => ({ k, label, n: scoped.filter(l => listingCategory(l) === Number(k)).length })).filter(c => c.n)
  const { onOrder, nav } = useRecordNav(open?.id, id => `${base}/${id}`)
  const filters = [cate, type, mv, flag, follow, track, who].filter(x => x !== '').length
  const clear = () => { setQ(''); setCate(''); setType(''); setMv(''); setFlag(''); setFollow(''); setTrack(''); setWho('') }
  const title = byRole ? ROLE_TITLES[role] : `All listings${view === 'all' ? '' : ` · ${VIEWS.find(v => v[0] === view)[1]}`}`

  return (
    <Page title={title} help={byRole ? PAGE.listingRoles : PAGE.listings} sub={byRole ? 'Property Listings Library by who looks after them' : 'Property Listings Library. Published to the SubSaleKing site and portals.'}
      actions={<button style={btn} onClick={() => go('listing-new')}>Add a listing</button>}>
      <Card pad={16}>
        {!byRole && <Tabs value={view} onChange={setView} tabs={VIEWS.map(([key, label]) => ({ key, label }))} />}
        <div style={{ marginBottom: 12 }}>
          <Chips label="Category" value={cate} onChange={setCate} options={[{ key: '', label: 'All', count: scoped.length }, ...cats.map(c => ({ key: c.k, label: c.label, count: c.n }))]} />
        </div>
        <Toolbar fold active={filters - (cate ? 1 : 0)} onClear={clear}>
          <SearchBox value={q} onChange={setQ} placeholder="Listing ID, title, area or holder" />
          {(owners.length > 0 || !byRole) && (
            <Select label={byRole ? ROLES[role] : 'Staff'} value={who} onChange={setWho}
              options={[{ value: '', label: byRole ? `All ${ROLES[role].toLowerCase()}s` : 'Select staff profile to view' }, ...(byRole ? owners : d.staff.filter(s => s.status !== 'pending').sort((a, b) => a.short.localeCompare(b.short)))
                .map(s => ({ value: String(s.id), label: `${role === 'bm' ? 'B.M ' : ''}${s.short} (${s.code})` }))]} />
          )}
          <Select label="Listing type" value={type} onChange={setType} options={[['', 'All Listings'], ['sale', 'Sales Listing'], ['rental', 'Rental Listing']].map(([value, label]) => ({ value, label }))} />
          <Select label="Market value" value={mv} onChange={setMv} options={[['', 'All market value'], ['complete', 'Complete Market Value'], ['incomplete', 'Incomplete Market Value']].map(([value, label]) => ({ value, label }))} />
          <Select label="Settings" value={flag} onChange={setFlag} options={[{ value: '', label: '[Settings]' }, ...LISTING_SETTINGS.map(f => ({ value: f, label: f }))]} />
          <Select label="Follow-up" value={follow} onChange={setFollow} options={[{ value: '', label: '[Follow-Up]' }, ...Object.entries(FOLLOW_UP_ACTIONS).map(([value, label]) => ({ value, label }))]} />
          <Select label="Status" value={track} onChange={setTrack} options={[{ value: '', label: '[Status]' }, ...Object.entries(LISTING_STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
          <span style={{ flex: 1 }} />
          <Segmented label="Layout" value={layout} onChange={setLayout} options={[{ key: 'table', label: 'Table', icon: 'menu' }, { key: 'cards', label: 'Cards', icon: 'listings' }]} />
        </Toolbar>
        {layout === 'table'
          ? <DataTable columns={columns} rows={rows} onRow={l => go(`${base}/${l.id}`)} defaultSort={{ key: sortKey, dir: 'desc' }} pageSize={25} narrowAt={1050}
            empty={view === 'today' ? 'No listings added today' : 'No listings match'} onClear={filters || q ? clear : undefined} onOrder={onOrder} />
          : <CardGrid rows={rows} m={m} base={base} />}
      </Card>
      <Drawer open={!!open} onClose={() => go(base)} width={620} title={open?.title} sub={open ? `${open.code} · ${open.category} · ${open.area}` : ''} nav={layout === 'table' ? nav : null}>
        {open && <ListingDetails l={open} m={m} />}
      </Drawer>
    </Page>
  )
}

function CardGrid({ rows, m, base }) {
  const [limit, setLimit] = useState(24)
  if (!rows.length) return <Empty title="No listings match" />
  return (
    <>
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(250px, 100%), 1fr))' }}>
        {rows.slice(0, limit).map(l => <ListingCard key={l.id} l={l} m={m} base={base} />)}
      </div>
      {rows.length > limit && (
        <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13, color: C.muted }}>
          Showing {limit} of {rows.length} <button style={{ ...small, marginLeft: 8 }} onClick={() => setLimit(limit + 24)}>Show more</button>
        </div>
      )}
    </>
  )
}

function ListingCard({ l, m, base }) {
  const [a, b] = SHADES[listingCategory(l)] || SHADES[1]
  return (
    <button onClick={() => go(`${base}/${l.id}`)} style={{ all: 'unset', cursor: 'pointer', display: 'block', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', boxShadow: C.shadow, minWidth: 0 }}>
      <div style={{ height: 118, background: `linear-gradient(135deg, ${a}, ${b})`, position: 'relative', display: 'grid', placeItems: 'center', color: 'rgba(29,35,48,0.35)' }}>
        <Icon name="listings" size={40} stroke={1.4} />
        <span style={{ position: 'absolute', top: 8, left: 8 }}><Pill tone={l.type === 'sale' ? 'brand' : 'blue'} dot={false} style={{ background: '#fff' }}>{l.type === 'sale' ? 'For Sale' : 'For Rent'}</Pill></span>
        <span style={{ position: 'absolute', top: 8, right: 8 }}><Status of={LISTING_STATUS} value={l.status} /></span>
        {l.photos > 0 && <span style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 11, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.85)', borderRadius: 4, padding: '1px 6px' }}>{l.photos} photos</span>}
      </div>
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>{rm0(l.askPrice)}{l.type === 'rental' && <span style={{ fontSize: 12, fontWeight: 500, color: C.muted }}> /month</span>}</div>
        <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.title}</div>
        <div style={{ fontSize: 12.5, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.category} · {l.area}</div>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6 }}>{l.beds ? `${l.beds} bed · ${l.baths} bath · ` : ''}{num(l.builtUp)} sq ft</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}`, fontSize: 12.5 }}>
          <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.staffName(l.holderId)}</span>
          <span style={{ color: C.muted }}>{ago(l.updated, m.today)}</span>
        </div>
      </div>
    </button>
  )
}

export function ListingDetails({ l, m }) {
  const deal = l.dealId ? m.deals[l.dealId] : null
  const title = m.titles[l.titleId]
  return (
    <>
      <Block title="Listing" right={<Status of={LISTING_STATUS} value={l.status} />}>
        <KV min={160} items={[
          [l.type === 'sale' ? 'Ad Price' : 'Ad Price (rent)', <b>{rm(l.askPrice)}</b>], ['Best Price', rm(l.bestPrice)],
          ['Market Value', l.marketValue ? rm(l.marketValue) : 'Not set'], ['Built-up', `${num(l.builtUp)} sq ft`], l.land && ['Land', `${l.land} ft`],
          ['Rooms', l.beds ? `${l.beds} bed · ${l.baths} bath` : `${l.baths} toilets`], ['Tenure', l.tenure], ['Furnishing', l.furnishing],
          ['Category', `${LISTING_CATEGORY[listingCategory(l)]} · ${l.category}`], ['Address', `${l.address}, ${l.postcode} ${l.city}, ${l.state}`],
          ['C.Date', date(l.created)], ['U.Date', date(l.updated)],
        ]} />
        {l.flags.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>{l.flags.map(f => <Pill key={f} tone={f === 'Process Deal' ? 'blue' : 'gray'} dot={false}>{f}</Pill>)}</div>}
      </Block>
      {deal && (
        <Block title="E-Form">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Link to={`deals/${deal.id}`} style={mono}>{deal.code}</Link>
            <span style={{ flex: 1, fontSize: 13, color: C.muted }}>{date(deal.date)} · {rm(deal.price)}</span>
            <Status of={DEAL_STATUS} value={deal.status} />
          </div>
        </Block>
      )}
      <Block title="People">
        <div style={{ display: 'grid', gap: 10 }}>
          <Who name={m.staffName(l.holderId)} to={`staff/${l.holderId}`} sub="Product Handler (gets the Product side)" />
          {l.creatorId !== l.holderId && <Who name={m.staffName(l.creatorId)} to={`staff/${l.creatorId}`} sub="Listing Creator" />}
          {m.branchManagerOf(l.holderId) && <Who name={m.branchManagerOf(l.holderId).short} sub="Branch Manager" />}
          {title?.handlerId && <Who name={m.staffName(title.handlerId)} sub={`Project Handler for ${title.name}`} />}
        </div>
      </Block>
      <Block title={l.type === 'sale' ? 'Owner' : 'Landlord'}>
        <KV min={160} items={[['Name', l.owner.name], ['IC no.', l.owner.ic ? maskIc(l.owner.ic) : '—'], ['Owner Contact', l.owner.phone]]} />
      </Block>
      <Block title="Follow-up history">
        {!l.followUps.length ? <p style={{ margin: 0, color: C.muted, fontSize: 13.5 }}>Never followed up.</p> : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {[...l.followUps].reverse().map((f, i) => (
              <li key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13.5 }}>
                <span style={{ fontSize: 12, color: C.muted, width: 52, flexShrink: 0 }}>{date(f.date, { short: true })}</span>
                <span style={{ flex: 1 }}><b>{FOLLOW_UP_ACTIONS[f.action]}</b> · {f.remark}{f.appointment && <span style={{ display: 'block', fontSize: 12, color: C.info }}>Appointment {date(f.appointment.date)} {f.appointment.time}</span>}</span>
              </li>
            ))}
          </ol>
        )}
      </Block>
      <Block title="Marketing Tools">
        <KV min={130} items={[['Views', num(l.views)], ['Enquiries', num(l.enquiries)], ['Photos', num(l.photos)]]} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          {['iProperty', 'PropertyGuru', 'Mudah.my'].map(p => <Pill key={p} tone={l.portals.includes(p) ? 'green' : 'gray'}>{p}{l.portals.includes(p) ? '' : ' (off)'}</Pill>)}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button style={btn} disabled title="Demo only">View Listing on Website</button>
          <button style={btn} disabled title="Demo only">WhatsApp share</button>
        </div>
      </Block>
    </>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { C, btn } from '../../styles.js'
import { LISTING_SETTINGS, FOLLOW_UP_ACTIONS } from '../../demo/erpSample.js'
import { useErp } from '../ErpContext.jsx'
import { LISTING_STATUS, LISTING_CATEGORY, DEAL_STATUS, listingCategory } from '../model.js'
import { Page, Card, Tabs, Toolbar, SearchBox, Select, RangeFilter, Chips, Segmented, DataTable, Status, Pill, Who, Link, Drawer, KV, Block, Empty, go, mono, small, useRecordNav } from '../ui.jsx'
import { CARD, COLUMN, PAGE } from '../help.js'
import { rm, rm0, rmShort, date, num, ago, maskIc } from '../format.js'
import Icon from '../Icon.jsx'
import ListingActions, { photosOf, videosOf, mediaCount } from './ListingActions.jsx'
import { Photo, coverOf, prunePreviews } from '../photos.jsx'
import { useFeedback } from '../feedback.jsx'
import { useCan, useAccess } from '../access.jsx'
import * as L from '../../../shared/listings.js'
import { useViewer, useOwnerSight, OwnerContact, FavStar, RatingPill, HotTags, BookViewing } from '../listingLife.jsx'
import { ListingViewings } from './Viewings.jsx'

// My Property Listing (Property menu) and the same list by role (Listing menu).
const VIEWS = [
  ['all', 'All'], ['hot', 'Hot lists'], ['fav', 'My favourites'], ['today', 'Added Today'], ['price', 'Latest Price Updated'], ['creator', 'Creator Listing'], ['sold', 'Sold Out'],
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
  const viewer = useViewer()
  const sightOf = useOwnerSight()
  const access = useAccess()
  // Agents (and branch roles) also see every active listing in the agency, to
  // bring their customers to it; the owner's details stay hidden from them.
  const market = access?.scope && access.scope !== 'all'
  const [hot, setHot] = useState('')
  const [rating, setRating] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [beds, setBeds] = useState('')
  const [book, setBook] = useState(null)
  // Once a visit, stored photo previews no listing uses any more are dropped.
  useEffect(() => { if (m) prunePreviews(m.data.listings) }, [m])
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

  const favs = m.data.favourites?.[viewer.key]?.listings || []
  const source = view === 'market' ? m.data.listings.filter(l => l.status === 'active') : d.listings
  const scoped = useMemo(() => source.filter(l => {
    if (byRole) {
      if (role === 'outdated') return l.status === 'outdated'
      if (role === 'vendor') return fromVendor.has(l.id)
      return !who || ownerOf(l) === Number(who)
    }
    return { all: true, market: true, hot: L.hotLists(l).length > 0, fav: favs.includes(l.id), today: l.created === m.today, price: !!l.priceBefore, creator: true, sold: l.status === 'sold', rent: l.status === 'rented',
      outdated: l.status === 'outdated', photos: l.photos > 0, followup: l.followUps.length > 0 }[view]
  }), [source, byRole, role, who, view, m, favs]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const words = q.trim().toLowerCase()
    return scoped.filter(l => (!cate || listingCategory(l) === Number(cate)) && (!type || l.type === type) &&
      (!mv || (mv === 'complete' ? l.marketValue : !l.marketValue)) && (!flag || l.flags.includes(flag)) &&
      (follow === '' || lastFollow(l)?.action === Number(follow)) && (!track || l.status === track) &&
      (byRole || !who || l.holderId === Number(who)) && (!hot || L.hotLists(l).includes(hot)) && (!rating || L.priceRating(l)?.band === rating) &&
      (!minPrice || l.askPrice >= Number(minPrice)) && (!maxPrice || l.askPrice <= Number(maxPrice)) && (!beds || l.beds >= Number(beds)) &&
      (!words || [l.code, l.title, l.area, sightOf(l).level === 'none' ? '' : l.address, m.staff[l.holderId]?.short].join(' ').toLowerCase().includes(words)))
  }, [scoped, cate, type, mv, flag, follow, track, who, byRole, q, m, hot, rating, minPrice, maxPrice, beds]) // eslint-disable-line react-hooks/exhaustive-deps
  const sortKey = { price: 'price', followup: 'follow', creator: 'creator' }[view] || 'updated'

  const columns = [
    { key: 'updated', label: 'Listing · C.Date / U.Date', help: COLUMN.listingDates, sort: l => (view === 'photos' ? l.photosOn || '' : l.updated), render: l => (
      <span><b style={{ ...mono, color: C.primaryDark }}>{l.code}</b>
        <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{date(l.created, { short: true })} / {date(l.updated, { short: true })}</span>
        {mediaCount(l) && <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{mediaCount(l)}{view === 'photos' && l.photos > 0 ? ` · ${date(l.photosOn, { short: true })}` : ''}</span>}</span>
    ) },
    { key: 'title', label: 'Title · Area · Category', sort: l => l.title, render: l => {
      const cover = coverOf(photosOf(l))
      return (
        <span style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
          <FavStar kind="listings" id={l.id} size={14} />
          {cover && <span style={{ width: 52, height: 39, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: C.grayBg }}><Photo src={cover.preview} /></span>}
          <span style={{ minWidth: 0 }}><b>{l.title}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{l.area} · {l.category} · {l.type === 'sale' ? 'Sale' : 'Rent'}</span>
            <HotTags l={l} /></span>
        </span>
      )
    } },
    { key: 'unit', label: 'Unit Number / Size', render: l => <span style={{ fontSize: 12.5 }}>{sightOf(l).level === 'none' ? <span style={{ color: C.muted }}>Unit hidden</span> : l.address.split(',')[0]}<span style={{ display: 'block', color: C.muted }}>{num(l.builtUp)} sq ft{l.beds ? ` · ${l.beds}R${l.baths}B` : ''}</span></span> },
    { key: 'price', label: 'Ad · Best · M. Value', help: COLUMN.listingPrice, align: 'right', sort: l => (view === 'price' ? l.priceUpdated : l.askPrice), render: l => (
      <span style={{ fontSize: 13 }}>{rm0(l.askPrice)}
        {l.priceBefore && view === 'price' && <span style={{ display: 'block', fontSize: 12, color: C.muted }}>was {rm0(l.priceBefore)} · {date(l.priceUpdated, { short: true })}</span>}
        <span style={{ display: 'block', fontSize: 12, color: C.muted }}>{rm0(l.bestPrice)} · {l.marketValue ? rm0(l.marketValue) : 'no M.V.'}</span>
        <RatingPill l={l} /></span>
    ) },
    { key: 'creator', label: 'Product Handler · Creator', help: COLUMN.listingHolder, sort: l => m.staffName(l.creatorId), render: l => (
      <span style={{ fontSize: 13 }}>{m.staffName(l.holderId)}<span style={{ display: 'block', fontSize: 12, color: C.muted }}>{l.creatorId !== l.holderId ? `by ${m.staffName(l.creatorId)}` : 'own listing'}</span></span>
    ) },
    { key: 'owner', label: 'Owner Contact', help: COLUMN.ownerContact, render: l => <OwnerContact l={l} sight={sightOf(l)} /> },
    { key: 'follow', label: 'Settings · Follow-Up', help: COLUMN.listingFollow, sort: l => lastFollow(l)?.date || '', render: l => (
      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {l.flags.slice(0, 2).map(f => <Pill key={f} tone={f === 'Process Deal' ? 'blue' : 'gray'} dot={false} style={{ fontSize: 11 }}>{f}</Pill>)}
        {lastFollow(l) && <span style={{ fontSize: 12, color: C.muted, width: '100%' }}>{FOLLOW_UP_ACTIONS[lastFollow(l).action]} · {date(lastFollow(l).date, { short: true })}</span>}
      </span>
    ) },
    { key: 'status', label: 'Status', render: l => <Status of={LISTING_STATUS} value={l.status} /> },
    { key: 'actions', label: '', card: false, render: l => <ListingActions l={l} quiet onBook={() => setBook(l)} /> },
  ]
  const cats = Object.entries(LISTING_CATEGORY).map(([k, label]) => ({ k, label, n: scoped.filter(l => listingCategory(l) === Number(k)).length })).filter(c => c.n)
  const { onOrder, nav } = useRecordNav(open?.id, id => `${base}/${id}`)
  const filters = [cate, type, mv, flag, follow, track, who, rating, minPrice, maxPrice, beds].filter(x => x !== '').length
  const clear = () => { setQ(''); setCate(''); setType(''); setMv(''); setFlag(''); setFollow(''); setTrack(''); setWho(''); setRating(''); setMinPrice(''); setMaxPrice(''); setBeds('') }
  const views = market ? [...VIEWS.slice(0, 1), ['market', 'Whole agency'], ...VIEWS.slice(1)] : VIEWS
  const title = byRole ? ROLE_TITLES[role] : `All listings${view === 'all' ? '' : ` · ${views.find(v => v[0] === view)[1]}`}`

  return (
    <Page title={title} help={byRole ? PAGE.listingRoles : PAGE.listings} sub={byRole ? 'Property Listings Library by who looks after them' : 'Property Listings Library. Published to the SubSaleKing site.'}
      actions={<button style={btn} onClick={() => go('listing-new')}>Add a listing</button>}>
      <Card pad={16}>
        {!byRole && <Tabs value={view} onChange={v => { setView(v); setHot('') }} tabs={views.map(([key, label]) => ({ key, label }))} />}
        {view === 'hot' && (
          <div style={{ marginBottom: 12 }}>
            <Chips label="Hot list" value={hot} onChange={setHot} options={[{ key: '', label: 'All hot', count: scoped.length },
              ...Object.entries(L.HOT_LISTS).map(([key, h]) => ({ key, label: h.label, count: scoped.filter(l => L.hotLists(l).includes(key)).length }))]} />
            <p style={{ fontSize: 12.5, color: C.muted, margin: '6px 0 0' }}>{hot ? L.HOT_LISTS[hot].help : 'Worked out from each listing: price against market value, photos and the key. They update as listings change.'}</p>
          </div>
        )}
        {view === 'market' && <p style={{ fontSize: 13, color: C.muted, margin: '0 0 12px' }}>Every listing on the market in the agency. Book a viewing for your customer; the product handler confirms it with the owner. Owners' details stay with the people tied to each listing.</p>}
        <Toolbar fold onClear={clear}>
          <SearchBox value={q} onChange={setQ} placeholder="Listing ID, title, area or holder" />
          <Select label="Listing type" value={type} onChange={setType} options={[['', 'Sale and rent'], ['sale', 'Sales Listing'], ['rental', 'Rental Listing']].map(([value, label]) => ({ value, label }))} />
          <Select label="Category" value={cate} onChange={setCate} options={[{ value: '', label: `All categories (${scoped.length})` }, ...cats.map(c => ({ value: c.k, label: `${c.label} (${c.n})` }))]} />
          <RangeFilter label="Ad Price" unit="RM" from={minPrice} to={maxPrice} format={rmShort} onChange={(lo, hi) => { setMinPrice(lo); setMaxPrice(hi) }} />
          <Select label="Bedrooms" value={beds} onChange={setBeds} options={[{ value: '', label: 'Any' }, ...[1, 2, 3, 4, 5].map(n => ({ value: String(n), label: `${n}+` }))]} />
          <Select label="Price vs market" value={rating} onChange={setRating} options={[{ value: '', label: 'Any' }, ...Object.entries(L.RATING).map(([value, r]) => ({ value, label: r.label }))]} />
          <Select label="Status" value={track} onChange={setTrack} options={[{ value: '', label: 'Any status' }, ...Object.entries(LISTING_STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
          {(owners.length > 0 || !byRole) && (
            <Select label={byRole ? ROLES[role] : 'Product handler'} value={who} onChange={setWho}
              options={[{ value: '', label: byRole ? `All ${ROLES[role].toLowerCase()}s` : 'Everyone' }, ...(byRole ? owners : d.staff.filter(s => s.status !== 'pending').sort((a, b) => a.short.localeCompare(b.short)))
                .map(s => ({ value: String(s.id), label: `${role === 'bm' ? 'B.M ' : ''}${s.short} (${s.code})` }))]} />
          )}
          <Select label="Settings" value={flag} onChange={setFlag} options={[{ value: '', label: 'Any setting' }, ...LISTING_SETTINGS.map(f => ({ value: f, label: f }))]} />
          <Select label="Last follow-up" value={follow} onChange={setFollow} options={[{ value: '', label: 'Any' }, ...Object.entries(FOLLOW_UP_ACTIONS).map(([value, label]) => ({ value, label }))]} />
          <Select label="Market value" value={mv} onChange={setMv} options={[['', 'With or without'], ['complete', 'Complete Market Value'], ['incomplete', 'Incomplete Market Value']].map(([value, label]) => ({ value, label }))} />
          <span style={{ flex: 1 }} />
          <Segmented label="Layout" value={layout} onChange={setLayout} options={[{ key: 'table', label: 'Table', icon: 'menu' }, { key: 'cards', label: 'Cards', icon: 'listings' }]} />
        </Toolbar>
        {layout === 'table'
          ? <DataTable columns={columns} rows={rows} onRow={l => go(`${base}/${l.id}`)} defaultSort={{ key: sortKey, dir: 'desc' }} pageSize={25} narrowAt={1050}
            empty={view === 'today' ? 'No listings added today' : 'No listings match'} onClear={filters || q ? clear : undefined} onOrder={onOrder} />
          : <CardGrid rows={rows} m={m} base={base} />}
      </Card>
      <Drawer open={!!open} onClose={() => go(base)} width={620} title={open?.title} sub={open ? `${open.code} · ${open.category} · ${open.area}` : ''} nav={layout === 'table' ? nav : null}
        footer={open && <ListingActions key={open.id} l={open} onBook={() => setBook(open)} />}>
        {open && <ListingDetails l={open} m={m} onBook={() => setBook(open)} />}
      </Drawer>
      <BookViewing listing={book} open={!!book} onClose={() => setBook(null)} />
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
  const cover = coverOf(photosOf(l))
  return (
    <button onClick={() => go(`${base}/${l.id}`)} style={{ all: 'unset', cursor: 'pointer', display: 'block', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', boxShadow: C.shadow, minWidth: 0 }}>
      <div style={{ height: 118, background: `linear-gradient(135deg, ${a}, ${b})`, position: 'relative', display: 'grid', placeItems: 'center', color: 'rgba(29,35,48,0.35)' }}>
        <Icon name="listings" size={40} stroke={1.4} />
        {cover && <span style={{ position: 'absolute', inset: 0 }}><Photo src={cover.preview} alt={l.title} /></span>}
        <span style={{ position: 'absolute', top: 8, left: 8 }}><Pill tone={l.type === 'sale' ? 'brand' : 'blue'} dot={false} style={{ background: '#fff' }}>{l.type === 'sale' ? 'For Sale' : 'For Rent'}</Pill></span>
        <span style={{ position: 'absolute', top: 8, right: 8 }}><Status of={LISTING_STATUS} value={l.status} /></span>
        {mediaCount(l) && <span style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 11, fontWeight: 600, color: C.text, background: 'rgba(255,255,255,0.85)', borderRadius: 4, padding: '1px 6px' }}>{mediaCount(l)}</span>}
      </div>
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>{rm0(l.askPrice)}{l.type === 'rental' && <span style={{ fontSize: 12, fontWeight: 500, color: C.muted }}> /month</span>}</span>
          <RatingPill l={l} />
        </div>
        <HotTags l={l} />
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

// Who handles the listing and why, by the rules in shared/listings.js, with
// every change before (the current system's product handler history).
function Handler({ l, m, title }) {
  const log = l.phLog || []
  const last = log.at(-1)
  const bm = m.branchManagerOf(l.holderId)
  const lead = l.type === 'sale' ? title?.managerId : title?.handlerId
  return (
    <Block title="People" help={CARD.productHandler}>
      <div style={{ display: 'grid', gap: 10 }}>
        <Who name={m.staffName(l.holderId)} to={`staff/${l.holderId}`} sub={`Product Handler (gets the Product side)${last && last.staffId === l.holderId ? ` · ${L.HANDLER_FROM[last.from]}` : ''}`} />
        {l.creatorId !== l.holderId && <Who name={m.staffName(l.creatorId)} to={`staff/${l.creatorId}`} sub="Listing Creator" />}
        {bm && bm.id !== l.holderId && <Who name={bm.short} to={`staff/${bm.id}`} sub="Branch Manager" />}
        {lead && <Who name={m.staffName(lead)} to={`staff/${lead}`} sub={`${l.type === 'sale' ? 'Project Manager' : 'Project Handler'} of ${title.name}`} />}
      </div>
      {log.length > 1 && (
        <details style={{ marginTop: 10, fontSize: 13 }}>
          <summary style={{ cursor: 'pointer', color: C.primaryDark, fontWeight: 600 }}>Product handler history ({log.length})</summary>
          <ol style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
            {[...log].reverse().map((x, i) => (
              <li key={i} style={{ display: 'flex', gap: 10, padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 12, color: C.muted, width: 70, flexShrink: 0 }}>{date(x.on, { short: true })}</span>
                <span><b>{m.staffName(x.staffId)}</b> <span style={{ color: C.muted }}>· {L.HANDLER_FROM[x.from] || x.from}</span></span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </Block>
  )
}

// Ad Price can be changed right here (it saves when you press Save or Enter).
function AdPrice({ l }) {
  const erp = useErp()
  const fb = useFeedback()
  // Only on the viewer's own listings (not the rest of the agency's).
  const editable = useCan()('listings', 'edit') && erp.scoped.listings.some(x => x.id === l.id)
  const [v, setV] = useState(String(l.askPrice))
  const changed = Number(v) !== l.askPrice && Number(v) >= 0 && v !== ''
  const save = () => changed && fb.run(() => erp.updateListing(l.id, { askPrice: Number(v) }), `${l.code} Ad Price set to ${rm(Number(v))}`)
  if (!editable) return <b>{rm(l.askPrice)}</b>
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="number" min="0" value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} aria-label="Ad Price"
        style={{ width: 120, padding: '3px 6px', border: `1px solid ${C.border}`, borderRadius: 6, fontWeight: 700, fontFamily: C.font, fontSize: 13.5 }} />
      {changed && <button style={{ ...small, padding: '3px 8px', fontSize: 12 }} onClick={save}>Save</button>}
    </span>
  )
}

export function ListingDetails({ l, m, onBook }) {
  const deal = l.dealId ? m.deals[l.dealId] : null
  const title = m.titles[l.titleId]
  const share = l.share || { users: [], pmId: null, coPh: [] }
  const sight = useOwnerSight()(l)
  const can = useCan()
  const rating = L.priceRating(l)
  const photos = photosOf(l)
  const videos = videosOf(l)
  // Photos with a stored preview, cover first; the strip shows up to 8.
  const strip = photos.filter(p => p.preview).sort((x, y) => y.cover - x.cover)
  return (
    <>
      <Block title="Listing" right={<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><FavStar kind="listings" id={l.id} label="Favourite" /><Status of={LISTING_STATUS} value={l.status} /></span>}>
        {strip.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 6, marginBottom: 14 }}>
            {strip.slice(0, 8).map((p, i) => (
              <span key={p.id} title={p.published ? p.name : `${p.name} (not published)`}
                style={{ position: 'relative', aspectRatio: '4 / 3', borderRadius: 6, overflow: 'hidden', background: C.grayBg, opacity: p.published ? 1 : 0.5 }}>
                <Photo src={p.preview} alt={p.name} />
                {i === 7 && strip.length > 8 && <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(16,24,40,.55)', color: '#fff', fontWeight: 700, fontSize: 14 }}>+{strip.length - 7}</span>}
              </span>
            ))}
          </div>
        )}
        <KV min={160} items={[
          [l.type === 'sale' ? 'Ad Price' : 'Ad Price (rent)', <AdPrice key={`${l.id}-${l.askPrice}`} l={l} />], ['Best Price', rm(l.bestPrice)],
          ['Market Value', l.marketValue ? rm(l.marketValue) : 'Not set'], ['Built-up', `${num(l.builtUp)} sq ft`], l.land && ['Land', `${l.land} ft`],
          ['Rooms', l.beds ? `${l.beds} bed · ${l.baths} bath` : `${l.baths} toilets`], ['Tenure', l.tenure], ['Furnishing', l.furnishing],
          ['Category', `${LISTING_CATEGORY[listingCategory(l)]} · ${l.category}`], ['Address', `${l.address}, ${l.postcode} ${l.city}, ${l.state}`],
          ['C.Date', date(l.created)], ['U.Date', date(l.updated)], l.commission != null && ['Commission', `${l.commission}%`],
          l.trackingPrice != null && l.status !== 'active' && ['Went for', rm(l.trackingPrice)],
        ]} />
        {(rating || L.hotLists(l).length > 0) && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, fontSize: 12.5, color: C.muted }}>
            <RatingPill l={l} long />{rating && <span>{rating.diff > 0 ? `${rm0(rating.diff)} above` : `${rm0(-rating.diff)} below`} market value</span>}<HotTags l={l} />
          </div>
        )}
        {l.status === 'active' && L.isOutdated(l, m.today) && <p style={{ fontSize: 12.5, color: C.warn, margin: '8px 0 0' }}>Not updated for over {L.LISTING_RULES.outdatedDays[l.type === 'rental' ? 'rental' : 'sale']} days: it will be marked Outdated unless someone follows it up.</p>}
        {l.description && <p style={{ fontSize: 13, margin: '10px 0 0', whiteSpace: 'pre-wrap' }}>{l.description}</p>}
        {l.remarks && <p style={{ fontSize: 12.5, color: C.muted, margin: '8px 0 0' }}>Personal use remarks: {l.remarks}</p>}
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
      <Handler l={l} m={m} title={title} />
      <Block title="Share" help={CARD.share}>
        <KV min={160} items={[
          ['Shared users', share.users.length ? share.users.map(id => m.staffName(id)).join(', ') : 'Not shared'],
          ['Main Product Handler', share.pmId ? m.staffName(share.pmId) : '—'],
          ['Co-Product Handlers', share.coPh.length ? (
            <span key="co" style={{ display: 'grid', gap: 2 }}>{share.coPh.map(c => (
              <span key={c.staffId}>{m.staffName(c.staffId)} <span style={{ color: C.muted, fontSize: 12 }}>
                {c.locked ? '· locked in (key or exclusive)' : !c.until ? '· no end date' : c.until < m.today ? `· ended ${date(c.until, { short: true })}` : `· until ${date(c.until, { short: true })}`}</span></span>
            ))}</span>
          ) : `${L.LISTING_RULES.coPhSlots} slots free`],
        ]} />
      </Block>
      <Block title={l.type === 'sale' ? 'Owner' : 'Landlord'} help={CARD.ownerPrivacy}>
        {sight.level === 'none' ? (
          <p style={{ margin: 0, fontSize: 13.5, color: C.muted }}>Only the people tied to this listing see the owner. To show it to your customer, book a viewing: {m.staffName(l.holderId)} arranges it with the owner.</p>
        ) : (
          <>
            <KV min={160} items={[['Owner', <OwnerContact key="o" l={l} sight={sight} reveal />], ['IC no.', l.owner.ic ? maskIc(l.owner.ic) : '—'],
              ['Unit', l.address.split(',')[0]], sight.roles.length > 0 && ['You are', sight.roles.map(r => L.LISTING_ROLE[r]).join(', ')]]} />
            {(sight.level === 'full' || can('listings', 'full')) && (l.ownerViews || []).length > 0 && (
              <p style={{ fontSize: 12.5, color: C.muted, margin: '10px 0 0' }}>
                Looked at by {[...new Map(l.ownerViews.map(x => [x.by, x])).values()].slice(0, 6).map(x => `${x.by ? m.staffName(x.by) : 'the office'} (${date(x.at.slice(0, 10), { short: true })})`).join(', ')}
              </p>
            )}
          </>
        )}
      </Block>
      <ListingViewings l={l} onBook={onBook} />
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
      <Block title="Marketing insight" help={CARD.marketing}>
        <KV min={130} items={[['Views (website)', num(l.views - (l.viewsApp || 0))], ['Views (app)', num(l.viewsApp || 0)], ['Enquiries', num(l.enquiries)],
          ['Photos', `${photos.filter(p => p.published).length} published of ${photos.length}`],
          ['Videos', videos.length ? `${videos.filter(v => v.published).length} published of ${videos.length}` : 'None yet']]} />
      </Block>
    </>
  )
}

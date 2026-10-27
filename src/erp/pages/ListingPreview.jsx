import { C } from '../../styles.js'
import { Avatar } from '../ui.jsx'
import Icon from '../Icon.jsx'
import { num } from '../format.js'
import { ReviewHeading } from '../review.jsx'

// How a listing will look on the SubSaleKing website, drawn from the form's
// values before it is saved. l: { type, title, area, state, category, tenure,
// furnishing, builtUp, beds, baths, parks, askPrice, description }.
export default function ListingPreview({ l, agent, photos = 0, videos = 0 }) {
  const rental = l.type === 'rental'
  const facts = [
    l.beds && `${l.beds} bed${Number(l.beds) === 1 ? '' : 's'}`, l.baths && `${l.baths} bath${Number(l.baths) === 1 ? '' : 's'}`,
    l.parks && `${l.parks} car park${Number(l.parks) === 1 ? '' : 's'}`, l.builtUp && `${num(l.builtUp)} sq ft`,
  ].filter(Boolean)
  return (
    <section>
      <ReviewHeading note="What the public sees">On the SubSaleKing website</ReviewHeading>
      <article style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', background: C.card, boxShadow: C.shadow }}>
        <div style={{ position: 'relative', minHeight: 170, background: 'linear-gradient(135deg, #1d1f27 0%, #5a0a2a 100%)', color: 'rgba(255,255,255,.75)',
          display: 'grid', placeItems: 'center', textAlign: 'center', fontSize: 12.5 }}>
          <span style={{ display: 'grid', gap: 6, justifyItems: 'center' }}><Icon name="image" size={26} />{photos ? `${photos} photo${photos === 1 ? '' : 's'}` : 'No photos yet'}</span>
          <span style={{ position: 'absolute', top: 10, left: 10, background: C.primary, color: '#fff', fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 6 }}>{rental ? 'For Rent' : 'For Sale'}</span>
          {videos > 0 && <span style={{ position: 'absolute', bottom: 10, right: 10, display: 'inline-flex', gap: 5, alignItems: 'center', background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 11.5, fontWeight: 600, padding: '3px 8px', borderRadius: 6 }}>
            <Icon name="video" size={13} />{videos} video{videos === 1 ? '' : 's'}</span>}
        </div>
        <div style={{ padding: '14px 16px', display: 'grid', gap: 6, alignContent: 'start', minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 750, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
            {Number(l.askPrice) > 0 ? `RM ${num(l.askPrice)}` : <span style={{ color: C.muted }}>No price yet</span>}{rental && Number(l.askPrice) > 0 && <span style={{ fontSize: 13, fontWeight: 500, color: C.muted }}> / month</span>}
          </div>
          <div style={{ fontSize: 15.5, fontWeight: 650, lineHeight: 1.3 }}>{l.title || <span style={{ color: C.muted }}>Building / taman</span>}</div>
          <div style={{ fontSize: 13, color: C.muted }}>{[l.area, l.state].filter(Boolean).join(', ') || '—'}</div>
          {facts.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{facts.map(x => <span key={x} style={{ fontSize: 12, fontWeight: 600, background: C.grayBg, borderRadius: 6, padding: '2px 8px' }}>{x}</span>)}</div>
          )}
          <div style={{ fontSize: 12.5, color: C.muted }}>{[l.category, l.tenure, l.furnishing].filter(Boolean).join(' · ')}</div>
          {l.description && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{l.description}</p>}
          {agent && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
              <Avatar name={agent.short} photo={agent.photo} size={28} />
              <span style={{ minWidth: 0, lineHeight: 1.3 }}><b style={{ fontSize: 13 }}>{agent.short}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{agent.phone}</span></span>
            </div>
          )}
        </div>
      </article>
    </section>
  )
}

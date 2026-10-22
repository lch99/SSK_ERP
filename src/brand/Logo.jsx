// SubSaleKing logo mark (from subsaleking.com). Takes the current text colour.
export default function LogoMark({ size = 26 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width={size} height={size} aria-hidden="true">
      <g transform="matrix(1.63176,0,0,1.63176,-1878.68,-245.723)"><g transform="matrix(-1,0,0,1,1219.78,150.665)"><path d="M-19.986,156.733L0,156.733L0,12.637L-19.986,0L-19.986,156.733Z" fill="currentColor"></path></g> <g transform="matrix(1,0,0,1,1185.27,180.795)"><path d="M0,109.181L-11.152,109.181L-11.152,0.002L21.785,0.002L21.785,-17.41L-28.564,-17.41L-28.564,126.591L21.785,126.591L21.785,12.208L0,26.223L0,109.181Z" fill="currentColor"></path></g> <g transform="matrix(-1,0,0,1,1274.26,180.807)"><path d="M0,109.181L-11.152,109.181L-11.152,0.002L21.785,0.002L21.785,-17.41L-28.564,-17.41L-28.564,126.591L21.785,126.591L21.785,12.208L0,26.223L0,109.181Z" fill="currentColor"></path></g></g>
    </svg>
  )
}

// Logo mark + wordmark, as on subsaleking.com, with an "ERP" tag.
export function Brand() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#ec003f' }}>
      <LogoMark size={26} />
      <span style={{ fontWeight: 600, fontSize: 18, letterSpacing: 0.3, textTransform: 'uppercase' }}>SubSaleKing</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: '#8b0836', borderRadius: 4, padding: '2px 6px', letterSpacing: 0.5 }}>ERP</span>
    </span>
  )
}

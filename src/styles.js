// Design tokens. Inline styles only — always import { C } from here.
// Interaction states (hover, focus, pressed) live in src/global.css.
// Brand: SubSaleKing (subsaleking.com) — crimson; Montserrat for headings and
// the brand, Inter for everything you read and type (denser, clearer numbers).
// Contrast: text colours reach 4.5:1 on white, bg and their own tinted pills
// (WCAG AA). `faint` reaches only 3:1: icons, chevrons, disabled items and
// decoration, never words people need to read (use `muted` for those).
// Smallest text: 12px for sentences, 11px for bold badges and caps headings.
export const C = {
  font: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontHead: "Montserrat, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  bg: '#f4f5f8',
  card: '#ffffff',
  text: '#101828',
  muted: '#667085',
  faint: '#828b9c',
  border: '#e4e7ec',
  borderStrong: '#d0d5dd',
  primary: '#ec003f',
  primaryDark: '#8b0836',
  primaryBg: '#fff1f2',
  ok: '#15763a',
  okBg: '#e6f4ea',
  warn: '#a15c00',
  warnBg: '#fff4e0',
  err: '#b42318',
  errBg: '#fdecea',
  info: '#1d5fc4',
  infoBg: '#eaf1fd',
  violet: '#6a3fc1',
  violetBg: '#f1ecfc',
  grayBg: '#f2f4f7',
  radius: 12,
  // ERP shell: dark sidebar with the brand crimson for the active page.
  side: '#15171e',
  sideText: '#a9b0bd',
  sideHead: '#858c99',
  sideActive: 'rgba(236, 0, 63, 0.16)',
  sideHover: 'rgba(255, 255, 255, 0.06)',
  shadow: '0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)',
  shadowLg: '0 12px 32px -8px rgba(16, 24, 40, 0.18), 0 4px 8px -4px rgba(16, 24, 40, 0.08)',
  // Chart series, in fixed order (validated set: blue, orange, aqua).
  series: ['#2a78d6', '#eb6834', '#1baf7a'],
  grid: '#e8eaee',
}

export const inp = {
  padding: '8px 11px', border: `1px solid ${C.borderStrong}`, borderRadius: 8, fontSize: 14, lineHeight: '20px',
  fontFamily: C.font, color: C.text, background: '#fff', boxSizing: 'border-box', minWidth: 0,
  boxShadow: '0 1px 2px rgba(16, 24, 40, 0.04)',
}
// Selects get their arrow from global.css; keep room for it.
export const sel = { ...inp, paddingRight: 32 }
export const btn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.borderStrong}`, background: '#fff', lineHeight: '20px',
  color: C.text, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: C.font,
  boxShadow: '0 1px 2px rgba(16, 24, 40, 0.05)',
}
export const btnPrimary = {
  ...btn, background: `linear-gradient(180deg, #f5124f 0%, ${C.primary} 45%, #c10036 100%)`, borderColor: '#c10036', color: '#fff',
  boxShadow: '0 1px 2px rgba(16, 24, 40, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.18)',
}
export const th = { textAlign: 'left', fontSize: 12, fontWeight: 600, color: C.muted, padding: '8px 10px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }
export const td = { padding: '8px 10px', borderBottom: `1px solid ${C.border}`, fontSize: 14, verticalAlign: 'middle' }
export const label = { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#344054', marginBottom: 6 }

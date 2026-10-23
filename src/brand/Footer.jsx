import { C } from '../styles.js'
import { DEMO } from '../api.js'

// Set from package.json at build time (vite.config.js).
export const VERSION = __APP_VERSION__ // eslint-disable-line no-undef
const BUILT = __BUILD_DATE__ // eslint-disable-line no-undef

// The footer on every page: who owns the system, which version it is, and who built it.
export default function Footer({ style }) {
  return (
    <footer style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', justifyContent: 'space-between', alignItems: 'center',
      fontSize: 12, lineHeight: 1.5, color: C.faint, padding: '14px 0', borderTop: `1px solid ${C.border}`, ...style }}>
      <span>© {new Date().getFullYear()} SubSaleKing (SSK). All rights reserved.</span>
      <span>
        <span title={`Version ${VERSION}${DEMO ? ' (demo: data stays in this browser)' : ''} · built ${BUILT}`} style={{ fontVariantNumeric: 'tabular-nums' }}>v{VERSION}{DEMO ? ' Demo' : ''}</span>
        <span aria-hidden style={{ margin: '0 6px' }}>·</span>
        Powered by <b style={{ color: C.muted, fontWeight: 600 }}>JonTech Solution</b>
      </span>
    </footer>
  )
}

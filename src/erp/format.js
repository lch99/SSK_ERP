// How the ERP writes money, dates and people.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The amount alone (2 dp), and with "RM" joined to it so the two never wrap apart.
export const amt = n => Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const rm = n => `RM\u00a0${amt(n)}`
export const rm0 = n => `RM\u00a0${Math.round(Number(n || 0)).toLocaleString('en-MY')}`
// RM 1.2M / RM 845k: for tiles and chart axes, never in tables.
export function rmShort(n) {
  const v = Number(n || 0), a = Math.abs(v)
  if (a >= 1e6) return `RM\u00a0${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`
  if (a >= 1e3) return `RM\u00a0${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '')}k`
  return `RM\u00a0${Math.round(v)}`
}
export const pct = n => `${Number(n).toLocaleString('en-MY', { maximumFractionDigits: 2 })}%`
export const num = n => Number(n || 0).toLocaleString('en-MY')

// '2026-10-21' → '21 Oct 2026'; short: '21 Oct'.
export function date(s, { short = false } = {}) {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  return short ? `${d} ${MONTHS[m - 1]}` : `${d} ${MONTHS[m - 1]} ${y}`
}
export const monthLabel = ym => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`
export const monthName = ym => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`

const dayNo = s => Date.UTC(...s.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v)))) / 86400000
export const daysFrom = (a, b) => Math.round(dayNo(b) - dayNo(a))
export function ago(s, today) {
  const n = daysFrom(s, today)
  if (n <= 0) return n === 0 ? 'today' : `in ${-n} day${n === -1 ? '' : 's'}`
  if (n === 1) return 'yesterday'
  if (n < 30) return `${n} days ago`
  const m = Math.round(n / 30)
  return m < 12 ? `${m} month${m > 1 ? 's' : ''} ago` : `${Math.round(n / 365)} yr ago`
}

// IC numbers are shown with the last four digits hidden.
export const maskIc = ic => (ic ? ic.replace(/\d{4}$/, '••••') : '')
export const maskAcc = acc => (acc ? `•••• ${String(acc).replace(/\s/g, '').slice(-4)}` : '')
export const initials = name => String(name || '?').replace(/\b(bin|binti|a\/l|a\/p)\b/gi, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')

// The last `n` months up to the one `today` is in: ['2026-01', …, '2026-10'].
export function lastMonths(today, n) {
  let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7))
  const out = []
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}`)
    if (--m === 0) { m = 12; y-- }
  }
  return out
}

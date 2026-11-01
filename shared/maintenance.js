// Planned downtime: the windows the technical team schedules, and where they
// stand at a moment. One copy for the page (banner, "back soon" screen) and,
// later, the server (which must also refuse requests while a window that
// closes the ERP is live). Times are local 'YYYY-MM-DD HH:MM', compared as text.

// Everyone sees the banner from this many days before a window starts.
export const NOTICE_DAYS = 7
// No window may be longer than this (a longer job is planned as several).
export const MAX_HOURS = 24

export const DOWNTIME_STATUS = {
  scheduled: { label: 'Scheduled', tone: 'blue', help: 'Planned. Everyone sees a notice at the top of every page from a week before.' },
  live: { label: 'In progress', tone: 'amber', help: 'Happening now. People see the "back soon" page; the technical team and the Superadmin can still work.' },
  done: { label: 'Finished', tone: 'green', help: 'Over, or ended early by the technical team.' },
  cancelled: { label: 'Cancelled', tone: 'gray', help: 'Called off before it started. Everyone was told.' },
}

const toMs = stamp => new Date(`${stamp.slice(0, 10)}T${stamp.slice(11, 16)}:00`).getTime()
export const hoursBetween = (a, b) => (toMs(b) - toMs(a)) / 3600000
export const daysUntil = (stamp, now) => (toMs(stamp) - toMs(now)) / 86400000

export const statusOf = (w, now) => (w.cancelled ? 'cancelled' : w.endedAt || w.end <= now ? 'done' : w.start <= now ? 'live' : 'scheduled')

// What the ERP shows at `now`: the window in progress, and the next one people are warned about.
export function downtimeAt(windows, now) {
  const open = (windows || []).filter(w => ['scheduled', 'live'].includes(statusOf(w, now)))
  const live = open.find(w => statusOf(w, now) === 'live') || null
  const next = open.filter(w => statusOf(w, now) === 'scheduled').sort((a, b) => a.start.localeCompare(b.start))[0] || null
  return { live, next: next && daysUntil(next.start, now) <= NOTICE_DAYS ? next : null, upcoming: next }
}

// Why a planned window can't be saved, or null.
export function checkWindow(w, now, others = []) {
  if (!w.start || !w.end) return 'Pick when it starts and ends.'
  if (w.end <= w.start) return 'It has to end after it starts.'
  if (w.start < now) return 'Pick a start time later than now.'
  if (hoursBetween(w.start, w.end) > MAX_HOURS) return `Keep one window to ${MAX_HOURS} hours or less; plan a longer job as several.`
  if (!String(w.message || '').trim()) return 'Say in a sentence what people should expect.'
  const clash = others.find(o => o.id !== w.id && ['scheduled', 'live'].includes(statusOf(o, now)) && o.start < w.end && w.start < o.end)
  if (clash) return `It overlaps the window planned for ${clash.start}.`
  return null
}

// "Sat 2 Nov, 10:00 pm – 12:00 am" in plain words for the banner and notices.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const clock = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}` }
const day = s => { const d = new Date(`${s.slice(0, 10)}T00:00:00`); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` }
export function whenText(w) {
  const sameDay = w.start.slice(0, 10) === w.end.slice(0, 10)
  return sameDay ? `${day(w.start)}, ${clock(w.start.slice(11))} – ${clock(w.end.slice(11))}`
    : `${day(w.start)}, ${clock(w.start.slice(11))} – ${day(w.end)}, ${clock(w.end.slice(11))}`
}

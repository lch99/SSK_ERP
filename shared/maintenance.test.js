import { describe, it, expect } from 'vitest'
import * as M from './maintenance.js'

const w = over => ({ id: 1, start: '2026-11-02 22:00', end: '2026-11-03 00:00', message: 'Upgrade', ...over })

describe('planned downtime', () => {
  it('moves from scheduled to live to done, unless cancelled or ended early', () => {
    expect(M.statusOf(w(), '2026-11-02 21:59')).toBe('scheduled')
    expect(M.statusOf(w(), '2026-11-02 22:00')).toBe('live')
    expect(M.statusOf(w(), '2026-11-03 00:00')).toBe('done')
    expect(M.statusOf(w({ endedAt: '2026-11-02 22:30' }), '2026-11-02 22:31')).toBe('done')
    expect(M.statusOf(w({ cancelled: true }), '2026-11-02 22:30')).toBe('cancelled')
  })
  it('warns from a week before, and knows the live window', () => {
    expect(M.downtimeAt([w()], '2026-10-25 21:00').next).toBe(null)
    expect(M.downtimeAt([w()], '2026-10-26 23:00').next?.id).toBe(1)
    expect(M.downtimeAt([w()], '2026-11-02 23:00').live?.id).toBe(1)
    expect(M.downtimeAt([w({ cancelled: true })], '2026-11-02 23:00')).toMatchObject({ live: null, next: null })
  })
  it('checks a new window', () => {
    const now = '2026-10-31 10:00'
    expect(M.checkWindow(w({ end: '2026-11-02 21:00' }), now)).toMatch(/end after/)
    expect(M.checkWindow(w({ start: '2026-10-30 22:00' }), now)).toMatch(/later than now/)
    expect(M.checkWindow(w({ end: '2026-11-04 00:00' }), now)).toMatch(/24 hours/)
    expect(M.checkWindow(w({ message: ' ' }), now)).toMatch(/expect/)
    expect(M.checkWindow(w({ id: 2, start: '2026-11-02 23:00', end: '2026-11-03 01:00' }), now, [w()])).toMatch(/overlaps/)
    expect(M.checkWindow(w(), now, [w({ id: 2, cancelled: true })])).toBe(null)
  })
  it('says when in plain words', () => {
    expect(M.whenText(w())).toBe('Mon 2 Nov, 10:00 pm – Tue 3 Nov, 12:00 am')
    expect(M.whenText(w({ end: '2026-11-02 23:30' }))).toBe('Mon 2 Nov, 10:00 pm – 11:30 pm')
  })
})

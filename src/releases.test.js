import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { RELEASES, unseen } from './releases.js'
import { MODULES, modulePages } from './erp/modules.js'

const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
// Words that mean nothing to the people using the ERP.
const JARGON = /\b(API|backend|frontend|front-end|back-end|localStorage|component|refactor|endpoint|props|JSON|SQL|npm|commit|deploy|bug fix|regex|cache)\b|\.jsx?\b|src\/|shared\//i

describe('release notes', () => {
  it('every release has its notes: the newest entry is the version in package.json', () => {
    expect(RELEASES[0].version).toBe(version)
  })
  it('newest first, one entry per version, each dated', () => {
    const num = v => v.split('.').map(Number).reduce((t, n) => t * 1000 + n, 0)
    for (let i = 1; i < RELEASES.length; i++) {
      expect(num(RELEASES[i - 1].version)).toBeGreaterThan(num(RELEASES[i].version))
      expect(RELEASES[i - 1].date >= RELEASES[i].date).toBe(true)
    }
    for (const r of RELEASES) expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('in plain words, short, and linking to real pages', () => {
    const pages = new Set(modulePages(MODULES).map(p => p.path))
    for (const r of RELEASES) {
      expect(r.title.length).toBeGreaterThan(0)
      expect(r.items.length).toBeGreaterThan(0)
      for (const i of r.items) {
        expect(i.text, `${r.version}: ${i.text}`).not.toMatch(JARGON)
        expect(i.text.length, `${r.version}: too long for a pop-up`).toBeLessThanOrEqual(260)
        if (i.who) expect(['agents', 'office']).toContain(i.who)
        if (i.to) expect(pages.has(i.to), `${r.version}: no page "${i.to}"`).toBe(true)
      }
    }
  })
  it('shows what is new since the last version seen', () => {
    expect(unseen(undefined).map(r => r.version)).toEqual([RELEASES[0].version])
    expect(unseen(RELEASES[2].version).map(r => r.version)).toEqual([RELEASES[0].version, RELEASES[1].version])
    expect(unseen(RELEASES[0].version)).toEqual([])
  })
})

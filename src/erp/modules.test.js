import { describe, expect, it } from 'vitest'
import { AREA_KEYS } from '../../shared/access.js'
import { ACCESS_GROUPS, MODULES, activePath, moduleHome, modulePages, visibleModules } from './modules.js'

describe('ERP modules', () => {
  it('puts every page in one module only', () => {
    const paths = MODULES.flatMap(m => m.items.filter(i => i.path).map(i => i.path))
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('gives every module a home page of its own', () => {
    for (const m of MODULES) expect(m.items.some(i => i.path === m.home)).toBe(true)
  })

  it('lists every access area once in Roles & access', () => {
    const areas = ACCESS_GROUPS.flatMap(g => g.areas)
    expect([...areas].sort()).toEqual([...AREA_KEYS].sort())
  })

  it('drops pages a viewer may not open, then empty headings and modules', () => {
    const mods = visibleModules(i => i.path === 'dashboard' || i.path === 'salary')
    expect(mods.map(m => m.key)).toEqual(['home', 'commission'])
    const commission = mods.find(m => m.key === 'commission')
    expect(commission.items.filter(i => i.section).map(i => i.section)).toEqual(['Pay agents'])
    expect(moduleHome(commission)).toBe('salary')
  })

  it('finds pages by their old names, their heading\'s included', () => {
    const page = modulePages(MODULES).find(p => p.path === 'staff')
    expect(page.moduleLabel).toBe('People')
    expect(page.was).toContain('H.R Portal')
  })

  it('marks the page an address belongs to', () => {
    const pages = modulePages(MODULES)
    expect(activePath(['deals', '42'], pages)).toBe('deals')
    expect(activePath(['deals', 'ready'], pages)).toBe('deals/ready')
    expect(activePath(['money-in', 'sst'], pages)).toBe('money-in/sst')
  })
})

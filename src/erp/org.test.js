import { describe, expect, it } from 'vitest'
import { buildOrg, findPeople } from './org.js'

// A big agency: 4 branches, each GSM → 5 TSM → 5 AGA each → 19 agents each (506 a branch).
function bigAgency() {
  const people = []
  let id = 1
  const add = (branchId, role, uplineId) => { const p = { id: id++, branchId, role, uplineId, short: `${role || 'Agent'} ${id}`, phone: `01${String(id).padStart(8, '0')}` }; people.push(p); return p }
  for (let b = 1; b <= 4; b++) {
    const gsm = add(b, 'GSM', null)
    for (let t = 0; t < 5; t++) {
      const tsm = add(b, 'TSM', gsm.id)
      for (let a = 0; a < 5; a++) {
        const aga = add(b, 'AGA', tsm.id)
        for (let n = 0; n < 19; n++) add(b, null, aga.id)
      }
    }
  }
  return people
}
const rank = p => ['AGA', 'TSM', 'GSM'].indexOf(p.role)

describe('org chart structure', () => {
  it('works out 2,000 people quickly, with team sizes', () => {
    const people = bigAgency()
    expect(people.length).toBe(2024)
    const t = performance.now()
    const org = buildOrg(people, { rank })
    expect(performance.now() - t).toBeLessThan(200)
    const gsm = org.top(1)[0]
    expect(org.team(gsm.id)).toBe(505)
    expect(org.under(gsm.id)).toHaveLength(5)
    expect(org.team(org.under(gsm.id)[0].id)).toBe(100)
  })

  it('gives the chain from the top of the branch to a person', () => {
    const org = buildOrg(bigAgency(), { rank })
    const gsm = org.top(2)[0], tsm = org.under(gsm.id)[1], aga = org.under(tsm.id)[2], agent = org.under(aga.id)[3]
    expect(org.chain(agent.id).map(p => p.id)).toEqual([gsm.id, tsm.id, aga.id])
    expect(org.within(agent.id, tsm.id)).toBe(true)
    expect(org.within(agent.id, org.under(gsm.id)[0].id)).toBe(false)
  })

  it('puts senior levels first, then bigger teams, then names', () => {
    const people = [
      { id: 1, branchId: 1, role: 'GSM', uplineId: null, short: 'Boss' },
      { id: 2, branchId: 1, role: null, uplineId: 1, short: 'Amy' },
      { id: 3, branchId: 1, role: 'AGA', uplineId: 1, short: 'Zed' },
      { id: 4, branchId: 1, role: null, uplineId: 1, short: 'Ben' },
      { id: 5, branchId: 1, role: null, uplineId: 4, short: 'Cat' },
    ]
    expect(buildOrg(people, { rank }).under(1).map(p => p.short)).toEqual(['Zed', 'Ben', 'Amy'])
  })

  it('never loops on an upline chain that goes round in a circle', () => {
    const people = [
      { id: 1, branchId: 1, uplineId: 3, short: 'A' },
      { id: 2, branchId: 1, uplineId: 1, short: 'B' },
      { id: 3, branchId: 1, uplineId: 2, short: 'C' },
      { id: 4, branchId: 1, uplineId: 4, short: 'Self' },
    ]
    const org = buildOrg(people)
    expect(org.top(1).map(p => p.short).sort()).toEqual(['A', 'Self'])
    expect(org.team(1)).toBe(2)
  })

  it('finds people by name, code or phone, leaders first', () => {
    const people = bigAgency()
    const org = buildOrg(people, { rank })
    const { hits, more } = findPeople(people, 'tsm', org, 3)
    expect(hits).toHaveLength(3)
    expect(more).toBe(17)
    expect(findPeople(people, people[10].phone, org).hits.map(p => p.id)).toEqual([people[10].id])
    expect(findPeople(people, '   ', org).hits).toEqual([])
    // A name match comes before a code that happens to hold the same digits.
    const named = [{ id: 1, branchId: 1, short: 'Agent 599', code: 'S-00001' }, { id: 2, branchId: 1, short: 'Agent 198', code: 'S-02599' }]
    expect(findPeople(named, 'agent 599', buildOrg(named)).hits.map(p => p.id)).toEqual([1, 2])
  })
})

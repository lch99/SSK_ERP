import { describe, it, expect } from 'vitest'
import * as A from './agents.js'
import { sampleState, view, applyStep } from './setupState.js'

const setup = view(sampleState())
const header = ['Name *', 'Branch *', 'Position', 'Upline', 'Tier', 'Phone', 'IC no.', 'Joined']
const table = rows => [header, ...rows]

describe('reading an agent list', () => {
  it('finds the header row under a title, matches loose names, keeps Excel row numbers', () => {
    const read = A.readAgentTable([['Our staff, Oct 2026'], [], ['Full Name', 'Office', 'Rank', 'Leader', 'Mobile', 'Remarks'], ['Tan Ah Kow', 'TD', 'GSM', '', '123456789', 'x'], [], ['Lim Siew Lan', 'Taman Desa', '', 'tan ah kow', '', '']])
    expect(read.columns).toEqual(['name', 'branch', 'position', 'upline', 'phone'])
    expect(read.unknown).toEqual(['Remarks'])
    expect(read.rows.map(r => r.line)).toEqual([4, 6])
    expect(read.rows[0].cells).toMatchObject({ name: 'Tan Ah Kow', branch: 'TD', position: 'GSM' })
  })
  it('says so when there is no Name column', () => {
    expect(A.readAgentTable([['Foo', 'Bar'], ['1', '2']]).error).toMatch(/column names/)
  })
})

describe('checking agents against Setup', () => {
  const check = rows => A.checkAgents(A.readAgentTable(table(rows)).rows, sampleState())
  it('resolves branch, position, upline and tier, and tidies phones and dates', () => {
    const { agents, errors } = check([
      ['Tan Ah Kow', 'Taman Desa', 'GSM', '', 'T5', '0123456789', '800101-14-5555', '15/03/2019'],
      ['Lim Siew Lan', 'td', 'tsm', 'Tan Ah Kow', '', '123456789', '', '43831'],
      ['Ali bin Abu', 'Puchong', '', 'Lim Siew Lan', 'P2', '', '', '2024-02-29'],
    ])
    expect(errors).toEqual([])
    const [tan, lim, ali] = agents
    expect(tan).toMatchObject({ position: 'GSM', upline: null, joined: '2019-03-15' })
    expect(lim).toMatchObject({ position: 'TSM', upline: tan.ref, phone: '0123456789', joined: '2020-01-01' })
    expect(ali.upline).toBe(lim.ref)                       // an upline may sit in another branch
    const pc = sampleState().branches.find(b => b.code === 'PC')
    expect(ali.tierId).toBe(sampleState().plans[1].tiers.find(t => t.name === 'P2').id)
    expect(ali.branchId).toBe(pc.id)
  })
  it('points at the spreadsheet row for each problem', () => {
    const { errors } = check([
      ['', 'Taman Desa', '', '', '', '', '', ''],
      ['Ah Seng', 'Klang', 'Boss', '', 'P1', '', '9.00101E+11', 'yesterday'],
      ['Mei', 'Cheras', '', 'Nobody', 'T9', '', '', ''],
      ['Mei', 'Cheras', '', '', '', '', '', ''],
    ])
    const at = line => errors.filter(e => e.line === line).map(e => e.text).join(' | ')
    expect(at(2)).toMatch(/needs a name/)
    expect(at(3)).toMatch(/branch "Klang" isn't one of yours/)
    expect(at(3)).toMatch(/position "Boss"/)
    expect(at(3)).toMatch(/shortened by Excel/)
    expect(at(3)).toMatch(/isn't a date/)
    expect(at(4)).toMatch(/upline "Nobody" isn't in the list/)
    expect(at(5)).toMatch(/Mei is also on row 4/)
  })
  it('catches upline loops and self-uplines', () => {
    const { errors } = check([['A', 'Cheras', '', 'B', '', '', '', ''], ['B', 'Cheras', '', 'A', '', '', '', ''], ['C', 'Cheras', '', 'C', '', '', '', '']])
    expect(errors.filter(e => /loops back/.test(e.text)).map(e => e.line)).toEqual([2, 3])
    expect(errors.find(e => e.line === 4).text).toMatch(/own upline/)
  })
  it('the example list for a Setup imports cleanly', () => {
    const rows = A.exampleAgents(setup)
    const read = A.readAgentTable([A.AGENT_COLUMNS.map(A.templateHeader), ...rows.map(r => A.AGENT_COLUMNS.map(c => r[c.key]))])
    expect(A.checkAgents(read.rows, sampleState()).errors).toEqual([])
  })
})

describe('the agents step', () => {
  const rows = A.readAgentTable(table([
    ['Tan Ah Kow', 'Puchong', 'GSM', '', 'P3', '', '', ''],
    ['Lim Siew Lan', 'Puchong', '', 'Tan Ah Kow', '', '', '', ''],
  ])).rows
  it('saves with real ids and uplines; adding keeps the saved ones', () => {
    let s = applyStep(sampleState(), 'agents', { mode: 'replace', rows })
    const [tan, lim] = s.agents
    expect(lim.uplineId).toBe(tan.id)
    expect(tan.id).toBeGreaterThan(0)
    const more = A.readAgentTable(table([['Raju', 'Cheras', '', 'Lim Siew Lan', '', '', '', '']])).rows
    s = applyStep(s, 'agents', { mode: 'add', rows: more })
    expect(s.agents.map(a => a.name)).toEqual(['Tan Ah Kow', 'Lim Siew Lan', 'Raju'])
    expect(s.agents[2].uplineId).toBe(lim.id)
    expect(view(s).checklist.find(i => i.key === 'agents').detail).toBe('3 agents · 1 leader')
  })
  it('refuses the whole list when a row is wrong', () => {
    const bad = A.readAgentTable(table([['X', 'Nowhere', '', '', '', '', '', '']])).rows
    expect(() => applyStep(sampleState(), 'agents', { mode: 'replace', rows: bad })).toThrow(/Row 2: branch "Nowhere"/)
  })
  it('keeps agents in line when Setup changes', () => {
    let s = applyStep(sampleState(), 'agents', { mode: 'replace', rows })
    const pc = s.branches.find(b => b.code === 'PC')
    // Puchong moves to the standard plan: its P3 tier no longer applies.
    s = applyStep(s, 'plans', { plans: [s.plans[0]] })
    expect(s.agents[0].tierId).toBeNull()
    s = applyStep(s, 'uplines', { roles: [], splits: {} })
    expect(s.agents[0].position).toBeNull()
    s = applyStep(s, 'branches', { branches: s.branches.filter(b => b.id !== pc.id) })
    expect(s.agents).toEqual([])
  })
})

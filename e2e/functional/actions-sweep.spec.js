import { ACTIONS } from '../../shared/access.js'
import { test, expect, NASTY, tokenOf, api } from './fixtures.js'

// Every action the ERP saves with, given arguments that make no sense: wrong types, missing, ids that don't
// exist, hostile text, deep nesting. Each must be refused (4xx), never a server error, and the server stays up.
// Bulk actions that need no arguments (they would just run on every record) are left out, and so are the
// ones that act on all ids given a missing one.
test.skip(!process.env.E2E_URL, 'needs a server: E2E_URL')

const BULK = new Set(['archiveCases', 'recheckHandlers', 'recheckBuildingLeads', 'markOutdated', 'readNotices', 'endDowntime'])
const deep = Array.from({ length: 60 }).reduce(x => ({ a: x }), {})
const GARBAGE = [
  [], [null], [undefined], ['abc'], [-1], [999999999], [1.5], [true], [{}], [[]], [NASTY], ['9'.repeat(40)],
  [999999999, {}], [999999999, null, null], ['abc', 'def', 'ghi'], [{ id: 'x', name: NASTY }], [deep], [999999999, deep],
  [[999999999, 'x', null]], [{ __proto__: { admin: true } }], [{ constructor: { prototype: { x: 1 } } }],
]

test('every action, given nonsense, refuses it without a server error', async ({ request }) => {
  test.setTimeout(10 * 60_000)
  const admin = api(request, tokenOf())
  const bad = []
  for (const name of Object.keys(ACTIONS).filter(n => !BULK.has(n))) {
    for (const args of GARBAGE) {
      const r = await admin.call('POST', `/erp/actions/${name}`, { args, small: true })
      if (r.status >= 500) bad.push(`${r.status} ${name}(${JSON.stringify(args).slice(0, 80)}): ${JSON.stringify(r.body).slice(0, 120)}`)
    }
  }
  expect((await api(request).call('GET', '/health')).status, 'the server is still up').toBe(200)
  expect(bad).toEqual([])
})

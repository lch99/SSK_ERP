import { LISTS } from '../../shared/lists.js'
import { test, expect, NASTY, tokenOf, api } from './fixtures.js'

// Every list the ERP reads, on the real data: each sort both ways, each filter with a value that makes no
// sense, odd paging and search, as the Superadmin and as an agent. A refusal (4xx) is fine; a server error is not.
test.skip(!process.env.E2E_URL, 'needs a server: E2E_URL')

const JUNK = ['abc', '-1', '99999999999999999999', '', NASTY, '2026-13-45', '1,2,x,,', 'null', '[]', '{"a":1}']
const lists = Object.keys(LISTS)

for (const who of ['superadmin', 'agent']) {
  for (const name of lists) {
    test(`${name}: every sort, filter and page, as ${who}`, async ({ request }) => {
      const as = api(request, tokenOf(who === 'agent' ? 'e2e/.auth/agent.json' : undefined))
      const spec = LISTS[name]
      const bad = []
      const tryOne = async query => {
        const r = await as.call('GET', `/erp/${name}?${query}`)
        if (r.status >= 500) bad.push(`${r.status} ${query.slice(0, 120)}`)
        return r
      }
      const first = await tryOne('counts=0&size=5')
      if (first.status === 403) return   // a list closed to this role: refused, as it should be
      for (const s of Object.keys(spec.sorts || {})) for (const dir of ['', '-']) await tryOne(`sort=${dir}${s}&counts=0&size=5`)
      await tryOne('sort=;drop table x&counts=0&size=5')
      for (const f of Object.keys(spec.filters || {})) {
        for (const v of JUNK) await tryOne(`${encodeURIComponent(f)}=${encodeURIComponent(v)}&counts=0&size=5`)
      }
      for (const q of ['page=-5&size=5', 'page=999999&size=5', 'size=0', 'size=-1', 'size=100000', `q=${encodeURIComponent(NASTY)}`, 'q=%25%25%25', 'counts=everything']) await tryOne(q)
      expect(bad, `server errors on ${name}`).toEqual([])
    })
  }
}

import { useEffect, useState } from 'react'
import { DEMO, getListPage } from '../api.js'
import { LISTS, listPage, recordsOf } from '../../shared/lists.js'
import { useErp } from './ErpContext.jsx'
import { useAccess } from './access.jsx'

// One list a page at a time, as shared/lists.js describes it: from the server
// (/api/erp/<list>), or in the demo from the records in this browser, run the
// same way. `params` are the page's search (q), filters and sort; more() adds
// the next page. Rows carry their extras as `$` (an E-Form's cleared cash…).
// Reads again when the records change (after an action) or the top bar's branch does.
export function useList(key, params, { pageSize = 20 } = {}) {
  const erp = useErp()
  const access = useAccess()
  const spec = LISTS[key]
  // The top bar's branch, for someone who sees every branch (the demo's records are limited to it already).
  const branch = !DEMO && (access?.scope || 'all') === 'all' && erp.branchId != null && spec.filters?.branchId ? { branchId: erp.branchId } : {}
  const typed = useDebounced(params.q || '', DEMO ? 0 : 250)
  const wanted = { ...params, q: typed, ...branch }
  const sig = JSON.stringify(wanted)
  const [more, setMore] = useState({ sig, pages: 1 })
  const pages = more.sig === sig ? more.pages : 1
  const [out, setOut] = useState({ rows: [], total: 0, counts: {}, loading: true, error: null })

  useEffect(() => {
    if (!erp.m) return undefined
    let live = true
    const one = page => (DEMO
      ? Promise.resolve(listPage(recordsOf(erp.scoped, key), spec, { ...wanted, page, size: pageSize }, { data: erp.m.data, today: erp.m.today, setup: erp.setup }))
      : getListPage(key, { ...wanted, page, size: pageSize }))
    setOut(o => ({ ...o, loading: true }))
    Promise.all(Array.from({ length: pages }, (_, i) => one(i + 1))).then(
      got => { if (live) setOut({ rows: got.flatMap(g => g.rows), total: got[0].total, counts: got[0].counts, loading: false, error: null }) },
      e => { if (live) setOut(o => ({ ...o, loading: false, error: e.message })) })
    return () => { live = false }
  }, [sig, pages, pageSize, erp.m, erp.scoped]) // eslint-disable-line react-hooks/exhaustive-deps

  return { ...out, more: () => setMore({ sig, pages: pages + 1 }) }
}

// `value`, once it has stopped changing for `ms` (typing in a search box).
function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    if (!ms) { setV(value); return undefined }
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return ms ? v : value
}

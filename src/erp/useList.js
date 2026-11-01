import { useEffect, useState } from 'react'
import { DEMO, getListPage } from '../api.js'
import { LISTS, MAX_SIZE, listPage, recordsOf } from '../../shared/lists.js'
import { useErp } from './ErpContext.jsx'
import { useAccess } from './access.jsx'

// One list a page at a time, as shared/lists.js describes it: from the server
// (/api/erp/<list>), or in the demo from the records in this browser, run the
// same way. `params` are the page's search (q), filters and sort; more() adds
// the next page (without its counts: the first page has them). Rows carry their
// extras as `$` (an E-Form's cleared cash…). After a change to the records (an
// action) it reads again, as many rows as were shown; also when the top bar's
// branch, or the person the Superadmin views the ERP as, changes.
export function useList(key, params, { pageSize = 20 } = {}) {
  const erp = useErp()
  const access = useAccess()
  const spec = LISTS[key]
  // The top bar's branch, for someone who sees every branch (the demo's records are limited to it already).
  const branch = !DEMO && (access?.scope || 'all') === 'all' && erp.branchId != null && spec.filters?.branchId ? { branchId: erp.branchId } : {}
  // "View the ERP as": the server limits the list to that role and person (the demo's records are limited already).
  const viewAs = !DEMO && access?.viewing ? { as: access.who.role, asStaff: access.who.staffId ?? '' } : {}
  const typed = useDebounced(params.q || '', DEMO ? 0 : 250)
  const wanted = { ...params, q: typed, ...branch, ...viewAs }
  const sig = JSON.stringify(wanted)
  const [out, setOut] = useState({ sig: null, rows: [], total: 0, counts: {}, loading: true, error: null })

  const load = (page, size, counts = true) => {
    const p = { ...wanted, page, size, ...(counts ? {} : { counts: '0' }) }
    return DEMO
      ? Promise.resolve(listPage(recordsOf(erp.scoped, key), spec, p, { data: erp.m.data, today: erp.m.today, setup: erp.setup }))
      : getListPage(key, p)
  }

  useEffect(() => {
    if (!erp.m) return undefined
    let live = true
    // The same list after a change to the records: read again as many rows as were shown.
    const shown = out.sig === sig ? Math.min(MAX_SIZE, Math.ceil(Math.max(out.rows.length, 1) / pageSize) * pageSize) : pageSize
    setOut(o => ({ ...o, loading: true }))
    load(1, shown).then(
      g => { if (live) setOut({ sig, rows: g.rows, total: g.total, counts: g.counts, loading: false, error: null }) },
      e => { if (live) setOut(o => ({ ...o, loading: false, error: e.message })) })
    return () => { live = false }
  }, [sig, pageSize, erp.m, erp.scoped]) // eslint-disable-line react-hooks/exhaustive-deps

  const more = () => {
    if (out.loading || out.rows.length >= out.total) return
    setOut(o => ({ ...o, loading: true }))
    load(Math.floor(out.rows.length / pageSize) + 1, pageSize, false).then(
      g => setOut(o => (o.sig !== sig ? o : { ...o, rows: [...o.rows, ...g.rows], total: g.total, loading: false })),
      e => setOut(o => ({ ...o, loading: false, error: e.message })))
  }

  return { rows: out.rows, total: out.total, counts: out.counts, loading: out.loading, error: out.error, more }
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

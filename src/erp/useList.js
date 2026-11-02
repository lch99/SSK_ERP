import { useCallback, useEffect, useState } from 'react'
import { DEMO, getListPage, getListRecord, downloadListFile, projectsOf } from '../api.js'
import { LISTS, MAX_SIZE, listPage, listAll, recordsOf, downloadRows } from '../../shared/lists.js'
import { makeXlsx, XLSX_TYPE } from '../../shared/xlsx.js'
import { download } from '../setup/sheet.js'
import { useErp } from './ErpContext.jsx'
import { useAccess } from './access.jsx'

// What every read of a list adds to the page's own params, and where the demo
// finds the records. `branch: false` leaves the top bar's branch out (a check
// across everything the viewer may see, such as the same slip recorded twice);
// `branch: '<filter>'` gives it to that filter instead of branchId (the
// earner's branch on payout lines, where branchId is the E-Form's).
function source(erp, access, key, { branch = true } = {}) {
  const spec = LISTS[key]
  const all = (access?.scope || 'all') === 'all'
  const named = typeof branch === 'string'
  const filter = named ? branch : 'branchId'
  // The top bar's branch, for someone who sees every branch (the demo's records are limited to it already, except by a named filter).
  const extra = { ...((!DEMO || named) && branch && all && erp.branchId != null && spec.filters?.[filter] ? { [filter]: erp.branchId } : {}) }
  // "View the ERP as": the server limits the list to that role and person (the demo's records are limited already).
  if (!DEMO && access?.viewing) Object.assign(extra, { as: access.who.role, asStaff: access.who.staffId ?? '' })
  // The demo keeps projects in a store of their own (src/demo/projectsApi.js).
  const records = () => (key === 'projects' && DEMO ? projectsOf(erp.m.data, erp.setup) : recordsOf(branch === true || !all ? erp.scoped : erp.m.data, key))
  // Who is asking, for a list of each person's own (notifications), as the server works it out.
  const staffId = access?.who?.staffId ?? null
  const viewer = { key: staffId ?? 0, branchId: (staffId != null ? erp.m?.staff[staffId]?.branchId : null) ?? access?.who?.branchId ?? null }
  const ctx = { data: erp.m?.data, today: erp.m?.today, setup: erp.setup, viewer }
  return { spec, extra, records, ctx }
}

// One list a page at a time, as shared/lists.js describes it: from the server
// (/api/erp/<list>), or in the demo from the records in this browser, run the
// same way. `params` are the page's search (q), filters and sort; more() adds
// the next page (without its counts: the first page has them). Rows carry their
// extras as `$` (an E-Form's cleared cash…). After a change to the records (an
// action) it reads again, as many rows as were shown; also when the top bar's
// branch, or the person the Superadmin views the ERP as, changes. `branch:
// false` leaves the top bar's branch out (one E-Form's payments); `branch:
// '<filter>'` sends it to that filter. `skip`: no read (a part of the page the
// viewer's role doesn't see). `searching`:
// what was typed hasn't been asked yet (the server waits until typing stops).
export function useList(key, params, { pageSize = 20, branch = true, skip = false } = {}) {
  const erp = useErp()
  const access = useAccess()
  const { spec, extra, records, ctx } = source(erp, access, key, { branch })
  const typed = useDebounced(params.q || '', DEMO ? 0 : 250)
  const wanted = { ...params, q: typed, ...extra }
  const sig = JSON.stringify(wanted)
  const [out, setOut] = useState({ sig: null, rows: [], total: 0, counts: {}, loading: true, error: null })

  const load = (page, size, counts = true) => {
    const p = { ...wanted, page, size, ...(counts ? {} : { counts: '0' }) }
    return DEMO ? Promise.resolve(listPage(records(), spec, p, ctx)) : getListPage(key, p)
  }

  useEffect(() => {
    if (!erp.m || skip) return undefined
    let live = true
    // The same list after a change to the records: read again as many rows as were shown.
    const shown = out.sig === sig ? Math.min(MAX_SIZE, Math.ceil(Math.max(out.rows.length, 1) / pageSize) * pageSize) : pageSize
    setOut(o => ({ ...o, loading: true }))
    load(1, shown).then(
      g => { if (live) setOut({ sig, rows: g.rows, total: g.total, counts: g.counts, loading: false, error: null }) },
      e => { if (live) setOut(o => ({ ...o, loading: false, error: e.message })) })
    return () => { live = false }
  }, [sig, pageSize, erp.m, erp.scoped, skip]) // eslint-disable-line react-hooks/exhaustive-deps

  if (skip) return { rows: [], total: 0, counts: {}, loading: false, error: null, more: () => {}, searching: false }
  const more = () => {
    if (out.loading || out.rows.length >= out.total) return
    setOut(o => ({ ...o, loading: true }))
    load(Math.floor(out.rows.length / pageSize) + 1, pageSize, false).then(
      g => setOut(o => (o.sig !== sig ? o : { ...o, rows: [...o.rows, ...g.rows], total: g.total, loading: false })),
      e => setOut(o => ({ ...o, loading: false, error: e.message })))
  }

  return { rows: out.rows, total: out.total, counts: out.counts, loading: out.loading, error: out.error, more, searching: typed !== (params.q || '') }
}

// One record of a list with the list's extras (GET /api/erp/<list>/<id>):
// { record, loading }; record is null while it loads or when the viewer may not
// see it. Read again after a change to the records. The top bar's branch
// doesn't hide a record opened by its address.
export function useRecord(key, id) {
  const erp = useErp()
  const access = useAccess()
  const { spec, extra, records, ctx } = source(erp, access, key, { branch: false })
  const [out, setOut] = useState({ id: null, record: null, loading: false })
  useEffect(() => {
    if (!erp.m || id == null) return undefined
    let live = true
    setOut(o => ({ ...o, loading: true }))
    const read = DEMO
      ? Promise.resolve((rec => (rec ? listPage([rec], spec, { counts: '0' }, ctx).rows[0] : null))(records().find(r => r.id === id)))
      : getListRecord(key, id, extra).catch(e => (e.status === 404 ? null : Promise.reject(e)))
    read.then(record => { if (live) setOut({ id, record, loading: false }) }, () => { if (live) setOut({ id, record: null, loading: false }) })
    return () => { live = false }
  }, [key, id, erp.m, erp.scoped]) // eslint-disable-line react-hooks/exhaustive-deps
  return id == null ? { record: null, loading: false } : { record: out.id === id ? out.record : null, loading: out.id !== id || out.loading }
}

// A list read once, when it's needed (a check before saving, a picker's
// search): read(key, params, { branch }) → { rows, total, counts }.
export function useListReader() {
  const erp = useErp()
  const access = useAccess()
  return useCallback((key, params, opts) => {
    const { spec, extra, records, ctx } = source(erp, access, key, opts)
    const p = { ...params, ...extra }
    return DEMO ? Promise.resolve(listPage(records(), spec, p, ctx)) : getListPage(key, p)
  }, [erp, access])
}

// Download every row of a list that matches `params` as Excel: built by the
// server from the same filters, or in the demo from the records here.
export function useListDownload(key) {
  const erp = useErp()
  const access = useAccess()
  return useCallback(async params => {
    const { spec, extra, records, ctx } = source(erp, access, key)
    if (!DEMO) {
      const { bytes, filename } = await downloadListFile(key, { ...params, ...extra })
      return download(bytes, filename, XLSX_TYPE)
    }
    const d = spec.download
    const { rows } = listAll(records(), spec, params, ctx)
    download(makeXlsx([{ name: d.sheet, rows: downloadRows(spec, rows), widths: d.widths }]), `${d.file}-${erp.m.today}.xlsx`, XLSX_TYPE)
  }, [erp, access, key])
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

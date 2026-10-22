import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as api from '../api.js'
import { visibleData } from '../../shared/access.js'
import { buildModel, inBranch } from './model.js'
import { useAccess } from './access.jsx'

// The ERP records for every page: the model (lookups and totals), the slice
// the viewer may see (their role's reach, then the chosen branch), and the
// actions, each refused when the viewer's role may not run it. Reloads when
// `reloadKey` changes (the shell changes it on leaving Setup, so the ERP
// follows new rules).
const Ctx = createContext(null)
export const useErp = () => useContext(Ctx)

const BRANCH_KEY = 'ssk-erp-branch'

export function ErpProvider({ reloadKey, children }) {
  const [state, setState] = useState(null)      // { setup, data, blockers }
  const [error, setError] = useState(null)
  const [branchId, setBranch] = useState(() => {
    try { return Number(localStorage.getItem(BRANCH_KEY)) || null } catch { return null }
  })
  const load = useCallback(() => api.getErp().then(s => { setState(s); setError(null) }).catch(e => setError(e.message)), [])
  useEffect(() => { load() }, [load, reloadKey])

  const m = useMemo(() => (state?.data ? buildModel(state.data, state.setup) : null), [state])
  // A role that sees one branch, or one team, stays in the viewer's own branch.
  const access = useAccess()
  const scope = access?.scope || 'all'
  const who = access?.who
  const ownBranch = m && who ? (m.staff[who.staffId]?.branchId ?? who.branchId ?? null) : null
  const branch = scope !== 'all' ? ownBranch : m && branchId != null && m.branches[branchId] ? branchId : null
  const scoped = useMemo(() => (!m ? null : scope === 'all' ? inBranch(m, branch) : visibleData(m.data, who, scope)), [m, branch, scope, who])
  const refusal = access?.refusal

  const value = useMemo(() => {
    const act = (fn, name) => async (...args) => {
      const why = name && refusal ? refusal(name) : null
      if (why) throw new Error(why)
      const s = await fn(...args); setState(s); return s
    }
    return {
      m, scoped, setup: state?.setup, blockers: state?.blockers || [], loading: !state && !error, error,
      branchId: branch,
      setBranchId: id => {
        setBranch(id)
        try { id ? localStorage.setItem(BRANCH_KEY, String(id)) : localStorage.removeItem(BRANCH_KEY) } catch { /* not kept */ }
      },
      reload: load,
      reset: act(api.resetErp),
      ...Object.fromEntries(['approvePayouts', 'queryPayouts', 'archiveCases', 'verifyLandlord', 'createRequests', 'setRequestStatus', 'closeDeal',
        'setMoneyInStatus', 'addTransaction', 'setMoneyOutStatus', 'addCustomer', 'updateCustomer', 'addListing', 'addStaff', 'setStaffStatus',
        'setVendorRequest', 'updateEnquiry', 'raiseRequest',
        'addDeal', 'updateDeal', 'deleteDeal', 'setDealDoc', 'requestInvoice', 'rerunClose', 'deleteClose', 'unarchive',
        'updateTransaction', 'deleteTransaction', 'updateMoneyOut', 'deleteMoneyOut', 'deleteSalaryRequest',
        'updateListing', 'addListingFollowUp', 'deleteListing', 'saveTitle', 'setTitleStatus', 'deleteTitle', 'saveArea', 'setAreaStatus', 'deleteArea',
        'addCustomerFollowUp', 'updateStaff', 'setMarketingStaffs', 'deleteStaff', 'saveVideo', 'deleteVideo', 'addPropertyType', 'deletePropertyType',
      ].map(k => [k, act(api[k], k)])),
    }
  }, [m, scoped, state, error, branch, load, refusal])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// The address after '#/', split on '/': ['deals', '42'].
export function useRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean)
  const [parts, setParts] = useState(read)
  useEffect(() => {
    const on = () => setParts(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return parts
}

export function useMedia(query) {
  const [on, setOn] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const f = () => setOn(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [query])
  return on
}

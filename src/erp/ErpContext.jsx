import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as api from '../api.js'
import { buildModel, inBranch } from './model.js'

// The ERP records for every page: the model (lookups and totals), the slice
// for the chosen branch, and the actions. Reloads when `reloadKey` changes
// (the shell changes it on leaving Setup, so the ERP follows new rules).
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
  const branch = m && branchId != null && m.branches[branchId] ? branchId : null
  const scoped = useMemo(() => (m ? inBranch(m, branch) : null), [m, branch])

  const value = useMemo(() => {
    const act = fn => async (...args) => { const s = await fn(...args); setState(s); return s }
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
        'setVendorRequest', 'updateEnquiry', 'raiseRequest'].map(k => [k, act(api[k])])),
    }
  }, [m, scoped, state, error, branch, load])

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

import { createContext, useContext } from 'react'
import { useErp } from './ErpContext.jsx'
import { useCan } from './access.jsx'
import { useList } from './useList.js'

// What waits on someone: the menu's badges, Home's "Waiting for you" and the
// commission flow's six steps. A few counts the server adds up (shared/lists.js),
// read once for every page of the shell and again after each change; a part the
// viewer's role doesn't see is not read (and counts 0).
const Waiting = createContext(null)

const useCounts = (key, names, skip) => useList(key, { counts: names }, { pageSize: 1, skip }).counts

export function WaitingProvider({ children }) {
  const erp = useErp()
  const can = useCan()
  const off = area => !erp.m || ![].concat(area).some(a => can(a, 'view'))
  const deals = useCounts('deals', 'status,readyToClose', off('deals'))
  const moneyIn = useCounts('moneyIn', 'toCheck', off('moneyIn'))
  const payouts = useCounts('payouts', 'waiting,readyToRequest,salaryToRequest', off(['payouts', 'salary']))
  const requests = useCounts('requests', 'status', off('salary'))
  const moneyOut = useCounts('moneyOut', 'toApprove', off('moneyOut'))
  const vendor = useCounts('vendorRequests', 'status', off('listings'))
  const viewings = useCounts('viewings', 'status', off('listings'))
  const value = {
    drafts: deals.status?.draft || 0, toClose: deals.readyToClose?.n || 0,
    moneyIn: moneyIn.toCheck?.n || 0,
    lines: payouts.waiting?.n || 0, closes: payouts.waiting?.distinct || 0,
    people: payouts.readyToRequest?.distinct || 0, salaryReady: payouts.salaryToRequest?.n || 0,
    newRequests: requests.status?.new || 0, toPay: (requests.status?.new || 0) + (requests.status?.ready || 0),
    moneyOut: moneyOut.toApprove?.n || 0, vendor: vendor.status?.['0'] || 0,
    viewings: (viewings.status?.new || 0) + (viewings.status?.rescheduled || 0),
  }
  return <Waiting.Provider value={value}>{children}</Waiting.Provider>
}

export const useWaiting = () => useContext(Waiting) || {}

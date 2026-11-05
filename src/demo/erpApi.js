// Browser-only stand-in for the ERP API while the app runs as a demo. The
// records are made up from the saved Setup (erpSample.js) and kept in this
// browser's localStorage, so actions taken in the demo stick. Changing Setup
// rebuilds them, so the ERP always pays by the current rules. What each action
// checks and changes is shared/erpActions.js, which the server runs too.
import { setupView } from './localApi.js'
import * as A from '../../shared/erpActions.js'
import { noticeExpired } from '../../shared/listings.js'
import { makeErpSample, setupSignature, erpBlockers, localToday, ERP_VERSION } from './erpSample.js'

const KEY = 'ssk-demo-erp-v1'
let memory = null

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* fall back to memory */ }
  return memory
}
function store(data) {
  memory = data
  try { localStorage.setItem(KEY, JSON.stringify(data)) } catch { /* memory only */ }
}

// { setup, data, blockers }: data is null until Setup has what the ERP needs.
function current({ rebuild = false } = {}) {
  const setup = setupView()
  const blockers = erpBlockers(setup)
  if (blockers.length) return { setup, data: null, blockers }
  let data = load()
  if (rebuild || !data || data.version !== ERP_VERSION || data.sig !== setupSignature(setup)) {
    data = makeErpSample(setup)
    store(data)
  }
  if (A.runClock(data, setup)) store(data)
  return { setup, data, blockers }
}

const reply = v => Promise.resolve(structuredClone(v))
const fail = msg => Promise.reject(Object.assign(new Error(msg), { status: 400, errors: [msg] }))

export const getErp = () => reply(current())
export const resetErp = () => reply(current({ rebuild: true }))

// Apply an action's change to the stored records and send everything back.
function change(fn) {
  const state = current()
  if (!state.data) return fail(state.blockers[0])
  const err = fn(state.data, state.setup, localToday())
  if (err) return fail(err)
  // Expired notifications go (noticeExpired, as the server does once a day), and this
  // browser keeps the latest 1,500 of the rest (it has little room).
  if (state.data.notices) {
    const today = localToday()
    state.data.notices = state.data.notices.filter(n => !noticeExpired(n, today))
    if (state.data.notices.length > 1500) state.data.notices.length = 1500
  }
  store(state.data)
  return reply(state)
}

export const validPhone = A.validPhone
export const approvePayouts = (...args) => change(A.approvePayouts(...args))
export const queryPayouts = (...args) => change(A.queryPayouts(...args))
export const archiveCases = (...args) => change(A.archiveCases(...args))
export const verifyLandlord = (...args) => change(A.verifyLandlord(...args))
export const createRequests = (...args) => change(A.createRequests(...args))
export const claimPay = (...args) => change(A.claimPay(...args))
export const stackPay = (...args) => change(A.stackPay(...args))
export const setRequestStatus = (...args) => change(A.setRequestStatus(...args))
export const setMoneyInStatus = (...args) => change(A.setMoneyInStatus(...args))
export const addTransaction = (...args) => change(A.addTransaction(...args))
export const setMoneyOutStatus = (...args) => change(A.setMoneyOutStatus(...args))
export const closeDeal = (...args) => change(A.closeDeal(...args))
export const addCustomer = (...args) => change(A.addCustomer(...args))
export const updateCustomer = (...args) => change(A.updateCustomer(...args))
export const addListing = (...args) => change(A.addListing(...args))
export const addStaff = (...args) => change(A.addStaff(...args))
export const setStaffStatus = (...args) => change(A.setStaffStatus(...args))
export const setVendorRequest = (...args) => change(A.setVendorRequest(...args))
export const updateEnquiry = (...args) => change(A.updateEnquiry(...args))
export const raiseRequest = (...args) => change(A.raiseRequest(...args))
export const addDeal = (...args) => change(A.addDeal(...args))
export const updateDeal = (...args) => change(A.updateDeal(...args))
export const deleteDeal = (...args) => change(A.deleteDeal(...args))
export const setDealDoc = (...args) => change(A.setDealDoc(...args))
export const requestInvoice = (...args) => change(A.requestInvoice(...args))
export const rerunClose = (...args) => change(A.rerunClose(...args))
export const deleteClose = (...args) => change(A.deleteClose(...args))
export const unarchive = (...args) => change(A.unarchive(...args))
export const updateTransaction = (...args) => change(A.updateTransaction(...args))
export const deleteTransaction = (...args) => change(A.deleteTransaction(...args))
export const updateMoneyOut = (...args) => change(A.updateMoneyOut(...args))
export const deleteMoneyOut = (...args) => change(A.deleteMoneyOut(...args))
export const deleteSalaryRequest = (...args) => change(A.deleteSalaryRequest(...args))
export const updateListing = (...args) => change(A.updateListing(...args))
export const addListingFollowUp = (...args) => change(A.addListingFollowUp(...args))
export const deleteListing = (...args) => change(A.deleteListing(...args))
export const saveTitle = (...args) => change(A.saveTitle(...args))
export const setTitleStatus = (...args) => change(A.setTitleStatus(...args))
export const deleteTitle = (...args) => change(A.deleteTitle(...args))
export const saveArea = (...args) => change(A.saveArea(...args))
export const setAreaStatus = (...args) => change(A.setAreaStatus(...args))
export const deleteArea = (...args) => change(A.deleteArea(...args))
export const addCustomerFollowUp = (...args) => change(A.addCustomerFollowUp(...args))
export const updateStaff = (...args) => change(A.updateStaff(...args))
export const setMarketingStaffs = (...args) => change(A.setMarketingStaffs(...args))
export const deleteStaff = (...args) => change(A.deleteStaff(...args))
export const saveVideo = (...args) => change(A.saveVideo(...args))
export const deleteVideo = (...args) => change(A.deleteVideo(...args))
export const addPropertyType = (...args) => change(A.addPropertyType(...args))
export const deletePropertyType = (...args) => change(A.deletePropertyType(...args))
export const bookViewing = (...args) => change(A.bookViewing(...args))
export const confirmViewing = (...args) => change(A.confirmViewing(...args))
export const rescheduleViewing = (...args) => change(A.rescheduleViewing(...args))
export const cancelViewing = (...args) => change(A.cancelViewing(...args))
export const reviewViewing = (...args) => change(A.reviewViewing(...args))
export const addViewingRemark = (...args) => change(A.addViewingRemark(...args))
export const toggleFavourite = (...args) => change(A.toggleFavourite(...args))
export const readNotices = (...args) => change(A.readNotices(...args))
export const sendNotice = (...args) => change(A.sendNotice(...args))
export const revealOwner = (...args) => change(A.revealOwner(...args))
export const recheckHandlers = (...args) => change(A.recheckHandlers(...args))
export const recheckBuildingLeads = (...args) => change(A.recheckBuildingLeads(...args))
export const markOutdated = (...args) => change(A.markOutdated(...args))
export const returnListings = (...args) => change(A.returnListings(...args))
export const scheduleDowntime = (...args) => change(A.scheduleDowntime(...args))
export const cancelDowntime = (...args) => change(A.cancelDowntime(...args))
export const endDowntime = (...args) => change(A.endDowntime(...args))

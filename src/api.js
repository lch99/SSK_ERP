// Every API call lives here.
import * as local from './demo/localApi.js'
import * as erp from './demo/erpApi.js'
import * as profile from './demo/profileApi.js'
import * as access from './demo/accessApi.js'
import { tidyProfile } from '../shared/profile.js'
import { defaultPolicy } from '../shared/access.js'

// Demo mode (the default for now): no server or database — Setup runs in the
// browser and saves to localStorage. Set VITE_USE_SERVER=true to use the API.
export const DEMO = import.meta.env.VITE_USE_SERVER !== 'true'
const DEMO_USER = { id: null, username: 'demo', name: 'Demo', role: 'superadmin', branchId: null }

const TOKEN_KEY = 'ssk-token'

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}
export function setToken(token) {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY) } catch { /* private mode */ }
}

// Fired when the server says the session is no longer valid; App shows sign-in.
export const SIGNED_OUT_EVENT = 'ssk:signed-out'

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let res
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw Object.assign(new Error('Cannot reach the server. Is the backend running?'), { status: 0, errors: ['Cannot reach the server. Is the backend running?'] })
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && token) {
      setToken('')
      window.dispatchEvent(new CustomEvent(SIGNED_OUT_EVENT, { detail: data.error }))
    }
    const msg = data.error || `Request failed (${res.status})`
    throw Object.assign(new Error(msg), { status: res.status, errors: data.errors || [msg] })
  }
  return data
}

// Auth
export const authStatus = () => (DEMO ? Promise.resolve({ authDisabled: true, needsFirstUser: false }) : request('/auth/status'))
export const getMe = () => (DEMO ? Promise.resolve({ user: DEMO_USER }) : request('/auth/me'))
export async function login(username, password) {
  const data = await request('/auth/login', { method: 'POST', body: { username, password } })
  setToken(data.token)
  return data.user
}
export async function createFirstUser(body) {
  const data = await request('/auth/first-user', { method: 'POST', body })
  setToken(data.token)
  return data.user
}
export async function changePassword(current, password) {
  const data = await request('/auth/password', { method: 'POST', body: { current, password } })
  setToken(data.token)
  return data.user
}
export const signOut = () => setToken('')

// My profile (avatar menu). The demo keeps it in this browser; the server has
// no /auth/profile route yet, so there only the name (from /auth/me) shows.
// PROFILE_EVENT fires after a save, so the top bar picks up a new name or photo.
export const PROFILE_EVENT = 'ssk:profile'
const profileSaved = p => { window.dispatchEvent(new Event(PROFILE_EVENT)); return p }
export const getMyProfile = () => (DEMO ? profile.getProfile() : request('/auth/me').then(r => ({ ...tidyProfile(r.user), hasPassword: true })))
export const saveMyProfile = body => (DEMO ? profile.saveProfile(body) : request('/auth/profile', { method: 'PUT', body })).then(profileSaved)
export const changeMyPassword = (current, password) => (DEMO ? profile.changePassword(current, password) : changePassword(current, password)).then(profileSaved)

// Roles & access (what each role may do). The demo keeps it in this browser;
// the server has no /access route yet, so there the recommended policy applies.
export const getAccess = () => (DEMO ? access.getAccess() : Promise.resolve({ policy: defaultPolicy() }))
export const saveAccessPolicy = policy => (DEMO ? access.savePolicy(policy) : request('/access', { method: 'PUT', body: { policy } }))

// Setup
export const getSetup = () => (DEMO ? local.getSetup() : request('/setup'))
// `step` may be a list of [step, body] pairs (one wizard page). The demo saves
// them all or nothing; the server takes them one by one.
export async function saveSetup(step, body) {
  if (DEMO) return local.saveSetup(step, body)
  let out
  for (const [k, b] of Array.isArray(step) ? step : [[step, body]]) out = await request(`/setup/${k}`, { method: 'PUT', body: b })
  return out
}
export const getBranches = () => (DEMO ? local.getBranches() : request('/branches'))
export const loadSampleSetup = () => local.loadSample()
export const startBlankSetup = () => local.startBlank()

// Users
export const listUsers = () => request('/users')
export const createUser = body => request('/users', { method: 'POST', body })
export const updateUser = (id, body) => request(`/users/${id}`, { method: 'PUT', body })
export const resetUserPassword = (id, password) => request(`/users/${id}/password`, { method: 'POST', body: { password } })
export const unlockUser = id => request(`/users/${id}/unlock`, { method: 'POST' })

// ERP records. Demo only for now: they are made up from the saved Setup and
// kept in this browser (src/demo/erpApi.js); the server has no ERP API yet.
export const getErp = () => erp.getErp()
export const resetErp = () => erp.resetErp()
export const approvePayouts = ids => erp.approvePayouts(ids)
export const queryPayouts = (ids, reason) => erp.queryPayouts(ids, reason)
export const archiveCases = () => erp.archiveCases()
export const verifyLandlord = (dealId, status, remarks) => erp.verifyLandlord(dealId, status, remarks)
export const createRequests = (staffIds, kind) => erp.createRequests(staffIds, kind)
export const setRequestStatus = (id, status, remark) => erp.setRequestStatus(id, status, remark)
export const claimPay = (staffId, lineIds) => erp.claimPay(staffId, lineIds)
export const stackPay = (staffId, lineIds) => erp.stackPay(staffId, lineIds)
export const closeDeal = id => erp.closeDeal(id)
export const setMoneyInStatus = (id, status, reason) => erp.setMoneyInStatus(id, status, reason)
export const addTransaction = body => erp.addTransaction(body)
export const setMoneyOutStatus = (id, status, query) => erp.setMoneyOutStatus(id, status, query)
export const addCustomer = body => erp.addCustomer(body)
export const updateCustomer = (id, fields) => erp.updateCustomer(id, fields)
export const addListing = body => erp.addListing(body)
export const addStaff = body => erp.addStaff(body)
export const setStaffStatus = (id, status) => erp.setStaffStatus(id, status)
export const setVendorRequest = (id, status, listingId) => erp.setVendorRequest(id, status, listingId)
export const updateEnquiry = (id, fields) => erp.updateEnquiry(id, fields)
export const raiseRequest = (dealId, type, body) => erp.raiseRequest(dealId, type, body)
export const addDeal = body => erp.addDeal(body)
export const updateDeal = (id, body) => erp.updateDeal(id, body)
export const deleteDeal = id => erp.deleteDeal(id)
export const setDealDoc = (id, name, fileName) => erp.setDealDoc(id, name, fileName)
export const requestInvoice = id => erp.requestInvoice(id)
export const rerunClose = closeId => erp.rerunClose(closeId)
export const deleteClose = closeId => erp.deleteClose(closeId)
export const unarchive = archiveId => erp.unarchive(archiveId)
export const updateTransaction = (id, body) => erp.updateTransaction(id, body)
export const deleteTransaction = id => erp.deleteTransaction(id)
export const updateMoneyOut = (id, body) => erp.updateMoneyOut(id, body)
export const deleteMoneyOut = id => erp.deleteMoneyOut(id)
export const deleteSalaryRequest = id => erp.deleteSalaryRequest(id)
export const updateListing = (id, fields) => erp.updateListing(id, fields)
export const addListingFollowUp = (id, body) => erp.addListingFollowUp(id, body)
export const deleteListing = id => erp.deleteListing(id)
export const saveTitle = body => erp.saveTitle(body)
export const setTitleStatus = (ids, status) => erp.setTitleStatus(ids, status)
export const deleteTitle = (id, replacementId) => erp.deleteTitle(id, replacementId)
export const saveArea = body => erp.saveArea(body)
export const setAreaStatus = (id, status) => erp.setAreaStatus(id, status)
export const deleteArea = id => erp.deleteArea(id)
export const addCustomerFollowUp = (id, body) => erp.addCustomerFollowUp(id, body)
export const updateStaff = (id, fields) => erp.updateStaff(id, fields)
export const setMarketingStaffs = (id, list) => erp.setMarketingStaffs(id, list)
export const deleteStaff = id => erp.deleteStaff(id)
export const saveVideo = body => erp.saveVideo(body)
export const deleteVideo = id => erp.deleteVideo(id)
export const addPropertyType = name => erp.addPropertyType(name)
export const deletePropertyType = id => erp.deletePropertyType(id)
// Listing life: viewings, favourites, notifications, owner details and the handler checks (demo store; not on the server yet).
export const bookViewing = body => erp.bookViewing(body)
export const confirmViewing = (id, by) => erp.confirmViewing(id, by)
export const rescheduleViewing = (id, body) => erp.rescheduleViewing(id, body)
export const cancelViewing = (id, reason, by) => erp.cancelViewing(id, reason, by)
export const reviewViewing = (id, body) => erp.reviewViewing(id, body)
export const addViewingRemark = (id, text, by) => erp.addViewingRemark(id, text, by)
export const toggleFavourite = (kind, id, by) => erp.toggleFavourite(kind, id, by)
export const readNotices = (ids, by) => erp.readNotices(ids, by)
export const sendNotice = body => erp.sendNotice(body)
export const revealOwner = (listingId, by) => erp.revealOwner(listingId, by)
export const recheckHandlers = () => erp.recheckHandlers()
export const recheckBuildingLeads = () => erp.recheckBuildingLeads()
export const markOutdated = () => erp.markOutdated()
export const returnListings = staffId => erp.returnListings(staffId)

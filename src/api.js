// Every API call lives here.
import * as local from './demo/localApi.js'
import * as erp from './demo/erpApi.js'
import * as profile from './demo/profileApi.js'
import * as access from './demo/accessApi.js'
import { tidyProfile } from '../shared/profile.js'

// Demo mode (the default for now): no server or database — Setup runs in the
// browser and saves to localStorage. Set VITE_USE_SERVER=true to use the API.
export const DEMO = import.meta.env.VITE_USE_SERVER !== 'true'
const DEMO_USER = { id: null, username: 'demo', name: 'Demo', role: 'superadmin', branchId: null }

const TOKEN_KEY = 'ssk-token'
// Where the API is. Blank (the default): the same site, under /api (Vite's
// proxy in development, or a reverse proxy in front of both). Set VITE_API_URL
// (e.g. https://api.subsaleking.com) when the API runs on its own server; the
// API then needs this site in its CORS_ORIGIN.
const API_URL = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

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
    res = await fetch(`${API_URL}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
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

// Roles & access (what each role may do). The demo keeps it in this browser.
export const getAccess = () => (DEMO ? access.getAccess() : request('/access'))
export const saveAccessPolicy = policy => (DEMO ? access.savePolicy(policy) : request('/access', { method: 'PUT', body: { policy } }))

// Setup
export const getSetup = () => (DEMO ? local.getSetup() : request('/setup'))
// `step` may be a list of [step, body] pairs (one wizard page), saved all or nothing.
export function saveSetup(step, body) {
  if (DEMO) return local.saveSetup(step, body)
  return Array.isArray(step)
    ? request('/setup/steps', { method: 'POST', body: { steps: step } })
    : request(`/setup/${step}`, { method: 'PUT', body })
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

// ERP records. The demo makes them up from the saved Setup and keeps them in
// this browser (src/demo/erpApi.js); the server reads them from its tables and
// runs the same actions on them (backend/src/db/erpState.js).
export const getErp = () => (DEMO ? erp.getErp() : request('/erp/state'))
export const resetErp = () => (DEMO ? erp.resetErp() : Promise.reject(new Error('The sample records can only be reset in the demo.')))
const act = name => (...args) => (DEMO ? erp[name](...args) : request(`/erp/actions/${name}`, { method: 'POST', body: { args } }))
export const approvePayouts = act('approvePayouts')
export const queryPayouts = act('queryPayouts')
export const archiveCases = act('archiveCases')
export const verifyLandlord = act('verifyLandlord')
export const createRequests = act('createRequests')
export const setRequestStatus = act('setRequestStatus')
export const claimPay = act('claimPay')
export const stackPay = act('stackPay')
export const closeDeal = act('closeDeal')
export const setMoneyInStatus = act('setMoneyInStatus')
export const addTransaction = act('addTransaction')
export const setMoneyOutStatus = act('setMoneyOutStatus')
export const addCustomer = act('addCustomer')
export const updateCustomer = act('updateCustomer')
export const addListing = act('addListing')
export const addStaff = act('addStaff')
export const setStaffStatus = act('setStaffStatus')
export const setVendorRequest = act('setVendorRequest')
export const updateEnquiry = act('updateEnquiry')
export const raiseRequest = act('raiseRequest')
export const addDeal = act('addDeal')
export const updateDeal = act('updateDeal')
export const deleteDeal = act('deleteDeal')
export const setDealDoc = act('setDealDoc')
export const requestInvoice = act('requestInvoice')
export const rerunClose = act('rerunClose')
export const deleteClose = act('deleteClose')
export const unarchive = act('unarchive')
export const updateTransaction = act('updateTransaction')
export const deleteTransaction = act('deleteTransaction')
export const updateMoneyOut = act('updateMoneyOut')
export const deleteMoneyOut = act('deleteMoneyOut')
export const deleteSalaryRequest = act('deleteSalaryRequest')
export const updateListing = act('updateListing')
export const addListingFollowUp = act('addListingFollowUp')
export const deleteListing = act('deleteListing')
export const saveTitle = act('saveTitle')
export const setTitleStatus = act('setTitleStatus')
export const deleteTitle = act('deleteTitle')
export const saveArea = act('saveArea')
export const setAreaStatus = act('setAreaStatus')
export const deleteArea = act('deleteArea')
export const addCustomerFollowUp = act('addCustomerFollowUp')
export const updateStaff = act('updateStaff')
export const setMarketingStaffs = act('setMarketingStaffs')
export const deleteStaff = act('deleteStaff')
export const saveVideo = act('saveVideo')
export const deleteVideo = act('deleteVideo')
export const addPropertyType = act('addPropertyType')
export const deletePropertyType = act('deletePropertyType')
// Listing life: viewings, favourites, notifications, owner details and the handler checks.
export const bookViewing = act('bookViewing')
export const confirmViewing = act('confirmViewing')
export const rescheduleViewing = act('rescheduleViewing')
export const cancelViewing = act('cancelViewing')
export const reviewViewing = act('reviewViewing')
export const addViewingRemark = act('addViewingRemark')
export const toggleFavourite = act('toggleFavourite')
export const readNotices = act('readNotices')
export const sendNotice = act('sendNotice')
export const revealOwner = act('revealOwner')
export const recheckHandlers = act('recheckHandlers')
export const recheckBuildingLeads = act('recheckBuildingLeads')
export const markOutdated = act('markOutdated')
export const returnListings = act('returnListings')
// Planned downtime (System → Technical).
export const scheduleDowntime = act('scheduleDowntime')
export const cancelDowntime = act('cancelDowntime')
export const endDowntime = act('endDowntime')

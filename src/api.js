// Every API call lives here.
import * as local from './demo/localApi.js'
import * as erp from './demo/erpApi.js'

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
export const closeDeal = id => erp.closeDeal(id)
export const setMoneyInStatus = (id, status, reason) => erp.setMoneyInStatus(id, status, reason)
export const addTransaction = body => erp.addTransaction(body)
export const setMoneyOutStatus = (id, status, query) => erp.setMoneyOutStatus(id, status, query)
export const addCustomer = body => erp.addCustomer(body)
export const updateCustomer = (id, fields) => erp.updateCustomer(id, fields)
export const addListing = body => erp.addListing(body)
export const addStaff = body => erp.addStaff(body)
export const setStaffStatus = (id, status) => erp.setStaffStatus(id, status)
export const setVendorRequest = (id, status) => erp.setVendorRequest(id, status)
export const updateEnquiry = (id, fields) => erp.updateEnquiry(id, fields)
export const raiseRequest = (dealId, type, body) => erp.raiseRequest(dealId, type, body)

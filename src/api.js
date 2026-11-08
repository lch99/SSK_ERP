// Every API call lives here.
import * as local from './demo/localApi.js'
import * as erp from './demo/erpApi.js'
import * as profile from './demo/profileApi.js'
import * as access from './demo/accessApi.js'
import * as projects from './demo/projectsApi.js'
import { fileId } from '../shared/files.js'

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
// Fired when the server is closed for planned maintenance (503 with the window): the ERP reads
// its start-up records again, which carry the window, and shows "back soon".
export const DOWNTIME_EVENT = 'ssk:downtime'

// The API's reply to `path`, signed in; a refusal or an unreachable server is
// thrown as an Error with `status` and `errors` (a 401 also signs the page out).
async function send(path, { method = 'GET', body, file } = {}) {
  const headers = file ? { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } : { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let res
  try {
    res = await fetch(`${API_URL}/api${path}`, { method, headers, body: file || (body === undefined ? undefined : JSON.stringify(body)) })
  } catch {
    throw Object.assign(new Error('Cannot reach the server. Is the backend running?'), { status: 0, errors: ['Cannot reach the server. Is the backend running?'] })
  }
  if (res.ok) return res
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && token) {
    setToken('')
    window.dispatchEvent(new CustomEvent(SIGNED_OUT_EVENT, { detail: data.error }))
  }
  if (res.status === 503 && data.downtime) window.dispatchEvent(new CustomEvent(DOWNTIME_EVENT, { detail: data.downtime }))
  const msg = data.error || `Request failed (${res.status})`
  throw Object.assign(new Error(msg), { status: res.status, errors: data.errors || [msg] })
}
const request = async (path, opts) => (await send(path, opts)).json().catch(() => ({}))

// Uploads (shared/files.js UPLOADS kinds). On the server a picked file is sent at once and checked
// there too; the record then keeps its reference ('files/<id>/<name>'). The demo keeps no files:
// the record keeps the name, as before.
export const uploadFile = async (file, kind) => (DEMO ? file.name : (await request(`/files?kind=${kind}`, { method: 'POST', file })).ref)
// Opens a saved upload in a new tab (a link the server signs for a few minutes). The tab opens
// first, while the click still counts, so the browser doesn't block it.
export async function openFile(ref) {
  const id = fileId(ref)
  if (DEMO || id == null) return
  const tab = window.open('', '_blank')
  try {
    const { url } = await request(`/files/${id}/link`)
    if (tab) tab.location = `${API_URL}${url}`
    else window.location.assign(`${API_URL}${url}`)
  } catch (e) {
    tab?.close()
    throw e
  }
}
// A signed link to a saved upload's preview (listing photos, profile pictures), or null.
// Several previews in one read (a list page's photos): { [ref]: url | null }, at most 200 refs.
export async function previewLinks(refs) {
  const ids = [...new Set(refs.map(fileId).filter(id => id != null))]
  if (DEMO || !ids.length) return {}
  const { links } = await request(`/files/links?ids=${ids.join(',')}`)
  return Object.fromEntries(refs.map(ref => {
    const l = links[fileId(ref)]
    return [ref, l?.preview ? `${API_URL}${l.preview}` : null]
  }))
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

// Own accounts for everyone on the staff list (server only): a one-time link sets the password.
export const linkInfo = token => request(`/auth/link/${encodeURIComponent(token)}`)
export async function setPasswordByLink(token, password) {
  const data = await request(`/auth/link/${encodeURIComponent(token)}`, { method: 'POST', body: { password } })
  setToken(data.token)
  return data.user
}
export const forgotPassword = username => request('/auth/forgot', { method: 'POST', body: { username } })
export const accountOf = staffId => request(`/accounts/${staffId}`)
export const makeAccountLink = staffId => request(`/accounts/${staffId}/link`, { method: 'POST', body: {} })
// The address a set-password link opens: this ERP, at #/password.
export const passwordLink = token => `${window.location.origin}${window.location.pathname}#/password?t=${token}`
// Everyone's accounts and links as an Excel file (Superadmin).
export async function downloadAllLinks(branchId) {
  const res = await send('/accounts/links', { method: 'POST', body: { base: `${window.location.origin}${window.location.pathname}`, branchId: branchId || null } })
  const bytes = new Uint8Array(await res.arrayBuffer())
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'sign-in-links.xlsx'
  return { bytes, name, made: Number(res.headers.get('x-accounts-made') || 0), links: Number(res.headers.get('x-links') || 0) }
}

// My profile (avatar menu). The demo keeps it in this browser; the server keeps
// it with the sign-in account. PROFILE_EVENT fires after a save, so the top bar
// picks up a new name or photo.
export const PROFILE_EVENT = 'ssk:profile'
const profileSaved = p => { window.dispatchEvent(new Event(PROFILE_EVENT)); return p }
export const getMyProfile = () => (DEMO ? profile.getProfile() : request('/auth/profile'))
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
// The server sends only the start-up read (the staff directory, buildings…): pages read the rest a page at a time.
export const getErp = () => (DEMO ? erp.getErp() : request('/erp/start'))
export const resetErp = () => (DEMO ? erp.resetErp() : Promise.reject(new Error('The sample records can only be reset in the demo.')))
// One page of a list (shared/lists.js) from the server: { rows, total, counts, page, size }.
// Pages use useList (src/erp/useList.js), which runs the same list in the demo.
const listQuery = params => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)]))
export const getListPage = (list, params) => request(`/erp/${list}?${listQuery(params)}`)
// One record of a list, with the list's extras.
export const getListRecord = (list, id, params = {}) => request(`/erp/${list}/${id}?${listQuery(params)}`)
// The tier credit of an E-Form's agent and listing holder: { [staffId]: { lifetime, yearly } } (server only).
export const getDealCredit = id => request(`/erp/deals/${id}/credit`)
// Every E-Form's history in reach, a page at a time: { rows, total } (server mode; the demo reads its own records).
export const getDealsHistory = params => request(`/erp/deals/history?${listQuery(params)}`)
// Every row of a list that matches `params`, as the Excel file the server builds: { bytes, filename }.
export async function downloadListFile(list, params) {
  const res = await send(`/erp/${list}/download?${listQuery(params)}`)
  const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `${list}.xlsx`
  return { bytes: new Uint8Array(await res.arrayBuffer()), filename }
}
// An action's reply is the start-up read again (small), with the ids of what it made (`added`).
const act = name => (...args) => (DEMO ? erp[name](...args) : request(`/erp/actions/${name}`, { method: 'POST', body: { args, small: true } }))
// The id of the record an action just made: from `added` on the server, the newest in the demo's records.
export const madeId = (reply, kind) => reply.added?.[kind]?.[0] ?? Math.max(0, ...(reply.data?.[kind] || []).map(x => x.id))
// That record (or one it changed): from the reply when the reply holds it (the demo's has every record), else
// read from the server. read: useRecordReader(); list: the list to read it through.
export const fromReply = (reply, kind, id, read, list = kind) => Promise.resolve((reply.data?.[kind] || []).find(x => x.id === id) || read(list, id))
export const approvePayouts = act('approvePayouts')
export const queryPayouts = act('queryPayouts')
export const archiveCases = act('archiveCases')
export const verifyLandlord = act('verifyLandlord')
export const createRequests = act('createRequests')
export const setRequestStatus = act('setRequestStatus')
export const claimPay = act('claimPay')
export const stackPay = act('stackPay')
export const closeDeal = act('closeDeal')
export const payIncentive = act('payIncentive')
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

// Projects. The demo keeps them in this browser, made from the sample's project
// E-Forms (src/demo/projectsApi.js); the server keeps them with the other
// records. Like the other actions (through ErpContext), a save gives back the
// ERP's records, plus `result`: the project or incentive saved.
export const projectsOf = (data, setup) => (DEMO ? projects.getProjects(data, setup).projects : data?.projects || [])
const projectAct = (name, inBrowser) => (...args) => (DEMO
  ? Promise.resolve().then(() => inBrowser(...args)).then(result => erp.getErp().then(s => ({ ...s, result })))
  : request(`/erp/actions/${name}`, { method: 'POST', body: { args, small: true } }))
export const saveProject = projectAct('saveProject', projects.saveProject)
export const saveIncentive = projectAct('saveIncentive', projects.saveIncentive)
export const deleteIncentive = projectAct('deleteIncentive', projects.deleteIncentive)

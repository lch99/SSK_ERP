// Browser-only stand-in for the Setup API, used while the app runs as a demo
// (no server, no database). Data is kept in this browser's localStorage.
import { emptyState, sampleState, view, applySteps, SetupError } from '../../shared/setupState.js'

const KEY = 'ssk-demo-setup-v1'
let memory = null   // used when localStorage is unavailable (private mode)

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* fall back to memory */ }
  return memory || emptyState()
}

function write(state) {
  memory = state
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* memory only */ }
}

const reply = state => Promise.resolve(structuredClone(view(state)))

export const getSetup = () => reply(read())

// One step, or a list of [step, body] pairs saved together (all or nothing).
export function saveSetup(step, body) {
  try {
    const next = applySteps(read(), structuredClone(Array.isArray(step) ? step : [[step, body]]))
    write(next)
    return reply(next)
  } catch (e) {
    if (e instanceof SetupError) return Promise.reject(Object.assign(new Error(e.message), { status: 400, errors: e.errors }))
    return Promise.reject(e)
  }
}

export function loadSample() { write(sampleState()); return reply(read()) }
export function startBlank() { write(emptyState()); return reply(read()) }
export const getBranches = () => Promise.resolve({ branches: read().branches })
// The saved Setup as the page sees it (used to build the ERP sample records).
export const setupView = () => structuredClone(view(read()))

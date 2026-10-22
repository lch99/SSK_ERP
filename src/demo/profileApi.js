// Browser-only store for the signed-in person's own profile and password while
// the app runs as a demo. Sign-in is off, so this stands in for the account:
// details and password are kept in this browser only. Demo only: the real
// server keeps a bcrypt hash, never anything like this.
import { checkProfile, tidyProfile } from '../../shared/profile.js'
import { validatePassword } from '../../shared/roles.js'

const KEY = 'ssk-demo-profile-v1'
let memory = null

function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw) } catch { /* memory */ }
  return memory || {}
}
function store(v) {
  memory = v
  try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* memory only */ }
}

const fail = (msg, errors = [msg]) => Object.assign(new Error(msg), { errors })

// A quick string hash (cyrb53), so the demo never stores the password as typed.
function hash(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

// What the page sees: the details, and whether a password is set (never the password).
const view = p => ({ ...tidyProfile({ name: 'Demo user', ...p }), hasPassword: !!p.passwordHash, passwordChangedAt: p.passwordChangedAt || null, updatedAt: p.updatedAt || null })

export async function getProfile() {
  return view(load())
}

export async function saveProfile(fields) {
  const problems = Object.values(checkProfile(fields))
  if (problems.length) throw fail(problems[0], problems)
  const next = { ...load(), ...tidyProfile(fields), updatedAt: new Date().toISOString() }
  store(next)
  return view(next)
}

// The first password needs no current one: sign-in is off in the demo.
export async function changePassword(current, password) {
  const p = load()
  if (p.passwordHash && hash(`${p.salt}:${current}`) !== p.passwordHash) throw fail('The current password is wrong.')
  const problem = validatePassword(password)
  if (problem) throw fail(problem)
  if (p.passwordHash && current === password) throw fail('Pick a new password, not the current one.')
  const salt = Math.random().toString(36).slice(2, 10)
  const next = { ...p, salt, passwordHash: hash(`${salt}:${password}`), passwordChangedAt: new Date().toISOString() }
  store(next)
  return view(next)
}

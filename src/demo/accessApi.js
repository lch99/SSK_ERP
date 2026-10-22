// Roles & access in the demo: the policy (what each role may do), kept in this
// browser under its own key. Same rules as shared/access.js.
import { tidyPolicy } from '../../shared/access.js'

const KEY = 'ssk-erp-access'
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} } }

export async function getAccess() {
  return { policy: tidyPolicy(read().policy) }
}

export async function savePolicy(policy) {
  const tidy = tidyPolicy(policy)
  try { localStorage.setItem(KEY, JSON.stringify({ ...read(), policy: tidy })) } catch { throw new Error('This browser would not save the change.') }
  return { policy: tidy }
}

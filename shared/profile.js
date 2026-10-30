// The signed-in person's own details ("My profile"). The page checks them as
// they are typed, and the store (the server, later) runs the same check on save.

export const PROFILE_FIELDS = ['name', 'icName', 'email', 'phone', 'address', 'bank', 'bankHolder', 'bankAccount', 'photo']

// The photo is kept as a data: URL after the page cuts it to a small square.
export const PHOTO_MAX = 400 * 1024

// Only the known fields, with text trimmed.
export function tidyProfile(p = {}) {
  const out = {}
  for (const k of PROFILE_FIELDS) out[k] = typeof p[k] === 'string' ? (k === 'photo' ? p[k] : p[k].trim()) : ''
  return out
}

// { field: problem } for each field that is wrong; empty when all is well.
export function checkProfile(p = {}) {
  const t = tidyProfile(p)
  const e = {}
  if (!t.name) e.name = 'Enter the name to show in the ERP.'
  else if (t.name.length > 80) e.name = 'Keep the name under 80 characters.'
  if (t.icName.length > 120) e.icName = 'Keep the IC name under 120 characters.'
  if (t.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email)) e.email = 'This does not look like an e-mail address.'
  if (t.phone && !/^\+?\d[\d -]{6,18}$/.test(t.phone)) e.phone = 'Use digits, e.g. 012-345 6789.'
  if (t.address.length > 300) e.address = 'Keep the address under 300 characters.'
  if (t.bankAccount && !/^\d[\d -]{4,22}\d$/.test(t.bankAccount)) e.bankAccount = 'Digits only, 6 to 24 of them.'
  if (t.bankAccount && !t.bank) e.bank = 'Pick the bank for this account.'
  if (t.bankAccount && !t.bankHolder) e.bankHolder = 'Enter the name on this account.'
  else if (t.bankHolder.length > 120) e.bankHolder = 'Keep the name under 120 characters.'
  if (t.photo && !/^data:image\/(jpeg|png);base64,/.test(t.photo)) e.photo = 'The photo must be a JPG or PNG.'
  else if (t.photo.length > PHOTO_MAX) e.photo = 'The photo is too large.'
  return e
}

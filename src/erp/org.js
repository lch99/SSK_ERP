// The org chart's structure, worked out once so it stays quick for thousands
// of people: who is under whom, how big each team is, and the chain from a
// person up to the top of their branch. Pure functions (tested in org.test.js).

// people: [{ id, branchId, uplineId, role, short|name }]. `rank(person)` puts
// senior upline levels first among people under the same leader.
export function buildOrg(people, { rank = () => 0 } = {}) {
  const byId = new Map(people.map(p => [p.id, p]))
  const up = new Map()
  for (const p of people) up.set(p.id, p.uplineId != null && p.uplineId !== p.id && byId.has(p.uplineId) ? p.uplineId : null)

  // An upline chain that loops back on itself never reaches the top: the first
  // person found in the loop is put at the top of their branch instead.
  const settled = new Set()
  for (const p of people) {
    const path = []
    const onPath = new Set()
    let id = p.id
    while (id != null && !settled.has(id)) {
      if (onPath.has(id)) { up.set(id, null); break }
      onPath.add(id)
      path.push(id)
      id = up.get(id)
    }
    for (const x of path) settled.add(x)
  }

  const kids = new Map()
  const tops = new Map()
  for (const p of people) {
    const u = up.get(p.id)
    const into = u == null ? tops : kids
    const key = u == null ? p.branchId : u
    if (!into.has(key)) into.set(key, [])
    into.get(key).push(p)
  }

  // Team size: everyone below a person, at any depth (not counting them).
  const team = new Map()
  const order = []
  const stack = [...tops.values()].flat().map(p => p.id)
  while (stack.length) {
    const id = stack.pop()
    order.push(id)
    for (const k of kids.get(id) || []) stack.push(k.id)
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]
    team.set(id, (kids.get(id) || []).reduce((t, k) => t + 1 + team.get(k.id), 0))
  }

  const name = p => p.short || p.name || ''
  const sort = list => list.sort((a, b) => rank(b) - rank(a) || team.get(b.id) - team.get(a.id) || name(a).localeCompare(name(b)))
  for (const list of kids.values()) sort(list)
  for (const list of tops.values()) sort(list)

  return {
    byId,
    // The people directly under a person.
    under: id => kids.get(id) || [],
    // The people at the top of a branch (no upline, or one outside this list).
    top: branchId => tops.get(branchId) || [],
    team: id => team.get(id) || 0,
    upline: id => up.get(id) ?? null,
    // From the top of the branch down to the person's direct upline.
    chain(id) {
      const out = []
      for (let u = up.get(id); u != null; u = up.get(u)) out.unshift(byId.get(u))
      return out
    },
    // Is `id` the person `top` or somewhere below them?
    within(id, top) {
      for (let x = id; x != null; x = up.get(x)) if (x === top) return true
      return false
    },
  }
}

// People whose name, code or phone has every typed word, best matches first:
// a match on the name before one on the code or phone, names that start with
// the first word, then leaders, then bigger teams.
export function findPeople(people, q, org, limit = 8) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return { hits: [], more: 0 }
  const digits = q.replace(/\D/g, '')
  const all = people.filter(p => {
    const text = `${p.name || ''} ${p.short || ''} ${p.code || ''}`.toLowerCase()
    return words.every(w => text.includes(w)) || (digits.length >= 4 && String(p.phone || '').replace(/\D/g, '').includes(digits))
  })
  const named = p => (words.every(w => `${p.name || ''} ${p.short || ''}`.toLowerCase().includes(w)) ? 1 : 0)
  const starts = p => (String(p.short || p.name || '').toLowerCase().startsWith(words[0]) ? 1 : 0)
  all.sort((a, b) => named(b) - named(a) || starts(b) - starts(a) || (b.role ? 1 : 0) - (a.role ? 1 : 0) || org.team(b.id) - org.team(a.id) || String(a.short || a.name).localeCompare(String(b.short || b.name)))
  return { hits: all.slice(0, limit), more: Math.max(0, all.length - limit) }
}

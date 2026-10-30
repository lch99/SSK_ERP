// Agents brought in at once from a spreadsheet (an Excel file, a CSV, or rows
// pasted from Excel): one row per person, with their branch, position, upline
// and tier. The same rules check the preview on the Setup page and the save in
// setupState.js, so what the page accepts is what gets stored.
import * as P from "./payout.js";

// Columns, in template order. Headers are matched loosely (case, "*", "(RM)",
// common other names), so most existing staff lists work as they are.
export const AGENT_COLUMNS = [
  { key: "name", label: "Name", required: true, width: 26, also: ["full name", "agent name", "agent", "staff name", "negotiator", "nama"] },
  { key: "branch", label: "Branch", required: true, width: 16, also: ["branch name", "branch code", "office", "cawangan"] },
  { key: "position", label: "Position", width: 12, also: ["rank", "level", "upline level", "designation", "jawatan", "role", "title"] },
  { key: "upline", label: "Upline", width: 26, also: ["upline name", "leader", "leader name", "team leader", "introducer", "recruiter", "reports to"] },
  { key: "tier", label: "Tier", width: 9, also: ["tier code", "grade"] },
  { key: "lifetime", label: "Lifetime commission (RM)", width: 16, also: ["lifetime", "total commission", "commission to date", "lifetime sales"] },
  { key: "phone", label: "Phone", width: 15, also: ["mobile", "hp", "h p", "phone no", "mobile no", "contact", "contact no", "handphone", "tel"] },
  { key: "email", label: "Email", width: 26, also: ["e mail", "email address"] },
  { key: "ic", label: "IC no.", width: 17, also: ["ic", "nric", "nric no", "ic number", "mykad", "ic/passport", "ic/passport no", "passport"] },
  { key: "renNo", label: "REN no.", width: 12, also: ["ren", "ren number", "ren/pea no", "ren/rea no", "ren/pea"] },
  { key: "joined", label: "Joined", width: 12, also: ["join date", "date joined", "joined on", "joining date", "start date"] },
  { key: "bank", label: "Bank", width: 16, also: ["bank name"] },
  { key: "accountNo", label: "Account no.", width: 18, also: ["account", "bank account", "bank account no", "account number", "acc no", "bank acc no"] },
];

const norm = s => String(s ?? "").toLowerCase().replace(/\(.*?\)|[*.:#]/g, " ").replace(/[^a-z0-9/]+/g, " ").trim();
const same = (a, b) => norm(a) !== "" && norm(a) === norm(b);
const text = v => String(v ?? "").replace(/\s+/g, " ").trim();
const HEADERS = new Map(AGENT_COLUMNS.flatMap(c => [[norm(c.label), c.key], ...c.also.map(a => [norm(a), c.key])]));

export const templateHeader = c => `${c.label}${c.required ? " *" : ""}`;

// table: rows of cells (strings), as read from the file. Finds the header row
// (one of the first 10 with a Name column and at least one other known one),
// then gives each data row its spreadsheet row number, so errors can say
// "Row 7" and match what Excel shows.
export function readAgentTable(table) {
  const rows = table || [];
  for (let h = 0; h < Math.min(rows.length, 10); h++) {
    const keys = (rows[h] || []).map(cell => HEADERS.get(norm(cell)) ?? null);
    const known = keys.filter(Boolean);
    if (!known.includes("name") || known.length < 2) continue;
    // A column named twice: the first one wins.
    const at = new Map();
    keys.forEach((k, i) => { if (k && !at.has(k)) at.set(k, i); });
    const unknown = (rows[h] || []).filter((cell, i) => text(cell) && !keys[i]).map(text);
    const out = [];
    for (let r = h + 1; r < rows.length; r++) {
      const cells = Object.fromEntries([...at].map(([k, i]) => [k, text(rows[r]?.[i])]));
      if (Object.values(cells).some(Boolean)) out.push({ line: r + 1, cells });
    }
    return {
      rows: out, unknown,
      columns: AGENT_COLUMNS.filter(c => at.has(c.key)).map(c => c.key),
      missing: AGENT_COLUMNS.filter(c => c.required && !at.has(c.key)).map(c => c.label),
    };
  }
  return { error: "Couldn't find the column names. The first row should name the columns, e.g. Name, Branch, Position, Upline." };
}

// ── Cleaning one cell ────────────────────────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};

// "15/03/2024" (day first, as in Malaysia), "2024-03-15", "15 Mar 2024", or an
// Excel date number (days since 1899-12-30). Returns "YYYY-MM-DD" or null.
export function parseDate(v) {
  const s = text(v);
  let m;
  if (/^\d{5}(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000).toISOString().slice(0, 10);
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    const y = m[3].length === 2 ? (+m[3] < 50 ? 2000 : 1900) + +m[3] : +m[3];
    return iso(y, +m[2], +m[1]);
  }
  if ((m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})$/))) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mon < 0 ? null : iso(+m[3], mon + 1, +m[1]);
  }
  return null;
}

const money = v => {
  const s = text(v).replace(/^rm/i, "").replace(/[,\s]/g, "");
  return s !== "" && Number.isFinite(Number(s)) && Number(s) >= 0 ? Math.round(Number(s) * 100) / 100 : null;
};
// Excel drops the 0 from numbers like 0123456789; put it back for Malaysian phones.
const phone = v => {
  const s = text(v);
  return /^1\d{8,9}$/.test(s) ? `0${s}` : /^60\d{8,10}$/.test(s) ? `+${s}` : s;
};
const rounded = v => /^\d(\.\d+)?e\+\d+$/i.test(text(v));     // 9.00101E+11: Excel shortened a long number

// ── Checking the whole list ──────────────────────────────────────────────────

// rows: from readAgentTable(). setup: the Setup state (branches, roles, plans).
// existing: agents kept when the rows are added to the current list.
// Returns { agents, errors }: agents carry `ref` (a temporary id: -1, -2, …)
// and `upline` (another row's ref, or an existing agent's id); errors are
// { line, text } with the spreadsheet row number.
export function checkAgents(rows, setup, existing = []) {
  const errors = [];
  const branches = setup.branches || [];
  const roles = setup.roles || [];
  const tiersOf = branchId => (Array.isArray(setup.plans) ? setup.plans[P.planIndexFor(setup.plans, branchId)]?.tiers || [] : P.tiersFor(setup, branchId));
  const branchNames = branches.map(b => b.name).join(", ");

  const agents = rows.map((row, i) => {
    const c = row.cells || {};
    const err = t => errors.push({ line: row.line, text: t });
    const name = text(c.name);
    if (!name) err("needs a name.");
    else if (name.length > 100) err("name can be at most 100 characters.");

    let branch = c.branch ? branches.find(b => same(b.name, c.branch) || same(b.code, c.branch)) : branches.length === 1 ? branches[0] : null;
    if (!branch) err(c.branch ? `branch "${c.branch}" isn't one of yours (${branchNames}).` : `which branch? (${branchNames})`);

    let position = null;
    if (c.position) {
      const r = roles.find(x => same(x.code, c.position) || same(x.name, c.position));
      if (r) position = r.code;
      else err(roles.length
        ? `position "${c.position}" isn't an upline level (${roles.map(x => x.code).join(", ")}). Leave it blank for a negotiator.`
        : `position "${c.position}": there are no upline levels in Setup, so leave it blank.`);
    }

    let tierId = null;
    if (c.tier && branch) {
      const tiers = tiersOf(branch.id);
      const t = tiers.find(x => same(x.name, c.tier) || same(x.title, c.tier));
      if (t) tierId = t.id;
      else err(`tier "${c.tier}" isn't on ${branch.name}'s tiers (${tiers.map(x => x.name).join(", ")}).`);
    }

    let lifetime = "";
    if (c.lifetime) {
      lifetime = money(c.lifetime);
      if (lifetime == null) { err(`lifetime commission "${c.lifetime}" isn't an amount.`); lifetime = ""; }
    }
    const email = text(c.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err(`email "${email}" doesn't look right.`);
    for (const [k, label] of [["ic", "IC no."], ["accountNo", "account no."], ["phone", "phone"]]) {
      if (rounded(c[k])) err(`${label} "${c[k]}" was shortened by Excel. Format that column as Text and type it again.`);
    }
    let joined = "";
    if (c.joined) {
      joined = parseDate(c.joined);
      if (!joined) { err(`joined "${c.joined}" isn't a date (use e.g. 15/03/2024).`); joined = ""; }
    }
    return {
      ref: -(i + 1), line: row.line, name, branchId: branch?.id ?? null, position, uplineText: text(c.upline), tierId, lifetime,
      phone: phone(c.phone), email, ic: text(c.ic), renNo: text(c.renNo), joined, bank: text(c.bank), accountNo: text(c.accountNo),
    };
  });

  // Who is who: the new rows plus the agents already saved (when adding).
  const people = [...existing.map(a => ({ ...a, ref: a.id, line: null })), ...agents];
  const where = p => (p.line ? `row ${p.line}` : `${p.name} (already saved)`);
  for (const a of agents) {
    if (a.ic) {
      const twin = people.find(p => p !== a && p.ic && same(p.ic, a.ic));
      if (twin && (twin.line == null || twin.line < a.line)) errors.push({ line: a.line, text: `same IC no. as ${where(twin)}.` });
    }
    if (a.name) {
      const twin = people.find(p => p !== a && same(p.name, a.name) && !(p.ic && a.ic && !same(p.ic, a.ic)));
      if (twin && (twin.line == null || twin.line < a.line)) errors.push({ line: a.line, text: `${a.name} is also on ${where(twin)}. Add both IC numbers if they are different people.` });
    }
  }
  // Uplines are named by the leader's name (or IC no.), as in the Name column.
  for (const a of agents) {
    a.upline = null;
    if (!a.uplineText) continue;
    const hits = people.filter(p => same(p.name, a.uplineText) || (p.ic && same(p.ic, a.uplineText)));
    if (hits.includes(a)) errors.push({ line: a.line, text: "can't be their own upline." });
    else if (!hits.length) errors.push({ line: a.line, text: `upline "${a.uplineText}" isn't in the list. Use the leader's name exactly as in the Name column.` });
    else if (hits.length > 1) errors.push({ line: a.line, text: `upline "${a.uplineText}" matches ${hits.length} people. Use their IC no. instead.` });
    else a.upline = hits[0].ref;
  }
  // No loops: following uplines must end at someone with none.
  const byRef = new Map(people.map(p => [p.ref, p]));
  const up = p => (p.line ? p.upline : p.uplineId);
  for (const a of agents) {
    const seen = new Set([a.ref]);
    for (let p = byRef.get(up(a)); p; p = byRef.get(up(p))) {
      if (seen.has(p.ref)) { errors.push({ line: a.line, text: `the upline chain loops back (${a.name} → … → ${a.name}).` }); break; }
      seen.add(p.ref);
    }
  }
  errors.sort((x, y) => x.line - y.line);
  return { agents: agents.map(({ uplineText, ...a }) => a), errors };
}

export const errorText = e => `Row ${e.line}: ${e.text}`;

// The lifetime commission an imported agent starts the ERP with: what the list
// says, or else the threshold of the tier they were put on (when that tier
// counts lifetime commission), so they carry on climbing from that tier.
// `tiers`: the agent's branch's ladder (P.tiersFor). The demo ERP and the
// server both start agents from this.
export function openingLifetime(agent, tiers) {
  if (agent.lifetime !== "" && agent.lifetime != null) return Number(agent.lifetime);
  const tier = tiers.find(t => t.id === agent.tierId) || tiers[0];
  return tier?.basis === "lifetime" ? Number(tier.threshold) : 0;
}

// ── An example list for the current Setup ────────────────────────────────────
// One chain per branch (most senior first), a negotiator or two under each
// leader. Used for the template's Example sheet, and by the demo to try an import.

const EXAMPLE_NAMES = ["Tan Wei Ming", "Nur Aisyah binti Rahman", "Lim Mei Ling", "Raj Kumar a/l Subramaniam", "Wong Jia Hui", "Muhammad Faiz bin Osman",
  "Chong Kah Seng", "Siti Nurhaliza binti Ahmad", "Lee Zhi Hao", "Priya a/p Ramasamy", "Ong Pei Shan", "Ahmad Hakim bin Yusof", "Goh Xin Yi",
  "Kavitha a/p Murugan", "Teh Chin Yong", "Farah Nabila binti Zainal", "Lau Yong Sheng", "Ng Shu Fen", "Hafiz bin Kamarudin", "Yap Li Ting",
  "Chan Kok Wai", "Aina Sofea binti Ismail", "Khoo Boon Hock", "Deepa a/p Krishnan", "Foo Jun Wei", "Nurul Izzah binti Hassan", "Soh Wai Kit",
  "Leong Hui Min", "Arif bin Mustafa", "Choo Ka Yan"];

export function exampleAgents(setup, perBranch = 7) {
  const roles = [...(setup.roles || [])].reverse();          // most senior first
  const rows = [];
  let n = 0;
  const next = () => EXAMPLE_NAMES[n++ % EXAMPLE_NAMES.length] + (n > EXAMPLE_NAMES.length ? ` ${Math.ceil(n / EXAMPLE_NAMES.length)}` : "");
  (setup.branches || []).forEach((b, bi) => {
    const tiers = Array.isArray(setup.plans) ? setup.plans[P.planIndexFor(setup.plans, b.id)]?.tiers || [] : P.tiersFor(setup, b.id);
    const add = (position, upline, tier, lifetime) => {
      const name = next();
      const k = rows.length;
      rows.push({ name, branch: b.name, position, upline, tier: tier?.name || "", lifetime: lifetime ? String(lifetime) : "",
        phone: `01${2 + (k % 8)}-${String(3000000 + k * 7919).slice(0, 3)} ${String(1000 + k * 37).slice(-4)}`,
        email: `${name.split(" ")[0].toLowerCase()}.${k + 1}@example.com`,
        ic: `${80 + (k % 18)}${String(1 + (k % 12)).padStart(2, "0")}${String(1 + (k % 28)).padStart(2, "0")}-14-${String(5000 + k * 13).slice(-4)}`,
        renNo: `REN ${31000 + k * 17}`, joined: `${String(1 + (k % 27)).padStart(2, "0")}/${String(1 + (k % 12)).padStart(2, "0")}/${2016 + (k % 9)}`,
        bank: ["Maybank", "CIMB Bank", "Public Bank", "RHB Bank"][k % 4], accountNo: `${5140 + k}${String(10000000 + k * 7331).slice(-8)}` });
      return name;
    };
    let upline = "";
    roles.forEach((r, i) => { upline = add(r.code, upline, tiers[Math.max(0, tiers.length - 1 - i)], 0); });
    for (let i = 0; i < Math.max(1, perBranch - roles.length); i++) add("", upline, i === 0 && tiers[1] ? tiers[1] : null, (i % 3) * 12000 + bi * 5000);
  });
  return rows;
}

// Account roles and what each may do — the one copy, used by the page (to show
// or hide things) and the API (to enforce them).

export const ROLES = [
  { value: 'superadmin', label: 'Superadmin',     branchScoped: false, desc: 'Everything, every branch. The only role that can change Setup.' },
  { value: 'manager',    label: 'Branch Manager', branchScoped: true,  desc: 'Runs one branch: sees all its work, approves its deals, and manages its Admin and Staff accounts.' },
  { value: 'accountant', label: 'Accountant',     branchScoped: false, desc: 'Accounts and finance reports for every branch.' },
  { value: 'admin',      label: 'Admin',          branchScoped: true,  desc: 'Day-to-day office work for one branch. Cannot approve.' },
  { value: 'staff',      label: 'Office Staff',   branchScoped: true,  desc: 'Enters and views their own branch\'s records.' },
];
export const ROLE_VALUES = ROLES.map(r => r.value);
export const roleMeta = value => ROLES.find(r => r.value === value) || { value, label: value, branchScoped: true, desc: '' };

const PERMISSIONS = {
  'setup.edit':   ['superadmin'],
  'users.manage': ['superadmin', 'manager'],
  'audit.view':   ['superadmin'],
};

export function can(user, perm) {
  return !!user && (PERMISSIONS[perm] || []).includes(user.role);
}

// Roles `actor` may give to an account.
export function assignableRoles(actor) {
  if (actor?.role === 'superadmin') return ROLE_VALUES;
  if (actor?.role === 'manager') return ['admin', 'staff'];
  return [];
}

// May `actor` edit an account that is (or would become) `target` = { role, branchId }?
export function canManage(actor, target) {
  if (!assignableRoles(actor).includes(target.role)) return false;
  if (actor.role === 'superadmin') return true;
  return actor.branchId != null && Number(target.branchId) === Number(actor.branchId);
}

export const PASSWORD_MIN = 8;

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (pw.length > 200) return 'Password is too long.';
  return null;
}

// u: { username, name, role, branchId, password? }. `isNew` requires a password.
export function validateUser(u, { isNew = false } = {}) {
  const errors = [];
  if (!/^[a-z0-9._-]{3,32}$/.test(String(u.username || ''))) {
    errors.push('Username: 3–32 characters, lowercase letters, numbers, dot, dash or underscore.');
  }
  if (!String(u.name || '').trim()) errors.push('Name is required.');
  if (!ROLE_VALUES.includes(u.role)) errors.push('Pick a role.');
  else if (roleMeta(u.role).branchScoped && (u.branchId == null || u.branchId === '')) {
    errors.push(`${roleMeta(u.role).label} accounts belong to one branch — pick it.`);
  }
  if (isNew || u.password) {
    const err = validatePassword(u.password);
    if (err) errors.push(err);
  }
  return errors;
}

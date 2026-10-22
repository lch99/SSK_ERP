// Colours for people in a payout: each upline level by its place in the chain
// (junior → senior), then the negotiator and the company.
export const ROLE_COLORS = ['#2f7dd1', '#7a4fc9', '#c2410c', '#0f8a6a']
export const AGENT_COLOR = '#1d2330'
export const COMPANY_COLOR = '#9aa3af'
export const roleColor = (roles, code) => ROLE_COLORS[Math.max(0, roles.findIndex(r => r.code === code)) % ROLE_COLORS.length]

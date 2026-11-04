// Labels the pages show and the server writes in Excel downloads (shared/lists.js
// `download`), so a status reads the same on screen and in the file.

// E-Forms: Draft → Submitted → Closed Partial / Closed Full, or Abort/Cancel.
export const DEAL_STATUS = {
  draft: { label: 'Draft', tone: 'gray', help: 'Saved by the agent but not submitted yet. Nothing is billed.' },
  submitted: { label: 'Submitted', tone: 'blue', hint: 'Waiting for the client’s money', help: 'Submitted. Waiting for the client’s money to come in and clear.' },
  partial: { label: 'Closed Partial', tone: 'violet', help: 'Part of the money is in and closed (paid out); the rest is still to come.' },
  closed: { label: 'Closed Full', tone: 'green', help: 'All the money is in and closed. The payouts are made.' },
  cancelled: { label: 'Abort/Cancel', tone: 'red', help: 'The deal fell through. Money received is refunded through Payments out.' },
}

// Money in (transactions): Draft → Pending → Clear, or Return / Invalid.
export const MONEY_IN_STATUS = {
  draft: { label: 'Draft', tone: 'gray', help: 'Recorded, not checked yet.' },
  pending: { label: 'Pending', tone: 'amber', help: 'Waiting for accounts to check it against the bank statement.' },
  cleared: { label: 'Clear', tone: 'green', help: 'Checked against the bank. Counts as cleared cash for closing the case.' },
  returned: { label: 'Return', tone: 'red', help: 'The bank returned it (e.g. a bounced cheque). It does not count.' },
  invalid: { label: 'Invalid', tone: 'red', help: 'Rejected (e.g. wrong amount or reference). It does not count.' },
}
// How a payment came in, and what it was for (the current ERP's Add Transaction form).
export const PURPOSES = { deposit: 'Cash Deposit', commission: 'Balance Commission', rental: 'Balance Rent', other: 'Others' }
export const METHODS = { online: 'Online Transfer', cheque: 'Cheque', cash: 'Cash' }
export const CASH_METHODS = { cashtocompany: 'Cash to Company', cashbankin: 'Cash Bank In' }

// Payments out (request forms): New → Pending Queries → Payment Ready → Payment Clear.
export const MONEY_OUT_STATUS = {
  new: { label: 'New', tone: 'amber', help: 'Requested. Waiting for approval.' },
  queried: { label: 'Pending Queries', tone: 'red', help: 'The approver asked a question before paying.' },
  ready: { label: 'Payment Ready', tone: 'blue', help: 'Approved. Accounts can pay it.' },
  paid: { label: 'Payment Clear', tone: 'green', help: 'Paid out of the account.' },
}
export const MONEY_OUT_TYPES = {
  balance: 'Balance to Vendor',
  transfer: 'Transfer Deposit to Other',
  refund: 'Abort Case',
  cobroke: 'Cheque to Co-Bro',
  referral: 'Introducer Fees',
  ta: 'Tenancy Agreement Fees',
}

// Staff accounts: Pending → Active, or Suspended / Locked by the clock, or Inactive (left).
export const STAFF_STATUS = {
  active: { label: 'Active', tone: 'green', help: 'Can sign in and be paid.' },
  pending: { label: 'Pending', tone: 'amber', help: 'New. HR still has to enable them (within 7 days, or the account is suspended).' },
  suspended: { label: 'Suspended', tone: 'red', help: 'Cannot sign in: not verified within 7 days of joining, or suspended by HR. Their listings went to the next person in line.' },
  locked: { label: 'Locked', tone: 'red', help: 'Cannot sign in: no activity for 60 days. HR unlocks it; their listings went to the next person in line.' },
  inactive: { label: 'Inactive', tone: 'gray', help: 'Left or disabled. Cannot sign in.' },
}
// Account types (the current ERP's codes). Agent and Sales Agent are agents; the rest are office staff.
export const ACCOUNT_TYPES = { staff: 'Agent', 'sale-staff': 'Sales Agent', 'admin-staff': 'Admin Level 2', 'admin-staff2': 'Admin Level 1', account: 'Accounting', 'sale-marketing': 'Marketing & Sales' }

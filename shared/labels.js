// Labels the pages show and the server writes in Excel downloads (shared/lists.js
// `download`), so a status reads the same on screen and in the file.

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

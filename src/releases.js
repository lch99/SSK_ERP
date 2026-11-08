// Release notes: what changed in each version, in plain words for the people
// who use the ERP (agents, the office, the boss), not for developers. The ERP
// shows the new ones once after an update ("What's new"), and keeps them all
// under Home → What's new.
//
// Every release adds its entry at the top, with the version in package.json
// (a test checks). Write what people can now do and where, not how it was
// built: no file names, no technical words. Items: { text, who?, to? } where
// `who` is 'agents' or 'office' when it only matters to them, and `to` is the
// page it is about ("Show me").
export const RELEASES = [
  {
    version: '0.10.0', date: '2026-11-08', title: 'The ERP as an app on your phone',
    items: [
      { text: 'Put SubSaleKing on your phone\'s home screen and it opens like an app: full screen, its own icon, no address bar. On Android tap Install (also in your picture\'s menu); on iPhone tap Share, then Add to Home Screen. Home shows how.', to: 'dashboard' },
      { text: 'On a phone the modules sit in a bar along the bottom, with what is waiting in each. Tap a module for its first page, tap it again for all its pages; More has everything else.' },
      { text: 'Forms and messages on a phone slide up from the bottom, with big buttons in easy reach, and typing into a box no longer zooms the page on iPhone.' },
      { text: 'Every page fits even the smallest phones without scrolling sideways, and the app opens quickly, even on a weak line.' },
    ],
  },
  {
    version: '0.9.9', date: '2026-10-31', title: 'What\'s new, and planned maintenance',
    items: [
      { text: 'This window: after every update the ERP tells you, once, what changed. You can read it again any time under Home → What\'s new.', to: 'whats-new' },
      { text: 'Planned maintenance: when the ERP has to go offline for an update, a notice shows at the top of every page from a week before, with the day and time, so you can finish your work first. While it is offline you see a "back soon" page.' },
      { text: 'The technical team plans maintenance under System → Technical. Give someone that access with the Technical team role in Roles & access.', who: 'office', to: 'technical/downtime' },
    ],
  },
  {
    version: '0.9.8', date: '2026-10-31', title: 'Tidier filters on every list',
    items: [
      { text: 'Every list now has a search box and one Filters button. Pick what you want inside; what you picked shows as small tags under the search, and one click on × removes it. Clear all starts again.', to: 'listings' },
      { text: 'Price and date ranges are one box each, for example "Ad Price from RM 300k" or an E-Form date range.', to: 'deals' },
      { text: 'Tabs no longer run off the page: the ones that don\'t fit are under More.' },
      { text: 'Owner requests: one search finds a request by ticket number, owner\'s name or phone.', who: 'office', to: 'vendor-requests' },
    ],
  },
  {
    version: '0.9.7', date: '2026-10-31', title: 'Viewings, hot lists and notifications',
    items: [
      { text: 'Book a viewing for your customer on any listing in the agency. The agent looking after it confirms the time with the owner; you both hear about every change, and afterwards you note how it went.', who: 'agents', to: 'appointments' },
      { text: 'See every listing on the market in the agency, not only your team\'s (Listings → Whole agency). The owner\'s phone and unit number stay with the people looking after it.', who: 'agents', to: 'listings' },
      { text: 'Hot lists: listings at a great price with the key, vacant or with a friendly tenant are tagged Hot Sales, Super Hot or Rent King. Every listing also shows whether its price is Hot, Good, Fair or Above market.', to: 'listings' },
      { text: 'Tap the star on a listing or a building to keep an eye on it: you hear when its price changes or it is sold.' },
      { text: 'The bell at the top shows your notifications: viewings, your favourites, your listings and commission ready to claim. The office can send a notice to one person, a branch or everyone.', to: 'notifications' },
      { text: 'Each listing shows who looks after it, why, and everyone who did before. Each building shows who leads it for sales and for rentals, and who is close to taking over.', to: 'titles' },
      { text: 'Accounts not activated within 7 days are suspended, and accounts unused for 60 days are locked. Their listings go to the next person in line and can be given back when they return.', who: 'office', to: 'staff' },
      { text: 'System → Automatic rules explains, in plain words, everything the ERP does by itself.', who: 'office', to: 'system/rules' },
      { text: 'New reports: Sales by building, and Follow-ups by person.', who: 'office', to: 'reports/buildings' },
    ],
  },
  {
    version: '0.9.6', date: '2026-10-30', title: 'Agents get their own home page',
    items: [
      { text: 'Agents see their own dashboard: their sales, their tier, what is waiting for them and their team.', who: 'agents', to: 'dashboard' },
      { text: 'My commission: choose for each ready payout to get it paid on the next pay day, or keep it stacked for later.', who: 'agents', to: 'my-pay' },
      { text: 'Listing photos show as small pictures on the list, the cards and the listing page.', to: 'listings' },
      { text: 'My profile asks for the bank account holder\'s name, so pay goes to the right account.', to: 'settings' },
    ],
  },
  {
    version: '0.9.5', date: '2026-10-28', title: 'Commission rules by date',
    items: [
      { text: 'Setup is down to six steps; tiers, uplines and payouts are on one page with a live preview.', who: 'office' },
      { text: 'When the boss changes how commission is paid, Setup asks from which E-Form date it applies. Older E-Forms keep being paid on the old rules.', who: 'office' },
      { text: 'Two agents on one deal: the closing agent\'s share is set in Setup (half each, as before). If one of them is taken off or has left, their part goes back to the company.' },
    ],
  },
  {
    version: '0.9.4', date: '2026-10-28', title: 'A cleaner Accounts menu',
    items: [{ text: 'The Accounts menu lists only what is ready to use.', who: 'office' }],
  },
  {
    version: '0.9.3', date: '2026-10-27', title: 'Each upline level keeps its own share',
    items: [
      { text: 'Setup gives each upline level one fixed share of the upline pool. If a level is missing on a deal, or its leader has left, that share stays with the company.', who: 'office' },
    ],
  },
  {
    version: '0.9.2', date: '2026-10-27', title: 'Easier to read',
    items: [
      { text: 'Darker, larger text everywhere, so it is easier to read on any screen.' },
      { text: 'Forgot a required field? It is outlined in red with "Required", and the cursor goes straight to it.' },
    ],
  },
  {
    version: '0.9.1', date: '2026-10-26', title: 'Agents record payments',
    items: [
      { text: 'Agents record the payments on their own E-Forms; Accounts checks and clears them.', who: 'agents', to: 'money-in' },
      { text: 'The commission steps now start at "Submit E-Forms", so drafts waiting to be sent are easy to spot.' },
      { text: 'On laptops the side menu shows icons only, leaving more room for your work.' },
    ],
  },
  {
    version: '0.9.0', date: '2026-10-23', title: 'Listing videos and a check before saving',
    items: [
      { text: 'Add up to three videos to a listing: a walk-through, the facilities or the neighbourhood.', to: 'listings' },
      { text: 'Every form shows what will be saved before it is saved, and listings show how they will look on the website.' },
    ],
  },
]

// Releases newer than the last one this person saw (just the latest the first time).
export function unseen(seenVersion) {
  const i = RELEASES.findIndex(r => r.version === seenVersion)
  return i < 0 ? RELEASES.slice(0, 1) : RELEASES.slice(0, i)
}

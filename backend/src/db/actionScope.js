// Which listings an action works on, so its save loads those and the rest of their buildings (the
// product handler pick and a building's lead look across the building) instead of all of them (about
// 120,000 with their follow-ups on the real data). An action not named here that reads listings
// loads them all: the rare ones that scan every listing (renaming a building or an area, the "still in
// use" checks, the re-checks). shared/erpActions.js is the reference for what each one reads.
const parseIds = v => (typeof v === 'string' ? JSON.parse(v || '[]') : v || []);

const dealListings = async (q, ids) => (await q('deals').whereIn('id', ids.filter(x => x != null).map(Number)).select('listing_id')).map(r => r.listing_id);
const viewingListings = async (q, id) => parseIds((await q('viewings').where('id', Number(id)).first('listing_ids'))?.listing_ids);

const LISTING_SCOPE = {
  updateListing: (q, [id]) => [id], addListingFollowUp: (q, [id]) => [id], deleteListing: (q, [id]) => [id], revealOwner: (q, [id]) => [id],
  bookViewing: (q, [b]) => b?.listingIds || [],
  confirmViewing: (q, [id]) => viewingListings(q, id), rescheduleViewing: (q, [id]) => viewingListings(q, id), cancelViewing: (q, [id]) => viewingListings(q, id),
  reviewViewing: (q, [id]) => viewingListings(q, id), addViewingRemark: (q, [id]) => viewingListings(q, id),
  addDeal: (q, [b]) => [b?.listingId],
  closeDeal: (q, [id]) => dealListings(q, [id]), deleteDeal: (q, [id]) => dealListings(q, [id]), raiseRequest: (q, [id]) => dealListings(q, [id]),
  updateDeal: async (q, [id, b]) => [...await dealListings(q, [id]), b?.listingId],
  deleteClose: async (q, [closeId]) => dealListings(q, (await q('closes').where('id', Number(closeId)).select('deal_id')).map(r => r.deal_id)),
  // By its code or id (the follow-up names the listing it was about).
  addCustomerFollowUp: async (q, [, b]) => (b?.listingId ? (await q('listings').where('code', String(b.listingId).trim().toUpperCase())
    .orWhere('id', Number(b.listingId) || 0).select('id')).map(r => r.id) : []),
  // The duplicate check compares listings in the same building (by its name); the code comes from codeFloor.
  addListing: async (q, [b]) => (await q('listings').where('title', String(b?.title ?? '').trim()).select('id')).map(r => r.id),
};

// The listing ids an action loads (with their buildings), or null: all of them.
async function listingsFor(q, name, args) {
  const scope = LISTING_SCOPE[name];
  if (!scope) return null;
  const ids = [...new Set((await scope(q, args)).filter(x => x != null && x !== '').map(Number).filter(Number.isFinite))];
  if (!ids.length) return [];
  const same = await q('listings').whereIn('title_id', q('listings').whereIn('id', ids).whereNotNull('title_id').select('title_id')).select('id');
  return [...new Set([...ids, ...same.map(r => r.id)])];
}

// The highest number in the listing codes (LIST-NNNNNN): a new listing's code without reading them all.
async function codeFloor(q) {
  const [rows] = await q.raw("select max(cast(substring(code, 6) as unsigned)) as n from listings where code like 'LIST-%'");
  return { listing: Number(rows[0]?.n) || 0 };
}

module.exports = { listingsFor, codeFloor, LISTING_SCOPE };

import { FormField, TextArea, Select, field } from '../ui.jsx'
import * as L from '../../../shared/listings.js'
import { rm } from '../format.js'

// The rest of the current ERP's listing form: land, car parks, store rooms, race, placement, specs,
// renovation, pricing, bank value and the three short descriptions. Used by Add a listing and Edit.
// f: the form's values; setF: its setter (setF(x => …)).
export function ListingDetailFields({ f, setF }) {
  const put = k => v => setF(x => ({ ...x, [k]: v }))
  const typed = k => e => put(k)(e.target.value)
  const choose = k => {
    const { label, options } = L.LISTING_CHOICES[k]
    // A value from the phone app or the old records that is not one of the choices is kept as it is.
    const odd = f[k] && !(f[k] in options) ? [{ value: f[k], label: f[k] }] : []
    return (
      <FormField key={k} label={label}>
        <Select block plain label={label} value={f[k] ?? ''} onChange={put(k)}
          options={[{ value: '', label: 'Not set' }, ...Object.entries(options).map(([value, l]) => ({ value, label: l })), ...odd]} />
      </FormField>
    )
  }
  const number = (k, label, step = '1') => (
    <FormField key={k} label={label}><input style={field} type="number" min="0" step={step} value={f[k] ?? ''} onChange={typed(k)} /></FormField>
  )
  return (
    <>
      <FormField label="Land area" help="Sq ft, or width x length (e.g. 22 x 75)"><input style={field} value={f.land ?? ''} onChange={typed('land')} /></FormField>
      {number('carpark', 'Car Parks')}
      {number('utilityRooms', 'Utilities / Store Rooms')}
      {choose('restriction')}
      {choose('placement')}
      {choose('specs')}
      {choose('renovation')}
      {number('renoCost', 'Renovation Cost (RM)')}
      {choose('pricing')}
      {number('bankValue', 'Bank Value (RM)')}
      <FormField label="Short Description" wide><TextArea rows={2} value={f.shortDescription ?? ''} onChange={typed('shortDescription')} /></FormField>
      <FormField label="Renovation Description" wide><TextArea rows={2} value={f.renoDescription ?? ''} onChange={typed('renoDescription')} /></FormField>
      <FormField label="Furnishing Description" wide><TextArea rows={2} value={f.furnishDescription ?? ''} onChange={typed('furnishDescription')} /></FormField>
    </>
  )
}

// The same details as label → value rows, for the listing page and the reviews (only those set).
export function listingDetailRows(l) {
  const ppsf = L.pricePerSqft(l)
  return [
    l.land && ['Land', /\d\s*x\s*\d/i.test(l.land) ? `${l.land} ft` : `${l.land} sq ft`],
    ppsf && ['Price per sq ft', rm(ppsf)],
    l.carpark != null && ['Car Parks', String(l.carpark)],
    l.utilityRooms != null && ['Utilities / Store Rooms', String(l.utilityRooms)],
    ...Object.keys(L.LISTING_CHOICES).map(k => L.choiceLabel(k, l[k]) && [L.LISTING_CHOICES[k].label, L.choiceLabel(k, l[k])]),
    l.renoCost != null && ['Renovation Cost', rm(l.renoCost)],
    l.bankValue != null && ['Bank Value', rm(l.bankValue)],
  ].filter(Boolean)
}

// The detail fields as they are on a listing, for an Edit form to start from.
export const detailValues = l => Object.fromEntries(L.LISTING_DETAILS.map(k => [k, l[k] ?? '']))

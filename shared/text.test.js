import { describe, it, expect } from 'vitest'
import { htmlToText } from './text.js'

describe('htmlToText', () => {
  it('leaves plain text alone', () => {
    expect(htmlToText('3 bed, near MRT\nFreehold')).toBe('3 bed, near MRT\nFreehold')
    expect(htmlToText('Price < RM500k')).toBe('Price < RM500k')
    expect(htmlToText(null)).toBe(null)
    expect(htmlToText('')).toBe('')
  })
  it('turns the old ERP description into lines', () => {
    const old = 'PROPERTY DETAILS<p><p></p><p>- Property Type: Condominium</p><p>- Furnishing: Fully Furnished&nbsp;</p><p></p></p><p>&nbsp;FACILITIES</p><p><p></p><p>- Swimming Pool</p><p>- Children&#39;s Pool</p><p><br></p><p>- Cheras&ndash;Kajang Highway</p>'
    expect(htmlToText(old)).toBe('PROPERTY DETAILS\n- Property Type: Condominium\n- Furnishing: Fully Furnished\n\nFACILITIES\n\n- Swimming Pool\n- Children\'s Pool\n\n- Cheras–Kajang Highway')
  })
  it('handles lists, breaks and unknown entities', () => {
    expect(htmlToText('<ul><li>Pool</li><li>Gym</li></ul>')).toBe('• Pool\n• Gym')
    expect(htmlToText('a<br/>b<BR>c')).toBe('a\nb\nc')
    expect(htmlToText('Tom &amp; Jerry &foo;')).toBe('Tom & Jerry &foo;')
  })
})

import { describe, it, expect } from 'vitest'
import { checkProfile, tidyProfile, PHOTO_MAX } from './profile.js'

const ok = { name: 'Aina Rahman', email: 'aina@example.com', phone: '012-345 6789', bank: 'Maybank', bankHolder: 'Aina binti Rahman', bankAccount: '5123 4567 8901' }

describe('checkProfile', () => {
  it('passes a filled-in profile', () => {
    expect(checkProfile(ok)).toEqual({})
  })
  it('needs a display name', () => {
    expect(checkProfile({ ...ok, name: '   ' }).name).toBeTruthy()
  })
  it('leaves optional fields alone when empty', () => {
    expect(checkProfile({ name: 'Aina' })).toEqual({})
  })
  it('catches a bad e-mail, phone or account number', () => {
    const e = checkProfile({ ...ok, email: 'aina@', phone: 'call me', bankAccount: '12ab' })
    expect(Object.keys(e).sort()).toEqual(['bankAccount', 'email', 'phone'])
  })
  it('wants a bank and holder name once there is an account number', () => {
    expect(checkProfile({ ...ok, bank: '' }).bank).toBeTruthy()
    expect(checkProfile({ ...ok, bankHolder: '  ' }).bankHolder).toBeTruthy()
    expect(checkProfile({ name: 'Aina', bankHolder: 'Aina' })).toEqual({})
  })
  it('takes only small JPG or PNG photos', () => {
    expect(checkProfile({ ...ok, photo: 'data:image/png;base64,AAAA' })).toEqual({})
    expect(checkProfile({ ...ok, photo: 'data:image/gif;base64,AAAA' }).photo).toBeTruthy()
    expect(checkProfile({ ...ok, photo: `data:image/jpeg;base64,${'A'.repeat(PHOTO_MAX)}` }).photo).toBeTruthy()
  })
})

describe('tidyProfile', () => {
  it('keeps only known fields and trims text', () => {
    expect(tidyProfile({ name: '  Aina ', role: 'superadmin' })).toEqual({ name: 'Aina', icName: '', email: '', phone: '', address: '', bank: '', bankHolder: '', bankAccount: '', photo: '' })
  })
})

import { describe, it, expect } from 'vitest'
import { getProfile, saveProfile, changePassword } from './profileApi.js'

describe('demo profile store', () => {
  it('starts as the demo user with no password', async () => {
    const p = await getProfile()
    expect(p.name).toBe('Demo user')
    expect(p.hasPassword).toBe(false)
  })

  it('saves details and refuses bad ones', async () => {
    const p = await saveProfile({ name: 'Aina Rahman', email: 'aina@example.com' })
    expect(p.name).toBe('Aina Rahman')
    expect(p.updatedAt).toBeTruthy()
    await expect(saveProfile({ name: '' })).rejects.toThrow()
    expect((await getProfile()).name).toBe('Aina Rahman')
  })

  it('sets a first password, then needs it to change it', async () => {
    await expect(changePassword('', 'short')).rejects.toThrow(/at least/)
    expect((await changePassword('', 'first-pass-1')).hasPassword).toBe(true)
    await expect(changePassword('wrong-pass', 'second-pass-2')).rejects.toThrow(/current password is wrong/)
    await expect(changePassword('first-pass-1', 'first-pass-1')).rejects.toThrow(/new password/)
    const p = await changePassword('first-pass-1', 'second-pass-2')
    expect(p.passwordChangedAt).toBeTruthy()
    expect(JSON.stringify(p)).not.toMatch(/second-pass-2/)
  })
})

import { describe, it, expect } from 'vitest'
import * as F from './files.js'

const MB = 1024 * 1024
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0])

describe('upload rules', () => {
  it('takes an allowed file within the limit', () => {
    expect(F.checkFile({ name: 'IC Copy.PDF', size: 2 * MB }, 'document', PDF)).toBe(null)
    expect(F.checkFile({ name: 'slip.jpeg', size: 300_000 }, 'document', JPG)).toBe(null)
  })
  it('refuses other file types', () => {
    expect(F.checkFile({ name: 'form.docx', size: 1000 }, 'document')).toBe('form.docx: only PDF, JPG or PNG files can be uploaded here.')
    expect(F.checkFile({ name: 'scan.pdf', size: 1000 }, 'photo')).toMatch(/only JPG or PNG/)
  })
  it('refuses files over the limit, and empty files', () => {
    expect(F.checkFile({ name: 'me.png', size: 3 * MB }, 'avatar')).toBe('me.png is 3.0 MB; the limit is 2 MB.')
    expect(F.checkFile({ name: 'big.pdf', size: 10 * MB + 1 }, 'document')).toMatch(/limit is 10 MB/)
    expect(F.checkFile({ name: 'blank.pdf', size: 0 }, 'document')).toBe('blank.pdf is empty.')
  })
  it('catches a file renamed to look allowed', () => {
    expect(F.checkFile({ name: 'invoice.pdf', size: 5000 }, 'document', EXE)).toBe('invoice.pdf is not a real PDF file.')
    expect(F.checkFile({ name: 'photo.png', size: 5000 }, 'photo', JPG)).toBe('photo.png is not a real PNG file.')
  })
  it('checks text files for binary bytes', () => {
    const csv = new TextEncoder().encode('Name,Branch\nTan,KL\n')
    expect(F.checkFile({ name: 'agents.csv', size: csv.length }, 'spreadsheet', csv)).toBe(null)
    expect(F.checkFile({ name: 'agents.csv', size: 8 }, 'spreadsheet', EXE)).toMatch(/not a real CSV/)
  })
  it('checks videos by the box at byte 4', () => {
    const box = name => new Uint8Array([0, 0, 0, 0x20, ...new TextEncoder().encode(name), 0x69, 0x73, 0x6f, 0x6d])
    expect(F.checkFile({ name: 'Close case.mp4', size: 80 * MB }, 'video', box('ftyp'))).toBe(null)
    expect(F.checkFile({ name: 'Old meeting.MOV', size: 80 * MB }, 'video', box('moov'))).toBe(null)
    expect(F.checkFile({ name: 'fake.mp4', size: 80 * MB }, 'video', box('moov'))).toBe('fake.mp4 is not a real MP4 file.')
    expect(F.checkFile({ name: 'huge.mp4', size: 501 * MB }, 'video', box('ftyp'))).toMatch(/limit is 500 MB/)
    expect(F.uploadHint('video')).toBe('MP4 or MOV · max 500 MB')
  })
  it('builds the accept list and the hint from the same rule', () => {
    expect(F.acceptFor('avatar')).toBe('.jpg,.jpeg,image/jpeg,.png,image/png')
    expect(F.uploadHint('document')).toBe('PDF, JPG or PNG · max 10 MB')
    expect(F.uploadHint('photo')).toBe('JPG or PNG · max 10 MB each · up to 20 photos')
  })
  it('reads the first bytes of a Blob', async () => {
    expect([...await F.fileHead(new Blob([PDF]))]).toEqual([...PDF])
  })
  it('refuses an unknown upload kind', () => {
    expect(() => F.checkFile({ name: 'a.pdf', size: 1 }, 'audio')).toThrow(/Unknown upload kind/)
  })
})

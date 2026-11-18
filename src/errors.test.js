import { describe, it, expect, vi, beforeEach } from 'vitest'
import { errorText, errorList, FAULT } from './errors.js'

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('errorText', () => {
  it('shows a refusal in its own words', () => {
    const e = Object.assign(new Error('That listing is already booked at 3pm.'), { status: 400, errors: ['That listing is already booked at 3pm.'] })
    expect(errorText(e)).toBe('That listing is already booked at 3pm.')
    expect(errorText(new Error('Pick a branch first.'))).toBe('Pick a branch first.')
    expect(console.error).not.toHaveBeenCalled()
  })

  it('never shows a fault in the page as it is: the person gets what to do, the console gets the details', () => {
    let fault
    try { undefined.runs } catch (e) { fault = e } // eslint-disable-line no-unused-expressions
    expect(fault.message).toMatch(/Cannot read properties of undefined/)
    expect(errorText(fault)).toBe(FAULT)
    expect(errorText(new RangeError('Offset is outside the bounds of the DataView'))).toBe(FAULT)
    expect(errorText(new SyntaxError('Unexpected token < in JSON at position 0'))).toBe(FAULT)
    expect(errorText(new DOMException('The source image could not be decoded.', 'InvalidStateError'))).toBe(FAULT)
    expect(console.error).toHaveBeenCalledWith(expect.any(String), FAULT, fault)
  })

  it('says a fault in the words of what was being done, when given them', () => {
    expect(errorText(new RangeError('bad zip'), 'agents.xlsx could not be read.')).toBe('agents.xlsx could not be read.')
    expect(errorText(new Error('Pick a file.'), 'agents.xlsx could not be read.')).toBe('Pick a file.')
  })

  it('reads the browser refusals that have a plain meaning', () => {
    expect(errorText(new DOMException('quota', 'QuotaExceededError'))).toMatch(/storage is full/)
    expect(errorText(new DOMException('aborted', 'AbortError'))).toMatch(/stopped before it finished/)
  })

  it('has something to say for whatever was thrown', () => {
    for (const thrown of [undefined, null, '', '   ', 42, {}, { message: 'not an Error' }, new Error(''), new Error('   ')]) {
      expect(errorText(thrown)).toBe(FAULT)
    }
    expect(errorText('Already deleted.')).toBe('Already deleted.')
  })
})

describe('errorList', () => {
  it("is every reason the server gave, or the one message", () => {
    const refusal = Object.assign(new Error('Name is required.'), { status: 400, errors: ['Name is required.', 'Phone is required.'] })
    expect(errorList(refusal)).toEqual(['Name is required.', 'Phone is required.'])
    expect(errorList(new Error('Pick a branch first.'))).toEqual(['Pick a branch first.'])
    expect(errorList(new TypeError('x is not a function'))).toEqual([FAULT])
  })

  it("never hands on a fault's own list (AggregateError's errors are Errors, not words)", () => {
    expect(errorList(new AggregateError([new Error('a'), new Error('b')], 'All promises were rejected'))).toEqual([FAULT])
    expect(errorList(Object.assign(new Error('Saved, but:'), { errors: [null, '', 3] }))).toEqual(['Saved, but:'])
  })
})

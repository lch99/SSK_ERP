// What to tell someone when something didn't work.
// A refusal (the server's, or the rules' in the demo) is already in plain words, and so is every Error the ERP
// throws on purpose: those are shown as they are. A fault in the page itself (a TypeError: "Cannot read
// properties of undefined…") or in the browser (a DOMException: "The source image could not be decoded")
// means nothing to the person who clicked: they're told what happened and what to do instead, and the details
// go to the console for the technical team.
//   setError(errorText(e))                 → one message
//   setErrors(errorList(e))                → every reason the server gave, or that one message
//   errorText(e, 'That file could not be read…') → a fault said in the words of what was being done
const FAULTS = new Set(['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'EvalError', 'URIError', 'InternalError', 'AggregateError'])

export const FAULT = 'Something went wrong on this page, so that may not have been done. Reload the page and check before you try again. If it keeps happening, tell the technical team.'

// The browser's own refusals that do have a plain meaning.
const BROWSER = {
  QuotaExceededError: "This browser's storage is full. Free some space on the device, or clear this site's saved data, and try again.",
  NotAllowedError: 'The browser did not allow that. Check what this site is allowed to do in the browser\'s settings, and try again.',
  AbortError: 'That was stopped before it finished. Try again.',
  NetworkError: 'The connection dropped. Check your internet connection and try again.',
}

const isDomException = e => typeof DOMException !== 'undefined' && e instanceof DOMException
export const isFault = e => !(e instanceof Error) || FAULTS.has(e.name) || isDomException(e) || !String(e.message || '').trim()

export function errorText(e, fault = FAULT) {
  if (typeof e === 'string') return e.trim() || fault
  if (BROWSER[e?.name]) return BROWSER[e.name]
  if (isFault(e)) {
    console.error('Shown as "%s":', fault, e)
    return fault
  }
  return e.message
}

export function errorList(e, fault) {
  const text = errorText(e, fault)
  const reasons = Array.isArray(e?.errors) ? e.errors.filter(x => typeof x === 'string' && x.trim()) : []
  return text === e?.message && reasons.length ? reasons : [text]
}

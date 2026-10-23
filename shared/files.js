// Upload rules: which files each upload slot takes, how big they may be and
// how many it holds. The page checks every file with checkFile() before
// taking it; the server must run the same check on every upload, so a file
// that is too big, or renamed to look like a PDF, is stopped on both sides.

const MB = 1024 * 1024
const ascii = text => [...text].map(c => c.charCodeAt(0))
const FTYP = ascii('ftyp')

// File types: extensions, MIME types, and the bytes every real file of that
// type has at `at` (default 0; a list of byte lists means any one of them).
// Text files have none, so they are checked for binary bytes instead.
export const FILE_TYPES = {
  pdf: { label: 'PDF', ext: ['.pdf'], mime: ['application/pdf'], magic: [0x25, 0x50, 0x44, 0x46] },
  jpg: { label: 'JPG', ext: ['.jpg', '.jpeg'], mime: ['image/jpeg'], magic: [0xff, 0xd8, 0xff] },
  png: { label: 'PNG', ext: ['.png'], mime: ['image/png'], magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  xlsx: { label: 'Excel', ext: ['.xlsx'], mime: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], magic: [0x50, 0x4b, 0x03, 0x04] },
  csv: { label: 'CSV', ext: ['.csv', '.txt'], mime: ['text/csv', 'text/plain'], text: true },
  // MP4 and modern MOV have an 'ftyp' box at byte 4; older QuickTime files may start with another box.
  mp4: { label: 'MP4', ext: ['.mp4', '.m4v'], mime: ['video/mp4'], at: 4, magic: [FTYP] },
  mov: { label: 'MOV', ext: ['.mov'], mime: ['video/quicktime'], at: 4, magic: [FTYP, ascii('moov'), ascii('mdat'), ascii('wide'), ascii('free')] },
}

// Upload slots. Change a limit here and every page (and the server) follows.
export const UPLOADS = {
  document: { types: ['pdf', 'jpg', 'png'], maxMB: 10, maxFiles: 1, noun: 'file' },      // IC, forms, slips, receipts, letters
  photo: { types: ['jpg', 'png'], maxMB: 10, maxFiles: 20, noun: 'photo' },              // listing photos
  avatar: { types: ['jpg', 'png'], maxMB: 2, maxFiles: 1, noun: 'photo' },               // profile picture
  spreadsheet: { types: ['xlsx', 'csv'], maxMB: 5, maxFiles: 1, noun: 'file' },          // Setup → agents import
  video: { types: ['mp4', 'mov'], maxMB: 500, maxFiles: 1, noun: 'video' },               // training videos
  listingVideo: { types: ['mp4', 'mov'], maxMB: 300, maxFiles: 3, noun: 'video' },        // listing walk-through, facilities, surroundings (3 per listing in all)
}

export function uploadRule(kind) {
  const rule = UPLOADS[kind]
  if (!rule) throw new Error(`Unknown upload kind: ${kind}`)
  return rule
}

const orList = words => words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`
const typeNames = kind => orList(uploadRule(kind).types.map(t => FILE_TYPES[t].label))

export const fileSize = b => b < 1024 ? `${b} B` : b < MB ? `${Math.round(b / 1024)} KB` : `${(b / MB).toFixed(1)} MB`

// Which allowed type a file name is, or undefined.
export const typeOf = (name, kind) => uploadRule(kind).types.find(t => FILE_TYPES[t].ext.some(e => String(name).toLowerCase().endsWith(e)))

// For <input accept="…">.
export const acceptFor = kind => uploadRule(kind).types.flatMap(t => [...FILE_TYPES[t].ext, ...FILE_TYPES[t].mime]).join(',')

// Line for the page, e.g. "PDF, JPG or PNG · max 10 MB".
export function uploadHint(kind) {
  const { maxMB, maxFiles, noun } = uploadRule(kind)
  return `${typeNames(kind)} · max ${maxMB} MB${maxFiles > 1 ? ` each · up to ${maxFiles} ${noun}s` : ''}`
}

// Why a file can't go in this slot, or null when it can. `head` is the
// file's first bytes (fileHead() in the browser, the buffer on the server);
// without it, only the name and size are checked.
export function checkFile({ name, size }, kind, head) {
  const { maxMB } = uploadRule(kind)
  const type = typeOf(name, kind)
  if (!type) return `${name}: only ${typeNames(kind)} files can be uploaded here.`
  if (!size) return `${name} is empty.`
  if (size > maxMB * MB) return `${name} is ${fileSize(size)}; the limit is ${maxMB} MB.`
  if (head) {
    const t = FILE_TYPES[type]
    const sigs = Array.isArray(t.magic?.[0]) ? t.magic : [t.magic]
    const real = t.text ? !head.includes(0) : sigs.some(sig => sig.every((b, i) => head[(t.at || 0) + i] === b))
    if (!real) return `${name} is not a real ${t.label} file.`
  }
  return null
}

// The first bytes of a File or Blob, for checkFile().
export const fileHead = async file => new Uint8Array(await file.slice(0, 512).arrayBuffer())

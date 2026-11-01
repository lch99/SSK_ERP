// Reading and writing simple spreadsheets in the browser, with no library:
// .xlsx (a zip of XML files), .csv, and cells pasted from Excel (tab-separated).
// Only what an import needs: the text of the first sheet's cells.

// ── Reading ──────────────────────────────────────────────────────────────────

// A File (or Blob with a name) → rows of cell strings.
export async function readSheetFile(file) {
  const name = (file.name || '').toLowerCase()
  if (/\.(xls|numbers|ods)$/.test(name)) throw new Error('Save the file as Excel Workbook (.xlsx) or CSV, then upload it again.')
  const buf = new Uint8Array(await file.arrayBuffer())
  if (buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf)
  return parseDelimited(new TextDecoder().decode(buf))
}

// CSV, semicolon-separated or tab-separated text (Excel's copy) → rows.
export function parseDelimited(text) {
  const src = String(text).replace(/^﻿/, '')
  const first = src.split(/\r?\n/, 1)[0]
  const sep = first.includes('\t') ? '\t' : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ','
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unxml = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_ENTITIES[e] ?? m)
const attrs = s => Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map(m => [m[1].replace(/^\w+:/, m[1].startsWith('r:') ? 'r:' : ''), unxml(m[2])]))
// Element names may carry a namespace prefix (<x:c>) in files from some tools.
const tag = name => `<(?:\\w+:)?${name}\\b`
const end = name => `<\\/(?:\\w+:)?${name}>`
// All text runs inside an element (shared strings and inline strings), leaving out phonetic hints.
const runs = xml => [...xml.replace(new RegExp(`${tag('rPh')}[\\s\\S]*?${end('rPh')}`, 'g'), '')
  .matchAll(new RegExp(`${tag('t')}[^>]*>([\\s\\S]*?)${end('t')}`, 'g'))].map(m => unxml(m[1])).join('')
const colIndex = ref => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1

export async function readXlsx(bytes) {
  const files = unzip(bytes)
  const read = async path => {
    const f = files.get(path)
    return f ? new TextDecoder().decode(await inflate(f)) : null
  }
  const workbook = await read('xl/workbook.xml')
  if (workbook == null) throw new Error("This doesn't look like an Excel file. Save it as .xlsx or CSV and try again.")
  // The first sheet, found through the workbook's relationships.
  const sheet = attrs(workbook.match(new RegExp(`${tag('sheet')}([^>]*)`))?.[1] || '')
  const rels = (await read('xl/_rels/workbook.xml.rels')) || ''
  const rel = [...rels.matchAll(new RegExp(`${tag('Relationship')}([^>]*)`, 'g'))].map(m => attrs(m[1])).find(r => r.Id === sheet['r:id'])
  const target = rel?.Target ? (rel.Target.startsWith('/') ? rel.Target.slice(1) : `xl/${rel.Target.replace(/^\.\//, '')}`) : 'xl/worksheets/sheet1.xml'
  const xml = await read(target)
  if (xml == null) throw new Error("Couldn't find the first sheet in this file.")
  const sharedXml = (await read('xl/sharedStrings.xml')) || ''
  const shared = [...sharedXml.matchAll(new RegExp(`${tag('si')}[^>]*>([\\s\\S]*?)${end('si')}`, 'g'))].map(m => runs(m[1]))

  const rows = []
  const rowRe = new RegExp(`${tag('row')}([^>]*?)(?:\\/>|>([\\s\\S]*?)${end('row')})`, 'g')
  const cellRe = new RegExp(`${tag('c')}([^>]*?)(?:\\/>|>([\\s\\S]*?)${end('c')})`, 'g')
  for (const rm of xml.matchAll(rowRe)) {
    // Row numbers come from the file, so blank rows keep "Row 7" meaning row 7 in Excel.
    const r = Number(attrs(rm[1]).r) || rows.length + 1
    const row = []
    for (const cm of (rm[2] || '').matchAll(cellRe)) {
      const a = attrs(cm[1])
      const body = cm[2] || ''
      const v = body.match(new RegExp(`${tag('v')}[^>]*>([\\s\\S]*?)${end('v')}`))?.[1]
      const value = a.t === 's' ? shared[Number(v)] ?? ''
        : a.t === 'inlineStr' ? runs(body)
        : a.t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE')
        : a.t === 'e' ? '' : unxml(v ?? '')
      row[a.r ? colIndex(a.r) : row.length] = value
    }
    rows[r - 1] = Array.from(row, x => x ?? '')
  }
  return Array.from(rows, x => x ?? [])
}

// Zip entries by name: { method, data } (data still compressed).
function unzip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  let eocd = -1
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error("This file couldn't be opened. Save it again as .xlsx or CSV.")
  const files = new Map()
  let p = dv.getUint32(eocd + 16, true)
  for (let n = dv.getUint16(eocd + 10, true); n > 0 && dv.getUint32(p, true) === 0x02014b50; n--) {
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true)
    const local = dv.getUint32(p + 42, true)
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true)
    files.set(new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen)),
      { method: dv.getUint16(p + 10, true), data: u8.subarray(start, start + dv.getUint32(p + 20, true)) })
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}

async function inflate({ method, data }) {
  if (method === 0) return data
  if (method !== 8) throw new Error("This file uses a kind of compression that can't be read here. Save it again as .xlsx or CSV.")
  const out = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(out).arrayBuffer())
}

// ── Writing (shared with the server) ────────────────────────────────────────
export { makeXlsx, zip, XLSX_TYPE } from '../../shared/xlsx.js'

// Let the browser save a file.
export function download(bytes, filename, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

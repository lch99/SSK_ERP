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

// ── Writing ──────────────────────────────────────────────────────────────────

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
const colName = i => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26))
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

// sheets: [{ name, rows: (string|number)[][], widths?: number[], lists?: { [col]: string[] } }].
// Every column is formatted as Text, so IC and phone numbers keep their
// leading zeros when typed; a JS number goes in as a number, so it adds up. Row 1 is a bold, frozen header;
// `lists` adds a drop-down to a column. Returns the .xlsx file's bytes.
export function makeXlsx(sheets) {
  const sheetXml = s => {
    const width = Math.max(...s.rows.map(r => r.length), 1)
    const cols = Array.from({ length: width }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${s.widths?.[i] || 14}" style="1" customWidth="1"/>`).join('')
    const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (v === '' || v == null ? ''
      : typeof v === 'number' && ri > 0 && Number.isFinite(v) ? `<c r="${colName(ci)}${ri + 1}" s="0"><v>${v}</v></c>`
        : `<c r="${colName(ci)}${ri + 1}" t="inlineStr" s="${ri === 0 ? 2 : 1}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`)).join('')}</row>`).join('')
    // A drop-down holds at most 255 characters, and its items can't contain commas.
    const lists = Object.entries(s.lists || {}).filter(([, items]) => items.length && items.every(x => !/[,"]/.test(x)) && items.join(',').length <= 250)
      .map(([col, items]) => `<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${colName(Number(col))}2:${colName(Number(col))}2000"><formula1>"${esc(items.join(','))}"</formula1></dataValidation>`)
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}">`
      + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      + `<cols>${cols}</cols><sheetData>${rows}</sheetData>`
      + (lists.length ? `<dataValidations count="${lists.length}">${lists.join('')}</dataValidations>` : '') + '</worksheet>'
  }
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>`
      + sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}">`
      + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF8B0836"/><name val="Calibri"/></font></fonts>'
      + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1F2"/><bgColor indexed="64"/></patternFill></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
      + '<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ]
  const enc = new TextEncoder()
  return zip(files.map(([name, xml]) => ({ name, data: enc.encode(xml) })))
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = data => {
  let c = 0xffffffff
  for (const b of data) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// files: [{ name, data: Uint8Array }] → zip bytes. Stored as-is unless a
// `deflate` (raw deflate, sync) is given; the files here are small either way.
export function zip(files, deflate) {
  const enc = new TextEncoder()
  const parts = [], central = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const body = deflate ? deflate(f.data) : f.data
    const head = (size, sig) => {
      const b = new Uint8Array(size + name.length)
      const v = new DataView(b.buffer)
      v.setUint32(0, sig, true)
      return [b, v]
    }
    const [local, lv] = head(30, 0x04034b50)
    lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, deflate ? 8 : 0, true); lv.setUint16(12, 0x21, true)
    lv.setUint32(14, crc32(f.data), true); lv.setUint32(18, body.length, true); lv.setUint32(22, f.data.length, true); lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const [dir, dv] = head(46, 0x02014b50)
    dv.setUint16(4, 20, true); dv.setUint16(6, 20, true); dv.setUint16(8, 0x0800, true); dv.setUint16(10, deflate ? 8 : 0, true); dv.setUint16(14, 0x21, true)
    dv.setUint32(16, crc32(f.data), true); dv.setUint32(20, body.length, true); dv.setUint32(24, f.data.length, true); dv.setUint16(28, name.length, true)
    dv.setUint32(42, offset, true)
    dir.set(name, 46)
    parts.push(local, body)
    central.push(dir)
    offset += local.length + body.length
  }
  const size = central.reduce((n, c) => n + c.length, 0)
  const tail = new Uint8Array(22)
  const tv = new DataView(tail.buffer)
  tv.setUint32(0, 0x06054b50, true); tv.setUint16(8, files.length, true); tv.setUint16(10, files.length, true)
  tv.setUint32(12, size, true); tv.setUint32(16, offset, true)
  const out = new Uint8Array(offset + size + 22)
  let at = 0
  for (const p of [...parts, ...central, tail]) { out.set(p, at); at += p.length }
  return out
}

// Let the browser save a file.
export function download(bytes, filename, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

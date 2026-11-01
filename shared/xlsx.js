// Writing .xlsx files with no library: a zip of XML files. The pages (Setup's
// agent template, the agent list) and the server (Excel downloads of a list,
// backend/src/routes/erp.js) write the same file with it.

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
const colName = i => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26))
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

// sheets: [{ name, rows: (string|number)[][], widths?: number[], lists?: { [col]: string[] } }].
// Every column is formatted as Text, so IC and phone numbers keep their
// leading zeros when typed; a JS number goes in as a number, so it adds up. Row 1 is a bold, frozen header;
// `lists` adds a drop-down to a column. Returns the .xlsx file's bytes.
export const makeXlsx = sheets => zip(xlsxParts(sheets))

// The files inside an .xlsx, [{ name, data }], for zip(). The server compresses
// them first (a big list shrinks about tenfold).
export function xlsxParts(sheets) {
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
  return files.map(([name, xml]) => ({ name, data: enc.encode(xml) }))
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

// files: [{ name, data: Uint8Array, body?, crc? }] → zip bytes. Stored as-is
// unless a `deflate` (raw deflate, sync) is given, or a file brings its own
// compressed `body` and the `crc` of its data (the server works them out first).
export function zip(files, deflate) {
  const enc = new TextEncoder()
  const parts = [], central = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const packed = f.body != null || !!deflate
    const body = f.body ?? (deflate ? deflate(f.data) : f.data)
    const crc = f.crc ?? crc32(f.data)
    const head = (size, sig) => {
      const b = new Uint8Array(size + name.length)
      const v = new DataView(b.buffer)
      v.setUint32(0, sig, true)
      return [b, v]
    }
    const [local, lv] = head(30, 0x04034b50)
    lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, packed ? 8 : 0, true); lv.setUint16(12, 0x21, true)
    lv.setUint32(14, crc, true); lv.setUint32(18, body.length, true); lv.setUint32(22, f.data.length, true); lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const [dir, dv] = head(46, 0x02014b50)
    dv.setUint16(4, 20, true); dv.setUint16(6, 20, true); dv.setUint16(8, 0x0800, true); dv.setUint16(10, packed ? 8 : 0, true); dv.setUint16(14, 0x21, true)
    dv.setUint32(16, crc, true); dv.setUint32(20, body.length, true); dv.setUint32(24, f.data.length, true); dv.setUint16(28, name.length, true)
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

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

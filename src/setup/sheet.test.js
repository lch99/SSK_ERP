import { describe, it, expect } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { makeXlsx, readXlsx, parseDelimited, zip } from './sheet.js'

const rows = [['Name *', 'Branch *', 'IC no.'], ['Tan & Sons "Ah Kow"', 'Taman Desa', '012345-14-0001'], ['', 'Cheras', '']]

describe('spreadsheets', () => {
  it('reads back the .xlsx it writes, with drop-downs and several sheets', async () => {
    const bytes = makeXlsx([{ name: 'Agents', rows, lists: { 1: ['Taman Desa', 'Cheras'] } }, { name: 'Help', rows: [['x']] }])
    // Empty cells aren't written, so a row ends at its last filled cell.
    expect(await readXlsx(bytes)).toEqual([rows[0], rows[1], ['', 'Cheras']])
  })
  it('writes numbers as numbers, so Excel can add them up', async () => {
    const bytes = makeXlsx([{ name: 'Pay', rows: [['Name', 'RM'], ['Mei', 1234.5]] }])
    expect(new TextDecoder().decode(bytes)).toContain('<v>1234.5</v>')
    expect(await readXlsx(bytes)).toEqual([['Name', 'RM'], ['Mei', '1234.5']])
  })
  it('reads compressed files, shared strings and blank rows, as Excel saves them', async () => {
    const enc = s => new TextEncoder().encode(s)
    const files = [
      ['xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId3"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId3" Target="/xl/worksheets/data.xml"/></Relationships>'],
      ['xl/sharedStrings.xml', '<sst><si><t>Name</t></si><si><r><t>Lim </t></r><r><t xml:space="preserve">Mei &amp; Co</t></r></si></sst>'],
      ['xl/worksheets/data.xml', '<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="inlineStr"><x:is><x:t>Phone</x:t></x:is></x:c></x:row>'
        + '<x:row r="3"><x:c r="A3" t="s"><x:v>1</x:v></x:c><x:c r="B3" s="1"/><x:c r="C3"><x:v>123456789</x:v></x:c></x:row></x:sheetData></x:worksheet>'],
    ].map(([name, xml]) => ({ name, data: enc(xml) }))
    const bytes = zip(files, data => new Uint8Array(deflateRawSync(data)))
    expect(await readXlsx(bytes)).toEqual([['Name', '', 'Phone'], [], ['Lim Mei & Co', '', '123456789']])
  })
  it('parses CSV with quotes, semicolons, and tab-separated paste', () => {
    expect(parseDelimited('﻿Name,Note\r\n"Tan, Ah Kow","said ""hi"""\n')).toEqual([['Name', 'Note'], ['Tan, Ah Kow', 'said "hi"']])
    expect(parseDelimited('Name;Branch\nMei;TD')).toEqual([['Name', 'Branch'], ['Mei', 'TD']])
    expect(parseDelimited('Name\tBranch\nMei\tTD, KL')).toEqual([['Name', 'Branch'], ['Mei', 'TD, KL']])
  })
})

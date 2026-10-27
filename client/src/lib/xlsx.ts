/**
 * A small Excel (.xlsx) writer: one sheet, a bold header row, every cell kept as text, so a phone
 * number like 0300-1234567 or 3096627723 stays exactly as written (Excel would otherwise turn
 * long numbers into 3.09E+09 and drop leading zeros). No library: an .xlsx file is a zip of a
 * few XML files, written here without compression.
 */

type Cell = string | number | null | undefined

const enc = new TextEncoder()

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC_TABLE.at((c ^ b[i]) & 0xff)! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A zip file with the files stored as they are (no compression). */
function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const local = new Uint8Array(30 + name.length)
    const v = new DataView(local.buffer)
    v.setUint32(0, 0x04034b50, true)
    v.setUint16(4, 20, true) // version needed
    v.setUint16(6, 0x0800, true) // names are UTF-8
    v.setUint16(8, 0, true) // stored
    v.setUint16(10, 0, true)
    v.setUint16(12, 0x21, true) // 1 Jan 1980
    v.setUint32(14, crc, true)
    v.setUint32(18, f.data.length, true)
    v.setUint32(22, f.data.length, true)
    v.setUint16(26, name.length, true)
    v.setUint16(28, 0, true)
    local.set(name, 30)
    parts.push(local, f.data)

    const c = new Uint8Array(46 + name.length)
    const w = new DataView(c.buffer)
    w.setUint32(0, 0x02014b50, true)
    w.setUint16(4, 20, true)
    w.setUint16(6, 20, true)
    w.setUint16(8, 0x0800, true)
    w.setUint16(10, 0, true)
    w.setUint16(12, 0, true)
    w.setUint16(14, 0x21, true)
    w.setUint32(16, crc, true)
    w.setUint32(20, f.data.length, true)
    w.setUint32(24, f.data.length, true)
    w.setUint16(28, name.length, true)
    w.setUint32(42, offset, true)
    c.set(name, 46)
    central.push(c)
    offset += local.length + f.data.length
  }
  const size = central.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, files.length, true)
  e.setUint16(10, files.length, true)
  e.setUint32(12, size, true)
  e.setUint32(16, offset, true)
  const all = [...parts, ...central, end]
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of all) { out.set(p, at); at += p.length }
  return out
}

const xml = (s: string) =>
  s
    // Characters XML does not allow (control codes pasted from other systems) are dropped.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function colName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** The .xlsx file as bytes. `sheetName` is cut to Excel's 31 characters. */
export function buildXlsx(sheetName: string, head: string[], rows: Cell[][]): Uint8Array {
  const all = [head, ...rows]
  const widths = head.map((_, c) => Math.min(60, Math.max(8, ...all.slice(0, 500).map((r) => String(r[c] ?? '').length + 2))))
  const sheetRows = all
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          const s = String(v ?? '')
          if (!s) return ''
          return `<c r="${colName(ci)}${ri + 1}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(s.slice(0, 32000))}</t></is></c>`
        })
        .join('')
      return `<row r="${ri + 1}">${cells}</row>`
    })
    .join('')
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows}</sheetData>${all.length > 1 ? `<autoFilter ref="A1:${colName(head.length - 1)}${all.length}"/>` : ''}</worksheet>`
  const name = xml(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1')
  const files = [
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>${all.length > 1 ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name.replace(/'/g, "''")}'!$A$1:$${colName(head.length - 1)}$${all.length}</definedName></definedNames>` : ''}</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', text: sheet },
  ]
  return zip(files.map((f) => ({ name: f.name, data: enc.encode(f.text) })))
}

/** Save an .xlsx file in the browser. */
export function downloadXlsx(fileName: string, sheetName: string, head: string[], rows: Cell[][]): void {
  const bytes = buildXlsx(sheetName, head, rows)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

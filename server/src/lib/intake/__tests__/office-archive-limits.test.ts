import { afterEach, describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import PizZip from 'pizzip'
import { OFFICE_ARCHIVE_LIMITS as limits, readDocumentLines } from '../document-text.js'

const xml = '<w:document><w:body><w:p><w:r><w:t>Applicant: Acme LLC</w:t></w:r></w:p></w:body></w:document>'

function zip(entries: [string, string | Buffer][] = [['word/document.xml', xml]], compression: 'STORE' | 'DEFLATE' = 'DEFLATE'): Buffer {
  const archive = new PizZip()
  for (const [name, content] of entries) archive.file(name, content, { createFolders: false })
  return archive.generate({ type: 'nodebuffer', compression })
}

function records(buffer: Buffer): { central: number; local: number }[] {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  let central = buffer.readUInt32LE(end + 16)
  return Array.from({ length: buffer.readUInt16LE(end + 10) }, () => {
    const record = { central, local: buffer.readUInt32LE(central + 42) }
    central += 46 + buffer.readUInt16LE(central + 28) + buffer.readUInt16LE(central + 30) + buffer.readUInt16LE(central + 32)
    return record
  })
}

function declaredSize(buffer: Buffer, size: number, index = 0): Buffer {
  const { central, local } = records(buffer)[index]
  buffer.writeUInt32LE(size, central + 24)
  buffer.writeUInt32LE(size, local + 22)
  return buffer
}

afterEach(() => vi.restoreAllMocks())

describe('Office archive limits', () => {
  const attacks: [string, () => Buffer][] = [
    ['oversized upload', () => Buffer.alloc(10 * 1024 * 1024 + 1)],
    ['encrypted Office compound file', () => Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(100)])],
    ['compressed per-entry bomb', () => zip([['word/document.xml', 'A'.repeat(limits.entryBytes + 1)]])],
    ['bomb in an unused entry', () => zip([['word/document.xml', xml], ['unused.bin', 'A'.repeat(limits.entryBytes + 1)]])],
    ['forged small size hiding a compressed bomb', () => declaredSize(zip([['word/document.xml', 'A'.repeat(limits.entryBytes + 1)]]), 64)],
    ['oversized declared total', () => {
      const buffer = zip(Array.from({ length: 5 }, (_, i) => [`part${i}.xml`, 'x'.repeat(50000)]))
      for (let i = 0; i < 5; i++) declaredSize(buffer, limits.entryBytes, i)
      // Avoid the ratio guard so this specifically exercises the total limit.
      for (const { central } of records(buffer)) buffer.writeUInt32LE(50000, central + 20)
      return buffer
    }],
    ['suspicious compression ratio', () => zip([['word/document.xml', 'A'.repeat(1024 * 1024)]])],
    ['too many entries', () => zip(Array.from({ length: limits.entries + 1 }, (_, i) => [`part${i}.xml`, 'x']))],
    ['forged entry count', () => {
      const buffer = zip([['a.xml', 'a'], ['b.xml', 'b']])
      buffer.writeUInt16LE(1, buffer.length - 22 + 8)
      buffer.writeUInt16LE(1, buffer.length - 22 + 10)
      return buffer
    }],
    ['oversized central directory', () => {
      const buffer = zip()
      buffer.writeUInt32LE(limits.centralDirectoryBytes + 1, buffer.length - 22 + 12)
      return buffer
    }],
    ['encrypted entry', () => {
      const buffer = zip()
      const { central, local } = records(buffer)[0]
      buffer.writeUInt16LE(1, central + 8)
      buffer.writeUInt16LE(1, local + 6)
      return buffer
    }],
    ['local-only encryption', () => {
      const buffer = zip()
      buffer.writeUInt16LE(1, records(buffer)[0].local + 6)
      return buffer
    }],
    ['unsupported compression', () => {
      const buffer = zip()
      buffer.writeUInt16LE(99, records(buffer)[0].central + 10)
      return buffer
    }],
    ['ZIP64 end record', () => {
      const buffer = zip()
      buffer.writeUInt16LE(0xffff, buffer.length - 22 + 10)
      return buffer
    }],
    ['multi-disk archive', () => {
      const buffer = zip()
      buffer.writeUInt16LE(1, buffer.length - 22 + 4)
      return buffer
    }],
    ['truncated archive', () => zip().subarray(0, -10)],
    ['trailing garbage', () => Buffer.concat([zip(), Buffer.from('garbage')])],
    ['path traversal', () => zip([['../document.xml', xml]])],
    ['absolute path', () => zip([['/word/document.xml', xml]])],
    ['backslash path', () => zip([['word\\document.xml', xml]])],
    ['prototype path', () => zip([['word/__proto__/document.xml', xml]])],
    ['case-colliding names', () => zip([['part.xml', 'a'], ['PART.xml', 'b']])],
    ['duplicate names', () => {
      const buffer = zip([['a.xml', 'a'], ['b.xml', 'b']])
      const { central, local } = records(buffer)[1]
      buffer[central + 46] = 97
      buffer[local + 30] = 97
      return buffer
    }],
    ['local/central name mismatch', () => {
      const buffer = zip()
      buffer[records(buffer)[0].local + 30] = 120
      return buffer
    }],
    ['local/central size mismatch', () => {
      const buffer = zip()
      buffer.writeUInt32LE(1, records(buffer)[0].local + 22)
      return buffer
    }],
    ['overlapping local records', () => {
      const buffer = zip([['a.xml', 'a'], ['b.xml', 'b']])
      const [first, second] = records(buffer)
      buffer.writeUInt32LE(first.local, second.central + 42)
      return buffer
    }],
    ['CRC mismatch', () => {
      const buffer = zip()
      buffer.writeUInt32LE(0, records(buffer)[0].central + 16)
      return buffer
    }],
    ['stored size mismatch', () => declaredSize(zip(undefined, 'STORE'), 1)],
    ['symbolic link', () => {
      const buffer = zip()
      const { central } = records(buffer)[0]
      buffer.writeUInt16LE(0x0314, central + 4)
      buffer.writeUInt32LE(0xa1ff0000, central + 38)
      return buffer
    }],
  ]

  it.each(attacks)('rejects %s before either Office parser', async (_name, makeInput) => {
    const buffer = makeInput()
    const wordParser = vi.spyOn(PizZip.prototype, 'load')
    const excelParser = vi.spyOn(ExcelJS, 'Workbook')
    for (const extension of ['docx', 'xlsx']) {
      expect(await readDocumentLines(`attack.${extension}`, buffer)).toEqual({ lines: [], readable: false })
      await expect(readDocumentLines(`attack.${extension}`, buffer, { strictLimits: true })).rejects.toThrow(
        'Document is damaged or exceeds private processing limits; split or replace it',
      )
    }
    expect(wordParser).not.toHaveBeenCalled()
    expect(excelParser).not.toHaveBeenCalled()
  })

  it.each(['STORE', 'DEFLATE'] as const)('reads valid %s Word and Excel archives in both modes', async (compression) => {
    const word = zip(undefined, compression)
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Vehicles').addRow(['Year', 2026])
    const originalExcel = new PizZip(Buffer.from(await workbook.xlsx.writeBuffer()))
    const excel = originalExcel.generate({ type: 'nodebuffer', compression })
    for (const strictLimits of [false, true]) {
      expect(await readDocumentLines('valid.docx', word, { strictLimits })).toEqual({ readable: true, lines: ['Applicant: Acme LLC'] })
      expect(await readDocumentLines('valid.xlsx', excel, { strictLimits })).toEqual({ readable: true, lines: ['Sheet: Vehicles', 'Year | 2026'] })
    }
  })

  it('accepts the entry-count boundary including empty entries', async () => {
    const entries: [string, string][] = [['word/document.xml', xml]]
    for (let i = 1; i < limits.entries; i++) entries.push([`empty${i}`, ''])
    expect(await readDocumentLines('valid.docx', zip(entries), { strictLimits: true })).toEqual({ readable: true, lines: ['Applicant: Acme LLC'] })
  })

  it('accepts the per-entry size boundary without extracting unused content as text', async () => {
    const buffer = zip([['word/document.xml', xml], ['unused.bin', Buffer.alloc(limits.entryBytes)]], 'STORE')
    expect(await readDocumentLines('valid.docx', buffer, { strictLimits: true })).toEqual({ readable: true, lines: ['Applicant: Acme LLC'] })
  })

  it('retains strict full-line preservation and text-limit failures after safe Office parsing', async () => {
    const document = (text: string) => zip([['word/document.xml', `<w:p><w:t>${text}</w:t></w:p>`]], 'STORE')
    const line = 'A'.repeat(600)
    expect((await readDocumentLines('valid.docx', document(line), { strictLimits: true })).lines).toEqual([line])
    expect((await readDocumentLines('valid.docx', document(line))).lines[0]).toHaveLength(501)
    await expect(readDocumentLines('large.docx', document('A'.repeat(120001)), { strictLimits: true })).rejects.toThrow(/processing limits/)
  })
})

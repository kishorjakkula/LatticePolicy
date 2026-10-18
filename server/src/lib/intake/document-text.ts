import ExcelJS from 'exceljs'
import PizZip from 'pizzip'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { inflateRaw } from 'node:zlib'

/**
 * Reads a submission document into text lines, so a drafted value can point
 * at the line it came from and the reviewer can see it.
 *
 * Text formats, spreadsheets, and Word files are read here. PDFs and images
 * are not: they need an AI model that reads documents (see extractors.ts),
 * and their evidence is shown as the quoted text and page instead.
 */

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
export const MAX_DOCUMENTS = 10
const MAX_LINES = 4000
const MAX_LINE_LENGTH = 500

export const OFFICE_ARCHIVE_LIMITS = Object.freeze({
  entries: 1024,
  centralDirectoryBytes: 256 * 1024,
  entryBytes: 8 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
  expansionRatio: 200,
})

interface OfficeZipEntry {
  fileName: Uint8Array
  fileNameStr: string
  bitFlag: number
  compressionMethod: string
  compressedSize: number
  uncompressedSize: number
  crc32: number
  diskNumberStart: number
  localHeaderOffset: number
  extraFields: Record<number, unknown>
  unixPermissions: number | null
  dir: boolean
  decompressed: { getCompressedContent(): Uint8Array }
}

// PizZip's public load API collapses duplicate entries and its inflater has no
// output cap. Use its structured reader without calling getContent/checkCRC32.
const require = createRequire(import.meta.url)
const ZipEntries = require('pizzip/js/zipEntries.js') as new (data: undefined, options: object) => {
  files: OfficeZipEntry[]
  prepareReader(data: Buffer): void
  readEndOfCentral(): void
  readCentralDir(): void
  readLocalFiles(): void
}
const crc32 = require('pizzip/js/crc32.js') as (data: Uint8Array) => number
const inflate = promisify(inflateRaw)

async function boundedOfficeArchive(buffer: Buffer): Promise<PizZip> {
  const reject = () => { throw new Error('Unsafe Office archive') }
  if (buffer.length > MAX_DOCUMENT_BYTES || buffer.length < 22) reject()

  // Reject unsupported containers before the ZIP reader can follow ZIP64
  // offsets. Only the fixed end record is inspected here; PizZip reads entries.
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0 || end + 22 > buffer.length) reject()
  const count = buffer.readUInt16LE(end + 10)
  const directoryBytes = buffer.readUInt32LE(end + 12)
  const directoryOffset = buffer.readUInt32LE(end + 16)
  if (end + 22 + buffer.readUInt16LE(end + 20) !== buffer.length
    || buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0
    || buffer.readUInt16LE(end + 8) !== count || count === 0 || count > OFFICE_ARCHIVE_LIMITS.entries
    || directoryBytes > OFFICE_ARCHIVE_LIMITS.centralDirectoryBytes
    || directoryOffset + directoryBytes !== end) reject()

  const archive = new ZipEntries(undefined, { checkCRC32: false, decodeFileName: (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8') })
  archive.prepareReader(buffer)
  archive.readEndOfCentral()
  archive.readCentralDir()
  if (archive.files.length !== count) reject()

  let total = 0
  const centralNames = archive.files.map((entry) => {
    const { compressedSize, uncompressedSize } = entry
    total += uncompressedSize
    if (entry.diskNumberStart !== 0 || entry.extraFields[1]
      || (entry.bitFlag & ~0x080e) !== 0
      || !['\x00\x00', '\x08\x00'].includes(entry.compressionMethod)
      || !Number.isSafeInteger(compressedSize) || compressedSize < 0
      || !Number.isSafeInteger(uncompressedSize) || uncompressedSize < 0
      || (entry.compressionMethod === '\x00\x00' && compressedSize !== uncompressedSize)
      || uncompressedSize > OFFICE_ARCHIVE_LIMITS.entryBytes || total > OFFICE_ARCHIVE_LIMITS.totalBytes
      || uncompressedSize > Math.max(1, compressedSize) * OFFICE_ARCHIVE_LIMITS.expansionRatio
      || entry.localHeaderOffset < 0 || entry.localHeaderOffset + 30 > directoryOffset) reject()
    return Buffer.from(entry.fileName)
  })
  archive.readLocalFiles()

  const ranges = archive.files.map((entry) => {
    const local = entry.localHeaderOffset
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
    const end = dataStart + entry.compressedSize
    if (end > directoryOffset) reject()
    if ((entry.bitFlag & 8) === 0 && (
      buffer.readInt32LE(local + 14) !== entry.crc32
      || buffer.readUInt32LE(local + 18) !== entry.compressedSize
      || buffer.readUInt32LE(local + 22) !== entry.uncompressedSize
    )) reject()
    return { start: local, end }
  }).sort((a, b) => a.start - b.start)
  if (ranges[0].start !== 0 || ranges.some((range, i) => i > 0 && range.start < ranges[i - 1].end)) reject()

  const safe = new PizZip()
  const names = new Set<string>()
  for (const [index, entry] of archive.files.entries()) {
    const name = entry.fileNameStr
    const local = entry.localHeaderOffset
    const fileType = (entry.unixPermissions ?? 0) & 0xf000
    if (!centralNames[index].equals(Buffer.from(entry.fileName))
      || buffer.readUInt16LE(local + 6) !== entry.bitFlag
      || buffer.readUInt16LE(local + 8) !== entry.compressionMethod.charCodeAt(0)
      || (fileType !== 0 && fileType !== 0x8000 && fileType !== 0x4000)
      || !name || /[\\:\x00-\x1f\x7f]/.test(name) || name.startsWith('/')
      || name.split('/').some((part, i, parts) => part === '.' || part === '..' || part === '__proto__' || (!part && i !== parts.length - 1))
      || names.has(name.toLowerCase())) reject()
    names.add(name.toLowerCase())
    const compressed = entry.decompressed.getCompressedContent()
    const content = entry.compressionMethod === '\x08\x00'
      ? await inflate(compressed, { maxOutputLength: Math.max(1, entry.uncompressedSize) })
      : Buffer.from(compressed)
    if (content.length !== entry.uncompressedSize || crc32(content) !== entry.crc32
      || (entry.dir && content.length !== 0)) reject()
    safe.file(name, content, { dir: entry.dir, createFolders: false })
  }
  return safe
}

export type DocumentKind = 'text' | 'spreadsheet' | 'word' | 'pdf' | 'image' | 'unsupported'

const EXTENSION_KIND: Record<string, DocumentKind> = {
  txt: 'text', eml: 'text', csv: 'text', json: 'text', md: 'text', html: 'text', htm: 'text', xml: 'text',
  xlsx: 'spreadsheet',
  docx: 'word',
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
}

const KIND_CONTENT_TYPE: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  eml: 'message/rfc822', csv: 'text/csv', json: 'application/json', html: 'text/html', htm: 'text/html',
}

export function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim())
  return match ? match[1].toLowerCase() : ''
}

export function documentKind(fileName: string): DocumentKind {
  return EXTENSION_KIND[extensionOf(fileName)] || 'unsupported'
}

export function contentTypeFor(fileName: string): string {
  return KIND_CONTENT_TYPE[extensionOf(fileName)] || 'text/plain'
}

function cleanLines(lines: string[], strictLimits = false): string[] {
  const cleaned = lines
    .map((line) => line.replace(/\t/g, '  ').replace(/\s+$/g, ''))
    .filter((line) => line.trim().length > 0)
  if (strictLimits) {
    if (cleaned.length > MAX_LINES || cleaned.join('\n').length > 120000) throw new Error('Document text exceeds private processing limits; split the document')
    return cleaned
  }
  return cleaned
    .map((line) => (line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line))
    .slice(0, MAX_LINES)
}

function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

/**
 * Text outside markup, read character by character: everything between "<"
 * and ">" is dropped, and so is the content of script and style elements.
 * No angle bracket survives, so the result can never contain markup.
 */
function stripTags(text: string, replacement: string): string {
  let out = ''
  let index = 0
  let skipUntil: string | null = null
  while (index < text.length) {
    const open = text.indexOf('<', index)
    if (open < 0) {
      if (!skipUntil) out += text.slice(index)
      break
    }
    if (!skipUntil) out += text.slice(index, open)
    const close = text.indexOf('>', open + 1)
    if (close < 0) break
    const tag = text.slice(open + 1, close).trim().toLowerCase()
    const name = tag.replace(/^\//, '').split(/[\s/]/)[0]
    if (skipUntil) {
      if (tag.startsWith('/') && name === skipUntil) skipUntil = null
    } else {
      if (!tag.startsWith('/') && (name === 'script' || name === 'style')) skipUntil = name
      out += replacement
    }
    index = close + 1
  }
  return out.replace(/[<>]/g, ' ')
}

/**
 * Decodes the common entities, `&amp;` last so `&amp;lt;` stays the text "&lt;".
 * Angle brackets become look-alike characters, so decoded text never contains
 * markup again; the reader only needs the words.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '‹')
    .replace(/&gt;/g, '›')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function htmlToText(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
  return decodeEntities(stripTags(withBreaks, ' ')).split('\n').map((line) => line.trim()).join('\n')
}

/**
 * An email keeps its From, To, Subject, and Date headers and its text body.
 * Attachments inside the .eml are not unpacked; upload them separately.
 */
function emailToLines(raw: string): string[] {
  const split = raw.search(/\r?\n\r?\n/)
  const headerBlock = split >= 0 ? raw.slice(0, split) : raw
  let body = split >= 0 ? raw.slice(split).trim() : ''
  const headers = headerBlock.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)
  const kept = headers.filter((line) => /^(from|to|cc|subject|date):/i.test(line))
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(headerBlock)?.[1]
  if (boundary) {
    const parts = body.split(`--${boundary}`)
    const textPart = parts.find((part) => /content-type:\s*text\/plain/i.test(part))
      || parts.find((part) => /content-type:\s*text\/html/i.test(part))
    if (textPart) {
      const partSplit = textPart.search(/\r?\n\r?\n/)
      const partHeaders = partSplit >= 0 ? textPart.slice(0, partSplit) : ''
      let partBody = partSplit >= 0 ? textPart.slice(partSplit).trim() : textPart
      if (/quoted-printable/i.test(partHeaders)) partBody = decodeQuotedPrintable(partBody)
      if (/base64/i.test(partHeaders)) partBody = Buffer.from(partBody.replace(/\s+/g, ''), 'base64').toString('utf8')
      if (/text\/html/i.test(partHeaders)) partBody = htmlToText(partBody)
      body = partBody
    }
  } else if (/quoted-printable/i.test(headerBlock)) {
    body = decodeQuotedPrintable(body)
  }
  return [...kept, ...body.split(/\r?\n/)]
}

async function spreadsheetToLines(buffer: Buffer): Promise<string[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as any)
  const lines: string[] = []
  workbook.eachSheet((sheet) => {
    lines.push(`Sheet: ${sheet.name}`)
    sheet.eachRow((row) => {
      const values = (Array.isArray(row.values) ? row.values.slice(1) : [])
        .map((cell: any) => {
          if (cell == null) return ''
          if (cell instanceof Date) return cell.toISOString().slice(0, 10)
          if (typeof cell === 'object') return String(cell.result ?? cell.text ?? cell.richText?.map((part: any) => part.text).join('') ?? '')
          return String(cell)
        })
      if (values.some((value) => value.trim())) lines.push(values.join(' | '))
    })
  })
  return lines
}

function wordToLines(buffer: Buffer): string[] {
  const zip = new PizZip(buffer)
  const xml = zip.file('word/document.xml')?.asText() || ''
  const withBreaks = xml.replace(/<w:tab\/>/g, '  ').replace(/<\/w:p>/g, '\n')
  return decodeEntities(stripTags(withBreaks, ''))
    .split('\n')
}

/**
 * Text lines of a document, or an empty list when it cannot be read without
 * an AI model. Never throws for a damaged file: it is kept and reported as
 * unreadable, so the reviewer still sees it.
 */
export async function readDocumentLines(fileName: string, buffer: Buffer, { strictLimits = false } = {}): Promise<{ lines: string[]; readable: boolean }> {
  const kind = documentKind(fileName)
  const clean = (lines: string[]) => cleanLines(lines, strictLimits)
  try {
    if (kind === 'text') {
      const raw = buffer.toString('utf8')
      const ext = extensionOf(fileName)
      if (ext === 'eml') return { lines: clean(emailToLines(raw)), readable: true }
      if (ext === 'html' || ext === 'htm') return { lines: clean(htmlToText(raw).split(/\r?\n/)), readable: true }
      return { lines: clean(raw.split(/\r?\n/)), readable: true }
    }
    if (kind === 'spreadsheet' || kind === 'word') {
      const archive = await boundedOfficeArchive(buffer)
      // Never give the original untrusted headers/compressed bytes to a parser.
      const safeBuffer = archive.generate({ type: 'nodebuffer', compression: 'STORE' })
      return { lines: clean(kind === 'spreadsheet' ? await spreadsheetToLines(safeBuffer) : wordToLines(safeBuffer)), readable: true }
    }
  } catch {
    if (strictLimits) throw new Error('Document is damaged or exceeds private processing limits; split or replace it')
    return { lines: [], readable: false }
  }
  return { lines: [], readable: false }
}

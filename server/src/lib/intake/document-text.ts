import ExcelJS from 'exceljs'
import PizZip from 'pizzip'

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

function cleanLines(lines: string[]): string[] {
  return lines
    .map((line) => line.replace(/\t/g, '  ').replace(/\s+$/g, ''))
    .filter((line) => line.trim().length > 0)
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
export async function readDocumentLines(fileName: string, buffer: Buffer): Promise<{ lines: string[]; readable: boolean }> {
  const kind = documentKind(fileName)
  try {
    if (kind === 'text') {
      const raw = buffer.toString('utf8')
      const ext = extensionOf(fileName)
      if (ext === 'eml') return { lines: cleanLines(emailToLines(raw)), readable: true }
      if (ext === 'html' || ext === 'htm') return { lines: cleanLines(htmlToText(raw).split(/\r?\n/)), readable: true }
      return { lines: cleanLines(raw.split(/\r?\n/)), readable: true }
    }
    if (kind === 'spreadsheet') return { lines: cleanLines(await spreadsheetToLines(buffer)), readable: true }
    if (kind === 'word') return { lines: cleanLines(wordToLines(buffer)), readable: true }
  } catch {
    return { lines: [], readable: false }
  }
  return { lines: [], readable: false }
}

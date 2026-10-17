import { describe, expect, it, vi } from 'vitest'
import PizZip from 'pizzip'
import ExcelJS from 'exceljs'
import { normalizeFieldValue, textContains } from '../normalize.js'
import { documentKind, readDocumentLines } from '../document-text.js'
import { buildExtractionCatalog, buildTargetFields } from '../target-fields.js'
import {
  AnthropicExtractor,
  BuiltinExtractor,
  confidenceBand,
  createIntakeExtractor,
  parseModelOutput,
  readIntakeAiSettings,
  verifyEvidence,
  type ExtractionDocument,
} from '../extractors.js'

const EMAIL = [
  'From: Dana Whitfield <dana@brightway.example>',
  'To: submissions@carrier.example',
  'Subject: New submission - Northline Logistics LLC, commercial auto',
  '',
  'Hi team, please quote commercial auto for Northline Logistics.',
  'They run regional deliveries with a small fleet.',
].join('\n')

const ACORD = [
  'ACORD 125 COMMERCIAL INSURANCE APPLICATION',
  'Applicant: NORTHLINE LOGISTICS LLC',
  'FEIN: 84-2219031',
  'Mailing address: 1180 Commerce Pkwy',
  'City: Columbus',
  'Proposed eff. date: 12/01/2026      State: OH',
  'Primary Garaging ZIP: 43215',
  'Vehicle Count: 2',
  'Driver Count: 4',
  'Years in Business: 7',
  'Prior carrier: Great Lakes Casualty',
].join('\n')

const SCHEDULE = [
  'ACORD 127 BUSINESS AUTO SECTION',
  'Primary Garaging ZIP: 43219',
  'Driver Count: 4',
].join('\n')

async function doc(id: string, fileName: string, text: string): Promise<ExtractionDocument> {
  const content = Buffer.from(text, 'utf8')
  const { lines } = await readDocumentLines(fileName, content)
  return { documentId: id, fileName, contentType: 'text/plain', kind: documentKind(fileName), lines, content }
}

describe('normalizeFieldValue', () => {
  it('turns US and ISO dates into ISO dates and rejects impossible ones', () => {
    expect(normalizeFieldValue({ key: 'effectiveDate', type: 'date', options: [] }, '12/01/2026')).toEqual({ value: '2026-12-01', ok: true })
    expect(normalizeFieldValue({ key: 'effectiveDate', type: 'date', options: [] }, '2026-12-01')).toEqual({ value: '2026-12-01', ok: true })
    expect(normalizeFieldValue({ key: 'effectiveDate', type: 'date', options: [] }, '02/30/2026').ok).toBe(false)
  })

  it('reads money and counts as plain numbers', () => {
    expect(normalizeFieldValue({ key: 'x', type: 'number', options: [] }, '$1,000,000 CSL')).toEqual({ value: '1000000', ok: true })
    expect(normalizeFieldValue({ key: 'x', type: 'number', options: [] }, '2.5k')).toEqual({ value: '2500', ok: true })
    expect(normalizeFieldValue({ key: 'x', type: 'number', options: [] }, 'several').ok).toBe(false)
  })

  it('maps state names and codes, and select text to a listed option', () => {
    expect(normalizeFieldValue({ key: 'state', type: 'text', options: [] }, 'Ohio')).toEqual({ value: 'OH', ok: true })
    expect(normalizeFieldValue({ key: 'state', type: 'text', options: [] }, 'oh')).toEqual({ value: 'OH', ok: true })
    expect(normalizeFieldValue({ key: 'state', type: 'text', options: [] }, 'Narnia').ok).toBe(false)
    const radius = { key: 'risk.radiusClass', type: 'select' as const, options: ['local', 'intermediate', 'long-haul'] }
    expect(normalizeFieldValue(radius, 'Long Haul')).toEqual({ value: 'long-haul', ok: true })
    expect(normalizeFieldValue(radius, 'regional').ok).toBe(false)
    const alarm = { key: 'risk.fireAlarm', type: 'select' as const, options: ['true', 'false'] }
    expect(normalizeFieldValue(alarm, 'Yes')).toEqual({ value: 'true', ok: true })
    expect(normalizeFieldValue(alarm, 'no')).toEqual({ value: 'false', ok: true })
    const occupancy = { key: 'risk.occupancy', type: 'select' as const, options: ['OwnerOccupied', 'TenantOccupied', 'Seasonal'] }
    expect(normalizeFieldValue(occupancy, 'Owner occupied')).toEqual({ value: 'OwnerOccupied', ok: true })
  })

  it('matches quotes regardless of case, spacing, and quote marks', () => {
    expect(textContains('Applicant:  NORTHLINE  LOGISTICS LLC', 'applicant: northline logistics llc')).toBe(true)
    expect(textContains('Applicant: NORTHLINE', 'Southline')).toBe(false)
    expect(textContains('anything', '')).toBe(false)
  })
})

describe('readDocumentLines', () => {
  it('keeps email headers that matter and drops blank lines', async () => {
    const { lines, readable } = await readDocumentLines('mail.eml', Buffer.from(EMAIL))
    expect(readable).toBe(true)
    expect(lines[0]).toMatch(/^From: Dana/)
    expect(lines).toContain('Hi team, please quote commercial auto for Northline Logistics.')
    expect(lines.some((line) => line.trim() === '')).toBe(false)
  })

  it('reads the text part of a multipart email', async () => {
    const raw = [
      'From: a@b.example',
      'Subject: Hello',
      'Content-Type: multipart/alternative; boundary="XYZ"',
      '',
      '--XYZ',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Effective date: 12/01/2026 =',
      'confirmed',
      '--XYZ--',
    ].join('\r\n')
    const { lines } = await readDocumentLines('mail.eml', Buffer.from(raw))
    expect(lines).toContain('Effective date: 12/01/2026 confirmed')
  })

  it('strips nested markup and decodes entities once', async () => {
    const html = '<p>Applicant: Acme &amp; Sons</p><scr<script>ipt>alert(1)</script><p>Note: &amp;lt;b&amp;gt; &lt;5 years</p>'
    const { lines } = await readDocumentLines('page.html', Buffer.from(html))
    expect(lines).toContain('Applicant: Acme & Sons')
    expect(lines.join('\n')).not.toMatch(/<|>|script/i)
    expect(lines.join('\n')).toContain('&lt;b&gt;')
  })

  it('reads Word and Excel files as lines', async () => {
    const zip = new PizZip()
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Applicant: Acme LLC</w:t></w:r></w:p><w:p><w:r><w:t>FEIN: 12-3456789</w:t></w:r></w:p></w:body></w:document>')
    const word = await readDocumentLines('app.docx', zip.generate({ type: 'nodebuffer' }))
    expect(word.lines).toEqual(['Applicant: Acme LLC', 'FEIN: 12-3456789'])

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Vehicles')
    sheet.addRow(['Year', 'Make', 'VIN'])
    sheet.addRow([2022, 'Freightliner', '3ALACWFC4NDNA1234'])
    const excel = await readDocumentLines('sov.xlsx', Buffer.from(await workbook.xlsx.writeBuffer()))
    expect(excel.lines).toEqual(['Sheet: Vehicles', 'Year | Make | VIN', '2022 | Freightliner | 3ALACWFC4NDNA1234'])
  })

  it('reports PDFs, images, and damaged files as unreadable without an AI model', async () => {
    expect(await readDocumentLines('scan.pdf', Buffer.from('%PDF-1.4'))).toEqual({ lines: [], readable: false })
    expect(await readDocumentLines('photo.png', Buffer.from([1, 2, 3]))).toEqual({ lines: [], readable: false })
    expect(await readDocumentLines('broken.docx', Buffer.from('not a zip'))).toEqual({ lines: [], readable: false })
    expect(documentKind('virus.exe')).toBe('unsupported')
  })
})

describe('target fields', () => {
  it('uses the product quote screen fields, keyed risk.<key>', () => {
    const fields = buildTargetFields('commercial-auto')
    const keys = fields.map((field) => field.key)
    expect(keys.slice(0, 3)).toEqual(['productCode', 'effectiveDate', 'state'])
    expect(keys).toContain('insuredName')
    expect(keys).toContain('risk.garagingZip')
    expect(keys).toContain('risk.vehicleCount')
    const radius = fields.find((field) => field.key === 'risk.radiusClass')
    expect(radius?.type).toBe('select')
    expect(radius?.options).toContain('long-haul')
    const hazmat = fields.find((field) => field.key === 'qual.noHazmatHauling')
    expect(hazmat).toMatchObject({ section: 'Qualification questions', type: 'select', options: ['yes', 'no'], required: true })
  })

  it('does not require follow-up qualification questions asked only after a particular answer', () => {
    const followUp = buildTargetFields('personal-auto').find((field) => field.key === 'qual.majorViolationsOlderThan12Months')
    expect(followUp?.required).toBe(false)
    expect(followUp?.help).toMatch(/Answer only if/)
    expect(normalizeFieldValue({ key: 'qual.x', type: 'select', options: ['yes', 'no'] }, 'Yes')).toEqual({ value: 'yes', ok: true })
    expect(normalizeFieldValue({ key: 'qual.x', type: 'select', options: ['yes', 'no'] }, 'false')).toEqual({ value: 'no', ok: true })
  })

  it('offers only common fields when the product is unknown', () => {
    expect(buildTargetFields(null).some((field) => field.key.startsWith('risk.'))).toBe(false)
    expect(buildTargetFields('no-such-product').some((field) => field.key.startsWith('risk.'))).toBe(false)
  })
})

describe('BuiltinExtractor', () => {
  it('detects the product, drafts labelled values with evidence, and reports conflicts', async () => {
    const documents = [await doc('d1', 'mail.eml', EMAIL), await doc('d2', 'acord125.txt', ACORD), await doc('d3', 'acord127.txt', SCHEDULE)]
    const result = await new BuiltinExtractor().extract({ documents, catalog: buildExtractionCatalog() })
    expect(result.productCode).toBe('commercial-auto')

    const byKey = new Map(result.values.map((value) => [value.key, value]))
    expect(byKey.get('insuredName')?.value).toBe('NORTHLINE LOGISTICS LLC')
    expect(byKey.get('insuredName')?.confidence).toBe('medium')
    expect(byKey.get('effectiveDate')).toMatchObject({ value: '2026-12-01' })
    expect(byKey.get('state')).toMatchObject({ value: 'OH', confidence: 'medium' })
    expect(byKey.get('fein')).toMatchObject({ value: '84-2219031', confidence: 'high' })
    expect(byKey.get('risk.vehicleCount')).toMatchObject({ value: '2', confidence: 'high' })
    expect(byKey.get('risk.driverCount')?.evidence).toHaveLength(2)
    expect(byKey.get('insuredType')).toMatchObject({ value: 'company' })
    expect(byKey.get('brokerEmail')).toMatchObject({ value: 'dana@brightway.example' })

    // Scores: exact label 90, agreeing documents +5, synonym 75; keyword product detection stays below "high".
    expect(byKey.get('fein')?.score).toBe(90)
    expect(byKey.get('risk.driverCount')?.score).toBe(95)
    expect(byKey.get('insuredName')?.score).toBe(75)
    expect(result.productScore).toBeGreaterThanOrEqual(60)
    expect(result.productScore).toBeLessThan(85)

    const evidence = byKey.get('fein')!.evidence[0]
    expect(evidence).toMatchObject({ documentId: 'd2', line: 2, verified: true })

    const zip = result.conflicts.find((conflict) => conflict.key === 'risk.garagingZip')
    expect(zip?.options.map((option) => option.value).sort()).toEqual(['43215', '43219'])
    expect(byKey.has('risk.garagingZip')).toBe(false)
  })

  it('matches labels at the start of a line or after a column gap, not inside a longer label', async () => {
    const documents = [await doc('d1', 'app.txt', 'Mailing address: 1 Main St\nGaraging ZIP (all vehicles): 43219\nZIP code: 43215\nProposed eff. date: 12/01/2026      State: OH\n2. Applicant: Acme LLC')]
    const result = await new BuiltinExtractor().extract({ documents, catalog: buildExtractionCatalog(), productHint: 'homeowners' })
    const byKey = new Map(result.values.map((value) => [value.key, value]))
    expect(byKey.get('addressLine1')?.value).toBe('1 Main St')
    expect(byKey.has('risk.address')).toBe(false)
    expect(byKey.get('postalCode')?.value).toBe('43215')
    expect(byKey.get('state')?.value).toBe('OH')
    expect(byKey.get('insuredName')?.value).toBe('Acme LLC')
    expect(result.conflicts).toEqual([])
  })

  it('reads a questionnaire answer written after the question mark without a colon', async () => {
    const documents = [await doc('d1', 'q.txt', 'MFA enforced for all remote and privileged access? Yes\nNo material cyber loss events in the last 3 years?: No')]
    const result = await new BuiltinExtractor().extract({ documents, catalog: buildExtractionCatalog(), productHint: 'cyber' })
    const byKey = new Map(result.values.map((value) => [value.key, value]))
    expect(byKey.get('qual.mfaRequiredForRemoteAccess')).toMatchObject({ value: 'yes', score: 90 })
    expect(byKey.get('qual.noMaterialCyberLoss3Years')).toMatchObject({ value: 'no', score: 90 })
  })

  it('uses the reviewer product choice and never reads email headers as insured data', async () => {
    const documents = [await doc('d1', 'forwarded.txt', 'From: Broker <b@x.example>\nPhone: 555-0100')]
    const result = await new BuiltinExtractor().extract({ documents, catalog: buildExtractionCatalog(), productHint: 'cyber' })
    expect(result.productCode).toBe('cyber')
    expect(result.productConfidence).toBe('high')
    expect(result.values.find((value) => value.key === 'email')).toBeUndefined()
    expect(result.values.find((value) => value.key === 'phone')?.value).toBe('555-0100')
  })
})

describe('confidenceBand', () => {
  it('derives the label from the score', () => {
    expect([100, 85, 84, 60, 59, 0].map(confidenceBand)).toEqual(['high', 'high', 'medium', 'medium', 'low', 'low'])
  })
})

describe('verifyEvidence', () => {
  it('corrects the line of a real quote and flags a quote that is not in the document', async () => {
    const documents = [await doc('d2', 'acord125.txt', ACORD)]
    expect(verifyEvidence(documents, { documentId: 'd2', line: 0, page: null, quote: 'FEIN: 84-2219031' })).toMatchObject({ line: 2, verified: true })
    expect(verifyEvidence(documents, { documentId: 'd2', line: 2, page: null, quote: 'FEIN: 99-9999999' })).toMatchObject({ line: null, verified: false })
  })
})

describe('parseModelOutput', () => {
  it('keeps known fields, normalises values, and caps unverifiable quotes at low confidence', async () => {
    const documents = [await doc('d2', 'acord125.txt', ACORD), { documentId: 'p1', fileName: 'loss.pdf', contentType: 'application/pdf', kind: 'pdf' as const, lines: [], content: Buffer.from('%PDF') }]
    const result = parseModelOutput({
      productCode: 'commercial-auto',
      productConfidence: 'high',
      productReason: 'ACORD 127 and fleet terms.',
      summary: 'Regional carrier.',
      values: [
        { key: 'fein', value: '84-2219031', confidence: 'high', documentId: 'd2', line: 3, quote: 'FEIN: 84-2219031', reason: 'Stated.' },
        { key: 'effectiveDate', value: '12/01/2026', confidence: 'high', documentId: 'd2', line: 6, quote: 'Proposed eff. date: 12/01/2026', reason: 'Stated.' },
        { key: 'insuredName', value: 'Invented Corp', confidence: 'high', documentId: 'd2', line: 2, quote: 'Applicant: INVENTED CORP', reason: 'Made up.' },
        { key: 'priorCarrier', value: 'Great Lakes Casualty', confidence: 'medium', documentId: 'p1', page: 1, quote: 'GREAT LAKES CASUALTY', reason: 'Loss run header.' },
        { key: 'notAField', value: 'x', confidence: 'high', documentId: 'd2', quote: 'x', reason: '' },
        { key: 'state', value: 'OH', confidence: 'high', documentId: 'unknown-doc', quote: 'State: OH', reason: '' },
      ],
      conflicts: [
        { key: 'risk.garagingZip', reason: 'Two ZIPs.', options: [
          { value: '43215', documentId: 'd2', line: 7, quote: 'Primary Garaging ZIP: 43215' },
          { value: '43219', documentId: 'p1', page: 2, quote: 'Garaging ZIP 43219' },
        ] },
      ],
    }, { documents, catalog: buildExtractionCatalog() })

    const byKey = new Map(result.values.map((value) => [value.key, value]))
    expect(result.productCode).toBe('commercial-auto')
    expect(byKey.get('fein')).toMatchObject({ confidence: 'high', score: 90, evidence: [{ line: 2, verified: true }] })
    expect(byKey.get('insuredName')?.score).toBe(35)
    expect(byKey.get('effectiveDate')?.value).toBe('2026-12-01')
    expect(byKey.get('insuredName')?.confidence).toBe('low')
    expect(byKey.get('insuredName')?.reason).toMatch(/not found in the document/)
    // PDF quotes cannot be checked here; the confidence is kept and the evidence marked unverified.
    expect(byKey.get('priorCarrier')).toMatchObject({ confidence: 'medium', evidence: [{ page: 1, verified: false }] })
    expect(byKey.has('notAField')).toBe(false)
    expect(byKey.has('state')).toBe(false)
    expect(result.conflicts[0].options).toHaveLength(2)
    expect(result.warnings[0]).toMatch(/2 value\(s\) from the AI model were ignored/)
  })

  it('keeps the model\'s numeric score and only lowers it when a check fails', async () => {
    const documents = [await doc('d2', 'acord125.txt', ACORD)]
    const result = parseModelOutput({
      productCode: 'commercial-auto', productConfidence: 93, productReason: 'r', summary: 's',
      values: [
        { key: 'fein', value: '84-2219031', confidence: 97, documentId: 'd2', line: 3, quote: 'FEIN: 84-2219031', reason: 'Stated.' },
        { key: 'effectiveDate', value: 'early next year', confidence: 88, documentId: 'd2', line: 6, quote: 'Proposed eff. date: 12/01/2026', reason: 'Guess.' },
        { key: 'city', value: 'Columbus', confidence: 0.92, documentId: 'd2', line: 5, quote: 'City: Columbus', reason: 'Stated.' },
      ],
      conflicts: [],
    }, { documents, catalog: buildExtractionCatalog() })
    const byKey = new Map(result.values.map((value) => [value.key, value]))
    expect(result).toMatchObject({ productScore: 93, productConfidence: 'high' })
    expect(byKey.get('fein')).toMatchObject({ score: 97, confidence: 'high' })
    expect(byKey.get('effectiveDate')).toMatchObject({ score: 50, confidence: 'low' })
    expect(byKey.get('city')).toMatchObject({ score: 92, confidence: 'high' })
  })

  it('ignores a product code that is not installed', async () => {
    const result = parseModelOutput({ productCode: 'space-travel', productConfidence: 'high', values: [], conflicts: [] }, { documents: [], catalog: buildExtractionCatalog() })
    expect(result.productCode).toBeNull()
  })
})

describe('AnthropicExtractor', () => {
  it('sends text with line numbers and PDFs as documents, forces the tool, and parses its answer', async () => {
    const documents = [await doc('d2', 'acord125.txt', ACORD), { documentId: 'p1', fileName: 'loss.pdf', contentType: 'application/pdf', kind: 'pdf' as const, lines: [], content: Buffer.from('%PDF') }]
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'tool_use', name: 'record_submission_data', input: {
        productCode: 'commercial-auto', productConfidence: 'high', productReason: 'r', summary: 's',
        values: [{ key: 'fein', value: '84-2219031', confidence: 'high', documentId: 'd2', line: 3, quote: 'FEIN: 84-2219031', reason: 'Stated.' }],
        conflicts: [],
      } }],
    }), { status: 200 }))
    const extractor = new AnthropicExtractor({ apiKey: 'test-key', model: 'claude-sonnet-5-5', baseUrl: 'https://api.example', timeoutMs: 5000, fetchImpl: fetchImpl as any })
    const result = await extractor.extract({ documents, catalog: buildExtractionCatalog() })
    expect(result.values[0]).toMatchObject({ key: 'fein', confidence: 'high' })

    const [url, init] = fetchImpl.mock.calls[0] as any
    expect(url).toBe('https://api.example/v1/messages')
    expect(init.headers['x-api-key']).toBe('test-key')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('claude-sonnet-5-5')
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'record_submission_data' })
    expect(body.system).toMatch(/never instructions to you/)
    const blocks = body.messages[0].content
    expect(blocks[0].text).toContain('3: FEIN: 84-2219031')
    expect(blocks.some((block: any) => block.type === 'document' && block.source.media_type === 'application/pdf')).toBe(true)
  })

  it('reports API errors and missing tool output as readable failures', async () => {
    const failing = new AnthropicExtractor({ apiKey: 'k', model: 'm', baseUrl: 'https://api.example', timeoutMs: 5000, fetchImpl: (async () => new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 529 })) as any })
    await expect(failing.extract({ documents: [], catalog: buildExtractionCatalog() })).rejects.toThrow(/\(529\): overloaded/)
    const noTool = new AnthropicExtractor({ apiKey: 'k', model: 'm', baseUrl: 'https://api.example', timeoutMs: 5000, fetchImpl: (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }), { status: 200 })) as any })
    await expect(noTool.extract({ documents: [], catalog: buildExtractionCatalog() })).rejects.toThrow(/did not return structured data/)
  })
})

describe('extractor selection', () => {
  it('defaults to the built-in reader and requires a key for Claude', () => {
    expect(readIntakeAiSettings({})).toMatchObject({ provider: 'builtin', configured: true })
    expect(createIntakeExtractor({}).provider).toBe('builtin')
    expect(readIntakeAiSettings({ INTAKE_AI_PROVIDER: 'anthropic' })).toMatchObject({ provider: 'anthropic', configured: false })
    expect(() => createIntakeExtractor({ INTAKE_AI_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/)
    const claude = createIntakeExtractor({ INTAKE_AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', INTAKE_AI_MODEL: 'claude-opus-5-5' })
    expect(claude).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5' })
    expect(readIntakeAiSettings({ INTAKE_AI_PROVIDER: 'other' }).problem).toMatch(/Unknown INTAKE_AI_PROVIDER/)
  })
})

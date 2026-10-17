import { describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { once } from 'node:events'
import { PrivateDocumentExtractor, createIntakeExtractor, readIntakeAiSettings } from '../extractors.js'
import { callDocumentProcessor, privateAddress } from '../private-client.js'
import { buildExtractionCatalog } from '../target-fields.js'

const token = 'test-only-private-token-1234567890123456'
const document = { documentId: 'd1', fileName: 'application.txt', contentType: 'text/plain', kind: 'text' as const, content: Buffer.from('Applicant: Synthetic LLC'), lines: ['Applicant: Synthetic LLC'] }
const response = () => ({
  schemaVersion: 1, model: 'self-hosted-test', profile: { id: 'submission', version: '1.0.0' },
  documents: [{ id: 'd1', pages: [{ page: null, lines: document.lines }] }],
  result: { variant: 'commercial-auto', variantConfidence: 90, variantReason: 'Explicit application', summary: 'Synthetic submission', values: [{ key: 'insuredName', value: 'Synthetic LLC', confidence: 95, documentId: 'd1', line: 1, quote: document.lines[0], reason: 'Stated' }], conflicts: [] },
})

describe('private document processing', () => {
  it('maps a generic document result into submission fields with evidence and provenance', async () => {
    const request = vi.fn(async () => response())
    const extractor = new PrivateDocumentExtractor('http://document-processor:8080', token, 'submission', request)
    const result = await extractor.extract({ documents: [document], catalog: buildExtractionCatalog() })
    expect(result.productCode).toBe('commercial-auto')
    expect(result.values[0]).toMatchObject({ key: 'insuredName', value: 'Synthetic LLC', evidence: [{ verified: true, line: 0 }] })
    expect(result.processing).toEqual({ model: 'self-hosted-test', profileId: 'submission', profileVersion: '1.0.0' })
    const [url, secret, body] = request.mock.calls[0] as unknown as [string, string, any]
    expect(url).toBe('http://document-processor:8080/v1/extract')
    expect(secret).toBe(token)
    expect(body.schema.variants.some((variant: any) => variant.id === 'commercial-auto')).toBe(true)
    expect(body.documents[0].dataBase64).toBeUndefined()
    expect(body.schemaVersion).toBe(1)
  })

  it('verifies OCR quotes by page and lowers scores for unsupported claims', async () => {
    const output = response()
    output.documents = [{ id: 'd1', pages: [{ page: 1 as any, lines: document.lines }] }]
    Object.assign(output.result.values[0], { line: null, page: 1 })
    const pdf = { ...document, lines: [], kind: 'pdf' as const, fileName: 'application.pdf', contentType: 'application/pdf' }
    const extractor = new PrivateDocumentExtractor('http://document-processor:8080', token, 'submission', async () => output)
    const result = await extractor.extract({ documents: [pdf], catalog: buildExtractionCatalog() })
    expect(result.values[0].evidence[0]).toMatchObject({ page: 1, verified: true })
    output.result.values[0].quote = 'Not in the uploaded document'
    const unsupported = await extractor.extract({ documents: [pdf], catalog: buildExtractionCatalog() })
    expect(unsupported.values[0]).toMatchObject({ confidence: 'low', score: 35 })
  })

  it('rejects a mismatched profile or missing OCR evidence', async () => {
    const output = response()
    output.profile.id = 'unrequested-profile'
    const extractor = new PrivateDocumentExtractor('http://document-processor:8080', token, 'submission', async () => output)
    await expect(extractor.extract({ documents: [document], catalog: buildExtractionCatalog() })).rejects.toThrow(/Invalid/)
    output.profile.id = 'submission'; output.documents = []
    await expect(extractor.extract({ documents: [{ ...document, lines: [] }], catalog: buildExtractionCatalog() })).rejects.toThrow(/evidence/)
  })

  it('defaults to private data handling and never falls back to an external model', () => {
    expect(readIntakeAiSettings({ INTAKE_AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'secret' })).toMatchObject({ configured: false, problem: expect.stringContaining('private data boundary') })
    expect(() => createIntakeExtractor({ INTAKE_AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'secret' })).toThrow(/private data boundary/)
    expect(() => createIntakeExtractor({ INTAKE_AI_PROVIDER: 'private' })).toThrow(/DOCUMENT_PROCESSOR/)
    expect(createIntakeExtractor({ INTAKE_AI_PROVIDER: 'private', DOCUMENT_PROCESSOR_URL: 'http://document-processor:8080', DOCUMENT_PROCESSOR_TOKEN: token }).provider).toBe('private')
  })

  it('blocks public destinations and follows no redirects', async () => {
    expect(privateAddress('169.254.169.254')).toBe(false)
    await expect(callDocumentProcessor('http://8.8.8.8/v1/extract', token, {})).rejects.toThrow(/private/)
    const server = http.createServer((_req, res) => { res.writeHead(302, { location: 'https://public.invalid' }); res.end(); })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    try { await expect(callDocumentProcessor(`http://127.0.0.1:${(server.address() as any).port}`, token, {})).rejects.toThrow(/302/) }
    finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  it('times out after headers when a processor body stalls', async () => {
    const server = http.createServer((_req, res) => { res.writeHead(200); res.flushHeaders(); res.write('{') })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    try { await expect(callDocumentProcessor(`http://127.0.0.1:${(server.address() as any).port}`, token, {}, 50)).rejects.toThrow(/abort|timed out/i) }
    finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })
})

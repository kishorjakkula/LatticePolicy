import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import PizZip from 'pizzip'
import { describe, expect, it, vi } from 'vitest'
import { buildPolicyDocumentPacket } from '../document-generation.service.js'

const memory = vi.hoisted(() => new Map<string, Buffer>())
vi.mock('../document-storage.service.js', () => ({
  getDocumentStorageAdapter: () => ({
    name: 'test-memory',
    store: async ({ documentId, content }: { documentId: string; content: Buffer }) => {
      const storageUri = `test-memory://${documentId}`
      memory.set(storageUri, Buffer.from(content))
      return { storageUri }
    },
  }),
  retrieveAndVerifyStoredDocument: async (uri: string, hash: string) => {
    const bytes = memory.get(uri)
    return bytes && crypto.createHash('sha256').update(bytes).digest('hex') === hash ? bytes : null
  },
  // Generic PDF rendering is covered separately; exercise actual DOCX rendering here.
  // Stored like any artifact, because packet generation re-verifies every stored copy.
  renderAndStoreDocument: async ({ documentId }: { documentId: string }) => {
    const bytes = Buffer.from('%PDF-test')
    const storageUri = `test-memory://generic-pdf-${documentId}`
    memory.set(storageUri, bytes)
    return { storageUri, contentType: 'application/pdf', byteSize: bytes.length,
      contentHash: crypto.createHash('sha256').update(bytes).digest('hex'), storageAdapter: 'test-memory', renderedAt: '2026-11-01T00:00:00Z' }
  },
}))

describe('businessowners DOCX archived transaction output', () => {
  it('uses the real resolver/render/store/hash pipeline and retains earlier edition bytes', async () => {
    const content = fs.readFileSync(path.resolve(__dirname, '../../../../products/businessowners/documents/BOP-DEC.docx'))
    let edition = '2026-11-01'
    const q = async (sql: string) => {
      if (sql.includes('FROM forms_admin_forms')) return { rows: [{ form_id: `demo-form-${edition}`, form_number: 'BOP-DEC',
        form_title: 'Businessowners Demo Declarations', edition_date: edition, transaction_types: ['Issue'],
        output_format: 'DOCX', visibility: ['Insured', 'Agent', 'Internal'] }], rowCount: 1 }
      if (sql.includes('FROM forms_admin_template_assets')) return { rows: [{ mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    }
    const context = { tenantId: 'synthetic', policyId: 'policy-1', policyNumber: 'DEMO-BOP-1',
      transactionId: 'issue-1', transactionType: 'Issue' as const, productCode: 'businessowners', state: 'OH',
      effectiveDate: '2026-11-01', versionId: 'version-1',
      premium: { total: { amount: 800, currency: 'USD' } },
      inputSnapshot: { productCode: 'businessowners', applicant: { firstName: 'Synthetic', lastName: 'Business' },
        coverages: [{ code: 'BOP_BI_EE', limit: 100000, packageTerms: { waitingPeriodHours: 72, restorationMonths: 12 } }] } }
    const first = await buildPolicyDocumentPacket(q, context)
    const archived = first.documents.find(doc => doc.type === 'POLICY_FORM_DOCUMENT')!
    expect(archived).toBeDefined()
    const original = Buffer.from(memory.get(archived.uri)!)
    expect(new PizZip(original).file('word/document.xml')!.asText()).toContain('72 hours')
    expect(first.forms[0].edition).toBe('2026-11-01')
    edition = '2027-11-01'
    context.inputSnapshot.coverages[0].packageTerms.waitingPeriodHours = 48
    const next = await buildPolicyDocumentPacket(q, { ...context, transactionId: 'issue-2', versionId: 'version-2' })
    const revised = next.documents.find(doc => doc.type === 'POLICY_FORM_DOCUMENT')!
    expect(new PizZip(memory.get(revised.uri)!).file('word/document.xml')!.asText()).toContain('48 hours')
    expect(memory.get(archived.uri)).toEqual(original)
    expect(crypto.createHash('sha256').update(original).digest('hex')).toBe(archived.hash)
    expect(first.forms[0].edition).toBe('2026-11-01')
    expect(next.forms[0].edition).toBe('2027-11-01')
  })
})

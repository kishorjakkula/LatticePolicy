import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../db.js', () => ({ getDb: () => ({}), withTenantTx: vi.fn(), toRawQuery: vi.fn() }))
vi.mock('../services/document-storage.service.js', () => ({ retrieveAndVerifyStoredDocument: vi.fn(), regenerateAndVerifyDocument: vi.fn(), storeRatingWorksheet: vi.fn() }))
import { withTenantTx, toRawQuery } from '../db.js'
import { retrieveAndVerifyStoredDocument, regenerateAndVerifyDocument, storeRatingWorksheet } from '../services/document-storage.service.js'
import { policyRoutes } from '../routes/policies.routes.js'

const policy = '11111111-1111-4111-8111-111111111111'
const doc = '22222222-2222-4222-8222-222222222222'
const version = '33333333-3333-4333-8333-333333333333'
const transaction = '44444444-4444-4444-8444-444444444444'
const base = `/policies/${policy}/documents/${doc}/content`
const row = { document_id: doc, version_id: version, transaction_id: transaction, type: 'POLICY_PACKET', integrity_status: 'VERIFIED', hash: 'original-hash', metadata: { customerSafe: true, artifact: { storageUri: 'private/original.pdf', contentType: 'application/pdf', byteSize: 100 } } }
const query = vi.fn()
let internal = true
let linked = true
let authorized = true
const app = express()
app.use((req: any, _res, next) => {
  req.tenant = { tenantId: 'tenant-a' }
  req.user = { id: 'test', customerId: 'customer', roles: [], permissions: authorized ? [internal ? 'page.policy.view' : 'customer.portal.read'] : [] }
  next()
})
app.use(policyRoutes)
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode || 500).json({ code: err.code }))

describe('archive-only document retrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    internal = linked = authorized = true
    vi.mocked(withTenantTx).mockImplementation(async (_tenant, callback) => callback({} as any))
    vi.mocked(toRawQuery).mockReturnValue(query)
    query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('policy_customer_links')) return { rowCount: linked ? 1 : 0, rows: [] }
      if (sql.includes('UPDATE')) return { rowCount: 1, rows: [] }
      const match = (!params[3] || params[3] === version) && (!params[4] || params[4] === transaction)
      return { rowCount: match ? 1 : 0, rows: match ? [row] : [] }
    })
    vi.mocked(retrieveAndVerifyStoredDocument).mockResolvedValue(Buffer.from('%PDF-original'))
  })
  it('matches exact tenant, policy, document, version and transaction before reading original bytes', async () => {
    const res = await request(app).get(`${base}?versionId=${version}&transactionId=${transaction}`).expect(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(query).toHaveBeenCalledWith(expect.stringContaining('AND ($5::uuid IS NULL OR transaction_id = $5::uuid)'), ['tenant-a', policy, doc, version, transaction])
    expect(retrieveAndVerifyStoredDocument).toHaveBeenCalledWith('private/original.pdf', 'original-hash')
    expect(regenerateAndVerifyDocument).not.toHaveBeenCalled()
  })
  it.each([`versionId=${transaction}`, `transactionId=${version}`])('never substitutes another transaction/version: %s', async scope => {
    await request(app).get(`${base}?${scope}`).expect(404)
    expect(retrieveAndVerifyStoredDocument).not.toHaveBeenCalled()
  })
  it.each(['versionId=bad', 'transactionId=bad', `versionId=${version}&versionId=${transaction}`])('validates scope %s', async scope => {
    await request(app).get(`${base}?${scope}`).expect(400)
    expect(query.mock.calls.some(([sql]) => /FROM documents|UPDATE documents/.test(sql))).toBe(false)
  })
  it('refuses missing/corrupt archives without reconstructing or re-rendering originals', async () => {
    vi.mocked(retrieveAndVerifyStoredDocument).mockResolvedValue(null)
    await request(app).get(base).expect(409)
    expect(regenerateAndVerifyDocument).not.toHaveBeenCalled()
    expect(storeRatingWorksheet).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledWith(expect.stringContaining("integrity_status='FAILED'"), ['tenant-a', policy, doc])
  })
  it.each(['FAILED', 'UNVERIFIED'])('refuses %s outputs server-side', async integrity_status => {
    query.mockResolvedValue({ rowCount: 1, rows: [{ ...row, integrity_status }] })
    await request(app).get(base).expect(409)
    expect(retrieveAndVerifyStoredDocument).not.toHaveBeenCalled()
  })
  it('refuses legacy worksheets without archived artifacts and never backfills on GET', async () => {
    query.mockResolvedValue({ rowCount: 1, rows: [{ ...row, type: 'RATING_WORKSHEET', metadata: { snapshot: { payload: {}, premium: {} } } }] })
    await request(app).get(base).expect(409)
    expect(storeRatingWorksheet).not.toHaveBeenCalled()
  })
  it('preserves RBAC', async () => {
    authorized = false
    await request(app).get(base).expect(403)
    expect(retrieveAndVerifyStoredDocument).not.toHaveBeenCalled()
  })
  it('preserves linked-customer and customer-safe checks', async () => {
    internal = false
    linked = false
    await request(app).get(base).expect(404)
    expect(retrieveAndVerifyStoredDocument).not.toHaveBeenCalled()
    linked = true
    query.mockImplementation(async (sql: string) => sql.includes('policy_customer_links') ? { rowCount: 1, rows: [] } : { rowCount: 1, rows: [{ ...row, metadata: { ...row.metadata, customerSafe: false } }] })
    await request(app).get(base).expect(403)
    expect(retrieveAndVerifyStoredDocument).not.toHaveBeenCalled()
  })
  it.each([
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ])('downloads archived native %s without converting it', async (contentType, extension) => {
    query.mockResolvedValue({ rowCount: 1, rows: [{ ...row, metadata: { ...row.metadata, artifact: { ...row.metadata.artifact, contentType } } }] })
    const res = await request(app).get(base).expect(200)
    expect(res.headers['content-type']).toContain(contentType)
    expect(res.headers['content-disposition']).toBe(`attachment; filename="POLICY_PACKET-${doc}.${extension}"`)
    expect(regenerateAndVerifyDocument).not.toHaveBeenCalled()
    expect(storeRatingWorksheet).not.toHaveBeenCalled()
  })
})

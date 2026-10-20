import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../db.js', () => ({ withTenantTx: vi.fn(), toRawQuery: vi.fn() }))
import { withTenantTx, toRawQuery } from '../../db.js'
import { archivedDocumentReference, getVersionDetails } from '../policy.service.js'

const query = vi.fn()
const version = { payload: { risks: [{ old: true }] }, processed_at: '2026-01-01', transaction_id: 'tx1', transaction_number: 'END-1', transaction_type: 'Endorsement', effective_date: '2026-01-01' }
const ready = { document_id: 'doc', transaction_id: 'tx1', version_id: 'v1', type: 'POLICY_PACKET', hash: 'hash', integrity_status: 'VERIFIED', metadata: { artifact: { storageUri: 'private/original', byteSize: 100, contentType: 'application/pdf' } } }

describe('pinned version Forms & Documents', () => {
  beforeEach(() => {
    vi.mocked(withTenantTx).mockImplementation(async (_tenant, callback) => callback({} as any))
    vi.mocked(toRawQuery).mockReturnValue(query)
    query.mockReset().mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT payload')) return { rowCount: 1, rows: [version] }
      if (sql.includes('FROM policy_forms')) return { rowCount: 1, rows: [{ code: 'OLD', edition: '2020-01', snapshot_hash: 'pinned', data: { title: 'Original wording' }, metadata: { packetPlacement: 'End', attachmentRuleIds: ['rule-v1'] } }] }
      if (sql.includes('FROM documents')) return { rowCount: 1, rows: [ready] }
      return { rowCount: 0, rows: [] }
    })
  })
  it('loads only exact tenant/policy/version and transaction-owned snapshots, without consulting forms master', async () => {
    const result = await getVersionDetails({} as any, 'tenant', 'policy', 'v1')
    expect(result).toMatchObject({ policyId: 'policy', versionId: 'v1', transactionId: 'tx1', transactionNumber: 'END-1', payload: version.payload, forms: [{ formNumber: 'OLD', editionDate: '2020-01', formTitle: 'Original wording', snapshotHash: 'pinned', reasons: ['rule-v1'] }], documents: [{ documentId: 'doc', versionId: 'v1', available: true }] })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM policy_forms WHERE tenant_id=$1 AND policy_id=$2 AND transaction_id=$3'), ['tenant', 'policy', 'tx1'])
    expect(query).toHaveBeenCalledWith(expect.stringContaining('transaction_id IS NOT DISTINCT FROM $4::uuid'), ['tenant', 'policy', 'v1', 'tx1'])
    expect(query.mock.calls.every(([sql]) => !/forms_catalog|forms_admin/.test(sql))).toBe(true)
    expect(result.documents[0]).not.toHaveProperty('storageUri')
    expect(result.documents[0]).not.toHaveProperty('metadata')
  })
  it('rejects a version missing in this tenant/policy before looking up attachments', async () => {
    query.mockResolvedValue({ rowCount: 0, rows: [] })
    await expect(getVersionDetails({} as any, 'other-tenant', 'policy', 'v1')).rejects.toMatchObject({ statusCode: 404, code: 'VERSION_NOT_FOUND' })
    expect(query).toHaveBeenCalledTimes(1)
  })
  it('does not broaden legacy versions with no transaction to policy-wide forms', async () => {
    query.mockImplementation(async (sql: string) => sql.startsWith('SELECT payload') ? { rowCount: 1, rows: [{ ...version, transaction_id: null }] } : { rowCount: 0, rows: [] })
    expect((await getVersionDetails({} as any, 'tenant', 'policy', 'v1')).forms).toEqual([])
    expect(query.mock.calls.some(([sql]) => sql.includes('FROM policy_forms'))).toBe(false)
    expect(query).toHaveBeenCalledWith(expect.stringContaining('transaction_id IS NOT DISTINCT FROM $4::uuid'), ['tenant', 'policy', 'v1', null])
  })
  it.each([
    { integrity_status: 'FAILED' }, { integrity_status: 'UNVERIFIED' }, { hash: null },
    { metadata: {} }, { metadata: { status: 'PENDING', artifact: ready.metadata.artifact } },
    { metadata: { artifact: { ...ready.metadata.artifact, byteSize: 0 } } },
  ])('fails closed on non-ready persisted outputs %j', overrides => {
    expect(archivedDocumentReference({ ...ready, ...overrides })).toMatchObject({ status: 'UNAVAILABLE', available: false })
  })
})

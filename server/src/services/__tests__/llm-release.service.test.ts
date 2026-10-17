import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync, verify } from 'node:crypto'
import {
  registerLlmRelease,
  releaseInput,
  signLlmAuthorization,
  transitionLlmRelease,
} from '../llm-release.service.js'
import { getDefaultPermissionCodesForRoles } from '../../rbac.js'

const mocks = vi.hoisted(() => ({ q: vi.fn() }))
vi.mock('../../db.js', () => ({
  withTenantTx: async (_tenant: string, operation: any) => operation({}),
  toRawQuery: () => mocks.q,
}))
afterEach(() => vi.unstubAllEnvs())
describe('LLM release contracts', () => {
  const artifacts = {
    profileId: 'submission',
    profileVersion: '1.0.0',
    profileSha256: 'a'.repeat(64),
    model: 'local-v1',
    modelSha256: 'b'.repeat(64),
  }
  const input = {
    versionLabel: 'v1',
    artifacts,
    evaluation: {
      sampleCount: 20,
      fieldAccuracy: 0.97,
      evidenceAccuracy: 0.99,
      criticalErrors: 0,
      datasetSha256: 'c'.repeat(64),
      reportSha256: 'd'.repeat(64),
    },
  }
  describe('email opt-in during registration', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      vi.stubEnv('LLM_EMAIL_ENABLED', undefined)
      vi.stubEnv('LLM_REVIEW_UI_URL', '')
      vi.stubEnv('LLM_SMTP_HOST', '')
      vi.stubEnv('LLM_SMTP_FROM', '')
      mocks.q.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT ur.role_code'))
          return { rows: [{ role_code: 'llm_release_automation' }] }
        if (sql.includes('INSERT INTO llm_releases'))
          return {
            rows: [
              { release_id: 'registered', status: 'READY_FOR_VALIDATION' },
            ],
          }
        return { rows: [] }
      })
    })
    const actor = '11111111-1111-4111-8111-111111111111'
    it.each([undefined, 'false', 'TRUE', '1'])(
      'registers and audits without contacts, SMTP, URL or pending retries for flag %j',
      async (flag) => {
        vi.stubEnv('LLM_EMAIL_ENABLED', flag)
        expect(await registerLlmRelease('carrier', actor, input)).toMatchObject(
          { status: 'READY_FOR_VALIDATION' },
        )
        expect(
          mocks.q.mock.calls.some(
            ([sql]) =>
              sql.includes('llm_release_contacts') ||
              sql.includes('notification_intents') ||
              sql.includes('async_message_outbox'),
          ),
        ).toBe(false)
        const audit = mocks.q.mock.calls.find(([sql]) =>
          sql.includes('INSERT INTO llm_release_audit'),
        )!
        expect(JSON.parse(audit[1][4])).toMatchObject({
          emailEnabled: false,
          emailStatus: 'Disabled',
        })
      },
    )
    it('still requires automation authority while email is disabled', async () => {
      mocks.q.mockResolvedValue({ rows: [{ role_code: 'admin' }] })
      await expect(
        registerLlmRelease('carrier', actor, input),
      ).rejects.toMatchObject({ statusCode: 403 })
    })
    it('requires configured technical-admin contacts when explicitly enabled', async () => {
      vi.stubEnv('LLM_EMAIL_ENABLED', 'true')
      await expect(
        registerLlmRelease('carrier', actor, input),
      ).rejects.toMatchObject({ code: 'LLM_ADMIN_CONTACT_REQUIRED' })
    })
    it('retains the HTTPS review URL requirement when enabled', async () => {
      vi.stubEnv('LLM_EMAIL_ENABLED', 'true')
      vi.stubEnv('LLM_REVIEW_UI_URL', 'http://carrier.example.test')
      mocks.q.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT ur.role_code'))
          return { rows: [{ role_code: 'llm_release_automation' }] }
        if (sql.includes('SELECT DISTINCT c.user_id'))
          return { rows: [{ user_id: actor, email: 'admin@example.test' }] }
        return { rows: [] }
      })
      await expect(
        registerLlmRelease('carrier', actor, input),
      ).rejects.toMatchObject({ code: 'LLM_REVIEW_UI_REQUIRED' })
      expect(
        mocks.q.mock.calls.some(([sql]) =>
          sql.includes('INSERT INTO llm_releases'),
        ),
      ).toBe(false)
    })
  })
  it('requires passing held-out evaluation before candidate registration', () => {
    expect(releaseInput.safeParse(input).success).toBe(true)
    expect(
      releaseInput.safeParse({ ...input, versionLabel: 'v1\n' }).success,
    ).toBe(false)
    expect(
      releaseInput.safeParse({
        ...input,
        artifacts: { ...artifacts, model: 'local-v1\n' },
      }).success,
    ).toBe(false)
    expect(
      releaseInput.safeParse({
        ...input,
        artifacts: { ...artifacts, profileSha256: 'a'.repeat(64) + '\n' },
      }).success,
    ).toBe(false)
    for (const evaluation of [
      { ...input.evaluation, criticalErrors: 1 },
      { ...input.evaluation, sampleCount: 2 },
      { ...input.evaluation, fieldAccuracy: 0.8 },
      { ...input.evaluation, evidenceAccuracy: 0.9 },
    ])
      expect(releaseInput.safeParse({ ...input, evaluation }).success).toBe(
        false,
      )
  })
  describe('authorization renewal', () => {
    const actor = '11111111-1111-4111-8111-111111111111'
    const id = '22222222-2222-4222-8222-222222222222'
    const keys = generateKeyPairSync('ed25519')
    let row: any
    beforeEach(() => {
      vi.clearAllMocks()
      vi.stubEnv(
        'LLM_RELEASE_SIGNING_KEY',
        String(keys.privateKey.export({ type: 'pkcs8', format: 'pem' })),
      )
      row = {
        release_id: id,
        created_by: '33333333-3333-4333-8333-333333333333',
        status: 'IN_VALIDATION',
        artifacts,
        artifact_digest: 'e'.repeat(64),
        validation: {
          passed: true,
          reportSha256: 'f'.repeat(64),
          notes: 'Preserve evidence',
        },
        validation_authorization: {
          payload: { approvedAt: '2020-01-01T00:00:00.000Z' },
        },
        production_authorization: {
          payload: { approvedAt: '2020-01-02T00:00:00.000Z' },
        },
      }
      mocks.q.mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('SELECT ur.role_code'))
          return { rows: [{ role_code: 'carrier_technical_admin' }] }
        if (sql.includes('SELECT * FROM llm_releases')) return { rows: [row] }
        if (sql.includes('UPDATE llm_releases')) {
          const column = sql.includes('SET validation_authorization')
            ? 'validation_authorization'
            : 'production_authorization'
          return { rows: [{ ...row, [column]: JSON.parse(params[2]) }] }
        }
        return { rows: [] }
      })
    })
    it.each([
      ['IN_VALIDATION', 'validation', 'validation_authorization'],
      ['PRODUCTION_AUTHORIZED', 'production', 'production_authorization'],
    ])(
      'renews only the current receipt for %s and audits without changing evidence',
      async (status, environment, column) => {
        row.status = status
        const renewed = await transitionLlmRelease(
          'carrier',
          id,
          actor,
          'renew-authorization',
          { attestation: true },
        )
        const receipt = renewed[column]
        expect(renewed).toMatchObject({
          status,
          validation: row.validation,
          artifacts,
        })
        expect(receipt.payload).toMatchObject({
          environment,
          approvedBy: actor,
          validationReportSha256: row.validation.reportSha256,
        })
        expect(Date.parse(receipt.payload.approvedAt)).toBeGreaterThan(
          Date.parse(row[column].payload.approvedAt),
        )
        expect(
          verify(
            null,
            Buffer.from(JSON.stringify(receipt.payload)),
            keys.publicKey,
            Buffer.from(receipt.signature, 'base64url'),
          ),
        ).toBe(true)
        const update = mocks.q.mock.calls.find(([sql]) =>
          sql.includes('UPDATE llm_releases'),
        )![0]
        expect(update).not.toMatch(
          /SET status|validated_by=|approved_by=|validation=/,
        )
        const audit = mocks.q.mock.calls.find(([sql]) =>
          sql.includes('INSERT INTO llm_release_audit'),
        )![1]
        expect(audit[3]).toBe('renew-authorization')
        expect(JSON.parse(audit[4])).toMatchObject({
          status,
          environment,
          attestation: true,
          previousApprovedAt: row[column].payload.approvedAt,
          approvedAt: receipt.payload.approvedAt,
        })
      },
    )
    it.each(['READY_FOR_VALIDATION', 'VALIDATED', 'REJECTED'])(
      'does not bypass status %s',
      async (status) => {
        row.status = status
        await expect(
          transitionLlmRelease('carrier', id, actor, 'renew-authorization', {
            attestation: true,
          }),
        ).rejects.toMatchObject({ code: 'INVALID_LLM_RELEASE_TRANSITION' })
        expect(
          mocks.q.mock.calls.some(([sql]) => /^\s*(UPDATE|INSERT)\b/.test(sql)),
        ).toBe(false)
      },
    )
    it.each([
      {},
      { attestation: false },
      { attestation: true, environment: 'production' },
    ])('requires strict, explicit renewal attestation %j', async (body) => {
      await expect(
        transitionLlmRelease('carrier', id, actor, 'renew-authorization', body),
      ).rejects.toMatchObject({ code: 'INVALID_LLM_RELEASE_INPUT' })
    })
    it('rejects the candidate maker even with a current technical-admin role', async () => {
      row.created_by = actor
      await expect(
        transitionLlmRelease('carrier', id, actor, 'renew-authorization', {
          attestation: true,
        }),
      ).rejects.toMatchObject({ code: 'LLM_MAKER_CHECKER_REQUIRED' })
    })
    it('rechecks current technical-admin authority', async () => {
      mocks.q.mockResolvedValueOnce({
        rows: [{ role_code: 'llm_release_automation' }],
      })
      await expect(
        transitionLlmRelease('carrier', id, actor, 'renew-authorization', {
          attestation: true,
        }),
      ).rejects.toMatchObject({ statusCode: 403 })
      expect(mocks.q).toHaveBeenCalledTimes(1)
    })
  })
  it('does not give the training identity approval permissions', () => {
    expect(
      getDefaultPermissionCodesForRoles(['llm_release_automation']),
    ).not.toContain('llm.releases.review')
    expect(
      getDefaultPermissionCodesForRoles(['carrier_technical_admin']),
    ).toContain('llm.releases.review')
  })
  it('produces a receipt verifiable by the independent processor', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    vi.stubEnv(
      'LLM_RELEASE_SIGNING_KEY',
      String(privateKey.export({ type: 'pkcs8', format: 'pem' })),
    )
    const verifierUrl = new URL(
      '../../../../services/document-processor/release-authorization.mjs',
      import.meta.url,
    ).href
    const { verifyAuthorization, profileDigest } = await import(verifierUrl)
    const profile = {
      id: 'submission',
      version: '1.0.0',
      instructions: 'synthetic',
    }
    const approvedArtifacts = {
      ...artifacts,
      profileSha256: profileDigest(profile),
    }
    const receipt = signLlmAuthorization(
      'carrier-a',
      {
        release_id: 'release-a',
        artifacts: approvedArtifacts,
        validation: { reportSha256: 'f'.repeat(64) },
      },
      'technical-admin',
      'production',
    )
    expect(
      verifyAuthorization(
        receipt,
        {
          publicKey: String(publicKey.export({ type: 'spki', format: 'pem' })),
          tenantId: 'carrier-a',
          environment: 'production',
          model: 'local-v1',
          modelSha256: artifacts.modelSha256,
        },
        profile,
      ).releaseId,
    ).toBe('release-a')
  })
})

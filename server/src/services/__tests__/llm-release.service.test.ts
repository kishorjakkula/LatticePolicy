import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync, verify } from 'node:crypto'
import {
  PLATFORM_POLICY,
  registerLlmRelease,
  releaseInput,
  reportDigest,
  signLlmAuthorization,
  transitionLlmRelease,
  verifyEvaluationReport,
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
  // A held-out evaluation report shaped like services/document-learning's output.
  function evaluated(changes: Record<string, unknown> = {}, tenantId = 'carrier') {
    const metrics = { sampleCount: 20, fieldAccuracy: 0.97, evidenceAccuracy: 0.99, criticalErrors: 0, datasetSha256: 'c'.repeat(64) }
    const report: Record<string, any> = {
      schemaVersion: 1,
      tenantId,
      artifacts,
      metrics,
      totals: { checks: 100, correct: 97, evidenceChecks: 100, validEvidence: 99, criticalErrors: 0, extractionErrors: 0, variantChecks: 20, variantCorrect: 20 },
      outcomes: Array.from({ length: 20 }, (_, i) => ({ sampleId: `s${i}`, status: 'PASSED', failedFields: [] })),
      passed: true,
      ...changes,
    }
    return { ...input, evaluation: { ...metrics, reportSha256: reportDigest(report) }, evaluationReport: report }
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
        expect(await registerLlmRelease('carrier', actor, evaluated())).toMatchObject(
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
        expect(audit[1][3]).toBe('automation')
        expect(JSON.parse(audit[1][6])).toMatchObject({
          emailEnabled: false,
          emailStatus: 'Disabled',
          evaluationReportVerified: true,
        })
      },
    )
    it('still requires automation authority while email is disabled', async () => {
      mocks.q.mockResolvedValue({ rows: [{ role_code: 'admin' }] })
      await expect(
        registerLlmRelease('carrier', actor, evaluated()),
      ).rejects.toMatchObject({ statusCode: 403 })
    })
    it('requires configured technical-admin contacts when explicitly enabled', async () => {
      vi.stubEnv('LLM_EMAIL_ENABLED', 'true')
      await expect(
        registerLlmRelease('carrier', actor, evaluated()),
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
        registerLlmRelease('carrier', actor, evaluated()),
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
        expect(audit[3]).toBe('user')
        expect(audit[5]).toBe('renew-authorization')
        expect(JSON.parse(audit[6])).toMatchObject({
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
    const receipt = await signLlmAuthorization(
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
  describe('evaluation evidence', () => {
    it('accepts a report whose totals support the claimed metrics', () => {
      const { evaluationReport, ...candidate } = evaluated()
      expect(() => verifyEvaluationReport(evaluationReport, candidate, 'carrier', PLATFORM_POLICY)).not.toThrow()
    })
    it.each([
      ['inflated accuracy', (c: any) => { c.evaluation.fieldAccuracy = 0.99 }],
      ['a tampered report', (c: any) => { c.evaluationReport.totals.correct = 99 }],
      ['another carrier', (c: any) => { c.evaluationReport.tenantId = 'other'; c.evaluation.reportSha256 = reportDigest(c.evaluationReport) }],
      ['different artifacts', (c: any) => { c.evaluationReport.artifacts = { ...artifacts, model: 'other' }; c.evaluation.reportSha256 = reportDigest(c.evaluationReport) }],
      ['a failed report', (c: any) => { c.evaluationReport.passed = false; c.evaluation.reportSha256 = reportDigest(c.evaluationReport) }],
      ['missing outcomes', (c: any) => { c.evaluationReport.outcomes = []; c.evaluation.reportSha256 = reportDigest(c.evaluationReport) }],
    ])('rejects %s', (_name, mutate) => {
      const candidate: any = evaluated()
      mutate(candidate)
      const { evaluationReport, ...rest } = candidate
      expect(() => verifyEvaluationReport(evaluationReport, rest, 'carrier', PLATFORM_POLICY)).toThrow(
        expect.objectContaining({ code: 'LLM_EVALUATION_REPORT_REJECTED' }),
      )
    })
    it('applies stricter carrier gates', () => {
      const { evaluationReport, ...candidate } = evaluated()
      expect(() =>
        verifyEvaluationReport(evaluationReport, candidate, 'carrier', { ...PLATFORM_POLICY, minFieldAccuracy: 0.98 }),
      ).toThrow(expect.objectContaining({ code: 'LLM_EVALUATION_REPORT_REJECTED' }))
    })
  })
  describe('automation identity', () => {
    const actor = '11111111-1111-4111-8111-111111111111'
    beforeEach(() => {
      vi.clearAllMocks()
      mocks.q.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT ur.role_code')) return { rows: [{ role_code: 'llm_release_automation' }] }
        if (sql.includes('INSERT INTO llm_releases')) return { rows: [{ release_id: 'r', status: 'READY_FOR_VALIDATION' }] }
        return { rows: [] }
      })
    })
    it('requires a service credential in managed deployments', async () => {
      vi.stubEnv('DEPLOYMENT_ENV', 'production')
      await expect(registerLlmRelease('carrier', actor, evaluated(), { via: 'session' })).rejects.toMatchObject({
        code: 'LLM_AUTOMATION_CREDENTIAL_REQUIRED',
      })
      expect(await registerLlmRelease('carrier', actor, evaluated(), { via: 'credential' })).toMatchObject({ status: 'READY_FOR_VALIDATION' })
    })
    it('refuses an account that also holds the approval role', async () => {
      mocks.q.mockImplementation(async (sql: string) =>
        sql.includes('SELECT ur.role_code')
          ? { rows: [{ role_code: 'llm_release_automation' }, { role_code: 'carrier_technical_admin' }] }
          : { rows: [] },
      )
      await expect(registerLlmRelease('carrier', actor, evaluated())).rejects.toMatchObject({ code: 'LLM_GOVERNANCE_ROLE_CONFLICT' })
    })
  })
  describe('four-eyes approval, cooldown and revocation', () => {
    const validator = '44444444-4444-4444-8444-444444444444'
    const approver = '55555555-5555-4555-8555-555555555555'
    const id = '22222222-2222-4222-8222-222222222222'
    const keys = generateKeyPairSync('ed25519')
    let row: any
    let recentGrant = false
    beforeEach(() => {
      vi.clearAllMocks()
      recentGrant = false
      vi.stubEnv('LLM_RELEASE_SIGNING_KEY', String(keys.privateKey.export({ type: 'pkcs8', format: 'pem' })))
      row = {
        release_id: id,
        created_by: '33333333-3333-4333-8333-333333333333',
        status: 'VALIDATED',
        artifacts,
        artifact_digest: 'e'.repeat(64),
        validated_by: validator,
        validation: { passed: true, reportSha256: 'f'.repeat(64) },
      }
      mocks.q.mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('SELECT ur.role_code')) return { rows: [{ role_code: 'carrier_technical_admin' }] }
        if (sql.includes('SELECT * FROM llm_releases')) return { rows: [row] }
        if (sql.includes("action='ROLE_GRANTED'")) return { rows: recentGrant ? [{ created_at: new Date() }] : [] }
        if (sql.includes('UPDATE llm_releases')) return { rows: [{ ...row, status: sql.includes("'REVOKED'") ? 'REVOKED' : 'PRODUCTION_AUTHORIZED', params }] }
        return { rows: [] }
      })
    })
    it('refuses production authorization by the validator', async () => {
      await expect(
        transitionLlmRelease('carrier', id, validator, 'authorize-production', { attestation: true }),
      ).rejects.toMatchObject({ code: 'LLM_FOUR_EYES_REQUIRED' })
    })
    it('lets a different technical admin authorize, with an expiring receipt', async () => {
      const result = await transitionLlmRelease('carrier', id, approver, 'authorize-production', { attestation: true })
      expect(result.status).toBe('PRODUCTION_AUTHORIZED')
      const update = mocks.q.mock.calls.find(([sql]) => sql.includes('UPDATE llm_releases'))!
      const receipt = JSON.parse(update[1][2])
      expect(Date.parse(receipt.payload.expiresAt) - Date.parse(receipt.payload.approvedAt)).toBe(7 * 86400000)
    })
    it('holds a newly granted technical admin to the cooldown, but never blocks revocation', async () => {
      recentGrant = true
      await expect(
        transitionLlmRelease('carrier', id, approver, 'authorize-production', { attestation: true }),
      ).rejects.toMatchObject({ code: 'LLM_ROLE_COOLDOWN' })
      row.status = 'PRODUCTION_AUTHORIZED'
      expect(
        (await transitionLlmRelease('carrier', id, approver, 'revoke', { reason: 'Drift found', attestation: true })).status,
      ).toBe('REVOKED')
    })
    it('requires a reason and attestation to revoke', async () => {
      row.status = 'PRODUCTION_AUTHORIZED'
      await expect(transitionLlmRelease('carrier', id, approver, 'revoke', { reason: 'x' })).rejects.toMatchObject({
        code: 'INVALID_LLM_RELEASE_INPUT',
      })
      const audit = () => mocks.q.mock.calls.filter(([sql]) => sql.includes('INSERT INTO llm_release_audit'))
      expect(audit()).toHaveLength(0)
    })
    it('checks the uploaded lower-environment report before recording validation', async () => {
      row.status = 'IN_VALIDATION'
      row.validated_by = null
      const report = { schemaVersion: 1, runId: 'run-1', environment: 'qa', artifactDigest: row.artifact_digest, passed: true }
      const body = {
        passed: true,
        environment: 'qa',
        runId: 'run-1',
        reportSha256: reportDigest(report),
        artifactDigest: row.artifact_digest,
        attestation: true,
        notes: 'Tested',
        report,
      }
      await expect(
        transitionLlmRelease('carrier', id, validator, 'record-validation', { ...body, reportSha256: 'a'.repeat(64) }),
      ).rejects.toMatchObject({ code: 'LLM_VALIDATION_REPORT_REJECTED' })
      await expect(
        transitionLlmRelease('carrier', id, validator, 'record-validation', { ...body, report: { ...report, passed: false } }),
      ).rejects.toMatchObject({ code: 'LLM_VALIDATION_REPORT_REJECTED' })
      await transitionLlmRelease('carrier', id, validator, 'record-validation', body)
      const update = mocks.q.mock.calls.find(([sql]) => sql.includes('UPDATE llm_releases'))!
      expect(JSON.parse(update[1][4])).toEqual(report)
    })
  })
  describe('release signer', () => {
    it('refuses an inline key in managed deployments', async () => {
      const { privateKey } = generateKeyPairSync('ed25519')
      vi.stubEnv('DEPLOYMENT_ENV', 'production')
      vi.stubEnv('LLM_RELEASE_SIGNING_KEY', String(privateKey.export({ type: 'pkcs8', format: 'pem' })))
      vi.stubEnv('LLM_RELEASE_SIGNER_URL', '')
      await expect(
        signLlmAuthorization('carrier', { release_id: 'r', artifacts, validation: {} }, 'admin', 'validation'),
      ).rejects.toThrow(/LLM_RELEASE_SIGNER_REQUIRED/)
    })
    it('uses the remote signer and verifies its signature against the trusted public key', async () => {
      const { signGovernancePayload } = await import('../llm-release-signer.js')
      const trusted = generateKeyPairSync('ed25519')
      const rogue = generateKeyPairSync('ed25519')
      const env = {
        LLM_RELEASE_SIGNER_URL: 'http://release-signer:8090',
        LLM_RELEASE_SIGNER_TOKEN: 's'.repeat(40),
        LLM_RELEASE_PUBLIC_KEY: String(trusted.publicKey.export({ type: 'spki', format: 'pem' })),
      } as any
      const { sign } = await import('node:crypto')
      const signer = (key: any) => (async (_url: any, init: any) => {
        const { payload } = JSON.parse(init.body)
        expect(init.headers.authorization).toBe(`Bearer ${'s'.repeat(40)}`)
        return { ok: true, json: async () => ({ signature: sign(null, Buffer.from(JSON.stringify(payload)), key).toString('base64url') }) }
      }) as any
      const payload = { schemaVersion: 1, tenantId: 'carrier' }
      const signature = await signGovernancePayload('revocation-list', payload, { env, fetchImpl: signer(trusted.privateKey) })
      expect(verify(null, Buffer.from(JSON.stringify(payload)), trusted.publicKey, Buffer.from(signature, 'base64url'))).toBe(true)
      await expect(
        signGovernancePayload('revocation-list', payload, { env, fetchImpl: signer(rogue.privateKey) }),
      ).rejects.toThrow(/trusted public key/)
    })
  })
})

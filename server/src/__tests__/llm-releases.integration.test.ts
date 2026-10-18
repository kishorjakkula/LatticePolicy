import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  randomUUID,
  generateKeyPairSync,
  createPublicKey,
  verify,
} from 'node:crypto'
import request from 'supertest'
import { initDb, closeDb, getDb, toRawQuery, withTenantTx } from '../db.js'
import { ensureTenantRbacDefaults } from '../rbac.js'
import { createApp } from '../app.js'
import { issueToken } from '../auth.js'
import {
  issueRevocationList,
  listLlmReleases,
  registerLlmRelease,
  reportDigest,
  saveLlmContact,
  saveLlmPolicy,
  transitionLlmRelease,
} from '../services/llm-release.service.js'
import {
  issueAutomationCredential,
  revokeAutomationCredential,
} from '../services/llm-automation-credentials.service.js'
import { listAiAudit, verifyAiAuditIntegrity, exportAiAuditCsv } from '../services/ai-audit.service.js'
import { sendLlmReleaseEmail } from '../services/llm-release-email.service.js'
import { dispatchOutboxRow, loadConfig } from '../asyncMessageWorker.js'

const tenant = `llm-release-carrier-${randomUUID().slice(0, 8)}`,
  other = `llm-release-other-${randomUUID().slice(0, 8)}`
const automation = randomUUID(),
  admin = randomUUID(),
  ordinary = randomUUID(),
  otherAdmin = randomUUID(),
  // A second technical admin: the production approver must differ from the validator.
  approver = randomUUID()
const artifacts = {
  profileId: 'submission',
  profileVersion: '1.0.0',
  profileSha256: 'a'.repeat(64),
  model: 'private-model-v1',
  modelSha256: 'b'.repeat(64),
}
// Candidate plus the held-out report the API re-checks (shape of services/document-learning output).
const candidate = () => {
  const metrics = { sampleCount: 50, fieldAccuracy: 0.98, evidenceAccuracy: 0.99, criticalErrors: 0, datasetSha256: 'c'.repeat(64) }
  const evaluationReport = {
    schemaVersion: 1,
    tenantId: tenant,
    artifacts,
    metrics,
    totals: { checks: 100, correct: 98, evidenceChecks: 100, validEvidence: 99, criticalErrors: 0, extractionErrors: 0, variantChecks: 50, variantCorrect: 50 },
    outcomes: Array.from({ length: 50 }, (_, i) => ({ sampleId: `s${i}`, status: 'PASSED', failedFields: [] })),
    passed: true,
  }
  return {
    versionLabel: `candidate-${randomUUID()}`,
    artifacts,
    evaluation: { ...metrics, reportSha256: reportDigest(evaluationReport) },
    evaluationReport,
  }
}
// Lower-environment test evidence: the uploaded report must hash to reportSha256.
const validation = (release: any, overrides: Record<string, any> = {}) => {
  const base = {
    passed: true,
    environment: 'test',
    runId: `run-${randomUUID().slice(0, 8)}`,
    artifactDigest: release.artifact_digest,
    attestation: true,
    notes: 'Verified synthetic applications in isolated test deployment',
    ...overrides,
  }
  const report = { schemaVersion: 1, runId: base.runId, environment: base.environment, artifactDigest: base.artifactDigest, passed: base.passed }
  return { ...base, reportSha256: reportDigest(report), report }
}
const recorded = ({ report: _report, ...rest }: Record<string, any>) => rest
async function q(sql: string, params: any[] = [], tenantId = tenant) {
  return withTenantTx(tenantId, async (db) => toRawQuery(db)(sql, params))
}
describe('carrier technical-admin LLM release governance', () => {
  beforeEach(() => {
    vi.stubEnv('LLM_EMAIL_ENABLED', 'true')
    vi.stubEnv('LLM_REVIEW_UI_URL', 'https://carrier.example.test')
    vi.stubEnv('LLM_SMTP_FROM', 'releases@example.test')
  })
  beforeAll(async () => {
    await initDb()
    vi.stubEnv('LLM_REVIEW_UI_URL', 'https://carrier.example.test')
    vi.stubEnv('LLM_SMTP_FROM', 'releases@example.test')
    vi.stubEnv('LLM_SMTP_HOST', '')
    vi.stubEnv('LLM_SMTP_PORT', '587')
    const { privateKey } = generateKeyPairSync('ed25519')
    vi.stubEnv(
      'LLM_RELEASE_SIGNING_KEY',
      String(privateKey.export({ type: 'pkcs8', format: 'pem' })),
    )
    for (const id of [tenant, other]) {
      await getDb()!.query(
        'INSERT INTO tenants(tenant_id,name) VALUES($1,$1) ON CONFLICT DO NOTHING',
        [id],
      )
      await ensureTenantRbacDefaults(id)
    }
    for (const [id, t, role] of [
      [automation, tenant, 'llm_release_automation'],
      [admin, tenant, 'carrier_technical_admin'],
      [ordinary, tenant, 'admin'],
      [otherAdmin, other, 'carrier_technical_admin'],
      [approver, tenant, 'carrier_technical_admin'],
    ]) {
      await getDb()!.query(
        'INSERT INTO users(user_id,tenant_id,username,password_hash) VALUES($1,$2,$3,$4)',
        [id, t, `llm-${id}`, 'test-no-login'],
      )
      await getDb()!.query(
        'INSERT INTO user_roles(user_id,role_code) VALUES($1,$2)',
        [id, role],
      )
    }
  })
  afterAll(async () => {
    try {
      await getDb()?.query(
        'DELETE FROM async_message_outbox WHERE tenant_id = ANY($1::text[])',
        [[tenant, other]],
      )
      // Audit logs are append-only; only explicit carrier offboarding may remove them.
      const client = await (getDb() as any).connect()
      try {
        await client.query('BEGIN')
        await client.query("SELECT set_config('app.audit_purge', 'tenant-offboarding', true)")
        await client.query('DELETE FROM tenants WHERE tenant_id = ANY($1::text[])', [[tenant, other]])
        await client.query('COMMIT')
      } finally {
        client.release()
      }
    } finally {
      vi.unstubAllEnvs()
      await closeDb()
    }
  })
  it('registers without any email setup by default, remains reviewable, and audits without queuing retries', async () => {
    vi.stubEnv('LLM_EMAIL_ENABLED', undefined)
    vi.stubEnv('LLM_REVIEW_UI_URL', '')
    vi.stubEnv('LLM_SMTP_FROM', '')
    const input = candidate()
    const release = await registerLlmRelease(tenant, automation, input)
    expect(release.status).toBe('READY_FOR_VALIDATION')
    expect(
      (await registerLlmRelease(tenant, automation, input)).release_id,
    ).toBe(release.release_id)
    const listing = await listLlmReleases(tenant, admin)
    expect(listing).toMatchObject({
      canReview: true,
      emailEnabled: false,
      contactEmail: '',
    })
    expect(
      listing.items.find((item: any) => item.release_id === release.release_id)
        .notifications,
    ).toEqual([])
    expect(
      (
        await q('SELECT * FROM async_message_outbox WHERE tenant_id=$1', [
          tenant,
        ])
      ).rows,
    ).toHaveLength(0)
    const audit = await q(
      'SELECT * FROM llm_release_audit WHERE tenant_id=$1 AND release_id=$2',
      [tenant, release.release_id],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]).toMatchObject({
      action: 'CANDIDATE_READY',
      detail: { emailEnabled: false, emailStatus: 'Disabled' },
    })
    await expect(
      transitionLlmRelease(
        tenant,
        release.release_id,
        ordinary,
        'start-validation',
        {},
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(
      (
        await transitionLlmRelease(
          tenant,
          release.release_id,
          admin,
          'start-validation',
          {},
        )
      ).status,
    ).toBe('IN_VALIDATION')
    // Opting in later does not backfill mail for an idempotent registration.
    vi.stubEnv('LLM_EMAIL_ENABLED', 'true')
    await registerLlmRelease(tenant, automation, input)
    expect(
      (
        await q(
          "SELECT * FROM notification_intents WHERE tenant_id=$1 AND payload->>'releaseId'=$2",
          [tenant, release.release_id],
        )
      ).rows,
    ).toHaveLength(0)
  })
  it('requires configured technical-admin recipients and a passing evaluation', async () => {
    await expect(
      registerLlmRelease(tenant, automation, candidate()),
    ).rejects.toMatchObject({ code: 'LLM_ADMIN_CONTACT_REQUIRED' })
    const invalid = candidate()
    invalid.evaluation.fieldAccuracy = 0.5
    await expect(
      registerLlmRelease(tenant, automation, invalid),
    ).rejects.toMatchObject({ code: 'INVALID_LLM_RELEASE_INPUT' })
    await saveLlmContact(tenant, admin, 'technical-admin@example.test')
  })
  it('atomically queues a minimal email and deduplicates repeated pipeline registration', async () => {
    const input = candidate()
    const release = await registerLlmRelease(tenant, automation, input)
    expect(
      (await registerLlmRelease(tenant, automation, input)).release_id,
    ).toBe(release.release_id)
    const notifications = await q(
      "SELECT * FROM notification_intents WHERE tenant_id=$1 AND payload->>'releaseId'=$2",
      [tenant, release.release_id],
    )
    expect(notifications.rows).toHaveLength(1)
    expect(notifications.rows[0]).toMatchObject({
      status: 'Queued',
      recipient: { email: 'technical-admin@example.test' },
    })
    expect(notifications.rows[0].body).toContain('/admin/llm-releases?release=')
    expect(notifications.rows[0].body).not.toContain(input.artifacts.model)
    const outbox = await q(
      'SELECT * FROM async_message_outbox WHERE tenant_id=$1 AND source_id=$2',
      [tenant, notifications.rows[0].notification_id],
    )
    expect(outbox.rows).toHaveLength(1)
    const sender = vi.fn(async () => ({
      messageId: 'smtp-test-1',
      accepted: ['technical-admin@example.test'],
    }))
    await sendLlmReleaseEmail(
      tenant,
      notifications.rows[0].notification_id,
      1,
      8,
      sender,
    )
    await sendLlmReleaseEmail(
      tenant,
      notifications.rows[0].notification_id,
      2,
      8,
      sender,
    )
    expect(sender).toHaveBeenCalledTimes(1)
    expect(
      (
        await q(
          'SELECT status FROM notification_intents WHERE notification_id=$1',
          [notifications.rows[0].notification_id],
        )
      ).rows[0].status,
    ).toBe('Sent')
    // A self-consistent candidate (report re-made for the changed model) reusing the label.
    const changedArtifacts = { ...input.artifacts, model: 'changed' }
    const changedReport = { ...input.evaluationReport, artifacts: changedArtifacts }
    await expect(
      registerLlmRelease(tenant, automation, {
        ...input,
        artifacts: changedArtifacts,
        evaluation: { ...input.evaluation, reportSha256: reportDigest(changedReport) },
        evaluationReport: changedReport,
      }),
    ).rejects.toMatchObject({ code: 'LLM_VERSION_IMMUTABLE' })
    // A stale report for changed artifacts is refused before anything else.
    await expect(
      registerLlmRelease(tenant, automation, { ...input, artifacts: changedArtifacts }),
    ).rejects.toMatchObject({ code: 'LLM_EVALUATION_REPORT_REJECTED' })
  })
  it.each(['true', 'false'])(
    'requires lower-environment evidence and explicit technical-admin approval before production with email %s',
    async (flag) => {
      vi.stubEnv('LLM_EMAIL_ENABLED', flag)
      const release = await registerLlmRelease(tenant, automation, candidate())
      await expect(
        transitionLlmRelease(
          tenant,
          release.release_id,
          automation,
          'authorize-production',
          { attestation: true },
        ),
      ).rejects.toMatchObject({ statusCode: 403 })
      await expect(
        transitionLlmRelease(
          tenant,
          release.release_id,
          ordinary,
          'start-validation',
          {},
        ),
      ).rejects.toMatchObject({ statusCode: 403 })
      await expect(
        transitionLlmRelease(
          tenant,
          release.release_id,
          admin,
          'authorize-production',
          { attestation: true },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_LLM_RELEASE_TRANSITION' })
      const testing = await transitionLlmRelease(
        tenant,
        release.release_id,
        admin,
        'start-validation',
        {},
      )
      expect(testing.validation_authorization.payload.environment).toBe(
        'validation',
      )
      const report = validation(release)
      await expect(
        transitionLlmRelease(
          tenant,
          release.release_id,
          admin,
          'record-validation',
          { ...report, environment: 'production' },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_LLM_RELEASE_INPUT' })
      await expect(
        transitionLlmRelease(
          tenant,
          release.release_id,
          admin,
          'record-validation',
          { ...report, artifactDigest: 'f'.repeat(64) },
        ),
      ).rejects.toMatchObject({ code: 'LLM_ARTIFACT_MISMATCH' })
      await transitionLlmRelease(
        tenant,
        release.release_id,
        admin,
        'record-validation',
        report,
      )
      await expect(
        transitionLlmRelease(
          tenant,
          release.release_id,
          approver,
          'authorize-production',
          { attestation: false },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_LLM_RELEASE_INPUT' })
      // Four eyes: the validator cannot also authorize production.
      await expect(
        transitionLlmRelease(
          tenant,
          release.release_id,
          admin,
          'authorize-production',
          { attestation: true },
        ),
      ).rejects.toMatchObject({ code: 'LLM_FOUR_EYES_REQUIRED' })
      const approved = await transitionLlmRelease(
        tenant,
        release.release_id,
        approver,
        'authorize-production',
        { attestation: true },
      )
      expect(approved).toMatchObject({
        status: 'PRODUCTION_AUTHORIZED',
        approved_by: approver,
        validated_by: admin,
      })
      expect(approved.production_authorization.payload).toMatchObject({
        tenantId: tenant,
        environment: 'production',
        approvedBy: approver,
        validationReportSha256: report.reportSha256,
      })
      expect(
        (
          await q(
            'SELECT * FROM llm_release_audit WHERE tenant_id=$1 AND release_id=$2',
            [tenant, release.release_id],
          )
        ).rows,
      ).toHaveLength(4)
      await expect(
        transitionLlmRelease(
          tenant,
          release.release_id,
          approver,
          'authorize-production',
          { attestation: true },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_LLM_RELEASE_TRANSITION' })
    },
  )
  it('renews current validation/production receipts through the guarded API without bypassing state or evidence', async () => {
    vi.stubEnv('LLM_EMAIL_ENABLED', 'false')
    const release = await registerLlmRelease(tenant, automation, candidate())
    const token = issueToken({
      id: admin,
      username: 'technical-admin',
      tenantId: tenant,
      roles: ['carrier_technical_admin'],
      permissions: ['llm.releases.review'],
    })
    const renew = (body: Record<string, unknown> = { attestation: true }) =>
      request(createApp())
        .post(
          `/api/v1/admin/llm/releases/${release.release_id}/renew-authorization`,
        )
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant', tenant)
        .send(body)
    await renew().expect(409)
    const testing = await transitionLlmRelease(
      tenant,
      release.release_id,
      admin,
      'start-validation',
      {},
    )
    await renew({ attestation: false }).expect(422)
    await renew({}).expect(422)
    await renew({ attestation: true, environment: 'production' }).expect(422)
    const validationReceipt = (await renew().expect(200)).body
    expect(validationReceipt.status).toBe('IN_VALIDATION')
    expect(
      Date.parse(validationReceipt.validation_authorization.payload.approvedAt),
    ).toBeGreaterThan(
      Date.parse(testing.validation_authorization.payload.approvedAt),
    )
    const report = validation(release, { runId: 'renewal-run', notes: 'Synthetic validation evidence retained' })
    // The approver validates here, so the renewing admin is not the validator.
    await transitionLlmRelease(
      tenant,
      release.release_id,
      approver,
      'record-validation',
      report,
    )
    await renew().expect(409)
    const approved = await transitionLlmRelease(
      tenant,
      release.release_id,
      admin,
      'authorize-production',
      { attestation: true },
    )
    const productionReceipt = (await renew().expect(200)).body
    expect(productionReceipt).toMatchObject({
      status: 'PRODUCTION_AUTHORIZED',
      validation: recorded(report),
      validated_by: approver,
      approved_by: admin,
      artifacts: release.artifacts,
    })
    expect(productionReceipt.validation_authorization).toEqual(
      validationReceipt.validation_authorization,
    )
    expect(productionReceipt.production_authorization.payload).toMatchObject({
      environment: 'production',
      validationReportSha256: report.reportSha256,
      approvedBy: admin,
    })
    expect(
      Date.parse(productionReceipt.production_authorization.payload.approvedAt),
    ).toBeGreaterThan(
      Date.parse(approved.production_authorization.payload.approvedAt),
    )
    const listed = (await listLlmReleases(tenant, admin)).items.find(
      (item: any) => item.release_id === release.release_id,
    )
    for (const receipt of [
      testing.validation_authorization,
      approved.production_authorization,
      validationReceipt.validation_authorization,
      productionReceipt.production_authorization,
      listed.validation_authorization,
      listed.production_authorization,
    ]) {
      expect(
        verify(
          null,
          Buffer.from(JSON.stringify(receipt.payload)),
          createPublicKey(process.env.LLM_RELEASE_SIGNING_KEY!),
          Buffer.from(receipt.signature, 'base64url'),
        ),
      ).toBe(true)
    }
    await expect(
      transitionLlmRelease(
        other,
        release.release_id,
        otherAdmin,
        'renew-authorization',
        { attestation: true },
      ),
    ).rejects.toMatchObject({ statusCode: 404 })
    await expect(
      transitionLlmRelease(
        tenant,
        release.release_id,
        ordinary,
        'renew-authorization',
        { attestation: true },
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
    await q(
      "INSERT INTO user_roles(user_id,role_code) VALUES($1,'carrier_technical_admin')",
      [automation],
    )
    try {
      await expect(
        transitionLlmRelease(
          tenant,
          release.release_id,
          automation,
          'renew-authorization',
          { attestation: true },
        ),
      ).rejects.toMatchObject({ code: 'LLM_GOVERNANCE_ROLE_CONFLICT' })
    } finally {
      await q(
        "DELETE FROM user_roles WHERE user_id=$1 AND role_code='carrier_technical_admin'",
        [automation],
      )
    }
    await q(
      "DELETE FROM user_roles WHERE user_id=$1 AND role_code='carrier_technical_admin'",
      [admin],
    )
    try {
      await renew().expect(403)
    } finally {
      await q(
        "INSERT INTO user_roles(user_id,role_code) VALUES($1,'carrier_technical_admin')",
        [admin],
      )
    }
    await q('UPDATE users SET disabled=true WHERE user_id=$1', [admin])
    try {
      await renew().expect(403)
    } finally {
      await q('UPDATE users SET disabled=false WHERE user_id=$1', [admin])
    }
    const audit = (
      await q(
        "SELECT * FROM llm_release_audit WHERE release_id=$1 AND action='renew-authorization' ORDER BY created_at",
        [release.release_id],
      )
    ).rows
    expect(audit).toHaveLength(2)
    expect(audit.map((entry: any) => entry.detail.environment)).toEqual([
      'validation',
      'production',
    ])
    for (const entry of audit)
      expect(entry).toMatchObject({
        actor_id: admin,
        detail: { attestation: true, artifactDigest: release.artifact_digest },
      })
  })
  it('never promotes failed validation or another tenant candidate', async () => {
    const release = await registerLlmRelease(tenant, automation, candidate())
    await expect(
      transitionLlmRelease(
        other,
        release.release_id,
        otherAdmin,
        'start-validation',
        {},
      ),
    ).rejects.toMatchObject({ statusCode: 404 })
    expect((await listLlmReleases(other, otherAdmin)).items).toHaveLength(0)
    await transitionLlmRelease(
      tenant,
      release.release_id,
      admin,
      'start-validation',
      {},
    )
    await transitionLlmRelease(
      tenant,
      release.release_id,
      admin,
      'record-validation',
      validation(release, { passed: false, environment: 'staging', runId: 'failed-run', notes: 'Missing source evidence' }),
    )
    await expect(
      transitionLlmRelease(
        tenant,
        release.release_id,
        admin,
        'authorize-production',
        { attestation: true },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_LLM_RELEASE_TRANSITION' })
  })
  it('records email failures for retry instead of pretending delivery succeeded', async () => {
    const release = await registerLlmRelease(tenant, automation, candidate())
    const notice = (
      await q(
        "SELECT notification_id FROM notification_intents WHERE tenant_id=$1 AND payload->>'releaseId'=$2",
        [tenant, release.release_id],
      )
    ).rows[0]
    await expect(
      sendLlmReleaseEmail(tenant, notice.notification_id, 1, 8, async () => {
        throw new Error('secret relay error')
      }),
    ).rejects.toThrow(/email delivery failed/)
    const row = (
      await q(
        'SELECT status,attempts,last_error FROM notification_intents WHERE notification_id=$1',
        [notice.notification_id],
      )
    ).rows[0]
    expect(row).toMatchObject({ status: 'Queued', attempts: 1 })
    expect(row.last_error).not.toContain('secret')
  })
  it('rechecks the flag at delivery and terminally suppresses already queued notices without SMTP', async () => {
    const release = await registerLlmRelease(tenant, automation, candidate())
    const notice = (
      await q(
        "SELECT notification_id FROM notification_intents WHERE tenant_id=$1 AND payload->>'releaseId'=$2",
        [tenant, release.release_id],
      )
    ).rows[0]
    vi.stubEnv('LLM_EMAIL_ENABLED', 'false')
    vi.stubEnv('LLM_SMTP_FROM', '')
    const sender = vi.fn()
    const outbox = (
      await q(
        'SELECT * FROM async_message_outbox WHERE tenant_id=$1 AND source_id=$2',
        [tenant, notice.notification_id],
      )
    ).rows[0]
    expect(await dispatchOutboxRow(getDb()!, outbox, loadConfig())).toBe(true)
    // Outbox Sent means dispatch completed; the actual mail remains Suppressed.
    expect(
      (
        await q(
          'SELECT status,last_error FROM async_message_outbox WHERE message_id=$1',
          [outbox.message_id],
        )
      ).rows[0],
    ).toEqual({ status: 'Sent', last_error: null })
    const row = (
      await q('SELECT * FROM notification_intents WHERE notification_id=$1', [
        notice.notification_id,
      ])
    ).rows[0]
    expect(row).toMatchObject({
      status: 'Suppressed',
      attempts: 0,
      sent_at: null,
      provider_message_id: null,
    })
    expect(row.last_error).toContain('LLM email disabled')
    vi.stubEnv('LLM_EMAIL_ENABLED', 'true')
    await sendLlmReleaseEmail(tenant, notice.notification_id, 2, 8, sender)
    expect(sender).not.toHaveBeenCalled()
    expect((await listLlmReleases(tenant, admin)).emailEnabled).toBe(true)
  })
  it('rejects stale JWT authority after technical role revocation and suppresses queued mail', async () => {
    const release = await registerLlmRelease(tenant, automation, candidate())
    const stale = issueToken({
      id: admin,
      username: 'technical-admin',
      tenantId: tenant,
      roles: ['carrier_technical_admin'],
      permissions: ['llm.releases.review'],
    })
    await q(
      "DELETE FROM user_roles WHERE user_id=$1 AND role_code='carrier_technical_admin'",
      [admin],
    )
    try {
      await request(createApp())
        .post(
          `/api/v1/admin/llm/releases/${release.release_id}/start-validation`,
        )
        .set('Authorization', `Bearer ${stale}`)
        .set('X-Tenant', tenant)
        .send({})
        .expect(403)
      const notice = (
        await q(
          "SELECT notification_id FROM notification_intents WHERE tenant_id=$1 AND payload->>'releaseId'=$2",
          [tenant, release.release_id],
        )
      ).rows[0]
      const sender = vi.fn()
      await sendLlmReleaseEmail(tenant, notice.notification_id, 1, 8, sender)
      expect(sender).not.toHaveBeenCalled()
      expect(
        (
          await q(
            'SELECT status FROM notification_intents WHERE notification_id=$1',
            [notice.notification_id],
          )
        ).rows[0].status,
      ).toBe('Suppressed')
    } finally {
      await q(
        "INSERT INTO user_roles(user_id,role_code) VALUES($1,'carrier_technical_admin')",
        [admin],
      )
    }
  })
  describe('audit integrity and AI/person segregation', () => {
    async function authorizedRelease() {
      vi.stubEnv('LLM_EMAIL_ENABLED', 'false')
      const release = await registerLlmRelease(tenant, automation, candidate())
      await transitionLlmRelease(tenant, release.release_id, admin, 'start-validation', {})
      await transitionLlmRelease(tenant, release.release_id, admin, 'record-validation', validation(release))
      return transitionLlmRelease(tenant, release.release_id, approver, 'authorize-production', { attestation: true })
    }
    it('keeps the governance log append-only and detects tampering through the hash chain', async () => {
      const release = await authorizedRelease()
      await expect(
        q('UPDATE llm_release_audit SET action=$2 WHERE release_id=$1', [release.release_id, 'forged']),
      ).rejects.toThrow(/AUDIT_APPEND_ONLY/)
      await expect(q('DELETE FROM llm_release_audit WHERE release_id=$1', [release.release_id])).rejects.toThrow(
        /AUDIT_APPEND_ONLY/,
      )
      const integrity = await verifyAiAuditIntegrity(tenant)
      expect(integrity.releases).toMatchObject({ intact: true, firstBrokenEntry: null })
      expect(integrity.releases.entries).toBeGreaterThan(3)
      // Simulate someone with database-owner access bypassing the trigger; roll it back.
      const client = await (getDb() as any).connect()
      try {
        await client.query('BEGIN')
        await client.query('ALTER TABLE llm_release_audit DISABLE TRIGGER audit_append_only')
        const target = await client.query(
          "SELECT chain_seq FROM llm_release_audit WHERE tenant_id=$1 AND release_id=$2 AND action='authorize-production'",
          [tenant, release.release_id],
        )
        await client.query(
          "UPDATE llm_release_audit SET detail = detail || '{\"validatedBy\":\"someone-else\"}' WHERE tenant_id=$1 AND chain_seq=$2",
          [tenant, target.rows[0].chain_seq],
        )
        const broken = await client.query("SELECT audit_chain_first_break('llm_release_audit', $1) AS first", [tenant])
        expect(Number(broken.rows[0].first)).toBe(Number(target.rows[0].chain_seq))
      } finally {
        await client.query('ROLLBACK')
        client.release()
      }
      expect((await verifyAiAuditIntegrity(tenant)).releases.intact).toBe(true)
    })
    it('lets the database refuse automation approvals and AI decisions', async () => {
      const release = await registerLlmRelease(tenant, automation, candidate())
      await expect(
        q(
          `INSERT INTO llm_release_audit(tenant_id,release_id,actor_id,actor_type,action) VALUES($1,$2,$3,'automation','authorize-production')`,
          [tenant, release.release_id, automation],
        ),
      ).rejects.toThrow(/llm_release_audit_segregation/)
      const submission = randomUUID()
      await q(`INSERT INTO submissions(submission_id,tenant_id,submission_number) VALUES($1,$2,$3)`, [
        submission,
        tenant,
        `SUB-${submission.slice(0, 8)}`,
      ])
      await expect(
        q(`INSERT INTO submission_events(tenant_id,submission_id,actor_type,actor,action) VALUES($1,$2,'ai','model','approved')`, [
          tenant,
          submission,
        ]),
      ).rejects.toThrow(/submission_events_segregation/)
      await q(`INSERT INTO submission_events(tenant_id,submission_id,actor_type,actor,action) VALUES($1,$2,'ai','Private model','drafted')`, [
        tenant,
        submission,
      ])
      await q(`INSERT INTO submission_events(tenant_id,submission_id,actor_type,actor,action) VALUES($1,$2,'user','underwriter','approved')`, [
        tenant,
        submission,
      ])
      await expect(q('UPDATE submission_events SET actor_type=$2 WHERE submission_id=$1', [submission, 'user'])).rejects.toThrow(
        /AUDIT_APPEND_ONLY/,
      )
      const ai = await listAiAudit(tenant, { source: 'intake', actor: 'ai' })
      expect(ai.items.map((item) => item.action)).toContain('drafted')
      expect(ai.items.every((item) => item.actorKind === 'ai')).toBe(true)
      const people = await listAiAudit(tenant, { source: 'intake', actor: 'person' })
      expect(people.items.map((item) => item.action)).toContain('approved')
      expect((await verifyAiAuditIntegrity(tenant)).intake.intact).toBe(true)
    })
    it('classifies automation and people in the unified trail and audits exports', async () => {
      await authorizedRelease()
      const automationEntries = await listAiAudit(tenant, { source: 'releases', actor: 'automation' })
      expect(automationEntries.items.length).toBeGreaterThan(0)
      expect(automationEntries.items.every((item) => item.action === 'CANDIDATE_READY')).toBe(true)
      const people = await listAiAudit(tenant, { source: 'releases', actor: 'person' })
      const authorization = people.items.find((item) => item.action === 'authorize-production')!
      expect(authorization.actorRoles).toContain('carrier_technical_admin')
      expect(authorization.entryHash).toMatch(/^[a-f0-9]{64}$/)
      const csv = await exportAiAuditCsv(tenant, ordinary, { source: 'releases' })
      expect(csv.split('\n')[0]).toContain('actor_kind')
      const exported = await listAiAudit(tenant, { source: 'releases', search: 'AUDIT_EXPORTED' })
      expect(exported.items[0]).toMatchObject({ actorKind: 'person', action: 'AUDIT_EXPORTED' })
    })
    it('revokes authorized releases and signs the revocation list', async () => {
      const release = await authorizedRelease()
      await expect(
        transitionLlmRelease(tenant, release.release_id, admin, 'revoke', { reason: 'Field drift', attestation: true }),
      ).resolves.toMatchObject({ status: 'REVOKED', revoked_by: admin, revocation_reason: 'Field drift' })
      const list = await issueRevocationList(tenant, admin)
      expect(list.releaseIds).toContain(release.release_id)
      expect(
        verify(
          null,
          Buffer.from(JSON.stringify(list.payload)),
          createPublicKey(process.env.LLM_RELEASE_SIGNING_KEY!),
          Buffer.from(list.signature, 'base64url'),
        ),
      ).toBe(true)
      const verifierUrl = new URL('../../../services/document-processor/release-authorization.mjs', import.meta.url).href
      const { revokedReleaseIds } = await import(verifierUrl)
      expect(revokedReleaseIds(list, createPublicKey(process.env.LLM_RELEASE_SIGNING_KEY!), tenant)).toContain(release.release_id)
      await expect(
        transitionLlmRelease(tenant, release.release_id, approver, 'renew-authorization', { attestation: true }),
      ).rejects.toMatchObject({ code: 'INVALID_LLM_RELEASE_TRANSITION' })
    })
    it('enforces carrier gates that can only be raised', async () => {
      await expect(
        saveLlmPolicy(tenant, admin, { minSampleCount: 10, minFieldAccuracy: 0.95, minEvidenceAccuracy: 0.98, authorizationDays: 7, roleCooldownHours: 24 }),
      ).rejects.toMatchObject({ code: 'INVALID_LLM_RELEASE_INPUT' })
      await saveLlmPolicy(tenant, admin, { minSampleCount: 20, minFieldAccuracy: 0.99, minEvidenceAccuracy: 0.98, authorizationDays: 3, roleCooldownHours: 24 })
      try {
        await expect(registerLlmRelease(tenant, automation, candidate())).rejects.toMatchObject({ code: 'LLM_EVALUATION_REPORT_REJECTED' })
      } finally {
        await saveLlmPolicy(tenant, admin, { minSampleCount: 20, minFieldAccuracy: 0.95, minEvidenceAccuracy: 0.98, authorizationDays: 7, roleCooldownHours: 24 })
      }
      const changes = await listAiAudit(tenant, { source: 'releases', search: 'POLICY_CHANGED' })
      expect(changes.items).toHaveLength(2)
    })
  })
  describe('service credentials and governance role changes', () => {
    const admin2 = randomUUID()
    const newcomer = randomUUID()
    beforeAll(async () => {
      for (const [id, role] of [
        [admin2, 'admin'],
        [newcomer, 'underwriter'],
      ]) {
        await getDb()!.query('INSERT INTO users(user_id,tenant_id,username,password_hash) VALUES($1,$2,$3,$4)', [
          id,
          tenant,
          `llm-${id}`,
          'test-no-login',
        ])
        await getDb()!.query('INSERT INTO user_roles(user_id,role_code) VALUES($1,$2)', [id, role])
      }
    })
    const tokenFor = (id: string, roles: string[]) =>
      issueToken({ id, username: `llm-${id}`, tenantId: tenant, roles, permissions: [] })
    it('registers through a scoped credential and refuses it once revoked', async () => {
      vi.stubEnv('LLM_EMAIL_ENABLED', 'false')
      await expect(
        issueAutomationCredential(tenant, ordinary, { userId: ordinary, label: 'self', expiresInDays: 30 }),
      ).rejects.toMatchObject({ code: 'CREDENTIAL_SELF_ISSUE' })
      await expect(
        issueAutomationCredential(tenant, ordinary, { userId: admin, label: 'approver', expiresInDays: 30 }),
      ).rejects.toMatchObject({ code: 'LLM_AUTOMATION_ROLE_REQUIRED' })
      await expect(
        issueAutomationCredential(tenant, ordinary, { userId: automation, label: 'too long', expiresInDays: 365 }),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL_INPUT' })
      const credential = await issueAutomationCredential(tenant, ordinary, {
        userId: automation,
        label: 'Training pipeline',
        expiresInDays: 30,
      })
      expect(credential.token).toMatch(/^lpa_/)
      const stored = await q('SELECT * FROM llm_automation_credentials WHERE credential_id=$1', [credential.credentialId])
      expect(JSON.stringify(stored.rows[0])).not.toContain(credential.token.split('_').pop())
      const register = (token: string) =>
        request(createApp())
          .post('/api/v1/admin/llm/releases')
          .set('Authorization', `Bearer ${token}`)
          .set('X-Tenant', tenant)
          .send(candidate())
      const created = (await register(credential.token).expect(201)).body
      const audit = await q("SELECT * FROM llm_release_audit WHERE release_id=$1 AND action='CANDIDATE_READY'", [created.release_id])
      expect(audit.rows[0]).toMatchObject({ actor_type: 'automation', actor_id: automation, detail: { authenticatedWith: 'credential' } })
      await register(`${credential.token.slice(0, -2)}xx`).expect(401)
      await revokeAutomationCredential(tenant, ordinary, credential.credentialId)
      await register(credential.token).expect(401)
      const events = await listAiAudit(tenant, { source: 'releases', search: 'CREDENTIAL_' })
      expect(events.items.map((item) => item.action).sort()).toEqual(['CREDENTIAL_ISSUED', 'CREDENTIAL_REVOKED'])
    })
    it('refuses self-granted governance roles, audits grants, and holds new approvers to the cooldown', async () => {
      const patch = (actor: string, target: string, roles: string[]) =>
        request(createApp())
          .patch(`/api/v1/admin/users/${target}`)
          .set('Authorization', `Bearer ${tokenFor(actor, ['admin'])}`)
          .set('X-Tenant', tenant)
          .send({ roles })
      expect((await patch(ordinary, ordinary, ['admin', 'carrier_technical_admin']).expect(403)).body.code).toBe(
        'GOVERNANCE_SELF_ASSIGNMENT',
      )
      expect((await patch(admin2, newcomer, ['carrier_technical_admin', 'llm_release_automation']).expect(400)).body.code).toBe(
        'GOVERNANCE_ROLE_CONFLICT',
      )
      await patch(admin2, newcomer, ['underwriter', 'carrier_technical_admin']).expect(200)
      const grant = await q("SELECT * FROM llm_release_audit WHERE subject_user_id=$1 AND action='ROLE_GRANTED'", [newcomer])
      expect(grant.rows[0]).toMatchObject({ actor_id: admin2, actor_type: 'user', detail: { role: 'carrier_technical_admin' } })
      expect(grant.rows[0].actor_roles).toContain('admin')
      vi.stubEnv('LLM_EMAIL_ENABLED', 'false')
      const release = await registerLlmRelease(tenant, automation, candidate())
      await expect(transitionLlmRelease(tenant, release.release_id, newcomer, 'start-validation', {})).rejects.toMatchObject({
        code: 'LLM_ROLE_COOLDOWN',
      })
      await patch(admin2, newcomer, ['underwriter']).expect(200)
      const revoked = await q("SELECT * FROM llm_release_audit WHERE subject_user_id=$1 AND action='ROLE_REVOKED'", [newcomer])
      expect(revoked.rows).toHaveLength(1)
    })
  })
})

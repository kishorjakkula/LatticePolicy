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
  listLlmReleases,
  registerLlmRelease,
  saveLlmContact,
  transitionLlmRelease,
} from '../services/llm-release.service.js'
import { sendLlmReleaseEmail } from '../services/llm-release-email.service.js'
import { dispatchOutboxRow, loadConfig } from '../asyncMessageWorker.js'

const tenant = `llm-release-carrier-${randomUUID().slice(0, 8)}`,
  other = `llm-release-other-${randomUUID().slice(0, 8)}`
const automation = randomUUID(),
  admin = randomUUID(),
  ordinary = randomUUID(),
  otherAdmin = randomUUID()
const candidate = () => ({
  versionLabel: `candidate-${randomUUID()}`,
  artifacts: {
    profileId: 'submission',
    profileVersion: '1.0.0',
    profileSha256: 'a'.repeat(64),
    model: 'private-model-v1',
    modelSha256: 'b'.repeat(64),
  },
  evaluation: {
    sampleCount: 50,
    fieldAccuracy: 0.98,
    evidenceAccuracy: 0.99,
    criticalErrors: 0,
    datasetSha256: 'c'.repeat(64),
    reportSha256: 'd'.repeat(64),
  },
})
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
      await getDb()?.query(
        'DELETE FROM tenants WHERE tenant_id = ANY($1::text[])',
        [[tenant, other]],
      )
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
    await expect(
      registerLlmRelease(tenant, automation, {
        ...input,
        artifacts: { ...input.artifacts, model: 'changed' },
      }),
    ).rejects.toMatchObject({ code: 'LLM_VERSION_IMMUTABLE' })
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
      const report = {
        passed: true,
        environment: 'test',
        runId: 'synthetic-test-run',
        reportSha256: 'e'.repeat(64),
        artifactDigest: release.artifact_digest,
        attestation: true,
        notes: 'Verified synthetic applications in isolated test deployment',
      }
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
          admin,
          'authorize-production',
          { attestation: false },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_LLM_RELEASE_INPUT' })
      const approved = await transitionLlmRelease(
        tenant,
        release.release_id,
        admin,
        'authorize-production',
        { attestation: true },
      )
      expect(approved).toMatchObject({
        status: 'PRODUCTION_AUTHORIZED',
        approved_by: admin,
      })
      expect(approved.production_authorization.payload).toMatchObject({
        tenantId: tenant,
        environment: 'production',
        approvedBy: admin,
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
          admin,
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
    const report = {
      passed: true,
      environment: 'test',
      runId: 'renewal-run',
      reportSha256: 'e'.repeat(64),
      artifactDigest: release.artifact_digest,
      attestation: true,
      notes: 'Synthetic validation evidence retained',
    }
    await transitionLlmRelease(
      tenant,
      release.release_id,
      admin,
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
      validation: report,
      validated_by: admin,
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
      ).rejects.toMatchObject({ code: 'LLM_MAKER_CHECKER_REQUIRED' })
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
      {
        passed: false,
        environment: 'staging',
        runId: 'failed-run',
        reportSha256: 'e'.repeat(64),
        artifactDigest: release.artifact_digest,
        attestation: true,
        notes: 'Missing source evidence',
      },
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
})

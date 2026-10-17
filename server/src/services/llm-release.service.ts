import { z } from 'zod'
import { createPrivateKey, sign, randomUUID } from 'node:crypto'
import { withTenantTx, toRawQuery } from '../db.js'
import { artifactDigest } from './product-governance.service.js'
import { isLlmEmailEnabled } from './llm-release-email.service.js'
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/domain.errors.js'

type Q = (sql: string, params?: any[]) => Promise<any>
const hash = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/)
export const releaseInput = z
  .object({
    versionLabel: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/)
      .refine((value) => !/[\s]/.test(value)),
    artifacts: z
      .object({
        profileId: z
          .string()
          .regex(/^[a-z][a-z0-9-]{0,63}$/)
          .refine((value) => !/[\s]/.test(value)),
        profileVersion: z
          .string()
          .max(80)
          .regex(/^\d+\.\d+\.\d+$/)
          .refine((value) => !/[\s]/.test(value)),
        profileSha256: hash,
        model: z
          .string()
          .min(1)
          .max(200)
          .refine((value) => !/[\r\n]/.test(value)),
        modelSha256: hash,
      })
      .strict(),
    evaluation: z
      .object({
        sampleCount: z.number().int().min(20),
        fieldAccuracy: z.number().min(0.95).max(1),
        evidenceAccuracy: z.number().min(0.98).max(1),
        criticalErrors: z.literal(0),
        datasetSha256: hash,
        reportSha256: hash,
      })
      .strict(),
  })
  .strict()
const validationInput = z
  .object({
    passed: z.boolean(),
    environment: z.enum(['test', 'qa', 'staging']),
    runId: z.string().trim().min(1).max(120),
    reportSha256: hash,
    artifactDigest: hash,
    attestation: z.literal(true),
    notes: z.string().trim().min(1).max(2000),
  })
  .strict()
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success)
    throw new ValidationError(
      'INVALID_LLM_RELEASE_INPUT',
      result.error.flatten(),
    )
  return result.data
}
async function roles(q: Q, tenantId: string, actor: string): Promise<string[]> {
  if (!z.string().uuid().safeParse(actor).success) throw new ForbiddenError()
  const result = await q(
    `SELECT ur.role_code FROM users u JOIN user_roles ur ON ur.user_id=u.user_id
    JOIN rbac_roles r ON r.tenant_id=u.tenant_id AND r.role_code=ur.role_code AND r.active=true
    WHERE u.tenant_id=$1 AND u.user_id=$2 AND u.disabled=false`,
    [tenantId, actor],
  )
  return result.rows.map((row: any) => row.role_code)
}
export async function assertLlmRole(
  q: Q,
  tenantId: string,
  actor: string,
  required: string[],
) {
  if (
    !(await roles(q, tenantId, actor)).some((role) => required.includes(role))
  )
    throw new ForbiddenError(
      required.includes('carrier_technical_admin')
        ? 'CARRIER_TECHNICAL_ADMIN_REQUIRED'
        : 'LLM_AUTOMATION_ROLE_REQUIRED',
    )
}
async function audit(
  q: Q,
  tenantId: string,
  id: string,
  actor: string,
  action: string,
  detail: object = {},
) {
  await q(
    'INSERT INTO llm_release_audit(tenant_id,release_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5::jsonb)',
    [tenantId, id, actor, action, JSON.stringify(detail)],
  )
}
function releaseUrl(id: string): string {
  const base = new URL(process.env.LLM_REVIEW_UI_URL || '')
  if (base.protocol !== 'https:' || base.username || base.password)
    throw new BadRequestError(
      'LLM_REVIEW_UI_REQUIRED',
      'Configure the HTTPS carrier administration UI URL',
    )
  return new URL(`/admin/llm-releases?release=${id}`, base.origin).toString()
}
async function load(q: Q, tenantId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success)
    throw new NotFoundError('LLM_RELEASE_NOT_FOUND')
  const result = await q(
    'SELECT * FROM llm_releases WHERE tenant_id=$1 AND release_id=$2 FOR UPDATE',
    [tenantId, id],
  )
  if (!result.rows[0]) throw new NotFoundError('LLM_RELEASE_NOT_FOUND')
  return result.rows[0]
}
function requireStatus(row: any, expected: string) {
  if (row.status !== expected)
    throw new ConflictError(
      'INVALID_LLM_RELEASE_TRANSITION',
      `Expected ${expected}; release is ${row.status}`,
    )
}
// JSONB orders object keys by UTF-8 byte length, then bytes. Sign that order
// so persisted/downloaded v1 receipts retain the exact signed payload bytes.
function orderReceiptPayload<T>(value: T): T {
  if (Array.isArray(value)) return value.map(orderReceiptPayload) as T
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(
          ([a], [b]) =>
            Buffer.byteLength(a) - Buffer.byteLength(b) ||
            Buffer.compare(Buffer.from(a), Buffer.from(b)),
        )
        .map(([key, item]) => [key, orderReceiptPayload(item)]),
    ) as T
  return value
}
export function signLlmAuthorization(
  tenantId: string,
  row: any,
  actor: string,
  environment: 'validation' | 'production',
) {
  const key = createPrivateKey(
    String(process.env.LLM_RELEASE_SIGNING_KEY || '').replace(/\\n/g, '\n'),
  )
  if (key.asymmetricKeyType !== 'ed25519')
    throw new Error('LLM release signing requires an Ed25519 key')
  const payload = orderReceiptPayload({
    schemaVersion: 1,
    tenantId,
    releaseId: row.release_id,
    environment,
    artifacts: row.artifacts,
    approvedBy: actor,
    approvedAt: new Date().toISOString(),
    validationReportSha256: row.validation?.reportSha256 || null,
  })
  return {
    payload,
    signature: sign(null, Buffer.from(JSON.stringify(payload)), key).toString(
      'base64url',
    ),
  }
}
export async function listLlmReleases(
  tenantId: string,
  actor: string,
  selectedId?: string,
) {
  if (selectedId) parsed(z.string().uuid(), selectedId)
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const assigned = await roles(q, tenantId, actor)
    if (
      !assigned.some((role) =>
        ['admin', 'carrier_technical_admin', 'llm_release_automation'].includes(
          role,
        ),
      )
    )
      throw new ForbiddenError()
    const result = await q(
      `SELECT r.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('email',n.recipient->>'email','status',n.status,'attempts',n.attempts,'error',n.last_error))
      FROM notification_intents n WHERE n.tenant_id=r.tenant_id AND n.event_type='LLM_CANDIDATE_READY' AND n.payload->>'releaseId'=r.release_id::text),'[]'::jsonb) AS notifications
      FROM llm_releases r WHERE r.tenant_id=$1 ORDER BY CASE WHEN r.release_id=$2::uuid THEN 0 ELSE 1 END,created_at DESC LIMIT 100`,
      [tenantId, selectedId || null],
    )
    const contact = await q(
      'SELECT email FROM llm_release_contacts WHERE tenant_id=$1 AND user_id=$2',
      [tenantId, actor],
    )
    return {
      items: result.rows,
      canReview: assigned.includes('carrier_technical_admin'),
      contactEmail: contact.rows[0]?.email || '',
      emailEnabled: isLlmEmailEnabled(),
    }
  })
}
export async function saveLlmContact(
  tenantId: string,
  actor: string,
  email: unknown,
) {
  const address = parsed(z.string().email().max(254), email)
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    await assertLlmRole(q, tenantId, actor, ['carrier_technical_admin'])
    await q(
      `INSERT INTO llm_release_contacts(tenant_id,user_id,email) VALUES($1,$2,$3)
      ON CONFLICT(tenant_id,user_id) DO UPDATE SET email=EXCLUDED.email,updated_at=now()`,
      [tenantId, actor, address],
    )
    return { email: address }
  })
}
export async function registerLlmRelease(
  tenantId: string,
  actor: string,
  body: unknown,
) {
  const input = parsed(releaseInput, body)
  const digest = artifactDigest(input.artifacts)
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    await assertLlmRole(q, tenantId, actor, ['llm_release_automation'])
    await q('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [
      tenantId,
      `llm:${input.versionLabel}`,
    ])
    const previous = await q(
      'SELECT * FROM llm_releases WHERE tenant_id=$1 AND version_label=$2',
      [tenantId, input.versionLabel],
    )
    if (previous.rows[0]) {
      if (
        previous.rows[0].artifact_digest !== digest ||
        artifactDigest(previous.rows[0].evaluation) !==
          artifactDigest(input.evaluation)
      )
        throw new ConflictError(
          'LLM_VERSION_IMMUTABLE',
          'Publish a new release version for changed artifacts or evaluation',
        )
      return previous.rows[0]
    }
    const emailEnabled = isLlmEmailEnabled()
    const recipients = emailEnabled
      ? await q(
          `SELECT DISTINCT c.user_id,c.email FROM llm_release_contacts c JOIN users u ON u.user_id=c.user_id AND u.tenant_id=c.tenant_id
      JOIN user_roles ur ON ur.user_id=u.user_id AND ur.role_code='carrier_technical_admin'
      JOIN rbac_roles r ON r.tenant_id=c.tenant_id AND r.role_code=ur.role_code AND r.active=true
      WHERE c.tenant_id=$1 AND u.disabled=false`,
          [tenantId],
        )
      : { rows: [] }
    if (emailEnabled && !recipients.rows.length)
      throw new ConflictError(
        'LLM_ADMIN_CONTACT_REQUIRED',
        'A carrier technical administrator must register a notification email first',
      )
    const id = randomUUID()
    const url = emailEnabled ? releaseUrl(id) : null
    const result = await q(
      `INSERT INTO llm_releases(release_id,tenant_id,version_label,status,artifacts,artifact_digest,evaluation,created_by)
      VALUES($1,$2,$3,'READY_FOR_VALIDATION',$4::jsonb,$5,$6::jsonb,$7) RETURNING *`,
      [
        id,
        tenantId,
        input.versionLabel,
        JSON.stringify(input.artifacts),
        digest,
        JSON.stringify(input.evaluation),
        actor,
      ],
    )
    for (const recipient of recipients.rows) {
      const notificationId = randomUUID()
      const subject = `LLM release ${input.versionLabel} is ready for validation`
      const text = `A new private document-processing release is ready. Sign in to test it in your lower environment, record your results, and authorize production only after validation passes.\n\n${url}\n\nThis email does not approve or deploy the release. No source documents or extracted customer data are included.`
      const payload = { releaseId: id, recipientUserId: recipient.user_id }
      await q(
        `INSERT INTO notification_intents(notification_id,tenant_id,event_type,channel,recipient,template_code,subject,body,payload,status,correlation_id)
        VALUES($1,$2,'LLM_CANDIDATE_READY','EMAIL',$3::jsonb,'llm-candidate-ready',$4,$5,$6::jsonb,'Queued',$7)`,
        [
          notificationId,
          tenantId,
          JSON.stringify({ email: recipient.email }),
          subject,
          text,
          JSON.stringify(payload),
          `${id}:${recipient.user_id}`,
        ],
      )
      await q(
        `INSERT INTO async_message_outbox(tenant_id,source_table,source_id,topic,payload)
        VALUES($1,'notification_intents',$2,'notification.llm_candidate_ready',$3::jsonb) ON CONFLICT DO NOTHING`,
        [tenantId, notificationId, JSON.stringify({ notificationId })],
      )
    }
    await audit(q, tenantId, id, actor, 'CANDIDATE_READY', {
      artifactDigest: digest,
      emailEnabled,
      emailStatus: emailEnabled ? 'Queued' : 'Disabled',
    })
    return result.rows[0]
  })
}
export async function transitionLlmRelease(
  tenantId: string,
  id: string,
  actor: string,
  action: string,
  body: unknown,
) {
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    await assertLlmRole(q, tenantId, actor, ['carrier_technical_admin'])
    const row = await load(q, tenantId, id)
    if (actor === row.created_by)
      throw new ForbiddenError('LLM_MAKER_CHECKER_REQUIRED')
    let result
    let auditDetail: object = {}
    if (action === 'start-validation') {
      requireStatus(row, 'READY_FOR_VALIDATION')
      const authorization = signLlmAuthorization(
        tenantId,
        row,
        actor,
        'validation',
      )
      result = await q(
        `UPDATE llm_releases SET status='IN_VALIDATION',validation_authorization=$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND release_id=$2 RETURNING *`,
        [tenantId, id, JSON.stringify(authorization)],
      )
    } else if (action === 'record-validation') {
      requireStatus(row, 'IN_VALIDATION')
      const input = parsed(validationInput, body)
      if (input.artifactDigest !== row.artifact_digest)
        throw new ConflictError(
          'LLM_ARTIFACT_MISMATCH',
          'The tested artifacts do not match this release',
        )
      result = await q(
        `UPDATE llm_releases SET status=$3,validation=$4::jsonb,validated_by=$5,updated_at=now() WHERE tenant_id=$1 AND release_id=$2 RETURNING *`,
        [
          tenantId,
          id,
          input.passed ? 'VALIDATED' : 'REJECTED',
          JSON.stringify(input),
          actor,
        ],
      )
    } else if (action === 'authorize-production') {
      requireStatus(row, 'VALIDATED')
      parsed(z.object({ attestation: z.literal(true) }).strict(), body)
      const authorization = signLlmAuthorization(
        tenantId,
        row,
        actor,
        'production',
      )
      result = await q(
        `UPDATE llm_releases SET status='PRODUCTION_AUTHORIZED',production_authorization=$3::jsonb,approved_by=$4,updated_at=now() WHERE tenant_id=$1 AND release_id=$2 RETURNING *`,
        [tenantId, id, JSON.stringify(authorization), actor],
      )
    } else if (action === 'renew-authorization') {
      if (!['IN_VALIDATION', 'PRODUCTION_AUTHORIZED'].includes(row.status))
        throw new ConflictError(
          'INVALID_LLM_RELEASE_TRANSITION',
          'Only validation or production authorizations can be renewed',
        )
      parsed(z.object({ attestation: z.literal(true) }).strict(), body)
      const environment =
        row.status === 'IN_VALIDATION' ? 'validation' : 'production'
      const authorization = signLlmAuthorization(
        tenantId,
        row,
        actor,
        environment,
      )
      const previous =
        environment === 'validation'
          ? row.validation_authorization
          : row.production_authorization
      result = await q(
        environment === 'validation'
          ? `UPDATE llm_releases SET validation_authorization=$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND release_id=$2 RETURNING *`
          : `UPDATE llm_releases SET production_authorization=$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND release_id=$2 RETURNING *`,
        [tenantId, id, JSON.stringify(authorization)],
      )
      auditDetail = {
        environment,
        attestation: true,
        previousApprovedAt: previous?.payload?.approvedAt || null,
        approvedAt: authorization.payload.approvedAt,
      }
    } else if (action === 'reject') {
      if (
        !['READY_FOR_VALIDATION', 'IN_VALIDATION', 'VALIDATED'].includes(
          row.status,
        )
      )
        throw new ConflictError(
          'INVALID_LLM_RELEASE_TRANSITION',
          'This release cannot be rejected',
        )
      const input = parsed(
        z.object({ reason: z.string().min(1).max(2000) }).strict(),
        body,
      )
      result = await q(
        `UPDATE llm_releases SET status='REJECTED',validation=$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND release_id=$2 RETURNING *`,
        [tenantId, id, JSON.stringify({ reason: input.reason })],
      )
    } else
      throw new BadRequestError('INVALID_LLM_ACTION', 'Unknown release action')
    await audit(q, tenantId, id, actor, action, {
      status: result.rows[0].status,
      artifactDigest: row.artifact_digest,
      ...auditDetail,
    })
    return result.rows[0]
  })
}

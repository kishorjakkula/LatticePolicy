import { z } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { withTenantTx, toRawQuery } from '../db.js'
import { isManagedDeployment } from '../config.js'
import { artifactDigest } from './product-governance.service.js'
import { isLlmEmailEnabled } from './llm-release-email.service.js'
import { signGovernancePayload } from './llm-release-signer.js'
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/domain.errors.js'

type Q = (sql: string, params?: any[]) => Promise<any>
/** Who is acting, as recorded in the audit log. */
export type LlmActorContext = {
  /** 'automation' only when the request authenticated with a service credential. */
  via?: 'session' | 'credential'
  requestId?: string
}
export const GOVERNANCE_ROLES = ['carrier_technical_admin', 'llm_release_automation'] as const
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
const jsonObject = z.record(z.string(), z.unknown())
const registrationInput = releaseInput.extend({ evaluationReport: jsonObject })
const validationInput = z
  .object({
    passed: z.boolean(),
    environment: z.enum(['test', 'qa', 'staging']),
    runId: z.string().trim().min(1).max(120),
    reportSha256: hash,
    artifactDigest: hash,
    attestation: z.literal(true),
    notes: z.string().trim().min(1).max(2000),
    report: jsonObject,
  })
  .strict()
const policyInput = z
  .object({
    minSampleCount: z.number().int().min(20).max(100000),
    minFieldAccuracy: z.number().min(0.95).max(1),
    minEvidenceAccuracy: z.number().min(0.98).max(1),
    authorizationDays: z.number().int().min(1).max(30),
    roleCooldownHours: z.number().int().min(24).max(720),
  })
  .strict()
export type LlmReleasePolicy = z.infer<typeof policyInput>
export const PLATFORM_POLICY: LlmReleasePolicy = {
  minSampleCount: 20,
  minFieldAccuracy: 0.95,
  minEvidenceAccuracy: 0.98,
  authorizationDays: 7,
  roleCooldownHours: 24,
}
const MAX_REPORT_BYTES = 1024 * 1024
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success)
    throw new ValidationError(
      'INVALID_LLM_RELEASE_INPUT',
      result.error.flatten(),
    )
  return result.data
}

/** Same canonical form and digest as services/document-learning (profileDigest). */
function canonicalReport(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalReport)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalReport(item)]),
    )
  return value
}
export function reportDigest(report: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalReport(report)))
    .digest('hex')
}
function reportBytes(report: unknown) {
  if (Buffer.byteLength(JSON.stringify(report)) > MAX_REPORT_BYTES)
    throw new ValidationError('LLM_REPORT_TOO_LARGE', { maxBytes: MAX_REPORT_BYTES })
}

export async function llmActorRoles(q: Q, tenantId: string, actor: string): Promise<string[]> {
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
  const assigned = await llmActorRoles(q, tenantId, actor)
  if (!assigned.some((role) => required.includes(role)))
    throw new ForbiddenError(
      required.includes('carrier_technical_admin')
        ? 'CARRIER_TECHNICAL_ADMIN_REQUIRED'
        : 'LLM_AUTOMATION_ROLE_REQUIRED',
    )
  return assigned
}

type AuditEntry = {
  releaseId: string | null
  actorId: string | null
  actorType: 'user' | 'automation' | 'system'
  actorRoles?: string[]
  action: string
  detail?: object
  subjectUserId?: string | null
  requestId?: string
}
/** Append one entry to the carrier's hash-chained, append-only governance log. */
export async function appendLlmAudit(q: Q, tenantId: string, entry: AuditEntry) {
  await q(
    `INSERT INTO llm_release_audit(tenant_id,release_id,actor_id,actor_type,actor_roles,action,detail,subject_user_id,request_id)
     VALUES($1,$2,$3,$4,$5::text[],$6,$7::jsonb,$8,$9)`,
    [
      tenantId,
      entry.releaseId,
      entry.actorId,
      entry.actorType,
      entry.actorRoles || [],
      entry.action,
      JSON.stringify(entry.detail || {}),
      entry.subjectUserId || null,
      entry.requestId?.slice(0, 200) || null,
    ],
  )
}

export async function loadLlmPolicy(q: Q, tenantId: string): Promise<LlmReleasePolicy> {
  const result = await q('SELECT * FROM llm_release_policies WHERE tenant_id=$1', [tenantId])
  const row = result.rows[0]
  if (!row) return { ...PLATFORM_POLICY }
  return {
    minSampleCount: Number(row.min_sample_count),
    minFieldAccuracy: Number(row.min_field_accuracy),
    minEvidenceAccuracy: Number(row.min_evidence_accuracy),
    authorizationDays: Number(row.authorization_days),
    roleCooldownHours: Number(row.role_cooldown_hours),
  }
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
export async function signLlmAuthorization(
  tenantId: string,
  row: any,
  actor: string,
  environment: 'validation' | 'production',
  authorizationDays = PLATFORM_POLICY.authorizationDays,
) {
  const approvedAt = new Date()
  const payload = orderReceiptPayload({
    schemaVersion: 1,
    tenantId,
    releaseId: row.release_id,
    environment,
    artifacts: row.artifacts,
    approvedBy: actor,
    approvedAt: approvedAt.toISOString(),
    // Processors refuse the receipt after this, whatever their own max age.
    expiresAt: new Date(approvedAt.getTime() + authorizationDays * 86400000).toISOString(),
    validationReportSha256: row.validation?.reportSha256 || null,
  })
  return {
    payload,
    signature: await signGovernancePayload('release-authorization', payload),
  }
}

/**
 * Re-checks a held-out evaluation report against the metrics the automation
 * submitted. Metrics are recomputed from the report's totals, so a candidate
 * cannot claim numbers its own report does not support.
 */
export function verifyEvaluationReport(
  report: Record<string, any>,
  input: z.infer<typeof releaseInput>,
  tenantId: string,
  policy: LlmReleasePolicy,
) {
  reportBytes(report)
  const problems: string[] = []
  const totals = report.totals || {}
  const metrics = report.metrics || {}
  const outcomes = Array.isArray(report.outcomes) ? report.outcomes : []
  const evaluation = input.evaluation
  const close = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 1e-9
  if (reportDigest(report) !== evaluation.reportSha256) problems.push('report hash does not match reportSha256')
  if (report.schemaVersion !== 1) problems.push('unsupported report schema')
  if (report.tenantId !== tenantId) problems.push('report belongs to a different carrier')
  if (report.passed !== true) problems.push('report did not pass')
  if (!report.artifacts || artifactDigest(report.artifacts) !== artifactDigest(input.artifacts))
    problems.push('report was produced for different artifacts')
  const counts = ['checks', 'correct', 'evidenceChecks', 'validEvidence', 'criticalErrors', 'extractionErrors']
  if (counts.some((key) => !Number.isSafeInteger(totals[key]) || totals[key] < 0)) problems.push('report totals are incomplete')
  else {
    if (totals.checks === 0 || totals.correct > totals.checks) problems.push('field checks are invalid')
    if (totals.evidenceChecks === 0 || totals.validEvidence > totals.evidenceChecks) problems.push('evidence checks are invalid')
    if (totals.extractionErrors !== 0) problems.push('report has extraction errors')
    if (totals.criticalErrors !== 0) problems.push('report has critical errors')
    const fieldAccuracy = totals.correct / Math.max(1, totals.checks)
    const evidenceAccuracy = totals.validEvidence / Math.max(1, totals.evidenceChecks)
    if (!close(evaluation.fieldAccuracy, fieldAccuracy) || !close(metrics.fieldAccuracy, fieldAccuracy))
      problems.push('field accuracy does not match the report totals')
    if (!close(evaluation.evidenceAccuracy, evidenceAccuracy) || !close(metrics.evidenceAccuracy, evidenceAccuracy))
      problems.push('evidence accuracy does not match the report totals')
    if (fieldAccuracy < policy.minFieldAccuracy) problems.push(`field accuracy is below the carrier gate of ${policy.minFieldAccuracy}`)
    if (evidenceAccuracy < policy.minEvidenceAccuracy)
      problems.push(`evidence accuracy is below the carrier gate of ${policy.minEvidenceAccuracy}`)
  }
  if (outcomes.length !== evaluation.sampleCount || metrics.sampleCount !== evaluation.sampleCount)
    problems.push('sample count does not match the report outcomes')
  if (evaluation.sampleCount < policy.minSampleCount) problems.push(`fewer than ${policy.minSampleCount} held-out samples`)
  if (outcomes.some((outcome: any) => outcome?.status !== 'PASSED' && outcome?.status !== 'FAILED'))
    problems.push('report outcomes are invalid')
  if (metrics.datasetSha256 !== evaluation.datasetSha256) problems.push('dataset hash does not match the report')
  if (metrics.criticalErrors !== 0) problems.push('report metrics show critical errors')
  if (problems.length) throw new ValidationError('LLM_EVALUATION_REPORT_REJECTED', { problems })
}

/** The lower-environment test report must hash to the recorded value and describe this run. */
export function verifyValidationReport(
  input: z.infer<typeof validationInput>,
  artifactDigestValue: string,
) {
  reportBytes(input.report)
  const report = input.report as Record<string, any>
  const problems: string[] = []
  if (reportDigest(report) !== input.reportSha256) problems.push('report hash does not match reportSha256')
  if (report.schemaVersion !== 1) problems.push('unsupported report schema')
  if (report.runId !== input.runId) problems.push('report is for a different test run')
  if (report.environment !== input.environment) problems.push('report is for a different environment')
  if (report.artifactDigest !== artifactDigestValue) problems.push('report tested different artifacts')
  if (report.passed !== input.passed) problems.push('report result does not match the recorded result')
  if (problems.length) throw new ValidationError('LLM_VALIDATION_REPORT_REJECTED', { problems })
}

function credentialRequired() {
  if (process.env.LLM_AUTOMATION_CREDENTIAL_REQUIRED === 'true') return true
  if (process.env.LLM_AUTOMATION_CREDENTIAL_REQUIRED === 'false' && !isManagedDeployment()) return false
  return isManagedDeployment()
}

/** A newly granted technical admin cannot approve until the cooldown has passed. */
async function assertRoleCooldown(q: Q, tenantId: string, actor: string, policy: LlmReleasePolicy) {
  const result = await q(
    `SELECT created_at FROM llm_release_audit
      WHERE tenant_id=$1 AND subject_user_id=$2 AND action='ROLE_GRANTED' AND detail->>'role'='carrier_technical_admin'
        AND created_at > now() - make_interval(hours => $3::int)
      ORDER BY chain_seq DESC LIMIT 1`,
    [tenantId, actor, policy.roleCooldownHours],
  )
  if (result.rows[0])
    throw new ForbiddenError(
      'LLM_ROLE_COOLDOWN',
      `A newly granted technical administrator can approve releases ${policy.roleCooldownHours} hours after the grant`,
    )
}

function publicRelease(row: any) {
  const { evaluation_report: evaluationReport, validation_report: validationReport, ...rest } = row
  return {
    ...rest,
    has_evaluation_report: !!evaluationReport,
    has_validation_report: !!validationReport,
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
    const assigned = await llmActorRoles(q, tenantId, actor)
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
      FROM notification_intents n WHERE n.tenant_id=r.tenant_id AND n.event_type='LLM_CANDIDATE_READY' AND n.payload->>'releaseId'=r.release_id::text),'[]'::jsonb) AS notifications,
      (SELECT bool_or(true) FROM users u JOIN user_roles ur ON ur.user_id=u.user_id AND ur.role_code='carrier_technical_admin'
        WHERE u.tenant_id=r.tenant_id AND u.user_id=r.approved_by AND u.disabled=false) AS approver_active
      FROM llm_releases r WHERE r.tenant_id=$1 ORDER BY CASE WHEN r.release_id=$2::uuid THEN 0 ELSE 1 END,created_at DESC LIMIT 100`,
      [tenantId, selectedId || null],
    )
    // Live quality: how often reviewers corrected what each release drafted.
    const quality = await q(
      `SELECT s.ai_run->'processing'->>'releaseId' AS release_id,
              count(DISTINCT s.submission_id)::int AS submissions,
              count(*) FILTER (WHERE f.ai_value IS NOT NULL)::int AS drafted,
              count(*) FILTER (WHERE f.ai_value IS NOT NULL AND f.value IS DISTINCT FROM f.ai_value)::int AS corrected
         FROM submissions s JOIN submission_fields f ON f.tenant_id=s.tenant_id AND f.submission_id=s.submission_id
        WHERE s.tenant_id=$1 AND s.status='COMPLETED' AND s.ai_run->'processing'->>'releaseId' IS NOT NULL
        GROUP BY 1`,
      [tenantId],
    )
    const qualityByRelease = new Map<string, any>(
      quality.rows.map((row: any) => [
        row.release_id,
        {
          submissions: row.submissions,
          drafted: row.drafted,
          corrected: row.corrected,
          correctionRate: row.drafted ? row.corrected / row.drafted : null,
        },
      ]),
    )
    const contact = await q(
      'SELECT email FROM llm_release_contacts WHERE tenant_id=$1 AND user_id=$2',
      [tenantId, actor],
    )
    return {
      items: result.rows.map((row: any) => ({
        ...publicRelease(row),
        approver_active: row.approved_by ? row.approver_active === true : null,
        production_quality: qualityByRelease.get(row.release_id) || null,
      })),
      canReview: assigned.includes('carrier_technical_admin'),
      canManageCredentials: assigned.includes('admin'),
      currentUserId: actor,
      policy: await loadLlmPolicy(q, tenantId),
      platformPolicy: PLATFORM_POLICY,
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

/** Carrier technical admins may raise the gates; the database refuses anything below the platform floor. */
export async function saveLlmPolicy(
  tenantId: string,
  actor: string,
  body: unknown,
  ctx: LlmActorContext = {},
) {
  const input = parsed(policyInput, body)
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const actorRoles = await assertLlmRole(q, tenantId, actor, ['carrier_technical_admin'])
    const previous = await loadLlmPolicy(q, tenantId)
    await q(
      `INSERT INTO llm_release_policies(tenant_id,min_sample_count,min_field_accuracy,min_evidence_accuracy,authorization_days,role_cooldown_hours,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(tenant_id) DO UPDATE SET min_sample_count=EXCLUDED.min_sample_count,min_field_accuracy=EXCLUDED.min_field_accuracy,
         min_evidence_accuracy=EXCLUDED.min_evidence_accuracy,authorization_days=EXCLUDED.authorization_days,
         role_cooldown_hours=EXCLUDED.role_cooldown_hours,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [tenantId, input.minSampleCount, input.minFieldAccuracy, input.minEvidenceAccuracy, input.authorizationDays, input.roleCooldownHours, actor],
    )
    await appendLlmAudit(q, tenantId, {
      releaseId: null,
      actorId: actor,
      actorType: 'user',
      actorRoles,
      action: 'POLICY_CHANGED',
      detail: { previous, next: input },
      requestId: ctx.requestId,
    })
    return input
  })
}

export async function registerLlmRelease(
  tenantId: string,
  actor: string,
  body: unknown,
  ctx: LlmActorContext = {},
) {
  const { evaluationReport, ...input } = parsed(registrationInput, body)
  const digest = artifactDigest(input.artifacts)
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const actorRoles = await assertLlmRole(q, tenantId, actor, ['llm_release_automation'])
    if (actorRoles.includes('carrier_technical_admin'))
      throw new ForbiddenError('LLM_GOVERNANCE_ROLE_CONFLICT')
    if (ctx.via !== 'credential' && credentialRequired())
      throw new ForbiddenError(
        'LLM_AUTOMATION_CREDENTIAL_REQUIRED',
        'Release automation must authenticate with a scoped service credential',
      )
    const policy = await loadLlmPolicy(q, tenantId)
    verifyEvaluationReport(evaluationReport, input, tenantId, policy)
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
      return publicRelease(previous.rows[0])
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
      `INSERT INTO llm_releases(release_id,tenant_id,version_label,status,artifacts,artifact_digest,evaluation,evaluation_report,gate_policy,created_by)
      VALUES($1,$2,$3,'READY_FOR_VALIDATION',$4::jsonb,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9) RETURNING *`,
      [
        id,
        tenantId,
        input.versionLabel,
        JSON.stringify(input.artifacts),
        digest,
        JSON.stringify(input.evaluation),
        JSON.stringify(evaluationReport),
        JSON.stringify(policy),
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
    await appendLlmAudit(q, tenantId, {
      releaseId: id,
      actorId: actor,
      actorType: 'automation',
      actorRoles,
      action: 'CANDIDATE_READY',
      detail: {
        artifactDigest: digest,
        evaluation: input.evaluation,
        evaluationReportVerified: true,
        authenticatedWith: ctx.via || 'session',
        emailEnabled,
        emailStatus: emailEnabled ? 'Queued' : 'Disabled',
      },
      requestId: ctx.requestId,
    })
    return publicRelease(result.rows[0])
  })
}
export async function transitionLlmRelease(
  tenantId: string,
  id: string,
  actor: string,
  action: string,
  body: unknown,
  ctx: LlmActorContext = {},
) {
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const actorRoles = await assertLlmRole(q, tenantId, actor, ['carrier_technical_admin'])
    if (actorRoles.includes('llm_release_automation'))
      throw new ForbiddenError('LLM_GOVERNANCE_ROLE_CONFLICT')
    const row = await load(q, tenantId, id)
    if (actor === row.created_by)
      throw new ForbiddenError('LLM_MAKER_CHECKER_REQUIRED')
    const policy = await loadLlmPolicy(q, tenantId)
    // Revoking is always allowed: it only ever stops a model from running.
    if (action !== 'revoke' && action !== 'reject') await assertRoleCooldown(q, tenantId, actor, policy)
    let result
    let auditDetail: object = {}
    if (action === 'start-validation') {
      requireStatus(row, 'READY_FOR_VALIDATION')
      const authorization = await signLlmAuthorization(tenantId, row, actor, 'validation', policy.authorizationDays)
      result = await q(
        `UPDATE llm_releases SET status='IN_VALIDATION',validation_authorization=$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND release_id=$2 RETURNING *`,
        [tenantId, id, JSON.stringify(authorization)],
      )
      auditDetail = { expiresAt: authorization.payload.expiresAt }
    } else if (action === 'record-validation') {
      requireStatus(row, 'IN_VALIDATION')
      const input = parsed(validationInput, body)
      if (input.artifactDigest !== row.artifact_digest)
        throw new ConflictError(
          'LLM_ARTIFACT_MISMATCH',
          'The tested artifacts do not match this release',
        )
      verifyValidationReport(input, row.artifact_digest)
      const { report, ...validation } = input
      result = await q(
        `UPDATE llm_releases SET status=$3,validation=$4::jsonb,validation_report=$5::jsonb,validated_by=$6,updated_at=now() WHERE tenant_id=$1 AND release_id=$2 RETURNING *`,
        [
          tenantId,
          id,
          input.passed ? 'VALIDATED' : 'REJECTED',
          JSON.stringify(validation),
          JSON.stringify(report),
          actor,
        ],
      )
      auditDetail = {
        environment: input.environment,
        runId: input.runId,
        passed: input.passed,
        reportSha256: input.reportSha256,
        reportVerified: true,
      }
    } else if (action === 'authorize-production') {
      requireStatus(row, 'VALIDATED')
      parsed(z.object({ attestation: z.literal(true) }).strict(), body)
      if (actor === row.validated_by)
        throw new ForbiddenError(
          'LLM_FOUR_EYES_REQUIRED',
          'A different technical administrator than the validator must authorize production',
        )
      const authorization = await signLlmAuthorization(tenantId, row, actor, 'production', policy.authorizationDays)
      result = await q(
        `UPDATE llm_releases SET status='PRODUCTION_AUTHORIZED',production_authorization=$3::jsonb,approved_by=$4,updated_at=now() WHERE tenant_id=$1 AND release_id=$2 RETURNING *`,
        [tenantId, id, JSON.stringify(authorization), actor],
      )
      auditDetail = { validatedBy: row.validated_by, expiresAt: authorization.payload.expiresAt }
    } else if (action === 'renew-authorization') {
      if (!['IN_VALIDATION', 'PRODUCTION_AUTHORIZED'].includes(row.status))
        throw new ConflictError(
          'INVALID_LLM_RELEASE_TRANSITION',
          'Only validation or production authorizations can be renewed',
        )
      parsed(z.object({ attestation: z.literal(true) }).strict(), body)
      const environment =
        row.status === 'IN_VALIDATION' ? 'validation' : 'production'
      if (environment === 'production' && actor === row.validated_by)
        throw new ForbiddenError(
          'LLM_FOUR_EYES_REQUIRED',
          'The validator cannot renew the production authorization',
        )
      const authorization = await signLlmAuthorization(tenantId, row, actor, environment, policy.authorizationDays)
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
        expiresAt: authorization.payload.expiresAt,
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
        z.object({ reason: z.string().trim().min(1).max(2000) }).strict(),
        body,
      )
      result = await q(
        `UPDATE llm_releases SET status='REJECTED',validation=COALESCE(validation,'{}'::jsonb)||$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND release_id=$2 RETURNING *`,
        [tenantId, id, JSON.stringify({ reason: input.reason })],
      )
      auditDetail = { reason: input.reason }
    } else if (action === 'revoke') {
      if (!['IN_VALIDATION', 'VALIDATED', 'PRODUCTION_AUTHORIZED'].includes(row.status))
        throw new ConflictError(
          'INVALID_LLM_RELEASE_TRANSITION',
          'Only a release with a signed authorization can be revoked',
        )
      const input = parsed(
        z.object({ reason: z.string().trim().min(1).max(2000), attestation: z.literal(true) }).strict(),
        body,
      )
      result = await q(
        `UPDATE llm_releases SET status='REVOKED',revoked_by=$3,revoked_at=now(),revocation_reason=$4,updated_at=now() WHERE tenant_id=$1 AND release_id=$2 RETURNING *`,
        [tenantId, id, actor, input.reason],
      )
      auditDetail = { previousStatus: row.status, reason: input.reason }
    } else
      throw new BadRequestError('INVALID_LLM_ACTION', 'Unknown release action')
    await appendLlmAudit(q, tenantId, {
      releaseId: id,
      actorId: actor,
      actorType: 'user',
      actorRoles,
      action,
      detail: {
        status: result.rows[0].status,
        artifactDigest: row.artifact_digest,
        ...auditDetail,
      },
      requestId: ctx.requestId,
    })
    return publicRelease(result.rows[0])
  })
}

/**
 * A signed list of every revoked release, for the processor's revocation file.
 * Rejected releases that were already authorized for validation are included,
 * so their validation receipts stop working too.
 */
export async function issueRevocationList(tenantId: string, actor: string, ctx: LlmActorContext = {}) {
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const actorRoles = await assertLlmRole(q, tenantId, actor, ['carrier_technical_admin'])
    const result = await q(
      `SELECT release_id FROM llm_releases
        WHERE tenant_id=$1 AND (status='REVOKED' OR (status='REJECTED' AND validation_authorization IS NOT NULL))
        ORDER BY release_id`,
      [tenantId],
    )
    const payload = orderReceiptPayload({
      schemaVersion: 1,
      tenantId,
      issuedAt: new Date().toISOString(),
      releaseIds: result.rows.map((row: any) => row.release_id),
    })
    const signature = await signGovernancePayload('revocation-list', payload)
    await appendLlmAudit(q, tenantId, {
      releaseId: null,
      actorId: actor,
      actorType: 'user',
      actorRoles,
      action: 'REVOCATION_LIST_ISSUED',
      detail: { releaseIds: payload.releaseIds, issuedAt: payload.issuedAt },
      requestId: ctx.requestId,
    })
    return { schemaVersion: 1, releaseIds: payload.releaseIds, payload, signature }
  })
}

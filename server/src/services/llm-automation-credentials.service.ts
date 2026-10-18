import { z } from 'zod'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { withTenantTx, toRawQuery } from '../db.js'
import { appendLlmAudit, llmActorRoles, type LlmActorContext } from './llm-release.service.js'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors/domain.errors.js'

/**
 * Scoped service credentials for release automation.
 *
 * The training pipeline registers candidates with a credential instead of a
 * person's password session: it is bound to one automation identity, expires
 * within 90 days, can be limited to network ranges, and is revoked
 * independently. Only the SHA-256 of the secret is stored; the token is shown
 * once when issued. Format: lpa_<credentialId>_<secret>.
 */
const TOKEN = /^lpa_([0-9a-f-]{36})_([A-Za-z0-9_-]{43})$/
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const issueInput = z
  .object({
    userId: z.string().uuid(),
    label: z.string().trim().min(1).max(120),
    expiresInDays: z.number().int().min(1).max(90),
    allowedCidrs: z
      .array(
        z
          .string()
          .trim()
          .max(64)
          .refine((value) => {
            const [address, bits, extra] = value.split('/')
            const version = isIP(address)
            if (!version || extra !== undefined) return false
            if (bits === undefined) return true
            const max = version === 4 ? 32 : 128
            return /^\d{1,3}$/.test(bits) && Number(bits) <= max
          }, 'Use an IP address or CIDR range'),
      )
      .max(20)
      .default([]),
  })
  .strict()

async function assertAdmin(q: any, tenantId: string, actor: string) {
  const roles = await llmActorRoles(q, tenantId, actor)
  if (!roles.includes('admin')) throw new ForbiddenError('ADMIN_REQUIRED')
  return roles
}

function mapCredential(row: any) {
  return {
    credentialId: row.credential_id,
    userId: row.user_id,
    username: row.username,
    label: row.label,
    allowedCidrs: row.allowed_cidrs || [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }
}

export async function listAutomationCredentials(tenantId: string, actor: string) {
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    await assertAdmin(q, tenantId, actor)
    const result = await q(
      `SELECT c.*, u.username FROM llm_automation_credentials c JOIN users u ON u.user_id=c.user_id
        WHERE c.tenant_id=$1 ORDER BY c.created_at DESC LIMIT 100`,
      [tenantId],
    )
    const automation = await q(
      `SELECT u.user_id, u.username FROM users u JOIN user_roles ur ON ur.user_id=u.user_id AND ur.role_code='llm_release_automation'
        WHERE u.tenant_id=$1 AND u.disabled=false
          AND NOT EXISTS (SELECT 1 FROM user_roles t WHERE t.user_id=u.user_id AND t.role_code='carrier_technical_admin')
        ORDER BY u.username`,
      [tenantId],
    )
    return {
      items: result.rows.map(mapCredential),
      automationUsers: automation.rows.map((row: any) => ({ userId: row.user_id, username: row.username })),
    }
  })
}

export async function issueAutomationCredential(
  tenantId: string,
  actor: string,
  body: unknown,
  ctx: LlmActorContext = {},
) {
  const parsed = issueInput.safeParse(body)
  if (!parsed.success) throw new ValidationError('INVALID_CREDENTIAL_INPUT', parsed.error.flatten())
  const input = parsed.data
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const actorRoles = await assertAdmin(q, tenantId, actor)
    if (input.userId === actor) throw new ForbiddenError('CREDENTIAL_SELF_ISSUE', 'You cannot issue a credential for yourself')
    const targetRoles = await llmActorRoles(q, tenantId, input.userId)
    if (!targetRoles.includes('llm_release_automation'))
      throw new ForbiddenError('LLM_AUTOMATION_ROLE_REQUIRED', 'The identity must hold only the LLM release automation role')
    if (targetRoles.includes('carrier_technical_admin') || targetRoles.includes('admin'))
      throw new ForbiddenError('LLM_GOVERNANCE_ROLE_CONFLICT', 'Automation identities cannot also approve or administer')
    const credentialId = randomUUID()
    const secret = randomBytes(32).toString('base64url')
    const result = await q(
      `INSERT INTO llm_automation_credentials(credential_id,tenant_id,user_id,label,secret_sha256,allowed_cidrs,created_by,expires_at)
       VALUES($1,$2,$3,$4,$5,$6::cidr[],$7,now() + make_interval(days => $8::int)) RETURNING *`,
      [credentialId, tenantId, input.userId, input.label, sha256(secret), input.allowedCidrs, actor, input.expiresInDays],
    )
    await appendLlmAudit(q, tenantId, {
      releaseId: null,
      actorId: actor,
      actorType: 'user',
      actorRoles,
      action: 'CREDENTIAL_ISSUED',
      subjectUserId: input.userId,
      detail: { credentialId, label: input.label, expiresAt: result.rows[0].expires_at, allowedCidrs: input.allowedCidrs },
      requestId: ctx.requestId,
    })
    return { ...mapCredential(result.rows[0]), token: `lpa_${credentialId}_${secret}` }
  })
}

export async function revokeAutomationCredential(
  tenantId: string,
  actor: string,
  credentialId: string,
  ctx: LlmActorContext = {},
) {
  if (!z.string().uuid().safeParse(credentialId).success) throw new NotFoundError('CREDENTIAL_NOT_FOUND')
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const actorRoles = await assertAdmin(q, tenantId, actor)
    const result = await q(
      `UPDATE llm_automation_credentials SET revoked_at=now(), revoked_by=$3
        WHERE tenant_id=$1 AND credential_id=$2 AND revoked_at IS NULL RETURNING *`,
      [tenantId, credentialId, actor],
    )
    if (!result.rows[0]) throw new NotFoundError('CREDENTIAL_NOT_FOUND')
    await appendLlmAudit(q, tenantId, {
      releaseId: null,
      actorId: actor,
      actorType: 'user',
      actorRoles,
      action: 'CREDENTIAL_REVOKED',
      subjectUserId: result.rows[0].user_id,
      detail: { credentialId, label: result.rows[0].label },
      requestId: ctx.requestId,
    })
    return mapCredential(result.rows[0])
  })
}

export function isAutomationToken(token: string) {
  return token.startsWith('lpa_')
}

/** Resolves a service credential to its automation identity, or null. */
export async function authenticateAutomationCredential(
  tenantId: string,
  token: string,
  clientIp: string,
): Promise<{ userId: string; username: string; credentialId: string } | null> {
  const match = TOKEN.exec(token)
  if (!match) return null
  const [, credentialId, secret] = match
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const result = await q(
      `SELECT c.*, u.username,
              (cardinality(c.allowed_cidrs) = 0 OR (CASE WHEN $3::text = '' THEN false ELSE $3::inet <<= ANY(c.allowed_cidrs) END)) AS ip_allowed
         FROM llm_automation_credentials c JOIN users u ON u.user_id=c.user_id AND u.tenant_id=c.tenant_id
        WHERE c.tenant_id=$1 AND c.credential_id=$2::uuid AND c.revoked_at IS NULL AND c.expires_at > now() AND u.disabled=false`,
      [tenantId, credentialId, isIP(clientIp) ? clientIp : ''],
    )
    const row = result.rows[0]
    if (!row || !row.ip_allowed) return null
    const expected = Buffer.from(row.secret_sha256, 'hex')
    const supplied = Buffer.from(sha256(secret), 'hex')
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null
    const roles = await llmActorRoles(q, tenantId, row.user_id)
    if (!roles.includes('llm_release_automation') || roles.includes('carrier_technical_admin')) return null
    await q('UPDATE llm_automation_credentials SET last_used_at=now() WHERE tenant_id=$1 AND credential_id=$2', [tenantId, credentialId])
    return { userId: row.user_id, username: row.username, credentialId }
  })
}

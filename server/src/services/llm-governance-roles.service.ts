import { withTenantTx, toRawQuery, getDb } from '../db.js'
import { appendLlmAudit, GOVERNANCE_ROLES, llmActorRoles } from './llm-release.service.js'

/**
 * Separation of duties for the two model-governance roles.
 *
 * - Nobody grants or removes a governance role on their own account.
 * - One account never holds both: automation registers, a person approves.
 * - Every grant, removal, and disabling of a governance account is written to
 *   the governance audit log with the administrator who did it. A newly
 *   granted technical administrator then waits out the carrier's cooldown
 *   before approving (enforced in llm-release.service).
 */
export type GovernanceChange = { granted: string[]; revoked: string[]; disabled: boolean }
export type GovernanceRefusal = { status: number; code: string; message: string }
const isGovernance = (role: string) => (GOVERNANCE_ROLES as readonly string[]).includes(role)

async function currentRoles(tenantId: string, userId: string | null): Promise<{ roles: string[]; disabled: boolean } | null> {
  if (!userId || !getDb()) return null
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const result = await q(
      `SELECT u.disabled, COALESCE(array_agg(ur.role_code) FILTER (WHERE ur.role_code IS NOT NULL), '{}') AS roles
         FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.user_id
        WHERE u.tenant_id=$1 AND u.user_id=$2::uuid GROUP BY u.disabled`,
      [tenantId, userId],
    )
    const row = result.rows[0]
    return row ? { roles: row.roles || [], disabled: row.disabled === true } : null
  })
}

/** Returns the governance change a user update would make, or why it is refused. */
export async function checkGovernanceRoleChange(
  tenantId: string,
  actorId: string | undefined,
  targetUserId: string | null,
  nextRoles: string[] | undefined,
  nextDisabled?: boolean,
): Promise<GovernanceChange | GovernanceRefusal> {
  const existing = await currentRoles(tenantId, targetUserId)
  const before = existing?.roles || []
  const after = nextRoles || before
  const granted = after.filter((role) => isGovernance(role) && !before.includes(role))
  const revoked = before.filter((role) => isGovernance(role) && !after.includes(role))
  const disabled = nextDisabled === true && existing?.disabled === false && before.some(isGovernance)
  if (!granted.length && !revoked.length && !disabled) return { granted, revoked, disabled }
  if (targetUserId && actorId === targetUserId)
    return {
      status: 403,
      code: 'GOVERNANCE_SELF_ASSIGNMENT',
      message: 'Model-governance roles must be granted or removed by another administrator',
    }
  if (after.includes('carrier_technical_admin') && after.includes('llm_release_automation'))
    return {
      status: 400,
      code: 'GOVERNANCE_ROLE_CONFLICT',
      message: 'One account cannot both register and approve model releases',
    }
  return { granted, revoked, disabled }
}

export function isGovernanceRefusal(value: GovernanceChange | GovernanceRefusal): value is GovernanceRefusal {
  return 'code' in value
}

export async function recordGovernanceRoleChange(
  tenantId: string,
  actorId: string | undefined,
  targetUserId: string,
  change: GovernanceChange,
  requestId?: string,
) {
  if (!getDb() || (!change.granted.length && !change.revoked.length && !change.disabled)) return
  await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const actorRoles = actorId ? await llmActorRoles(q, tenantId, actorId).catch(() => []) : []
    const base = {
      releaseId: null,
      actorId: actorId || null,
      actorType: actorId ? ('user' as const) : ('system' as const),
      actorRoles,
      subjectUserId: targetUserId,
      requestId,
    }
    for (const role of change.granted) await appendLlmAudit(q, tenantId, { ...base, action: 'ROLE_GRANTED', detail: { role } })
    for (const role of change.revoked) await appendLlmAudit(q, tenantId, { ...base, action: 'ROLE_REVOKED', detail: { role } })
    if (change.disabled) await appendLlmAudit(q, tenantId, { ...base, action: 'GOVERNANCE_ACCOUNT_DISABLED', detail: {} })
  })
}

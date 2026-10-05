import { BadRequestError, ConflictError, NotFoundError } from '../errors/domain.errors.js'

type RawQuery = (text: string, params?: any[]) => Promise<any>

function parseExpectedTimelineVersion(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestError(
      'INVALID_EXPECTED_TIMELINE_VERSION',
      'expectedTimelineVersion must be a non-negative integer.',
    )
  }
  return parsed
}

/**
 * Serializes policy mutations for the duration of the caller's transaction.
 * The optional version precondition turns a stale client write into a stable
 * domain conflict instead of silently applying it to a newer timeline.
 */
export async function lockPolicyForMutation(
  q: RawQuery,
  tenantId: string,
  policyId: string,
  expectedTimelineVersion?: unknown,
): Promise<number> {
  const locked = await q(
    `SELECT policy_id
       FROM policies
      WHERE tenant_id = $1 AND policy_id = $2
      FOR UPDATE`,
    [tenantId, policyId],
  )
  if (!locked.rowCount) throw new NotFoundError('POLICY_NOT_FOUND')

  const result = await q(
    `SELECT GREATEST(
              COALESCE((SELECT MAX(timeline_version) FROM policy_transactions
                         WHERE tenant_id = $1 AND policy_id = $2), 0),
              COALESCE((SELECT MAX(timeline_version) FROM policy_versions
                         WHERE tenant_id = $1 AND policy_id = $2), 0)
            )::int AS timeline_version`,
    [tenantId, policyId],
  )
  const currentTimelineVersion = Number(result.rows?.[0]?.timeline_version || 0)
  const expected = parseExpectedTimelineVersion(expectedTimelineVersion)
  if (expected !== null && expected !== currentTimelineVersion) {
    throw new ConflictError(
      'STALE_POLICY_VERSION',
      `Policy timeline changed from version ${expected} to ${currentTimelineVersion}.`,
      { policyId, expectedTimelineVersion: expected, currentTimelineVersion },
    )
  }
  return currentTimelineVersion
}

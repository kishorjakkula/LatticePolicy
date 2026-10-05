import { createHash } from 'crypto'
import { v4 as uuidv4 } from '../uuid.js'

export const GOVERNANCE_STATUSES = ['DRAFT', 'REVIEW', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'RETIRED'] as const
export type GovernanceStatus = typeof GOVERNANCE_STATUSES[number]

const transitions: Record<GovernanceStatus, GovernanceStatus[]> = {
  DRAFT: ['REVIEW'],
  REVIEW: ['DRAFT', 'APPROVED'],
  APPROVED: ['SCHEDULED', 'ACTIVE'],
  SCHEDULED: ['ACTIVE', 'RETIRED'],
  ACTIVE: ['RETIRED'],
  RETIRED: [],
}

export function assertGovernanceTransition(from: GovernanceStatus, to: GovernanceStatus) {
  if (!transitions[from]?.includes(to)) throw new Error(`INVALID_TRANSITION:${from}:${to}`)
}

export function assertMakerChecker(submitter: string, approver: string) {
  if (!submitter || submitter === approver) throw new Error('MAKER_CHECKER_REQUIRED')
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicalize(entry)]))
  }
  return value
}

export function artifactDigest(artifacts: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(artifacts))).digest('hex')
}

export function assertCompleteArtifacts(artifacts: unknown) {
  if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) throw new Error('INVALID_ARTIFACTS')
  const record = artifacts as Record<string, unknown>
  const required = ['product', 'rating', 'underwritingRules', 'coverages', 'forms']
  const missing = required.filter(key => record[key] === undefined || record[key] === null)
  if (missing.length) throw new Error(`MISSING_ARTIFACTS:${missing.join(',')}`)
}

export function periodsOverlap(aStart: string, aEnd: string | null, bStart: string, bEnd: string | null) {
  return aStart <= (bEnd || '9999-12-31') && bStart <= (aEnd || '9999-12-31')
}

export function mapGovernanceRelease(row: any) {
  return {
    releaseId: row.release_id,
    productCode: row.product_code,
    jurisdictionCode: row.jurisdiction_code || null,
    versionLabel: row.version_label,
    status: row.status,
    effectiveDate: String(row.effective_date).slice(0, 10),
    expirationDate: row.expiration_date ? String(row.expiration_date).slice(0, 10) : null,
    artifacts: row.artifacts,
    contentSha256: row.content_sha256,
    createdBy: row.created_by,
    submittedBy: row.submitted_by || null,
    approvedBy: row.approved_by || null,
    activatedBy: row.activated_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function resolveGovernanceRelease(q: any, tenantId: string, productCode: string, jurisdiction: string, asOf: string) {
  const result = await q(
    `SELECT * FROM product_governance_releases
      WHERE tenant_id=$1 AND LOWER(product_code)=LOWER($2) AND status='ACTIVE'
        AND effective_date <= $4::date AND (expiration_date IS NULL OR expiration_date >= $4::date)
        AND (jurisdiction_code IS NULL OR jurisdiction_code='' OR UPPER(jurisdiction_code)=UPPER($3))
      ORDER BY CASE WHEN UPPER(COALESCE(jurisdiction_code,''))=UPPER($3) THEN 0 ELSE 1 END,
               effective_date DESC
      LIMIT 1`,
    [tenantId, productCode, jurisdiction || '', asOf]
  )
  return result.rows?.[0] ? mapGovernanceRelease(result.rows[0]) : null
}

export function newReleaseId() { return uuidv4() }

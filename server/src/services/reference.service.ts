import { toRawQuery, withTenantTx, type DrizzleDB } from '../db.js'
import { checkStateEligibility } from '../policyCompliance.js'
import { NotFoundError } from '../errors/domain.errors.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgencyFilters = {
  q?: string
  limit?: number
}

export type AgencyItem = {
  agencyId: string
  agencyCode: string
  agencyKey: string
  legalName: string
  dbaName: string
  agencyType: string
  updatedAt: string | null
}

export type AgencyContactItem = {
  contactId: string
  displayName: string
  firstName: string
  lastName: string
  email: string
  phoneNumber: string
  extension: string
  preferred: boolean
  verified: boolean
}

export type UnderwriterItem = {
  userId: string
  username: string
  displayName: string
}

export type StateEligibilityResult = {
  eligible: boolean
  reason?: string
  _source?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function asTrimmedText(value: any): string {
  return String(value ?? '').trim()
}

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * List active agencies for a tenant, optionally filtered by a search string.
 *
 * Queries the `agencies` table with status='ACTIVE', filtering on agency_code,
 * agency_key, legal_name, and dba_name via ILIKE.
 */
export async function listAgencies(
  db: DrizzleDB,
  tenantId: string,
  filters: AgencyFilters
): Promise<{ items: AgencyItem[] }> {
  const qText = asTrimmedText(filters.q)
  const limitRaw = Number(filters.limit)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.round(limitRaw))) : 200

  const result = await withTenantTx(tenantId, async (innerDb) => {
    const q = toRawQuery(innerDb)
    const clauses = ['tenant_id = $1', `status = 'ACTIVE'`]
    const params: any[] = [tenantId]
    let idx = 2
    if (qText) {
      clauses.push(`(
        agency_code ILIKE $${idx}
        OR agency_key ILIKE $${idx}
        OR legal_name ILIKE $${idx}
        OR coalesce(dba_name, '') ILIKE $${idx}
      )`)
      params.push(`%${qText}%`)
      idx += 1
    }
    params.push(limit)
    return q(
      `SELECT agency_id, agency_code, agency_key, legal_name, dba_name, agency_type, updated_at
         FROM agencies
        WHERE ${clauses.join(' AND ')}
        ORDER BY legal_name ASC
        LIMIT $${idx}`,
      params
    )
  })

  return {
    items: (result as any).rows.map((row: any) => ({
      agencyId: row.agency_id,
      agencyCode: row.agency_code || '',
      agencyKey: row.agency_key || '',
      legalName: row.legal_name || '',
      dbaName: row.dba_name || '',
      agencyType: row.agency_type || '',
      updatedAt: row.updated_at || null
    }))
  }
}

/**
 * Get deduplicated contact points for a specific agency.
 *
 * Queries `onboarding_contact_points` for the given agencyId (entity_type='AGENCY'),
 * filtered to currently effective records. Deduplicates contacts by identity
 * (firstName + lastName + email + phone).
 *
 * Throws NotFoundError if the agency does not exist for this tenant.
 */
export async function getAgencyContacts(
  db: DrizzleDB,
  tenantId: string,
  agencyId: string
): Promise<{ items: AgencyContactItem[] }> {
  const result = await withTenantTx(tenantId, async (innerDb) => {
    const q = toRawQuery(innerDb)
    const agencyResult = await q(
      `SELECT agency_id
         FROM agencies
        WHERE tenant_id = $1
          AND agency_id = $2::uuid
        LIMIT 1`,
      [tenantId, agencyId]
    )
    if (!agencyResult.rowCount) {
      throw new NotFoundError('NOT_FOUND', 'Agency not found')
    }

    return q(
      `SELECT contact_id, contact_type, value, extension, preferred_flag, verified_flag, metadata, updated_at
         FROM onboarding_contact_points
        WHERE tenant_id = $1
          AND entity_type = 'AGENCY'
          AND entity_id = $2::uuid
          AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
        ORDER BY preferred_flag DESC, updated_at DESC`,
      [tenantId, agencyId]
    )
  })

  const byIdentity = new Map<string, AgencyContactItem>()
  for (const row of (result as any).rows || []) {
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
    const firstName = asTrimmedText(metadata.firstName)
    const lastName = asTrimmedText(metadata.lastName)
    const email = asTrimmedText(
      metadata.email ||
        (String(row.contact_type || '').toUpperCase() === 'EMAIL' ? row.value : '')
    )
    const phoneNumber = asTrimmedText(
      metadata.phoneNumber ||
        (String(row.contact_type || '').toUpperCase() === 'PHONE' ? row.value : '')
    )
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()
    const displayName = fullName || email || phoneNumber || 'Agency Contact'
    const dedupeKey =
      [
        firstName.toLowerCase(),
        lastName.toLowerCase(),
        email.toLowerCase(),
        phoneNumber.replace(/\D+/g, '')
      ].join('|') || String(row.contact_id)

    const existing = byIdentity.get(dedupeKey)
    const nextRecord: AgencyContactItem = {
      contactId: row.contact_id,
      displayName,
      firstName,
      lastName,
      email,
      phoneNumber,
      extension: asTrimmedText(row.extension),
      preferred: Boolean(row.preferred_flag),
      verified: Boolean(row.verified_flag)
    }
    if (!existing || (!existing.preferred && nextRecord.preferred)) {
      byIdentity.set(dedupeKey, nextRecord)
    }
  }

  const items = Array.from(byIdentity.values()).sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1
    return String(a.displayName || '').localeCompare(String(b.displayName || ''))
  })

  return { items }
}

/**
 * List users with underwriter or admin roles for a tenant.
 *
 * Queries `users` joined with `user_roles` filtering on role_code in
 * ('underwriter', 'admin') and disabled=false.
 */
export async function listUnderwriters(
  db: DrizzleDB,
  tenantId: string
): Promise<{ items: UnderwriterItem[] }> {
  const result = await withTenantTx(tenantId, (innerDb) =>
    toRawQuery(innerDb)(
      `SELECT DISTINCT u.user_id, u.username
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.user_id
        WHERE u.tenant_id = $1
          AND u.disabled = false
          AND ur.role_code IN ('underwriter', 'admin')
        ORDER BY u.username ASC`,
      [tenantId]
    )
  )

  return {
    items: (result as any).rows.map((row: any) => ({
      userId: row.user_id,
      username: row.username,
      displayName: row.username
    }))
  }
}

/**
 * Check whether a product/state combination is eligible for writing.
 *
 * Delegates to the `checkStateEligibility` function from policyCompliance.ts
 * which queries the state_eligibility table.
 */
export async function checkStateEligibilityForProduct(
  db: DrizzleDB,
  tenantId: string,
  productCode: string,
  stateCode: string
): Promise<StateEligibilityResult> {
  return withTenantTx(tenantId, (innerDb) =>
    checkStateEligibility(toRawQuery(innerDb), tenantId, productCode, stateCode)
  )
}

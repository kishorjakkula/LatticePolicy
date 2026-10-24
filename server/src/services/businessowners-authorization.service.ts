import { AppError, BadRequestError, ForbiddenError } from '../errors/domain.errors.js'
import { isUuidLike } from '../lib/utils.js'

type Query = (text: string, params?: any[]) => Promise<any>

export const BUSINESSOWNERS_USER_SOURCE = 'latticepolicy-user'

export function isBusinessownersProduct(productCode: unknown): boolean {
  return typeof productCode === 'string' && productCode.trim().toLowerCase() === 'businessowners'
}

function selectedId(nested: unknown, flat: unknown, field: string): string {
  const value = nested ?? flat
  if (typeof value !== 'string' || !isUuidLike(value) ||
      (nested != null && flat != null && String(nested).toLowerCase() !== String(flat).toLowerCase())) {
    throw new BadRequestError('BOP_DISTRIBUTION_REQUIRED', `Select a valid ${field}.`, { field })
  }
  return value
}

/**
 * Call with the action's tenant-scoped transaction, including immediately before
 * persistence. actorId must come from authenticated server context, never payload
 * or an audit username. Locks keep checked dependencies stable until commit.
 * This is distribution authorization, not a claim of regulatory license validity.
 */
export async function assertBusinessownersAuthorization(
  q: Query,
  tenantId: string,
  payload: any,
  actorId?: string | null,
): Promise<void> {
  if (!isBusinessownersProduct(payload?.productCode)) return
  if (payload.state !== 'OH' || (payload.country != null && payload.country !== 'US') ||
      (payload.countryCode != null && payload.countryCode !== 'US') ||
      (payload.jurisdiction?.code != null && payload.jurisdiction.code !== 'OH')) {
    throw new BadRequestError('STATE_NOT_ELIGIBLE', 'Businessowners is available only for the US/Ohio demo scope.')
  }
  const date = payload.effectiveDate
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new BadRequestError('BOP_EFFECTIVE_DATE_REQUIRED', 'A valid effective date is required.', { field: 'effectiveDate' })
  }
  if (typeof payload.underwritingCompanyId !== 'string' || !isUuidLike(payload.underwritingCompanyId)) {
    throw new BadRequestError('BOP_COMPANY_NOT_ELIGIBLE', 'Select an active Ohio businessowners underwriting company.', { field: 'underwritingCompanyId' })
  }
  const agencyId = selectedId(payload.agency?.agencyId, payload.agencyId, 'agency.agencyId')
  const producerId = selectedId(payload.producer?.producerId, payload.producerId, 'producer.producerId')
  if (payload.producer?.agencyId != null && String(payload.producer.agencyId).toLowerCase() !== agencyId.toLowerCase()) {
    throw new BadRequestError('BOP_DISTRIBUTION_REQUIRED', 'The producer agency must match the selected agency.', { field: 'producer.agencyId' })
  }
  if (!actorId || !isUuidLike(actorId)) {
    throw new ForbiddenError('BOP_ACTOR_NOT_AUTHORIZED', 'An authenticated current tenant user is required.')
  }

  try {
    // The user FK lock also blocks concurrent role additions (e.g. customer).
    const user = await q(`SELECT user_id FROM users
      WHERE tenant_id=$1 AND user_id=$2 AND disabled=false FOR UPDATE`, [tenantId, actorId])
    if (!user.rows.length) throw new ForbiddenError('BOP_ACTOR_NOT_AUTHORIZED', 'The current tenant user is unavailable or disabled.')
    const assigned = await q(`SELECT ur.role_code FROM user_roles ur
      JOIN rbac_roles rr ON rr.role_code=ur.role_code AND rr.tenant_id=$1 AND rr.active=true
      WHERE ur.user_id=$2 FOR SHARE OF ur, rr`, [tenantId, actorId])
    if (assigned.rows.some((row: any) => ['customer', 'llm_release_automation'].includes(row.role_code))) {
      throw new ForbiddenError('BOP_ACTOR_NOT_AUTHORIZED', 'Customer and automation identities cannot quote or bind businessowners.')
    }
    const access = await q(`SELECT ur.role_code, rp.permission_code FROM user_roles ur
      JOIN rbac_roles rr ON rr.role_code=ur.role_code AND rr.tenant_id=$1 AND rr.active=true
      JOIN rbac_role_permissions rp ON rp.tenant_id=rr.tenant_id AND rp.role_code=rr.role_code
      WHERE ur.user_id=$2 AND rp.permission_code='page.wizard.view'
      FOR SHARE OF ur, rr, rp`, [tenantId, actorId])
    const roles = access.rows.map((row: any) => row.role_code)
    const internal = roles.includes('admin') || roles.includes('underwriter')
    if (!internal && !roles.includes('agent')) {
      throw new ForbiddenError('BOP_ACTOR_NOT_AUTHORIZED', 'Current agent, underwriter or administrator wizard authorization is required.')
    }

    const eligibility = await q(`SELECT eligibility_id FROM product_state_eligibility
      WHERE tenant_id=$1 AND product_code='businessowners' AND state_code='OH' AND status='ACTIVE'
      AND (effective_date IS NULL OR effective_date <= $2::date)
      AND (expiration_date IS NULL OR expiration_date > $2::date) FOR SHARE`, [tenantId, date])
    if (!eligibility.rows.length) throw new BadRequestError('STATE_NOT_ELIGIBLE', 'Active effective-dated Ohio businessowners eligibility is required.')

    const company = await q(`SELECT company_id FROM underwriting_companies
      WHERE tenant_id=$1 AND company_id=$2 AND product_code='businessowners'
      AND country_code='US' AND state_code='OH' AND active=true FOR SHARE`, [tenantId, payload.underwritingCompanyId])
    if (!company.rows.length) throw new BadRequestError('BOP_COMPANY_NOT_ELIGIBLE', 'The selected company is not active for Ohio businessowners.', { field: 'underwritingCompanyId' })

    const agency = await q(`SELECT agency_id FROM agencies
      WHERE tenant_id=$1 AND agency_id=$2 AND status='ACTIVE'
      AND (effective_from IS NULL OR effective_from <= $3::date)
      AND (effective_to IS NULL OR effective_to > $3::date) FOR SHARE`, [tenantId, agencyId, date])
    const producer = await q(`SELECT producer_id FROM producers
      WHERE tenant_id=$1 AND producer_id=$2 AND status='ACTIVE' FOR SHARE`, [tenantId, producerId])
    const affiliation = await q(`SELECT affiliation_id FROM agency_producer_affiliations
      WHERE tenant_id=$1 AND agency_id=$2 AND producer_id=$3
      AND (effective_from IS NULL OR effective_from <= $4::date)
      AND (effective_to IS NULL OR effective_to > $4::date) FOR SHARE`, [tenantId, agencyId, producerId, date])
    if (!agency.rows.length || !producer.rows.length || !affiliation.rows.length) {
      throw new ForbiddenError('BOP_DISTRIBUTION_NOT_AUTHORIZED', 'An active agency, producer and effective-dated affiliation are required.')
    }

    // Carrier code is the tenant's carrier identity, not an invented company FK.
    const appointments = await q(`SELECT entity_type FROM onboarding_appointments
      WHERE tenant_id=$1 AND carrier_code=$1 AND state='OH' AND product_code='businessowners'
      AND appointment_status='ACTIVE' AND appointment_effective_date <= $4::date
      AND (termination_date IS NULL OR termination_date > $4::date)
      AND ((entity_type='AGENCY' AND entity_id=$2) OR (entity_type='PRODUCER' AND entity_id=$3))
      FOR SHARE`, [tenantId, agencyId, producerId, date])
    if (!['AGENCY', 'PRODUCER'].every(type => appointments.rows.some((row: any) => row.entity_type === type))) {
      throw new ForbiddenError('BOP_APPOINTMENT_REQUIRED', 'Active Ohio businessowners appointments for the agency and producer are required on the effective date.')
    }
    if (!internal) {
      const identity = await q(`SELECT external_identifier_id FROM onboarding_external_identifiers
        WHERE tenant_id=$1 AND entity_type='PRODUCER' AND entity_id=$2
        AND source_system=$3 AND external_id=$4 AND id_type='USER_ID' AND active_flag=true FOR SHARE`,
      [tenantId, producerId, BUSINESSOWNERS_USER_SOURCE, actorId])
      if (!identity.rows.length) throw new ForbiddenError('BOP_PRODUCER_IDENTITY_REQUIRED', 'The selected producer must be associated with the current user.')
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(503, 'BOP_DEPENDENCIES_UNAVAILABLE', 'Businessowners authorization dependencies are unavailable; no quote or bind is permitted.')
  }
}

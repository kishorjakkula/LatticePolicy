/**
 * Personal/commercial insurance flow mapper: ACORD P&C-style submission
 * payload <-> LatticePolicy internal quote/policy shapes.
 */
import type { MappingError, MappingResult } from './errors.js'
import { mappingFail, mappingOk, requireField, requireString } from './errors.js'
import type { CanonicalParty, CanonicalPolicy, CanonicalSubmission } from './types.js'

/** What LatticePolicy's create-quote flow actually needs (packages/types/src/schemas/quote.schema.ts). */
export interface InternalQuoteIntake {
  productCode: string
  effectiveDate: string
  termMonths?: number
  state?: string
  insuredParty: {
    fullName: string
    taxId?: string
    address?: { line1?: string; city?: string; stateCode?: string; postalCode?: string }
    email?: string
    phone?: string
  }
}

/** Internal row shapes this outbound mapper reads from (server/src/schema.ts). */
export interface InternalPolicyForExport {
  policyNumber: string | null
  productCode: string
  status: string
  termEffectiveDate: string
  termExpirationDate: string
  currencyCode: string | null
  jurisdictionCode: string | null
  insuredParty: {
    name: string
    taxId?: string
    address?: { line1?: string; city?: string; stateCode?: string; postalCode?: string }
    email?: string
    phone?: string
  }
}

/**
 * Inbound: an ACORD P&C-style submission payload -> internal quote intake.
 * Maps the subset of PersPolicyQuoteInqRq / CommlPolicyQuoteInqRq fields
 * this platform's quote flow actually consumes.
 */
export function mapAcordSubmissionToQuoteIntake(payload: unknown): MappingResult<InternalQuoteIntake> {
  const errors: MappingError[] = []
  if (typeof payload !== 'object' || payload === null) {
    return mappingFail([{ field: '$', code: 'INVALID_TYPE', message: 'payload must be an object', expected: 'object' }])
  }
  const p = payload as Record<string, unknown>

  const productCode = p['LOBCd'] ?? p['productCode']
  const effectiveDate = p['ContractTerm.EffectiveDt'] ?? p['effectiveDate']
  const termMonths = p['ContractTerm.DurationPeriod.NumUnits'] ?? p['termMonths']
  const state = p['PolicyState'] ?? p['state']
  const insured = (p['InsuredOrPrincipal'] ?? p['insured']) as Record<string, unknown> | undefined

  requireString(errors, productCode, 'LOBCd')
  requireField(errors, effectiveDate, 'ContractTerm.EffectiveDt', 'ISO date string')
  requireField(errors, insured, 'InsuredOrPrincipal', 'object')

  let fullName: string | undefined
  let taxId: string | undefined
  let address: InternalQuoteIntake['insuredParty']['address']
  let email: string | undefined
  let phone: string | undefined

  if (insured) {
    const generalPartyInfo = (insured['GeneralPartyInfo'] ?? insured) as Record<string, unknown>
    const nameInfo = (generalPartyInfo['NameInfo'] ?? generalPartyInfo['name']) as Record<string, unknown> | undefined
    fullName = (nameInfo?.['CommlName.CommercialName'] ?? nameInfo?.['PersonName.FullName'] ?? nameInfo?.['fullName']) as
      | string
      | undefined
    taxId = (generalPartyInfo['TaxIdentity.TaxId'] ?? generalPartyInfo['taxId']) as string | undefined

    const addr = (generalPartyInfo['Addr'] ?? generalPartyInfo['address']) as Record<string, unknown> | undefined
    if (addr) {
      address = {
        line1: addr['Addr1'] as string | undefined,
        city: addr['City'] as string | undefined,
        stateCode: addr['StateProvCd'] as string | undefined,
        postalCode: addr['PostalCode'] as string | undefined,
      }
    }
    const commsInfo = (generalPartyInfo['Communications'] ?? {}) as Record<string, unknown>
    email = (commsInfo['EmailInfo.EmailAddr'] ?? generalPartyInfo['email']) as string | undefined
    phone = (commsInfo['PhoneInfo.PhoneNumber'] ?? generalPartyInfo['phone']) as string | undefined

    requireString(errors, fullName, 'InsuredOrPrincipal.GeneralPartyInfo.NameInfo')
  }

  if (errors.length > 0) return mappingFail(errors)

  return mappingOk({
    productCode: productCode as string,
    effectiveDate: effectiveDate as string,
    termMonths: termMonths ? Number(termMonths) : undefined,
    state: state as string | undefined,
    insuredParty: {
      fullName: fullName as string,
      taxId,
      address,
      email,
      phone,
    },
  })
}

/**
 * Outbound: an internal policy row -> ACORD P&C-style canonical policy
 * payload, suitable for integration/export consumers.
 */
export function mapPolicyToAcordCanonical(policy: InternalPolicyForExport): CanonicalPolicy {
  const insuredParty: CanonicalParty = {
    partyType: 'Organization',
    fullName: policy.insuredParty.name,
    taxId: policy.insuredParty.taxId,
    roleCode: 'Insured',
    addresses: policy.insuredParty.address
      ? [
          {
            addressType: 'Mailing',
            line1: policy.insuredParty.address.line1,
            city: policy.insuredParty.address.city,
            stateCode: policy.insuredParty.address.stateCode,
            postalCode: policy.insuredParty.address.postalCode,
          },
        ]
      : [],
    contacts: [
      ...(policy.insuredParty.email ? [{ contactType: 'Email' as const, value: policy.insuredParty.email, isPrimary: true }] : []),
      ...(policy.insuredParty.phone ? [{ contactType: 'Phone' as const, value: policy.insuredParty.phone }] : []),
    ],
  }

  return {
    policyNumber: policy.policyNumber ?? undefined,
    productCode: policy.productCode,
    lineOfBusinessCode: policy.productCode,
    statusCode: policy.status,
    termEffectiveDate: policy.termEffectiveDate,
    termExpirationDate: policy.termExpirationDate,
    currencyCode: policy.currencyCode ?? 'USD',
    insuredParty,
    jurisdictionCode: policy.jurisdictionCode ?? undefined,
  }
}

/**
 * Inbound: an ACORD GRLC-style large-commercial submission -> internal
 * submission intent. Distinct from mapAcordSubmissionToQuoteIntake because
 * GRLC submissions carry subscription/market-placement context a simple
 * personal/commercial quote payload does not.
 */
export function mapGrlcSubmissionToInternal(payload: unknown): MappingResult<CanonicalSubmission> {
  const errors: MappingError[] = []
  if (typeof payload !== 'object' || payload === null) {
    return mappingFail([{ field: '$', code: 'INVALID_TYPE', message: 'payload must be an object', expected: 'object' }])
  }
  const p = payload as Record<string, unknown>

  const productCode = p['LOBCd'] ?? p['productCode']
  const effectiveDate = p['ContractTerm.EffectiveDt'] ?? p['effectiveDate']
  const termMonths = p['ContractTerm.DurationPeriod.NumUnits'] ?? p['termMonths']
  const insured = (p['InsuredOrPrincipal'] ?? p['insured']) as Record<string, unknown> | undefined

  requireString(errors, productCode, 'LOBCd')
  requireField(errors, effectiveDate, 'ContractTerm.EffectiveDt', 'ISO date string')
  requireField(errors, insured, 'InsuredOrPrincipal', 'object')

  if (errors.length > 0) return mappingFail(errors)

  const generalPartyInfo = insured ? ((insured['GeneralPartyInfo'] ?? insured) as Record<string, unknown>) : {}
  const nameInfo = (generalPartyInfo['NameInfo'] ?? generalPartyInfo['name']) as Record<string, unknown> | undefined
  const fullName = (nameInfo?.['CommlName.CommercialName'] ?? nameInfo?.['fullName'] ?? 'Unknown Insured') as string

  return mappingOk({
    productCode: productCode as string,
    effectiveDate: effectiveDate as string,
    termMonths: termMonths ? Number(termMonths) : 12,
    isLargeCommercialPlacement: true,
    insuredParty: {
      partyType: 'Organization',
      fullName,
      roleCode: 'Insured',
      addresses: [],
      contacts: [],
    },
  })
}

/**
 * Canonical mapping types for ACORD P&C and ACORD Global Reinsurance & Large
 * Commercial (GRLC) data exchange. These are LatticePolicy's own canonical
 * JSON shapes, structurally inspired by ACORD concepts and field-named to
 * make the cross-reference obvious — this is not a generated ACORD XML/XSD
 * binding. See docs/ACORD_GRLC_MAPPING.md for supported scope and gaps.
 */

/** ACORD P&C: Person/Org party (Producer, InsuredOrPrincipal, etc.). */
export interface CanonicalParty {
  partyId?: string
  partyType: 'Person' | 'Organization'
  fullName: string
  taxId?: string
  addresses: CanonicalAddress[]
  contacts: CanonicalContact[]
  /** ACORD role code, e.g. Insured, NamedInsured, LossPayee, AdditionalInsured. */
  roleCode?: string
}

export interface CanonicalAddress {
  addressType?: 'Mailing' | 'Physical' | 'Garaging' | 'Risk'
  line1?: string
  line2?: string
  city?: string
  stateCode?: string
  postalCode?: string
  countryCode?: string
}

export interface CanonicalContact {
  contactType: 'Email' | 'Phone' | 'Fax'
  value: string
  isPrimary?: boolean
}

/** ACORD P&C PolicySummaryInfo / GRLC Policy concepts. */
export interface CanonicalPolicy {
  policyNumber?: string
  productCode: string
  lineOfBusinessCode: string
  statusCode: string
  termEffectiveDate: string
  termExpirationDate: string
  currencyCode: string
  insuredParty: CanonicalParty
  jurisdictionCode?: string
}

/** ACORD P&C Submission/PersPolicyQuoteInqRq or GRLC MarketSubmission. */
export interface CanonicalSubmission {
  submissionId?: string
  productCode: string
  effectiveDate: string
  termMonths: number
  jurisdictionCode?: string
  insuredParty: CanonicalParty
  /** GRLC: true when this submission targets subscription/large-commercial placement, not a simple single-carrier quote. */
  isLargeCommercialPlacement?: boolean
}

/** ACORD P&C RiskLocationInfo / VehInfo / DwellInfo, generalized. */
export interface CanonicalRisk {
  riskUnitId?: string
  kind: string
  attributes: Record<string, unknown>
  address?: CanonicalAddress
  effectiveDate?: string
  expirationDate?: string
}

/** ACORD P&C CoverageInfo. */
export interface CanonicalCoverage {
  coverageCode: string
  appliesTo?: string
  limits?: Record<string, unknown>
  deductibles?: Record<string, unknown>
  selected: boolean
}

/** ACORD P&C PolicyChgInfo / GRLC Endorsement-equivalent transaction. */
export interface CanonicalTransaction {
  transactionId?: string
  transactionType: string
  statusCode: string
  effectiveDate?: string
  processedAt?: string
  transactionNumber?: string
}

/** ACORD P&C PremiumInfo / MiscCost, applied at a transaction. */
export interface CanonicalPremiumImpact {
  transactionId?: string
  totalPremium?: number
  fees?: number
  taxes?: number
  currencyCode: string
}

/** ACORD P&C RemarkText / AttachmentInfo (form/document reference). */
export interface CanonicalDocument {
  documentId?: string
  documentType: string
  displayName?: string
  contentIdentifier?: string
  generatedAt?: string
}

/** ACORD GRLC Exposure/AggregateExposure-equivalent. */
export interface CanonicalExposure {
  productCode: string
  stateCode?: string
  postalCode?: string
  classCode?: string
  totalInsuredValue?: number
  asOfDate: string
}

/**
 * ACORD GRLC ReinsuranceCession / TreatyInfo. Maps LatticePolicy's own
 * reinsurance model (issue #61, docs/REINSURANCE_MODEL.md) rather than
 * inventing a parallel shape.
 */
export interface CanonicalReinsurancePlacement {
  placementType: 'TREATY' | 'FACULTATIVE'
  treatyName?: string
  treatyType?: 'QUOTA_SHARE' | 'SURPLUS' | 'EXCESS_OF_LOSS' | 'FACULTATIVE_OBLIGATORY'
  layerNumber?: number
  certificateNumber?: string
  retainedPercent: number
  cededPercent: number
  retainedPremium?: number
  cededPremium?: number
  effectiveDate?: string
  expirationDate?: string
  marketParticipants: CanonicalReinsuranceParticipant[]
}

/** ACORD GRLC SecurityInfo / MarketInfo (a reinsurer's share of a placement). */
export interface CanonicalReinsuranceParticipant {
  reinsurerName: string
  reinsurerReference?: string
  participationPercent: number
  brokerName?: string
  isLead?: boolean
}

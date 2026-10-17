// ── Document template variables ────────────────────────────────────────────
// A curated, fixed catalog of merge-field tokens that an uploaded .docx form
// template may reference as `{{token}}`, plus:
//   - the resolver that turns a real bound policy's data into a flat
//     token -> string map (see `resolveDocumentTemplateVariables`), and
//   - the docx parse/validate/substitute helpers built on docxtemplater +
//     pizzip (see `extractDocxPlaceholderTokens` / `renderDocxTemplate`).
//
// The catalog is intentionally a FIXED, flat list (not an arbitrary
// dotted-path resolver like `valueAtPath` in notification.service.ts) so
// that a typo in an uploaded template is caught at upload-validation time
// (forms-admin.routes.ts's template-upload endpoint rejects unknown tokens),
// rather than silently rendering blank inside a real, bound policy document
// later. Every token here is traced to a real column/field already used
// elsewhere in this codebase (see the comments above each group) — nothing
// here is fabricated insurance content.
import crypto from 'crypto'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { loadProductConfig } from '../lib/products.js'

export type QueryFn = (text: string, params?: any[]) => Promise<any>

// The exact MIME type the forms-admin upload endpoint and the packet builder
// use to recognize an uploaded file as a Word template (as opposed to the
// existing PDF-template path, which is untouched).
export const DOCX_TEMPLATE_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type DocumentTemplateVariableGroup = 'Insured' | 'Policy' | 'Policy details' | 'Coverage' | 'Homeowners' | 'Premium' | 'Agent'

export type DocumentTemplateVariable = {
  token: string
  label: string
  description: string
  group: DocumentTemplateVariableGroup
}

// How many repeating coverage "slots" are exposed as named tokens
// (coverage1Code/Limit/Deductible .. coverageNCode/Limit/Deductible). Coverage
// codes are product-defined (personal auto, cyber, professional liability,
// etc. all use different codes) so there is no fixed, universal set of
// per-coverage-code tokens to expose — an indexed convention (in the same
// order the policy's own coverages are stored) is the pragmatic, honest
// choice here, documented via each token's `description`.
const COVERAGE_SLOT_COUNT = 5

function ordinal(n: number): string {
  const names = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']
  return names[n] || `${n}th`
}

function buildCoverageSlotVariables(): DocumentTemplateVariable[] {
  const variables: DocumentTemplateVariable[] = []
  for (let i = 1; i <= COVERAGE_SLOT_COUNT; i++) {
    const place = ordinal(i)
    variables.push(
      {
        token: `coverage${i}Code`,
        label: `Coverage ${i} Code`,
        description: `The coverage code of the ${place} selected coverage, in the policy's own coverage order.`,
        group: 'Coverage',
      },
      {
        token: `coverage${i}Limit`,
        label: `Coverage ${i} Limit`,
        description: `The limit of the ${place} selected coverage.`,
        group: 'Coverage',
      },
      {
        token: `coverage${i}Deductible`,
        label: `Coverage ${i} Deductible`,
        description: `The deductible of the ${place} selected coverage.`,
        group: 'Coverage',
      }
    )
  }
  return variables
}

export const DOCUMENT_TEMPLATE_VARIABLES: DocumentTemplateVariable[] = [
  // ── Insured (customers / customer_person_details / customer_company_details /
  // customer_addresses / customer_contact_points — migration 017_customer_master.sql
  // — joined off policy_customer_links for the PRIMARY_NAMED_INSURED role; falls
  // back to the quote payload's insureds.primary/applicant when no customer
  // master record is linked) ────────────────────────────────────────────────
  {
    token: 'insuredName',
    label: 'Insured Name',
    description: "The primary named insured's full display name.",
    group: 'Insured',
  },
  {
    token: 'insuredFirstName',
    label: 'Insured First Name',
    description: "The primary named insured's first name (individuals only).",
    group: 'Insured',
  },
  {
    token: 'insuredLastName',
    label: 'Insured Last Name',
    description: "The primary named insured's last name (individuals only).",
    group: 'Insured',
  },
  {
    token: 'insuredEmail',
    label: 'Insured Email',
    description: "The primary named insured's preferred email address.",
    group: 'Insured',
  },
  {
    token: 'insuredPhone',
    label: 'Insured Phone',
    description: "The primary named insured's preferred phone number.",
    group: 'Insured',
  },
  {
    token: 'insuredAddressLine1',
    label: 'Insured Address Line 1',
    description: "The primary named insured's primary address, line 1.",
    group: 'Insured',
  },
  {
    token: 'insuredAddressLine2',
    label: 'Insured Address Line 2',
    description: "The primary named insured's primary address, line 2.",
    group: 'Insured',
  },
  {
    token: 'insuredCity',
    label: 'Insured City',
    description: "The city of the primary named insured's primary address.",
    group: 'Insured',
  },
  {
    token: 'insuredState',
    label: 'Insured State',
    description: "The state of the primary named insured's primary address.",
    group: 'Insured',
  },
  {
    token: 'insuredPostalCode',
    label: 'Insured Postal Code',
    description: "The postal code of the primary named insured's primary address.",
    group: 'Insured',
  },

  // ── Policy (policies / policy_versions, and the transaction context every
  // caller of buildPolicyDocumentPacket already passes in
  // document-generation.service.ts) ──────────────────────────────────────────
  { token: 'policyNumber', label: 'Policy Number', description: 'The policy number.', group: 'Policy' },
  { token: 'productCode', label: 'Product Code', description: 'The product/line-of-business code.', group: 'Policy' },
  { token: 'state', label: 'Policy State', description: 'The policy jurisdiction/state code.', group: 'Policy' },
  {
    token: 'effectiveDate',
    label: 'Effective Date',
    description: 'The effective date of the transaction that generated this document.',
    group: 'Policy',
  },
  {
    token: 'expirationDate',
    label: 'Expiration Date',
    description: "The policy's current term expiration date.",
    group: 'Policy',
  },
  {
    token: 'transactionType',
    label: 'Transaction Type',
    description: 'The transaction type that generated this document (e.g. NB, Endorse, Renew).',
    group: 'Policy',
  },
  {
    token: 'transactionNumber',
    label: 'Transaction Number',
    description: 'The transaction number that generated this document.',
    group: 'Policy',
  },

  // ── Coverage (coverages / coverage_selections, via the same `payload.coverages`
  // shape policy.service.ts's getFullPolicyPayload and document-generation.service.ts's
  // own coverageMap() already assemble) ───────────────────────────────────────
  {
    token: 'coverageSummary',
    label: 'Coverage Summary',
    description: 'A single-line summary of every selected coverage, its limit, and its deductible.',
    group: 'Coverage',
  },
  ...buildCoverageSlotVariables(),

  // ── Premium (policy_versions.premium_total/premium_fees/premium_taxes/currency) ──
  {
    token: 'premiumTotal',
    label: 'Premium Total',
    description: 'The total premium for this policy version.',
    group: 'Premium',
  },
  {
    token: 'premiumFees',
    label: 'Premium Fees',
    description: 'The policy fees for this policy version.',
    group: 'Premium',
  },
  {
    token: 'premiumTaxes',
    label: 'Premium Taxes',
    description: 'The taxes for this policy version.',
    group: 'Premium',
  },
  {
    token: 'premiumCurrency',
    label: 'Premium Currency',
    description: 'The currency code for the premium amounts.',
    group: 'Premium',
  },

  // ── Agent (the producer/agency identifiers carried on the quote/policy payload,
  // the same shape commission-handoff.service.ts's extractProducer() reads;
  // cross-referenced against the real producers/agencies/onboarding_commission_plans
  // tables from migration 018_agency_onboarding.sql when those ids resolve to a
  // real onboarding record) ───────────────────────────────────────────────────
  {
    token: 'agentName',
    label: 'Agent Name',
    description: 'The name of the producer/agent of record.',
    group: 'Agent',
  },
  {
    token: 'agentNpn',
    label: 'Agent NPN',
    description: "The producer's National Producer Number.",
    group: 'Agent',
  },
  {
    token: 'agencyName',
    label: 'Agency Name',
    description: 'The legal name of the agency of record.',
    group: 'Agent',
  },
  {
    token: 'agencyCode',
    label: 'Agency Code',
    description: 'The agency code of record.',
    group: 'Agent',
  },
  {
    token: 'agencyNpn',
    label: 'Agency NPN',
    description: "The agency's National Producer Number.",
    group: 'Agent',
  },
  {
    token: 'agentCommissionPercent',
    label: 'Agent Commission Percent',
    description:
      'The commission rate on file (onboarding_commission_plans) for this agency/producer, product, and state, for this transaction type, formatted as a percentage. Empty when no commission plan is on file — commission calculation for payment purposes remains owned by the external commission system.',
    group: 'Agent',
  },

  // ── Policy details shared by every product (quote payload common fields:
  // see frontend/src/features/wizard/CommonQuoteSections.tsx) ───────────────────
  { token: 'underwritingCompany', label: 'Underwriting Company', description: 'The insurer writing the policy.', group: 'Policy details' },
  { token: 'mailingAddress', label: 'Mailing Address', description: 'Where notices are sent, on one line; falls back to the insured address.', group: 'Policy details' },
  { token: 'billingMethod', label: 'Billing Method', description: 'Direct bill or agency bill.', group: 'Policy details' },
  { token: 'paymentPlan', label: 'Payment Plan', description: 'Annual, semi-annual, quarterly, or monthly.', group: 'Policy details' },
  { token: 'priorCarrier', label: 'Prior Carrier', description: 'The prior insurer.', group: 'Policy details' },
  { token: 'priorPolicyNumber', label: 'Prior Policy Number', description: 'The prior policy number.', group: 'Policy details' },
  { token: 'priorExpirationDate', label: 'Prior Policy Expiration', description: 'When the prior policy expires or expired.', group: 'Policy details' },
  { token: 'additionalInterests', label: 'Additional Interests', description: 'Every additional interest, one per line: type, name, loan number, address.', group: 'Policy details' },
  { token: 'mortgageeName', label: 'Mortgagee / Lienholder Name', description: 'The first mortgagee, or the first lienholder/loss payee when there is no mortgagee.', group: 'Policy details' },
  { token: 'mortgageeLoanNumber', label: 'Mortgagee Loan Number', description: 'Loan number of that mortgagee or lienholder.', group: 'Policy details' },
  { token: 'mortgageeAddress', label: 'Mortgagee Address', description: 'Address of that mortgagee or lienholder, on one line.', group: 'Policy details' },

  // ── Homeowners (HO-3 structure; empty for other products) ───────────────────
  { token: 'policyFormName', label: 'Policy Form', description: 'The policy form name and code from the product definition, e.g. "Homeowners Special Form (HO3)".', group: 'Homeowners' },
  { token: 'premisesAddress', label: 'Residence Premises', description: 'The insured location (risk address).', group: 'Homeowners' },
  { token: 'dwellingConstruction', label: 'Construction', description: 'Dwelling construction type.', group: 'Homeowners' },
  { token: 'dwellingYearBuilt', label: 'Year Built', description: 'Year the dwelling was built.', group: 'Homeowners' },
  { token: 'coverageALimit', label: 'Coverage A - Dwelling', description: 'Coverage A limit, formatted as currency.', group: 'Homeowners' },
  { token: 'coverageBLimit', label: 'Coverage B - Other Structures', description: 'Coverage B limit (from its percentage of A when no amount is stored).', group: 'Homeowners' },
  { token: 'coverageCLimit', label: 'Coverage C - Personal Property', description: 'Coverage C limit.', group: 'Homeowners' },
  { token: 'coverageDLimit', label: 'Coverage D - Loss of Use', description: 'Coverage D limit.', group: 'Homeowners' },
  { token: 'coverageELimit', label: 'Coverage E - Personal Liability', description: 'Coverage E limit, each occurrence.', group: 'Homeowners' },
  { token: 'coverageFLimit', label: 'Coverage F - Medical Payments', description: 'Coverage F limit, each person.', group: 'Homeowners' },
  { token: 'allPerilDeductible', label: 'All Peril Deductible', description: 'The all-peril deductible, formatted as currency.', group: 'Homeowners' },
  { token: 'windHailDeductible', label: 'Wind/Hail Deductible', description: 'The wind/hail deductible as a percentage of Coverage A with its dollar amount.', group: 'Homeowners' },
  { token: 'endorsementsList', label: 'Endorsements', description: 'Selected optional endorsements with their limits, one per line; "None" when none.', group: 'Homeowners' },
]

export const DOCUMENT_TEMPLATE_VARIABLE_TOKENS: ReadonlySet<string> = new Set(
  DOCUMENT_TEMPLATE_VARIABLES.map((variable) => variable.token)
)

// ── Policy details and homeowners tokens (pure, from the payload) ──────────────

function loadProductConfigSafely(productCode: string): any {
  if (!productCode) return null
  try {
    return loadProductConfig(productCode)
  } catch {
    return null
  }
}

const INTEREST_LABELS: Record<string, string> = {
  MORTGAGEE: 'Mortgagee',
  LOSS_PAYEE: 'Lienholder / loss payee',
  ADDITIONAL_INSURED: 'Additional insured',
  ADDITIONAL_INTEREST: 'Additional interest',
}
const PAYMENT_PLANS: Record<string, string> = { annual: 'Annual', 'semi-annual': 'Semi-annual', quarterly: 'Quarterly', monthly: 'Monthly' }

function money(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  const num = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(num)) return ''
  return `$${num.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function oneLineAddress(address: any): string {
  if (!address || typeof address !== 'object') return ''
  const cityLine = [text(address.city), [text(address.state), text(address.zip || address.postalCode)].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [text(address.street || address.line1), cityLine].filter(Boolean).join(', ')
}

/**
 * Tokens computed only from the policy/quote payload: the common policy
 * details every product shares, and the homeowners declarations values.
 * `productConfig` is the product definition (coverage names, form name).
 */
export function resolvePolicyDetailTokens(payload: any, productConfig?: any): Record<string, string> {
  const interests = Array.isArray(payload?.additionalInterests) ? payload.additionalInterests.filter((item: any) => text(item?.name)) : []
  const mortgagee = interests.find((item: any) => item.role === 'MORTGAGEE') || interests.find((item: any) => item.role === 'LOSS_PAYEE')
  const interestAddress = (item: any) => oneLineAddress({ street: item.street, city: item.city, state: item.state, zip: item.zip })
  const coverages: any[] = Array.isArray(payload?.coverages) ? payload.coverages.filter((cov: any) => cov && cov.selected !== false) : []
  const byCode = new Map<string, any>(coverages.map((cov: any) => [String(cov.code || cov.coverageCode || '').toUpperCase(), cov]))
  const dwelling: any = byCode.get('A') || {}
  const aLimit = Number(dwelling.limit)
  const limitOf = (code: string) => {
    const cov: any = byCode.get(code)
    if (!cov) return ''
    if (cov.limit != null && cov.limit !== '') return money(cov.limit)
    if (cov.percent != null && Number.isFinite(aLimit)) return money(Math.round((aLimit * Number(cov.percent)) / 100))
    return ''
  }
  const configured = new Map<string, any>((Array.isArray(productConfig?.coverages) ? productConfig.coverages : []).map((cov: any) => [String(cov.code), cov]))
  const endorsements = coverages
    .filter((cov: any) => String(cov.code || '').toUpperCase().startsWith('END_') || configured.get(cov.code)?.endorsement === true)
    .map((cov: any) => {
      const name = configured.get(cov.code)?.name || cov.code
      const detail = cov.percent != null && cov.percent !== '' ? `${cov.percent}% of Coverage A` : cov.limit != null && cov.limit !== '' ? money(cov.limit) : ''
      return detail ? `${name}: ${detail}` : String(name)
    })
  const windPct = Number(dwelling.windHailPercent)
  const risk = Array.isArray(payload?.risks) ? payload.risks[0] || {} : {}
  const isHomeowners = text(payload?.productCode) === 'homeowners'
  const form = productConfig?.form
  return {
    underwritingCompany: text(payload?.underwritingCompanyName),
    mailingAddress: oneLineAddress(payload?.mailingAddress) || oneLineAddress(payload?.insureds?.primary?.address),
    billingMethod: payload?.billingMethod === 'agency' ? 'Agency bill' : payload?.billingMethod === 'direct' ? 'Direct bill' : '',
    paymentPlan: PAYMENT_PLANS[text(payload?.paymentPlan)] || '',
    priorCarrier: text(payload?.priorCarrier),
    priorPolicyNumber: text(payload?.priorPolicyNumber),
    priorExpirationDate: dateOnly(payload?.priorExpirationDate),
    additionalInterests: interests
      .map((item: any) => [INTEREST_LABELS[item.role] || 'Additional interest', text(item.name), text(item.loanNumber) ? `loan ${text(item.loanNumber)}` : '', interestAddress(item)].filter(Boolean).join(', '))
      .join('\n'),
    mortgageeName: text(mortgagee?.name),
    mortgageeLoanNumber: text(mortgagee?.loanNumber),
    mortgageeAddress: mortgagee ? interestAddress(mortgagee) : '',
    policyFormName: isHomeowners && form?.name ? `${form.name}${form.code ? ` (${form.code})` : ''}` : '',
    premisesAddress: isHomeowners ? text(risk.address) : '',
    dwellingConstruction: isHomeowners ? text(risk.construction) : '',
    dwellingYearBuilt: isHomeowners ? text(risk.yearBuilt) : '',
    coverageALimit: isHomeowners ? limitOf('A') : '',
    coverageBLimit: isHomeowners ? limitOf('B') : '',
    coverageCLimit: isHomeowners ? limitOf('C') : '',
    coverageDLimit: isHomeowners ? limitOf('D') : '',
    coverageELimit: isHomeowners ? limitOf('E') : '',
    coverageFLimit: isHomeowners ? limitOf('F') : '',
    allPerilDeductible: isHomeowners ? money(dwelling.deductible) : '',
    windHailDeductible: isHomeowners && Number.isFinite(windPct) && windPct > 0
      ? `${windPct}% of Coverage A${Number.isFinite(aLimit) ? ` (${money(Math.round((aLimit * windPct) / 100))})` : ''}`
      : '',
    endorsementsList: isHomeowners ? (endorsements.join('\n') || 'None') : '',
  }
}

// ── Resolver ─────────────────────────────────────────────────────────────────

export type TemplateVariableResolverContext = {
  tenantId: string
  policyId: string
  versionId?: string | null
  policyNumber?: string | null
  productCode?: string | null
  state?: string | null
  effectiveDate?: string | null
  transactionType?: string | null
  transactionNumber?: string | null
  // The full policy/quote payload — the same shape passed as `inputSnapshot`
  // into buildPolicyDocumentPacket (see quote-bind.service.ts, lifecycle.service.ts,
  // endorsement.service.ts), and the same shape policy.service.ts's
  // getFullPolicyPayload returns for an already-bound policy.
  payload?: any
  /** Fallback when the policy version (and its premium) is not saved yet, as during bind. */
  premium?: { total?: { amount?: number; currency?: string } | null; fees?: { amount?: number } | null; taxes?: { amount?: number } | null } | null
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const str = text(value)
    if (str) return str
  }
  return ''
}

function isUuidLike(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}

function dateOnly(value: unknown): string {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function formatNumeric(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  const num = typeof value === 'number' ? value : Number(value)
  if (Number.isFinite(num)) return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return text(value)
}

function formatCoverageValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number') return formatNumeric(value)
  if (typeof value === 'object') {
    const amount = (value as any).amount ?? (value as any).limit ?? null
    return amount !== null && amount !== undefined ? formatCoverageValue(amount) : ''
  }
  return String(value)
}

type ExtractedCoverage = { code: string; limit: string; deductible: string }

// Mirrors coverageMap() in document-generation.service.ts: a coverage entry
// may use either `code` (policy.service.ts's getFullPolicyPayload shape) or
// `coverageCode` (the raw coverage_selections fallback shape).
function extractCoverages(payload: any): ExtractedCoverage[] {
  const list = Array.isArray(payload?.coverages) ? payload.coverages : []
  return list
    .map((cov: any) => ({
      code: firstNonEmpty(cov?.code, cov?.coverageCode),
      limit: formatCoverageValue(cov?.limit),
      deductible: formatCoverageValue(cov?.deductible),
    }))
    .filter((cov: ExtractedCoverage) => cov.code)
}

function buildCoverageSlotValues(coverages: ExtractedCoverage[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (let i = 1; i <= COVERAGE_SLOT_COUNT; i++) {
    const cov = coverages[i - 1]
    values[`coverage${i}Code`] = cov?.code || ''
    values[`coverage${i}Limit`] = cov?.limit || ''
    values[`coverage${i}Deductible`] = cov?.deductible || ''
  }
  return values
}

// Mirrors extractProducer() in commission-handoff.service.ts (not exported
// there, so reimplemented here against the same payload shape) — the
// producer/agency identifiers captured directly on the quote/policy payload
// at bind time.
function extractProducerAndAgency(payload: any): {
  producerId: string
  producerName: string
  producerNpn: string
  agencyId: string
  agencyName: string
  agencyCode: string
} {
  const producer = payload?.producer || payload?.agent || payload?.broker || {}
  const agency = payload?.agency || producer?.agency || {}
  return {
    producerId: firstNonEmpty(producer?.producerId, producer?.producer_id, producer?.id, payload?.producerId),
    producerName: firstNonEmpty(
      producer?.name,
      producer?.displayName,
      [producer?.firstName, producer?.lastName].filter(Boolean).join(' '),
      payload?.producerName
    ),
    producerNpn: firstNonEmpty(producer?.npn, producer?.producerNpn, payload?.producerNpn, payload?.npn),
    agencyId: firstNonEmpty(agency?.agencyId, agency?.agency_id, agency?.id, producer?.agencyId, payload?.agencyId),
    agencyName: firstNonEmpty(agency?.legalName, agency?.name, producer?.agencyName, payload?.agencyName),
    agencyCode: firstNonEmpty(agency?.agencyCode, agency?.code, producer?.agencyCode, payload?.agencyCode),
  }
}

async function loadPolicyFallbackFields(q: QueryFn, tenantId: string, policyId: string): Promise<any | null> {
  const res = await q(
    `SELECT policy_number, product_code, jurisdiction_code, term_expiration_date
       FROM policies WHERE tenant_id = $1 AND policy_id = $2 LIMIT 1`,
    [tenantId, policyId]
  )
  return res.rowCount ? res.rows[0] : null
}

async function loadPremiumFields(
  q: QueryFn,
  tenantId: string,
  policyId: string,
  versionId?: string | null
): Promise<any | null> {
  const res = await q(
    `SELECT premium_total, premium_fees, premium_taxes, currency, transaction_type, payload
       FROM policy_versions
      WHERE tenant_id = $1 AND policy_id = $2
        AND ($3::uuid IS NULL OR version_id = $3::uuid)
      ORDER BY processed_at DESC
      LIMIT 1`,
    [tenantId, policyId, isUuidLike(versionId) ? versionId : null]
  )
  return res.rowCount ? res.rows[0] : null
}

async function loadPrimaryInsured(q: QueryFn, tenantId: string, policyId: string): Promise<any | null> {
  const res = await q(
    `SELECT c.display_name, c.entity_type,
            p.first_name, p.last_name,
            co.legal_name,
            a.line1, a.line2, a.city, a.state, a.postal_code,
            cte.value AS email, ctp.value AS phone
       FROM policy_customer_links pcl
       JOIN customers c ON c.tenant_id = pcl.tenant_id AND c.customer_id = pcl.customer_id
       LEFT JOIN customer_person_details p ON p.tenant_id = c.tenant_id AND p.customer_id = c.customer_id
       LEFT JOIN customer_company_details co ON co.tenant_id = c.tenant_id AND co.customer_id = c.customer_id
       LEFT JOIN customer_addresses a ON a.tenant_id = c.tenant_id AND a.customer_id = c.customer_id
         AND a.primary_flag = true AND a.effective_to IS NULL
       LEFT JOIN customer_contact_points cte ON cte.tenant_id = c.tenant_id AND cte.customer_id = c.customer_id
         AND cte.contact_type = 'EMAIL' AND cte.preferred_flag = true AND cte.effective_to IS NULL
       LEFT JOIN customer_contact_points ctp ON ctp.tenant_id = c.tenant_id AND ctp.customer_id = c.customer_id
         AND ctp.contact_type = 'PHONE' AND ctp.preferred_flag = true AND ctp.effective_to IS NULL
      WHERE pcl.tenant_id = $1 AND pcl.policy_id = $2 AND pcl.role_code = 'PRIMARY_NAMED_INSURED'
      LIMIT 1`,
    [tenantId, policyId]
  )
  return res.rowCount ? res.rows[0] : null
}

async function loadProducerRecord(q: QueryFn, tenantId: string, producerId: string): Promise<any | null> {
  if (!isUuidLike(producerId)) return null
  const res = await q(
    `SELECT first_name, last_name, npn FROM producers WHERE tenant_id = $1 AND producer_id = $2 LIMIT 1`,
    [tenantId, producerId]
  )
  return res.rowCount ? res.rows[0] : null
}

async function loadAgencyRecord(q: QueryFn, tenantId: string, agencyId: string): Promise<any | null> {
  if (!isUuidLike(agencyId)) return null
  const res = await q(
    `SELECT legal_name, dba_name, agency_np_number FROM agencies WHERE tenant_id = $1 AND agency_id = $2 LIMIT 1`,
    [tenantId, agencyId]
  )
  return res.rowCount ? res.rows[0] : null
}

type CommissionRateColumn = 'nb_rate' | 'rn_rate' | 'endorsements_rate'

// onboarding_commission_plans only has three rate columns (new-business,
// renewal, endorsement); every other transaction type (Issue, Cancel,
// Reinstate, Rewrite, NonRenewal) falls back to the new-business rate as the
// closest real column this schema defines.
function commissionRateColumn(transactionType: string | null | undefined): CommissionRateColumn {
  const normalized = String(transactionType || '').toLowerCase()
  if (normalized.includes('renew')) return 'rn_rate'
  if (normalized.includes('endorse')) return 'endorsements_rate'
  return 'nb_rate'
}

async function loadCommissionRate(
  q: QueryFn,
  tenantId: string,
  entity: { assignedTo: 'AGENCY' | 'PRODUCER'; entityId: string },
  productCode: string,
  state: string,
  transactionType: string | null | undefined
): Promise<string> {
  if (!isUuidLike(entity.entityId) || !productCode || !state) return ''
  const column = commissionRateColumn(transactionType)
  const res = await q(
    `SELECT ${column} AS rate
       FROM onboarding_commission_plans
      WHERE tenant_id = $1 AND assigned_to = $2 AND entity_id = $3
        AND lower(product_code) = lower($4) AND upper(state) = upper($5)
        AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
        AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
      ORDER BY effective_from DESC NULLS LAST
      LIMIT 1`,
    [tenantId, entity.assignedTo, entity.entityId, productCode, state]
  )
  if (!res.rowCount) return ''
  const rate = res.rows[0]?.rate
  if (rate === null || rate === undefined) return ''
  const num = Number(rate)
  return Number.isFinite(num) ? `${num.toFixed(2)}%` : ''
}

/**
 * Resolves every token in `DOCUMENT_TEMPLATE_VARIABLES` to a real string
 * value for one specific bound policy, for use as the docxtemplater data
 * context. Every token is always present in the result (defaulting to ''
 * when not applicable to this policy) so a template render never throws for
 * a recognized token.
 */
export async function resolveDocumentTemplateVariables(
  q: QueryFn,
  ctx: TemplateVariableResolverContext
): Promise<Record<string, string>> {
  const [policyRow, versionRow, insuredRow] = await Promise.all([
    loadPolicyFallbackFields(q, ctx.tenantId, ctx.policyId),
    loadPremiumFields(q, ctx.tenantId, ctx.policyId, ctx.versionId),
    loadPrimaryInsured(q, ctx.tenantId, ctx.policyId),
  ])

  const payload = ctx.payload && typeof ctx.payload === 'object' && Object.keys(ctx.payload).length
    ? ctx.payload
    : versionRow?.payload || {}

  const personName = insuredRow
    ? firstNonEmpty(
        [insuredRow.first_name, insuredRow.last_name].filter(Boolean).join(' '),
        insuredRow.legal_name,
        insuredRow.display_name
      )
    : ''
  const payloadInsuredName = firstNonEmpty(
    payload?.insureds?.primary?.displayName,
    [payload?.insureds?.primary?.firstName, payload?.insureds?.primary?.lastName].filter(Boolean).join(' '),
    [payload?.applicant?.firstName, payload?.applicant?.lastName].filter(Boolean).join(' ')
  )

  const coverages = extractCoverages(payload)
  const coverageSummary = coverages
    .map((cov) => `${cov.code}: limit ${cov.limit || 'N/A'}, deductible ${cov.deductible || 'N/A'}`)
    .join('; ')

  const producerAndAgency = extractProducerAndAgency(payload)
  const [producerRecord, agencyRecord] = await Promise.all([
    loadProducerRecord(q, ctx.tenantId, producerAndAgency.producerId),
    loadAgencyRecord(q, ctx.tenantId, producerAndAgency.agencyId),
  ])

  const productCode = firstNonEmpty(ctx.productCode, policyRow?.product_code, payload?.productCode)
  const state = firstNonEmpty(ctx.state, policyRow?.jurisdiction_code, payload?.state)
  const transactionType = firstNonEmpty(ctx.transactionType, versionRow?.transaction_type)

  let agentCommissionPercent = ''
  if (producerAndAgency.agencyId) {
    agentCommissionPercent = await loadCommissionRate(
      q,
      ctx.tenantId,
      { assignedTo: 'AGENCY', entityId: producerAndAgency.agencyId },
      productCode,
      state,
      transactionType
    )
  }
  if (!agentCommissionPercent && producerAndAgency.producerId) {
    agentCommissionPercent = await loadCommissionRate(
      q,
      ctx.tenantId,
      { assignedTo: 'PRODUCER', entityId: producerAndAgency.producerId },
      productCode,
      state,
      transactionType
    )
  }

  const values: Record<string, string> = {
    insuredName: firstNonEmpty(personName, payloadInsuredName),
    insuredFirstName: firstNonEmpty(insuredRow?.first_name, payload?.insureds?.primary?.firstName, payload?.applicant?.firstName),
    insuredLastName: firstNonEmpty(insuredRow?.last_name, payload?.insureds?.primary?.lastName, payload?.applicant?.lastName),
    insuredEmail: firstNonEmpty(insuredRow?.email, payload?.applicant?.email, payload?.insureds?.primary?.email),
    insuredPhone: firstNonEmpty(insuredRow?.phone),
    insuredAddressLine1: text(insuredRow?.line1),
    insuredAddressLine2: text(insuredRow?.line2),
    insuredCity: text(insuredRow?.city),
    insuredState: text(insuredRow?.state),
    insuredPostalCode: text(insuredRow?.postal_code),

    policyNumber: firstNonEmpty(ctx.policyNumber, policyRow?.policy_number),
    productCode,
    state,
    effectiveDate: firstNonEmpty(ctx.effectiveDate, payload?.effectiveDate),
    expirationDate: firstNonEmpty(dateOnly(policyRow?.term_expiration_date), payload?.expirationDate),
    transactionType,
    transactionNumber: text(ctx.transactionNumber),

    coverageSummary,
    ...buildCoverageSlotValues(coverages),

    premiumTotal: formatNumeric(versionRow?.premium_total ?? ctx.premium?.total?.amount),
    premiumFees: formatNumeric(versionRow?.premium_fees ?? ctx.premium?.fees?.amount),
    premiumTaxes: formatNumeric(versionRow?.premium_taxes ?? ctx.premium?.taxes?.amount),
    premiumCurrency: text(versionRow?.currency ?? ctx.premium?.total?.currency),

    agentName: firstNonEmpty(
      producerRecord ? [producerRecord.first_name, producerRecord.last_name].filter(Boolean).join(' ') : '',
      producerAndAgency.producerName
    ),
    agentNpn: firstNonEmpty(producerRecord?.npn, producerAndAgency.producerNpn),
    agencyName: firstNonEmpty(agencyRecord?.legal_name, producerAndAgency.agencyName),
    agencyCode: producerAndAgency.agencyCode,
    agencyNpn: text(agencyRecord?.agency_np_number),
    agentCommissionPercent,

    ...resolvePolicyDetailTokens(payload, loadProductConfigSafely(productCode)),
  }

  const result: Record<string, string> = {}
  for (const variable of DOCUMENT_TEMPLATE_VARIABLES) {
    result[variable.token] = text(values[variable.token] ?? '')
  }
  return result
}

// ── .docx parsing / validation / substitution (docxtemplater + pizzip) ─────

const DOCXTEMPLATER_OPTIONS = {
  paragraphLoop: true,
  linebreaks: true,
  delimiters: { start: '{{', end: '}}' },
}

type DocxTagMap = Record<string, unknown>
type DocxGetTagsResult = {
  document?: { tags?: DocxTagMap }
  headers?: Array<{ tags?: DocxTagMap }>
  footers?: Array<{ tags?: DocxTagMap }>
}

/**
 * Parses a .docx file and returns every `{{token}}`-style placeholder it
 * references (document body, headers, and footers), using docxtemplater's
 * own tag-discovery API (`getTags()`) rather than regex-scanning the raw
 * OOXML. Throws if the file is not a parseable .docx or has malformed
 * template syntax (e.g. an unclosed `{{`).
 */
export function extractDocxPlaceholderTokens(content: Buffer): string[] {
  const zip = new PizZip(content)
  const doc = new Docxtemplater(zip, DOCXTEMPLATER_OPTIONS)
  const tags = (doc as unknown as { getTags(): DocxGetTagsResult }).getTags()
  const names = new Set<string>()
  const collect = (tagMap: DocxTagMap | undefined) => {
    if (!tagMap) return
    for (const key of Object.keys(tagMap)) names.add(key)
  }
  collect(tags.document?.tags)
  for (const header of tags.headers || []) collect(header.tags)
  for (const footer of tags.footers || []) collect(footer.tags)
  return [...names].sort()
}

/** Splits a list of discovered tokens into recognized vs. unrecognized against the fixed catalog. */
export function validateDocxPlaceholderTokens(tokens: string[]): { recognized: string[]; unrecognized: string[] } {
  const recognized: string[] = []
  const unrecognized: string[] = []
  for (const token of tokens) {
    if (DOCUMENT_TEMPLATE_VARIABLE_TOKENS.has(token)) recognized.push(token)
    else unrecognized.push(token)
  }
  recognized.sort()
  unrecognized.sort()
  return { recognized, unrecognized }
}

/** Builds a human-readable message from a docxtemplater parse/render error. */
export function describeDocxTemplateError(err: unknown): string {
  const anyErr = err as any
  const nested = Array.isArray(anyErr?.properties?.errors) ? anyErr.properties.errors : []
  if (nested.length) {
    const explanations = nested
      .map((nestedErr: any) => nestedErr?.properties?.explanation || nestedErr?.message)
      .filter(Boolean)
    if (explanations.length) return explanations.join('; ')
  }
  return text(anyErr?.message) || 'Unable to parse the uploaded Word template.'
}

/**
 * Substitutes every `{{token}}` placeholder in a .docx template with the
 * given data and returns the filled .docx bytes. `data` should already
 * contain a value (possibly '') for every token the template uses —
 * `resolveDocumentTemplateVariables` guarantees this for every token in the
 * catalog — but a `nullGetter` is still set defensively so an unexpected
 * missing key renders blank instead of throwing.
 */
export function renderDocxTemplate(content: Buffer, data: Record<string, string>): Buffer {
  const zip = new PizZip(content)
  const doc = new Docxtemplater(zip, {
    ...DOCXTEMPLATER_OPTIONS,
    nullGetter: () => '',
  })
  doc.render(data)
  return doc.toBuffer()
}

export function sha256Bytes(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

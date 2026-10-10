import type { APIRequestContext } from '@playwright/test'
import { apiJson, isoDate } from './api'

export type ProductLine = {
  productCode: string
  label: string
  policyPrefix: string
  state: string
  risk: Record<string, unknown>
  coverage: { code: string; selected: true; limit: number }
}

/** One clean (auto-eligible) risk per product line the platform ships with. */
export const productLines: ProductLine[] = [
  {
    productCode: 'homeowners',
    label: 'Homeowners',
    policyPrefix: 'HO-',
    state: 'TX',
    risk: { type: 'dwelling', address: '1 Main St', construction: 'masonry', yearBuilt: 2015, squareFeet: 2000, roofAgeYears: 5, protectionClass: 3 },
    coverage: { code: 'DWELLING', selected: true, limit: 300_000 },
  },
  {
    productCode: 'cyber',
    label: 'Cyber',
    policyPrefix: 'CY-',
    state: 'WA',
    risk: {
      type: 'cyberProfile', industry: 'technology', annualRevenue: 5_000_000, employeeCount: 40, recordsCount: 10_000,
      mfaEnabled: true, endpointProtection: true, backups: 'daily', priorIncidents: 0, publicFacingApps: 2, domain: 'example.com',
    },
    coverage: { code: 'CYB_LIAB', selected: true, limit: 1_000_000 },
  },
  {
    productCode: 'commercial-auto',
    label: 'Commercial Auto',
    policyPrefix: 'CA-',
    state: 'OH',
    risk: {
      type: 'commercialAutoFleet', garagingZip: '43004', vehicleCount: 3, driverCount: 3, useClass: 'service', radiusClass: 'local',
      vehicleType: 'service-van', gvwClass: 'light', annualMileage: 15_000, yearsInBusiness: 8, priorLossesCount: 0, businessName: 'E2E Fleet LLC',
    },
    coverage: { code: 'AUTO_LIAB', selected: true, limit: 1_000_000 },
  },
  {
    productCode: 'professional-liability',
    label: 'Professional Liability',
    policyPrefix: 'PL-',
    state: 'IL',
    risk: {
      type: 'professionalLiabilityProfile', industry: 'consulting', annualRevenue: 2_000_000, employeeCount: 12, yearsInBusiness: 9,
      priorClaimsCount: 0, largestContractValue: 250_000, subcontractorPct: 10, writtenContracts: true, qualityControl: 'formal', retroactiveYears: 3,
    },
    coverage: { code: 'PROF_LIAB', selected: true, limit: 1_000_000 },
  },
]

export function productLine(productCode: string) {
  const line = productLines.find((item) => item.productCode === productCode)
  if (!line) throw new Error(`Unknown product line ${productCode}`)
  return line
}

export function productQuotePayload(
  line: ProductLine,
  options: { name?: string; state?: string; effectiveDate?: string; risk?: Record<string, unknown> } = {},
) {
  const [firstName, lastName = 'Insured'] = (options.name ?? 'Multi Line').split(' ')
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`
  return {
    productCode: line.productCode,
    effectiveDate: options.effectiveDate ?? isoDate(0),
    termMonths: 12,
    country: 'US',
    state: options.state ?? line.state,
    applicant: { firstName, lastName, email },
    insureds: { primary: { firstName, lastName, displayName: `${firstName} ${lastName}`, email } },
    uwAnswers: {},
    risks: [{ ...line.risk, ...(options.risk ?? {}) }],
    coverages: [line.coverage],
  }
}

export async function createQuote(request: APIRequestContext, token: string, payload: unknown) {
  return apiJson<any>(request, 'POST', '/api/v1/quotes', { token, data: payload })
}

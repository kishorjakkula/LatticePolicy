// Curated catalog of field paths that tenant-authored `underwriting_rules`
// rows are allowed to reference, plus the generic path resolver used to
// evaluate them against a real submission payload.
//
// This catalog exists so that a typo'd field_path can never silently create
// a rule that never fires (see uw.routes.ts's create/update validation,
// which rejects any field_path/operator pair not listed here for the
// rule's product_code) and so that an admin UI has a safe, product-scoped
// dropdown to render instead of a freeform text input.
//
// Every entry below was derived by reading exactly what the five hardcoded
// per-product functions in uw.service.ts check today. Fields that back a
// check the current code performs but that cannot be expressed as a single
// field-vs-fixed-value comparison (e.g. a ratio between two fields, or a
// substring/format check) are intentionally left out of the catalog -- see
// the comments in uw.service.ts's seedUnderwritingRulesForTenant for the
// full list of what could and couldn't be ported.

export type UwFieldDataType = 'number' | 'string' | 'boolean'

export type UwRuleOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_than_or_equal'
  | 'is_true'
  | 'is_false'
  | 'in'
  | 'not_in'

export type UwFieldCatalogEntry = {
  fieldPath: string
  label: string
  description: string
  dataType: UwFieldDataType
  allowedOperators: UwRuleOperator[]
}

const NUMBER_OPERATORS: UwRuleOperator[] = [
  'equals',
  'not_equals',
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
  'in',
  'not_in',
]

const STRING_OPERATORS: UwRuleOperator[] = ['equals', 'not_equals', 'in', 'not_in']

const BOOLEAN_OPERATORS: UwRuleOperator[] = ['is_true', 'is_false']

function numberField(fieldPath: string, label: string, description: string): UwFieldCatalogEntry {
  return { fieldPath, label, description, dataType: 'number', allowedOperators: NUMBER_OPERATORS }
}

function stringField(fieldPath: string, label: string, description: string): UwFieldCatalogEntry {
  return { fieldPath, label, description, dataType: 'string', allowedOperators: STRING_OPERATORS }
}

function booleanField(fieldPath: string, label: string, description: string): UwFieldCatalogEntry {
  return { fieldPath, label, description, dataType: 'boolean', allowedOperators: BOOLEAN_OPERATORS }
}

export const UW_FIELD_CATALOG: Record<string, UwFieldCatalogEntry[]> = {
  'personal-auto': [
    numberField(
      'uwAnswers.driverAge',
      'Driver Age (Underwriting Answer)',
      'Driver age as captured on the underwriting questionnaire.'
    ),
    numberField(
      'risks[0].driverAge',
      'Driver Age (Vehicle Risk)',
      'Driver age as captured on the primary vehicle risk record.'
    ),
    stringField(
      'risks[0].garagingZip',
      'Garaging ZIP Code',
      'Primary garaging ZIP code for the insured vehicle.'
    ),
    numberField(
      'risks[0].annualMiles',
      'Annual Miles',
      'Annual mileage declared for the primary vehicle.'
    ),
    stringField(
      'risks[0].usage',
      'Vehicle Usage',
      "Declared vehicle usage, e.g. 'commute', 'pleasure', 'rideshare', 'commercial'."
    ),
    stringField(
      'risks[0].symbol',
      'Vehicle Symbol',
      'Rating symbol/code for the insured vehicle.'
    ),
  ],
  'commercial-auto': [
    numberField('risks[0].vehicleCount', 'Vehicle Count', 'Number of vehicles in the fleet.'),
    numberField('risks[0].driverCount', 'Driver Count', 'Number of drivers on the fleet.'),
    stringField(
      'risks[0].garagingZip',
      'Garaging ZIP Code',
      'Primary garaging ZIP code for the fleet.'
    ),
    stringField(
      'risks[0].radiusClass',
      'Radius Class',
      "Operating radius classification, e.g. 'local', 'intermediate', 'long-haul'."
    ),
    stringField(
      'risks[0].vehicleType',
      'Vehicle Type',
      "Vehicle type classification, e.g. 'van', 'tractor-trailer', 'dump-truck'."
    ),
    stringField(
      'risks[0].gvwClass',
      'GVW Class',
      "Gross vehicle weight classification, e.g. 'light', 'medium', 'heavy'."
    ),
    numberField(
      'risks[0].annualMileage',
      'Annual Mileage',
      'Average annual mileage across the fleet.'
    ),
    numberField(
      'risks[0].yearsInBusiness',
      'Years In Business',
      'Number of years the insured has been operating.'
    ),
    numberField(
      'risks[0].priorLossesCount',
      'Prior Losses Count',
      'Count of prior commercial auto losses.'
    ),
  ],
  homeowners: [
    numberField('risks[0].roofAgeYears', 'Roof Age (Years)', 'Age of the roof in years.'),
    numberField(
      'risks[0].protectionClass',
      'Protection Class',
      'ISO protection class (fire protection rating) for the dwelling location, 1-10.'
    ),
  ],
  cyber: [
    stringField('risks[0].industry', 'Industry', 'Declared industry classification.'),
    numberField('risks[0].annualRevenue', 'Annual Revenue', 'Declared annual revenue.'),
    numberField('risks[0].employeeCount', 'Employee Count', 'Declared employee headcount.'),
    numberField(
      'risks[0].recordsCount',
      'Sensitive Records Count',
      'Count of sensitive records held by the insured.'
    ),
    numberField(
      'risks[0].priorIncidents',
      'Prior Incidents Count',
      'Count of prior cyber incidents.'
    ),
    booleanField(
      'risks[0].mfaEnabled',
      'MFA Enabled',
      'Whether multi-factor authentication is enabled across the environment.'
    ),
    booleanField(
      'risks[0].endpointProtection',
      'Endpoint Protection Enabled',
      'Whether endpoint protection is deployed across the environment.'
    ),
    stringField(
      'risks[0].backups',
      'Backup Frequency',
      "Declared backup frequency/controls, e.g. 'daily', 'monthly', 'none'."
    ),
    numberField(
      'risks[0].publicFacingApps',
      'Public-Facing Applications Count',
      'Count of internet-facing applications.'
    ),
  ],
  'professional-liability': [
    stringField('risks[0].industry', 'Industry', 'Declared industry/profession classification.'),
    numberField('risks[0].annualRevenue', 'Annual Revenue', 'Declared annual revenue.'),
    numberField('risks[0].employeeCount', 'Employee Count', 'Declared employee headcount.'),
    numberField(
      'risks[0].yearsInBusiness',
      'Years In Business',
      'Number of years the insured has been operating.'
    ),
    numberField(
      'risks[0].largestContractValue',
      'Largest Contract Value',
      'Value of the largest single client contract.'
    ),
    numberField(
      'risks[0].subcontractorPct',
      'Subcontractor Percentage',
      'Percentage of work performed by subcontractors.'
    ),
    booleanField(
      'risks[0].writtenContracts',
      'Written Contracts Used',
      'Whether written engagement contracts are consistently used with clients.'
    ),
    stringField(
      'risks[0].qualityControl',
      'Quality Control Level',
      "Declared quality-control/peer-review maturity, e.g. 'formal', 'limited'."
    ),
    numberField(
      'risks[0].retroactiveYears',
      'Retroactive Years',
      'Years of prior-acts/retroactive coverage history.'
    ),
    numberField(
      'risks[0].priorClaimsCount',
      'Prior Claims Count',
      'Count of prior professional liability claims.'
    ),
  ],
}

export function listUwFieldsForProduct(productCode: string): UwFieldCatalogEntry[] {
  return UW_FIELD_CATALOG[productCode] || []
}

export function findUwFieldCatalogEntry(
  productCode: string,
  fieldPath: string
): UwFieldCatalogEntry | null {
  const fields = listUwFieldsForProduct(productCode)
  return fields.find((f) => f.fieldPath === fieldPath) || null
}

/**
 * Safely reads a dotted/bracketed path (e.g. `risks[0].roofAgeYears`) off a
 * real submission payload. Never throws -- any missing/invalid segment
 * (including an out-of-range array index, or indexing into a non-object)
 * resolves to `undefined`, matching the optional-chaining style already
 * used throughout uw.service.ts's hardcoded checks.
 */
export function resolveFieldValue(payload: any, fieldPath: string): unknown {
  if (payload == null || typeof fieldPath !== 'string' || !fieldPath.trim()) return undefined
  const tokens = fieldPath.match(/[^.[\]]+|\[\d+\]/g)
  if (!tokens || !tokens.length) return undefined

  let current: any = payload
  for (const token of tokens) {
    if (current == null) return undefined
    const arrayIndexMatch = /^\[(\d+)\]$/.exec(token)
    if (arrayIndexMatch) {
      if (!Array.isArray(current)) return undefined
      current = current[Number(arrayIndexMatch[1])]
    } else {
      if (typeof current !== 'object') return undefined
      current = current[token]
    }
  }
  return current
}

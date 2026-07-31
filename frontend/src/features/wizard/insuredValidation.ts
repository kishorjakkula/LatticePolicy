type ProductCode = 'personal-auto' | 'commercial-auto' | 'homeowners' | 'cyber' | 'professional-liability' | ''

type InsuredLike = {
  firstName?: unknown
  lastName?: unknown
  displayName?: unknown
  email?: unknown
  phone?: unknown
  customerId?: unknown
  customerKey?: unknown
  address?: {
    street?: unknown
    city?: unknown
    state?: unknown
    zip?: unknown
  } | null
}

function text(value: unknown): string {
  return String(value || '').trim()
}

function hasInsuredData(party: InsuredLike | null | undefined): boolean {
  if (!party) return false
  if (text(party.firstName) || text(party.lastName) || text(party.displayName) || text(party.email) || text(party.phone)) return true
  if (text(party.customerId) || text(party.customerKey)) return true
  return Boolean(text(party.address?.street) || text(party.address?.city) || text(party.address?.state) || text(party.address?.zip))
}

function hasCompleteIndividualName(party: InsuredLike | null | undefined): boolean {
  return Boolean(text(party?.firstName) && text(party?.lastName))
}

function hasRecognizableName(party: InsuredLike | null | undefined): boolean {
  return hasCompleteIndividualName(party) || Boolean(text(party?.displayName))
}

function validateOptionalNamedInsured(
  errs: Record<string, string>,
  path: string,
  label: string,
  party: InsuredLike | null | undefined,
) {
  if (!hasInsuredData(party) || hasRecognizableName(party)) return
  if (!text(party?.firstName) && !text(party?.displayName)) errs[`${path}.firstName`] = `${label} first name is required`
  if (!text(party?.lastName) && !text(party?.displayName)) errs[`${path}.lastName`] = `${label} last name is required`
}

export function validateInsureds(insureds: any, productCode: ProductCode | string = ''): Record<string, string> {
  const errs: Record<string, string> = {}
  const primary = insureds?.primary || {}
  const requiresIndividualPrimary = productCode === 'personal-auto' || productCode === 'homeowners'

  if (requiresIndividualPrimary) {
    if (!text(primary.firstName)) errs['insureds.primary.firstName'] = 'Primary insured first name is required'
    if (!text(primary.lastName)) errs['insureds.primary.lastName'] = 'Primary insured last name is required'
  } else if (!hasRecognizableName(primary)) {
    errs['insureds.primary.displayName'] = 'Primary insured name is required'
  }

  validateOptionalNamedInsured(errs, 'insureds.secondary', 'Secondary insured', insureds?.secondary)

  const additional = Array.isArray(insureds?.additional) ? insureds.additional : []
  additional.forEach((party, index) => {
    validateOptionalNamedInsured(errs, `insureds.additional.${index}`, `Additional insured ${index + 1}`, party)
  })

  return errs
}

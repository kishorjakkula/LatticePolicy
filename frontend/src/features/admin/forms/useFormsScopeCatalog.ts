import { useEffect, useState } from 'react'
import { apiAdmin as api } from '../../../api/client'
import { regionsForCountry } from '../../../shared/usStates'
import type { CatalogOption } from './FormScenarioTest'

export function useFormsScopeCatalog() {
  const [companies, setCompanies] = useState<Array<{ productCode: string; country: string; state: string }>>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    // The underwriting-company catalog is also the wizard's configured scope source.
    api.listUnderwritingCompanies?.({ includeInactive: true }).then((rows) => { if (current) setCompanies(rows) }).catch((e: Error) => { if (current) setError(e.message) })
    return () => { current = false }
  }, [])
  const products: CatalogOption[] = [...new Set(companies.map((row) => row.productCode))].sort().map((code) => ({ code, label: code }))
  const stateMap = new Map<string, string>()
  for (const company of companies) {
    const regions = regionsForCountry(company.country)
    if (company.state === 'ALL') regions.forEach((region) => stateMap.set(region.code, region.name))
    else if (company.state) stateMap.set(company.state, regions.find((region) => region.code === company.state)?.name || company.state)
  }
  const states: CatalogOption[] = [...stateMap].sort(([a], [b]) => a.localeCompare(b)).map(([code, label]) => ({ code, label: `${code} - ${label}` }))
  return { products, states, error }
}

/** Scope fields of a `/admin/forms` list summary that the catalog filters read. */
export type FormScopeSummary = {
  lineOfBusiness?: string | null
  hasApplicability?: boolean
  productCodes?: string[]
  stateCodes?: string[]
  requireApprovedJurisdiction?: boolean
}

const sameCode = (a: unknown, b: string) => String(a || '').trim().toLowerCase() === b

/**
 * Product filter, mirroring the generator's applicability rules (selectPolicyForms and
 * isPreviewApplicabilityMatch): explicit product codes match; a form with no active
 * applicability rows matches by its own line of business; an active row with a blank
 * product matches by its line of business, or any product when that is blank too.
 */
export function formMatchesProductFilter(item: FormScopeSummary, product: string): boolean {
  const wanted = String(product || '').trim().toLowerCase()
  if (!wanted) return true
  if (item.hasApplicability === false) return sameCode(item.lineOfBusiness, wanted)
  // Like selectPolicyForms, a row attaches only for its own product code.
  return (item.productCodes || []).some((code) => sameCode(code, wanted))
}

/**
 * State filter, mirroring formJurisdictionDecision: a matching or 'ALL' jurisdiction row
 * keeps the form; a form with no jurisdiction rows applies everywhere unless it requires
 * an approved jurisdiction.
 */
export function formMatchesStateFilter(item: FormScopeSummary, state: string): boolean {
  const wanted = String(state || '').trim().toLowerCase()
  if (!wanted) return true
  const states = item.stateCodes || []
  if (!states.length) return item.requireApprovedJurisdiction === false
  return states.some((code) => sameCode(code, wanted) || sameCode(code, 'all'))
}

export function formMatchesScopeFilter(item: FormScopeSummary, filter: { product: string; state: string }): boolean {
  return formMatchesProductFilter(item, filter.product) && formMatchesStateFilter(item, filter.state)
}

/**
 * Catalog list labels that say what applies (WP-0004 REQ-18), mirroring the
 * product and state filters above: a form with no state rows applies in all
 * states unless it requires an approved jurisdiction, in which case it applies
 * in none until one is approved.
 */
export function formScopeLabels(item: FormScopeSummary): { products: string; states: string } {
  const products = item.hasApplicability === false
    ? (item.lineOfBusiness ? `All ${item.lineOfBusiness} products` : 'No products')
    : (item.productCodes || []).join(', ') || 'No products'
  const stateCodes = (item.stateCodes || []).map((code) => (code.toUpperCase() === 'ALL' ? 'All states' : code))
  const states = stateCodes.includes('All states')
    ? 'All states'
    : stateCodes.length
      ? stateCodes.join(', ')
      : item.requireApprovedJurisdiction === false ? 'All states' : 'No approved state'
  return { products, states }
}

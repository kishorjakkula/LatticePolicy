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

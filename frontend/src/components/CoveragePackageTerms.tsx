import type { CoveragePackageTerms as PackageTerms } from '@lattice-policy/types'

export function coveragePackageTerms(definition: any, selection: any, snapshot = true): PackageTerms | undefined {
  if (snapshot && selection?.packageTerms) return selection.packageTerms
  if (!definition?.packageTerms) return undefined
  const terms: PackageTerms = { ...definition.packageTerms }
  const limit = selection?.limit
  if (limit !== '' && limit != null && Number.isFinite(Number(limit))) {
    if (Number.isFinite(definition.aggregateMultiplier)) {
      terms.generalAggregate = Number(limit) * definition.aggregateMultiplier
      terms.productsCompletedOperationsAggregate = Number(limit) * definition.aggregateMultiplier
    }
    if (Number.isFinite(definition.personalAdvertisingInjuryMultiplier)) {
      terms.personalAdvertisingInjuryLimit = Number(limit) * definition.personalAdvertisingInjuryMultiplier
    }
  }
  return terms
}

export function packageTermLines(terms?: PackageTerms): string[] {
  if (!terms) return []
  const lines: string[] = []
  const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  if (terms.basis === 'occurrence') lines.push('Occurrence basis')
  if (terms.basis === 'limited-dollar') lines.push('Limited-dollar business income')
  if (terms.valuation === 'replacement-cost') lines.push('Replacement cost')
  if (terms.included) lines.push('Included - no additional premium')
  if (terms.basis === 'perPerson') lines.push('Per person')
  const amounts: Array<[keyof PackageTerms, string]> = [
    ['generalAggregate', 'General aggregate'],
    ['productsCompletedOperationsAggregate', 'Products-completed operations aggregate'],
    ['personalAdvertisingInjuryLimit', 'Personal and advertising injury included'],
    ['damageToRentedPremisesLimit', 'Damage to rented premises included'],
    ['medicalExpensesPerPerson', 'Medical expenses per person included'],
  ]
  for (const [key, label] of amounts) {
    const value = terms[key]
    if (typeof value === 'number' && Number.isFinite(value)) lines.push(`${label}: ${money(value)}`)
  }
  if (terms.restorationMonths != null) lines.push(`Restoration period: up to ${terms.restorationMonths} months`)
  if (terms.waitingPeriodHours != null) lines.push(`Income waiting period: ${terms.waitingPeriodHours} hours`)
  if (terms.extraExpenseIncluded) lines.push(terms.sharedLimit ? 'Extra expense included in the shared limit' : 'Extra expense included')
  return lines
}

export function CoveragePackageTerms({ terms }: { terms?: PackageTerms }) {
  const lines = packageTermLines(terms)
  return lines.length ? <ul className="coverage-package-terms" style={{ margin: '8px 0', paddingLeft: 20, overflowWrap: 'anywhere' }}>
    {lines.map(line => <li key={line}>{line}</li>)}
  </ul> : null
}

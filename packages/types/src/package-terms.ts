/** Explicit package benefits carried with coverage selections and policy snapshots. */
export type CoveragePackageTerms = {
  basis?: 'occurrence' | 'limited-dollar' | 'perPerson'
  included?: boolean
  valuation?: 'replacement-cost'
  generalAggregate?: number
  productsCompletedOperationsAggregate?: number
  personalAdvertisingInjuryLimit?: number
  damageToRentedPremisesLimit?: number
  medicalExpensesPerPerson?: number
  restorationMonths?: number
  waitingPeriodHours?: number
  extraExpenseIncluded?: boolean
  sharedLimit?: boolean
}

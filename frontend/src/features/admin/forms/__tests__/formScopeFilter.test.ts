import { describe, expect, it } from 'vitest'
import { formMatchesProductFilter, formMatchesScopeFilter, formMatchesStateFilter, formScopeLabels, type FormScopeSummary } from '../useFormsScopeCatalog'

const explicit: FormScopeSummary = {
  lineOfBusiness: 'personal-auto', hasApplicability: true,
  productCodes: ['personal-auto'], stateCodes: ['CA'], requireApprovedJurisdiction: true,
}

describe('forms catalog product filter', () => {
  it('keeps explicit product codes case-insensitively and drops other products', () => {
    expect(formMatchesProductFilter(explicit, 'personal-auto')).toBe(true)
    expect(formMatchesProductFilter(explicit, 'PERSONAL-AUTO')).toBe(true)
    expect(formMatchesProductFilter(explicit, 'homeowners')).toBe(false)
    expect(formMatchesProductFilter(explicit, '')).toBe(true)
  })
  it('matches a form with no applicability rows by its line of business only', () => {
    const noRows = { ...explicit, hasApplicability: false, productCodes: [] }
    expect(formMatchesProductFilter(noRows, 'personal-auto')).toBe(true)
    expect(formMatchesProductFilter(noRows, 'homeowners')).toBe(false)
    expect(formMatchesProductFilter({ ...noRows, lineOfBusiness: null }, 'personal-auto')).toBe(false)
  })
  it('does not match a form whose rows have no product code, as generation never attaches through them', () => {
    expect(formMatchesProductFilter({ ...explicit, productCodes: [] }, 'personal-auto')).toBe(false)
  })
  it('does not treat the form line of business as a fallback once applicability rows exist', () => {
    // Generator: a form with rows only for another product is excluded.
    expect(formMatchesProductFilter({ ...explicit, productCodes: ['homeowners'] }, 'personal-auto')).toBe(false)
  })
  it('falls back to explicit codes for summaries without the scope fields', () => {
    expect(formMatchesProductFilter({ productCodes: ['auto'] }, 'auto')).toBe(true)
    expect(formMatchesProductFilter({ productCodes: ['auto'] }, 'property')).toBe(false)
  })
})

describe('forms catalog state filter', () => {
  it('keeps the exact state and ALL rows, and drops other states', () => {
    expect(formMatchesStateFilter(explicit, 'CA')).toBe(true)
    expect(formMatchesStateFilter(explicit, 'ca')).toBe(true)
    expect(formMatchesStateFilter(explicit, 'NY')).toBe(false)
    expect(formMatchesStateFilter({ ...explicit, stateCodes: ['all'] }, 'NY')).toBe(true)
    expect(formMatchesStateFilter({ ...explicit, stateCodes: ['ALL', 'CA'] }, 'TX')).toBe(true)
  })
  it('keeps forms without jurisdiction rows only when approval is not required', () => {
    expect(formMatchesStateFilter({ ...explicit, stateCodes: [], requireApprovedJurisdiction: false }, 'NY')).toBe(true)
    expect(formMatchesStateFilter({ ...explicit, stateCodes: [], requireApprovedJurisdiction: true }, 'NY')).toBe(false)
    expect(formMatchesStateFilter({ stateCodes: [] }, 'NY')).toBe(false)
  })
  it('does not let a state code that merely contains ALL bypass the filter', () => {
    expect(formMatchesStateFilter({ ...explicit, stateCodes: ['ALLX', 'XALL'] }, 'NY')).toBe(false)
  })
  it('requires both product and state to match', () => {
    expect(formMatchesScopeFilter(explicit, { product: 'personal-auto', state: 'CA' })).toBe(true)
    expect(formMatchesScopeFilter(explicit, { product: 'personal-auto', state: 'NY' })).toBe(false)
    expect(formMatchesScopeFilter(explicit, { product: 'homeowners', state: 'CA' })).toBe(false)
  })
})

describe('forms catalog scope labels', () => {
  it('says what applies rather than what is missing (WP-0004 REQ-18)', () => {
    expect(formScopeLabels(explicit)).toEqual({ products: 'personal-auto', states: 'CA' })
    expect(formScopeLabels({ ...explicit, hasApplicability: false, productCodes: [], stateCodes: [], requireApprovedJurisdiction: false }))
      .toEqual({ products: 'All personal-auto products', states: 'All states' })
    expect(formScopeLabels({ ...explicit, productCodes: [], stateCodes: [] })).toEqual({ products: 'No products', states: 'No approved state' })
    expect(formScopeLabels({ hasApplicability: false, stateCodes: [] })).toEqual({ products: 'No products', states: 'No approved state' })
  })
  it('collapses an ALL jurisdiction row to "All states", in any case', () => {
    expect(formScopeLabels({ ...explicit, stateCodes: ['ALL', 'CA'] }).states).toBe('All states')
    expect(formScopeLabels({ ...explicit, stateCodes: ['all'] }).states).toBe('All states')
  })
  it('does not treat a code that merely contains ALL as all states', () => {
    expect(formScopeLabels({ ...explicit, stateCodes: ['ALLX', 'XALL'] }).states).toBe('ALLX, XALL')
  })
  it('never says "All states" for a form that needs approval but has no state', () => {
    expect(formScopeLabels({ ...explicit, stateCodes: [], requireApprovedJurisdiction: true }).states).toBe('No approved state')
    expect(formScopeLabels({ ...explicit, stateCodes: [], requireApprovedJurisdiction: undefined }).states).toBe('No approved state')
  })
})

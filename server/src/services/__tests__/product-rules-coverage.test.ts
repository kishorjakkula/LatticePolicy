import { beforeEach, describe, expect, it, vi } from 'vitest'

const pinned = vi.hoisted(() => ({ snapshot: null as any }))
vi.mock('../../lib/product-snapshot.js', () => ({
  requireLoadedSnapshot: () => pinned.snapshot,
}))

import { assertCoveragesDefined, assertProductRules, coverageViolations } from '../product-rules.service.js'

const auto = (codes: string[]) => ({ productCode: 'personal-auto', state: 'CA', coverages: codes.map((code) => ({ code, selected: true })) })

beforeEach(() => {
  pinned.snapshot = null
})

describe('coverage codes must belong to the product', () => {
  it('accepts the product\'s own coverages', () => {
    expect(coverageViolations('t', auto(['BI', 'PD', 'COMP', 'COLL']))).toEqual([])
  })

  it('names every coverage the product does not offer, with its path', () => {
    expect(coverageViolations('t', auto(['BI', 'A', 'END_WB']))).toEqual([
      { path: '/coverages/1/code', keyword: 'coverage', code: 'A', message: 'Coverage A is not offered by Personal Auto.' },
      { path: '/coverages/2/code', keyword: 'coverage', code: 'END_WB', message: 'Coverage END_WB is not offered by Personal Auto.' },
    ])
  })

  it('checks unselected entries too, since they are stored on the quote', () => {
    expect(coverageViolations('t', { ...auto([]), coverages: [{ code: 'END_WB', selected: false }] })).toHaveLength(1)
  })

  it('uses the pinned product version, not the current definition', () => {
    pinned.snapshot = { definition: { config: { capabilities: { label: 'Personal Auto' }, coverages: [{ code: 'BI' }, { code: 'LEGACY_MED' }] } } }
    expect(coverageViolations('t', auto(['BI', 'LEGACY_MED']))).toEqual([])
    expect(coverageViolations('t', auto(['COMP'])).map((violation) => violation.code)).toEqual(['COMP'])
  })

  it('carries codes already on the policy for a change, refusing only what the change introduces', () => {
    const previous = auto(['BI', 'A'])
    expect(coverageViolations('t', auto(['BI', 'A', 'PD']), { previous })).toEqual([])
    expect(coverageViolations('t', auto(['BI', 'A', 'END_WB']), { previous }).map((violation) => violation.code)).toEqual(['END_WB'])
  })

  it('leaves unknown products to their existing errors', () => {
    expect(coverageViolations('t', { productCode: 'no-such-product', coverages: [{ code: 'X' }] })).toEqual([])
  })

  it('refuses through the transaction assertions with PRODUCT_RULES_NOT_MET', () => {
    expect(() => assertProductRules('t', auto(['END_WB']), 'bind')).toThrow(expect.objectContaining({ code: 'PRODUCT_RULES_NOT_MET' }))
    expect(() => assertCoveragesDefined('t', auto(['END_WB']), 'issue')).toThrow(
      expect.objectContaining({ code: 'PRODUCT_RULES_NOT_MET', details: expect.objectContaining({ transaction: 'issue' }) }),
    )
    expect(() => assertCoveragesDefined('t', auto(['BI']), 'issue')).not.toThrow()
  })
})

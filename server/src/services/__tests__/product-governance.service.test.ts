import { describe, expect, it } from 'vitest'
import {
  artifactDigest,
  assertCompleteArtifacts,
  assertGovernanceTransition,
  assertMakerChecker,
  periodsOverlap,
} from '../product-governance.service.js'

describe('product governance', () => {
  it('enforces the controlled release lifecycle', () => {
    expect(() => assertGovernanceTransition('DRAFT', 'REVIEW')).not.toThrow()
    expect(() => assertGovernanceTransition('REVIEW', 'APPROVED')).not.toThrow()
    expect(() => assertGovernanceTransition('APPROVED', 'SCHEDULED')).not.toThrow()
    expect(() => assertGovernanceTransition('SCHEDULED', 'ACTIVE')).not.toThrow()
    expect(() => assertGovernanceTransition('ACTIVE', 'RETIRED')).not.toThrow()
    expect(() => assertGovernanceTransition('DRAFT', 'ACTIVE')).toThrow('INVALID_TRANSITION')
    expect(() => assertGovernanceTransition('RETIRED', 'ACTIVE')).toThrow('INVALID_TRANSITION')
  })

  it('requires a separate approver', () => {
    expect(() => assertMakerChecker('maker', 'checker')).not.toThrow()
    expect(() => assertMakerChecker('maker', 'maker')).toThrow('MAKER_CHECKER_REQUIRED')
  })

  it('builds a stable digest independent of object key order', () => {
    expect(artifactDigest({ rates: { factor: 1 }, forms: ['A'] }))
      .toBe(artifactDigest({ forms: ['A'], rates: { factor: 1 } }))
  })

  it('requires every governed artifact class', () => {
    const complete = { product: {}, rating: {}, underwritingRules: [], coverages: [], forms: [] }
    expect(() => assertCompleteArtifacts(complete)).not.toThrow()
    expect(() => assertCompleteArtifacts({ product: {}, rating: {} }))
      .toThrow('MISSING_ARTIFACTS:underwritingRules,coverages,forms')
  })

  it('detects bounded and open-ended overlaps', () => {
    expect(periodsOverlap('2026-01-01', '2026-12-31', '2026-06-01', null)).toBe(true)
    expect(periodsOverlap('2026-01-01', '2026-03-31', '2026-04-01', null)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { evaluateAggregationAppetite } from '../quote-bind.service.js'

describe('evaluateAggregationAppetite', () => {
  it('is a no-op (configured: false) when no limit is configured for the tenant/product/state', () => {
    const result = evaluateAggregationAppetite(null, { policyCount: 500, totalTiv: 999_999_999 }, 1_000_000)
    expect(result).toMatchObject({ configured: false, exceeded: false, reasons: [] })
  })

  it('is a no-op when a limit row exists but both thresholds are null', () => {
    const result = evaluateAggregationAppetite(
      { maxTotalTiv: null, maxPolicyCount: null },
      { policyCount: 10, totalTiv: 100 },
      50
    )
    expect(result).toMatchObject({ configured: false, exceeded: false, reasons: [] })
  })

  it('does not exceed when projected TIV stays at or under the configured limit', () => {
    const result = evaluateAggregationAppetite(
      { maxTotalTiv: 1_000_000, maxPolicyCount: null },
      { policyCount: 5, totalTiv: 900_000 },
      100_000
    )
    expect(result).toMatchObject({ configured: true, exceeded: false, reasons: [], projectedTotalTiv: 1_000_000 })
  })

  it('flags AGGREGATION_TIV_LIMIT_EXCEEDED when the new policy pushes total TIV over the configured max', () => {
    const result = evaluateAggregationAppetite(
      { maxTotalTiv: 1_000_000, maxPolicyCount: null },
      { policyCount: 5, totalTiv: 950_000 },
      100_000
    )
    expect(result.configured).toBe(true)
    expect(result.exceeded).toBe(true)
    expect(result.reasons).toEqual(['AGGREGATION_TIV_LIMIT_EXCEEDED'])
    expect(result.projectedTotalTiv).toBe(1_050_000)
  })

  it('flags AGGREGATION_POLICY_COUNT_LIMIT_EXCEEDED when the new policy pushes the count over the configured max', () => {
    const result = evaluateAggregationAppetite(
      { maxTotalTiv: null, maxPolicyCount: 10 },
      { policyCount: 10, totalTiv: 0 },
      0
    )
    expect(result.exceeded).toBe(true)
    expect(result.reasons).toEqual(['AGGREGATION_POLICY_COUNT_LIMIT_EXCEEDED'])
    expect(result.projectedPolicyCount).toBe(11)
  })

  it('can report both reasons at once when both thresholds are configured and exceeded', () => {
    const result = evaluateAggregationAppetite(
      { maxTotalTiv: 1_000, maxPolicyCount: 2 },
      { policyCount: 2, totalTiv: 900 },
      200
    )
    expect(result.reasons).toEqual(
      expect.arrayContaining(['AGGREGATION_TIV_LIMIT_EXCEEDED', 'AGGREGATION_POLICY_COUNT_LIMIT_EXCEEDED'])
    )
    expect(result.reasons).toHaveLength(2)
  })

  it('treats a null new-policy TIV as zero contribution', () => {
    const result = evaluateAggregationAppetite(
      { maxTotalTiv: 1_000, maxPolicyCount: null },
      { policyCount: 1, totalTiv: 500 },
      null
    )
    expect(result.projectedTotalTiv).toBe(500)
    expect(result.exceeded).toBe(false)
  })
})

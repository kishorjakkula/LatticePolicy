import { describe, expect, it } from 'vitest'
import { POLICY_INTEGRITY_CLASSES, policyIntegrityQueries } from '../handlers/policyIntegrityReconciliation.js'

describe('policy integrity reconciliation rules', () => {
  it('defines one detector for every required exception class', () => {
    const rules = policyIntegrityQueries()
    expect(rules.map((rule) => rule.exceptionClass)).toEqual(POLICY_INTEGRITY_CLASSES)
    for (const exceptionClass of POLICY_INTEGRITY_CLASSES) {
      expect(rules.find((rule) => rule.exceptionClass === exceptionClass)?.sql).toContain(exceptionClass)
    }
  })

  it('scopes every detector to tenant and optional policy', () => {
    const policyId = '00000000-0000-4000-8000-000000000001'
    for (const rule of policyIntegrityQueries(policyId)) {
      expect(rule.sql).toContain('p.tenant_id = $1')
      expect(rule.sql).toContain('p.policy_id = $2')
      expect(rule.params).toEqual([policyId])
    }
  })
})

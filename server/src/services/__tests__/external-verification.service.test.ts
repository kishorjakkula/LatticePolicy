import { describe, expect, it } from 'vitest'
import {
  NoopExternalVerificationProvider,
  runExternalVerification,
  type ExternalVerificationProvider,
  type ExternalVerificationRequest,
} from '../external-verification.service.js'

function baseRequest(): ExternalVerificationRequest {
  return {
    tenantId: 'sample-carrier',
    productCode: 'personal-auto',
    stateCode: 'CA',
    effectiveDate: '2026-07-01',
    insuredDisplayName: 'Jane Doe',
    customerId: null,
    qualificationAnswers: null,
  }
}

describe('runExternalVerification (pluggable extension point)', () => {
  it('defaults to the no-op provider and contributes zero findings when no provider is configured', async () => {
    const result = await runExternalVerification(baseRequest())
    expect(result).toEqual({ provider: 'noop', findings: [] })
  })

  it('the NoopExternalVerificationProvider itself always returns empty findings', async () => {
    const provider = new NoopExternalVerificationProvider()
    const result = await provider.verify(baseRequest())
    expect(result.findings).toEqual([])
    expect(result.provider).toBe('noop')
  })

  it('supports swapping in a different provider without changing the call site (future real integration shape)', async () => {
    const fakeProvider: ExternalVerificationProvider = {
      name: 'test-fixture-provider',
      async verify(request) {
        return {
          provider: this.name,
          findings: request.customerId
            ? [{ code: 'TEST_FINDING', description: 'Synthetic finding for test wiring only' }]
            : [],
        }
      },
    }

    const withCustomer = await runExternalVerification(
      { ...baseRequest(), customerId: '11111111-1111-4111-a111-111111111111' },
      fakeProvider
    )
    expect(withCustomer.findings).toHaveLength(1)
    expect(withCustomer.findings[0].code).toBe('TEST_FINDING')

    const withoutCustomer = await runExternalVerification(baseRequest(), fakeProvider)
    expect(withoutCustomer.findings).toEqual([])
  })
})

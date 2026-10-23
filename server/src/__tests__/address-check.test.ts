import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addressCapabilities, addressCheckInput, checkAddress } from '../services/address-check.service.js'

const address = { line1: '20 Test Avenue', line2: 'APT 4B', city: 'Boston', state: 'MA', postalCode: '02108-1234', country: 'US' }
const match = { addressComponents: { fromAddress: '2', streetName: 'TEST', suffixType: 'AVE', city: 'BOSTON', state: 'MA', zip: '02108' } }
const mockFetch = vi.fn()
beforeEach(() => { vi.stubGlobal('fetch', mockFetch); vi.stubEnv('ADDRESS_CHECK_PROVIDER', 'census'); vi.stubEnv('ADDRESS_CHECK_ALLOWED_TENANTS', 'demo'); vi.stubEnv('CARRIER_TENANT_ID', ''); mockFetch.mockReset() })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })
describe('private-by-default optional address range matching', () => {
  it('is off for absent configuration, other tenants and wildcard entries', async () => {
    expect(addressCapabilities('other').enabled).toBe(false)
    vi.stubEnv('ADDRESS_CHECK_ALLOWED_TENANTS', '*')
    expect((await checkAddress('demo', address)).outcome).toBe('disabled')
    vi.stubEnv('ADDRESS_CHECK_PROVIDER', '')
    expect(addressCapabilities('demo').enabled).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })
  it.each(['CA', 'GB'])('does not submit non-US country %s', async country => {
    expect((await checkAddress('demo', { ...address, country })).outcome).toBe('unsupported')
    expect(mockFetch).not.toHaveBeenCalled()
  })
  it.each(['PO Box 9', 'P.O. BOX 42', 'APO AE 09012'])('does not certify unsupported %s', async line1 => {
    expect((await checkAddress('demo', { ...address, line1 })).outcome).toBe('unsupported')
    expect(mockFetch).not.toHaveBeenCalled()
  })
  it('sends only street/city/state/base ZIP and preserves unit, ZIP+4 and house number', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ result: { addressMatches: [match] } })))
    const result = await checkAddress('demo', address)
    expect(result).toMatchObject({ outcome: 'matched', candidates: [{ precision: 'address_range', address: { line1: '20 TEST AVE', line2: 'APT 4B', postalCode: '02108-1234' } }] })
    const [url, options] = mockFetch.mock.calls[0]
    expect(url.origin).toBe('https://geocoding.geo.census.gov')
    expect(url.searchParams.get('zip')).toBe('02108')
    expect(url.toString()).not.toMatch(/APT|4B|1234/)
    expect(options.redirect).toBe('error')
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })
  it.each([[[], 'unmatched'], [[match, match], 'ambiguous']])('handles match counts', async (matches, outcome) => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ result: { addressMatches: matches } })))
    expect((await checkAddress('demo', address)).outcome).toBe(outcome)
  })
  it.each(['invalid JSON', JSON.stringify({ result: {} }), JSON.stringify({ result: { addressMatches: Array(6).fill(match) } }), 'x'.repeat(256 * 1024 + 1)])('bounds or rejects malformed responses', async body => {
    mockFetch.mockResolvedValue(new Response(body))
    expect(await checkAddress('demo', address)).toMatchObject({ outcome: 'unavailable', candidates: [] })
  })
  it('sanitizes provider errors', async () => {
    mockFetch.mockRejectedValue(new Error('secret upstream address URL'))
    const result = await checkAddress('demo', address)
    expect(result.outcome).toBe('unavailable')
    expect(JSON.stringify(result)).not.toContain('secret')
  })
  it.each(['fetch', 'body'])('times out stalled provider %s without leaking input', async stage => {
    vi.useFakeTimers()
    mockFetch.mockImplementation((_url, { signal }) => {
      if (stage === 'fetch') return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private upstream request'))))
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) { signal.addEventListener('abort', () => controller.error(new Error('private upstream body'))) },
      })))
    })
    const pending = checkAddress('demo', address)
    await vi.advanceTimersByTimeAsync(5001)
    const result = await pending
    expect(result).toMatchObject({ outcome: 'unavailable', candidates: [] })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true)
  })
  it('honors the pinned carrier even when another tenant is allowlisted', async () => {
    vi.stubEnv('CARRIER_TENANT_ID', 'carrier-a')
    expect((await checkAddress('demo', address)).outcome).toBe('disabled')
    expect(mockFetch).not.toHaveBeenCalled()
  })
  it('validates strict minimal requests without personal contact data', () => {
    expect(addressCheckInput.safeParse({ address }).success).toBe(true)
    for (const body of [{ address: { ...address, email: 'person@example.com' } }, { address, endpoint: 'https://evil.invalid' }, { address: { ...address, line1: 'x'.repeat(201) } }, { address: { ...address, line1: 'line\nfeed' } }]) expect(addressCheckInput.safeParse(body).success).toBe(false)
  })
})

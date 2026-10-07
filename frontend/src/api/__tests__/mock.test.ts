import { describe, expect, it } from 'vitest'
import { mockApi } from '../mock'

describe('mock quote search sorting', () => {
  it('allowlists sort fields and falls back safely for unknown input', async () => {
    await mockApi('POST', '/v1/quotes', {
      quoteId: 'sort-test-earlier',
      effectiveDate: '2026-01-01',
      productCode: 'personal-auto',
    })
    await mockApi('POST', '/v1/quotes', {
      quoteId: 'sort-test-later',
      effectiveDate: '2026-12-01',
      productCode: 'personal-auto',
    })

    const result = await mockApi<{ items: Array<{ quoteId: string }> }>(
      'GET',
      '/v1/quotes?page=1&pageSize=100&sortBy=constructor&sortDir=desc',
    )
    const matchingIds = result.items
      .map((item) => item.quoteId)
      .filter((id) => id.startsWith('sort-test-'))

    expect(matchingIds).toEqual(['sort-test-later', 'sort-test-earlier'])
  })
})

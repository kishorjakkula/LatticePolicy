import { describe, expect, it } from 'vitest'
import { routeParam } from '../utils.js'

describe('utils', () => {
  describe('routeParam', () => {
    it('normalizes scalar route params', () => {
      expect(routeParam(' policy-123 ')).toBe('policy-123')
    })

    it('uses the first repeated route param value', () => {
      expect(routeParam([' customer-1 ', 'customer-2'])).toBe('customer-1')
    })

    it('returns an empty string for missing route params', () => {
      expect(routeParam(undefined)).toBe('')
      expect(routeParam([])).toBe('')
    })
  })
})

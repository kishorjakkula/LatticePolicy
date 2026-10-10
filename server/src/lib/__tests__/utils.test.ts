import { describe, expect, it } from 'vitest'
import { fileExtensionForContentType, routeParam } from '../utils.js'

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

  describe('fileExtensionForContentType', () => {
    it('uses the Word extension for generated DOCX policy forms', () => {
      expect(
        fileExtensionForContentType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      ).toBe('docx')
    })

    it('falls back to a binary extension for unknown content types', () => {
      expect(fileExtensionForContentType('application/octet-stream')).toBe('bin')
    })
  })
})

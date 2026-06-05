import { describe, expect, it } from 'vitest'
import { applyJsonPatch, diffPayloadPaths, getByPath } from '../patch.utils.js'

describe('patch.utils', () => {
  it('diffs nested object payloads using JSON pointer paths', () => {
    const before = {
      insured: { name: 'Ada', address: { state: 'CA' } },
      premium: { total: 100 },
    }
    const after = {
      insured: { name: 'Ada Lovelace', address: { state: 'NY' } },
      premium: { total: 100 },
      metadata: { source: 'test' },
    }

    expect(diffPayloadPaths(before, after).sort()).toEqual([
      '/insured/address/state',
      '/insured/name',
      '/metadata/source',
    ])
  })

  it('reads escaped JSON pointer paths', () => {
    const payload = {
      'a/b': {
        'c~d': 42,
      },
    }

    expect(getByPath(payload, '/a~1b/c~0d')).toBe(42)
    expect(getByPath(payload, '/missing/value')).toBeUndefined()
  })

  it('applies add, replace, and remove patch operations', () => {
    const payload = {
      risk: { state: 'CA', county: 'Alameda' },
      coverages: [{ code: 'BI', limit: 50000 }],
    }

    const result = applyJsonPatch(payload, [
      { op: 'replace', path: '/risk/state', value: 'TX' },
      { op: 'add', path: '/risk/zip', value: '73301' },
      { op: 'replace', path: '/coverages/0/limit', value: 100000 },
      { op: 'remove', path: '/risk/county' },
    ])

    expect(result).toEqual({
      risk: { state: 'TX', zip: '73301' },
      coverages: [{ code: 'BI', limit: 100000 }],
    })
  })

  it('creates missing intermediate objects when applying patches', () => {
    const result = applyJsonPatch({}, [
      { op: 'add', path: '/customer/contact/email', value: 'test@example.com' },
    ])

    expect(result).toEqual({
      customer: { contact: { email: 'test@example.com' } },
    })
  })
})

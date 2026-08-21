import { describe, expect, it } from 'vitest'
import { v4 } from '../uuid.js'

describe('uuid helper', () => {
  it('generates RFC 4122 version 4 identifiers', () => {
    const id = v4()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

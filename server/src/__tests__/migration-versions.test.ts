import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('migration ordering', () => {
  it('gives every migration a unique numeric version so the runner never skips a file', () => {
    const files = readdirSync(fileURLToPath(new URL('../../migrations/', import.meta.url)))
      .filter(file => /^\d+_.+\.sql$/i.test(file)).sort()
    const versions = files.map(file => Number(file.split('_')[0]))
    expect(new Set(versions).size, files.join('\n')).toBe(files.length)
    expect(versions.indexOf(60)).toBeLessThan(versions.indexOf(61))
    expect(versions.indexOf(61)).toBeLessThan(versions.indexOf(62))
  })
})

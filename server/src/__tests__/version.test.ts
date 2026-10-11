import fs from 'fs'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { getBuildInfo, resetBuildInfoCache } from '../version.js'

describe('build info', () => {
  const originalCommit = process.env.BUILD_COMMIT

  afterEach(() => {
    if (originalCommit === undefined) delete process.env.BUILD_COMMIT
    else process.env.BUILD_COMMIT = originalCommit
    resetBuildInfoCache()
  })

  it('reports the server package version', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'))
    resetBuildInfoCache()
    expect(getBuildInfo().version).toBe(pkg.version)
  })

  it('reports the build commit only when the build supplied one', () => {
    delete process.env.BUILD_COMMIT
    resetBuildInfoCache()
    expect(getBuildInfo().commit).toBeNull()

    process.env.BUILD_COMMIT = ' abc123 '
    resetBuildInfoCache()
    expect(getBuildInfo().commit).toBe('abc123')
  })
})

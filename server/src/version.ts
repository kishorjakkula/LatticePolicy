import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

export type BuildInfo = {
  version: string
  commit: string | null
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let cached: BuildInfo | null = null

/**
 * Release version of this build, read from server/package.json (present next
 * to both src/ and dist/), plus the commit the image was built from when the
 * build supplied BUILD_COMMIT. Upgrade tooling and the carrier registry read
 * this through GET /version.
 */
export function getBuildInfo(): BuildInfo {
  if (cached) return cached
  let version = 'unknown'
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'))
    if (typeof pkg?.version === 'string' && pkg.version.trim()) version = pkg.version.trim()
  } catch {
    // Leave 'unknown' rather than fail a health or version probe.
  }
  const commit = String(process.env.BUILD_COMMIT || '').trim() || null
  cached = { version, commit }
  return cached
}

/** Test hook: BUILD_COMMIT is read once per process. */
export function resetBuildInfoCache() {
  cached = null
}

import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

export const nodeEngine = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).engines.node

export function supportsNodeVersion(version) {
  const parsed = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!parsed) return false
  const [, major, minor, patch] = parsed.map(Number)
  // The root contract uses stable-major caret ranges and an open-ended floor.
  return nodeEngine.split(' || ').some(range => {
    const floor = /^(\^|>=)(\d+)\.(\d+)\.(\d+)$/.exec(range)
    if (!floor) throw new Error(`Unsupported Node engine syntax: ${range}`)
    const [, operator, floorMajor, floorMinor, floorPatch] = floor
    const atLeast = major > +floorMajor || (major === +floorMajor &&
      (minor > +floorMinor || (minor === +floorMinor && patch >= +floorPatch)))
    return atLeast && (operator === '>=' || major === +floorMajor)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!supportsNodeVersion(process.versions.node)) {
    console.error(`Local Node is v${process.versions.node}; this project requires ${nodeEngine}.`)
    process.exitCode = 1
  }
}

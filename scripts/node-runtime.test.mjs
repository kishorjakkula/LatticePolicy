import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { nodeEngine, supportsNodeVersion } from './node-runtime.mjs'

test('root manifest, lock metadata and jsdom share the required Node contract', () => {
  const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
  assert.equal(nodeEngine, '^22.22.2 || ^24.15.0 || >=26.0.0')
  assert.equal(lock.packages[''].engines.node, nodeEngine)
  const jsdom = Object.entries(lock.packages).filter(([name]) => name.endsWith('/node_modules/jsdom') || name === 'node_modules/jsdom')
  assert(jsdom.length > 0)
  for (const [, pkg] of jsdom) {
    assert.equal(pkg.engines.node, nodeEngine)
  }
})

for (const version of ['22.22.2', '22.23.0', '22.99.99', '24.15.0', '24.15.1', '24.99.99', '26.0.0', '26.0.1', '27.0.0', '28.0.0']) {
  test(`accepts supported Node ${version}`, () => assert.equal(supportsNodeVersion(version), true))
}

for (const version of ['20.99.0', '21.0.0', '22.12.0', '22.21.99', '22.22.1', '23.99.99', '24.0.0', '24.14.99', '25.99.99', '26.0.0-rc.1', 'unknown', '', '22', 'v22.22.2', '22.22.2extra']) {
  test(`rejects unsupported or invalid Node ${JSON.stringify(version)}`, () => assert.equal(supportsNodeVersion(version), false))
}

test('runtime CLI accepts the supported test process', () => {
  assert(supportsNodeVersion(process.versions.node))
  const result = spawnSync(process.execPath, [new URL('./node-runtime.mjs', import.meta.url).pathname], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('runtime CLI rejects a below-minimum process with the canonical range', () => {
  const script = new URL('./node-runtime.mjs', import.meta.url)
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    Object.defineProperty(process.versions, 'node', { value: '22.22.1' })
    process.argv[1] = ${JSON.stringify(script.pathname)}
    await import(${JSON.stringify(script.href)})
  `], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert(result.stderr.includes('22.22.1'))
  assert(result.stderr.includes(nodeEngine))
})

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { validateArchitecture } from './check-module-boundaries.mjs'

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'lattice-boundaries-'))
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, source)
  }
  return root
}

test('accepts an acyclic one-way capability graph', (context) => {
  const root = fixture({ 'src/orchestrator.ts': "import './leaf.js'", 'src/leaf.ts': "export const value = 1" })
  context.after(() => rmSync(root, { recursive: true, force: true }))
  assert.deepEqual(validateArchitecture(root, { sourceRoots: ['src'], boundaries: [] }), [])
})

test('reports the complete import cycle path', (context) => {
  const root = fixture({ 'src/a.ts': "import './b.js'", 'src/b.ts': "import './c.js'", 'src/c.ts': "import './a.js'" })
  context.after(() => rmSync(root, { recursive: true, force: true }))
  assert.deepEqual(validateArchitecture(root, { sourceRoots: ['src'], boundaries: [] }), [
    'Import cycle: src/a.ts -> src/b.ts -> src/c.ts -> src/a.ts',
  ])
})

test('reports a forbidden reverse dependency', (context) => {
  const root = fixture({ 'src/orchestrator.ts': "export const run = true", 'src/leaf.ts': "import './orchestrator.js'" })
  context.after(() => rmSync(root, { recursive: true, force: true }))
  const boundaries = [{ leaf: 'src/leaf.ts', forbidden: ['src/orchestrator.ts'] }]
  assert.deepEqual(validateArchitecture(root, { sourceRoots: ['src'], boundaries }), [
    'src/leaf.ts must not import src/orchestrator.ts',
  ])
})

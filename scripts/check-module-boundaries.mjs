import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts']
const IMPORT_PATTERN = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g

export const DEFAULT_BOUNDARIES = [
  { leaf: 'server/src/services/lifecycle/lifecycle-support.ts', forbidden: ['server/src/services/lifecycle.service.ts'] },
  { leaf: 'server/src/services/customers/customer-matching.ts', forbidden: ['server/src/routes/customers.routes.ts'] },
  { leaf: 'server/src/services/onboarding/onboarding-normalization.ts', forbidden: ['server/src/routes/agency-onboarding.routes.ts'] },
  { leaf: 'frontend/src/features/wizard/riskDefaults.ts', forbidden: ['frontend/src/features/wizard/QuoteWizard.tsx'] },
]

function sourceFiles(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return SOURCE_EXTENSIONS.includes(extname(path)) && !path.endsWith('.d.ts') ? [path] : []
  })
}

function resolveImport(importer, specifier) {
  if (!specifier.startsWith('.')) return null
  const unresolved = resolve(dirname(importer), specifier)
  const base = SOURCE_EXTENSIONS.some((extension) => unresolved.endsWith(extension))
    ? unresolved.slice(0, -extname(unresolved).length)
    : unresolved.replace(/\.js$/, '')
  const candidates = [
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => resolve(unresolved, `index${extension}`)),
  ]
  return candidates.find(existsSync) || null
}

export function buildImportGraph(root, sourceRoots = ['server/src', 'frontend/src', 'packages/types/src']) {
  const files = sourceRoots.flatMap((directory) => sourceFiles(resolve(root, directory)))
  const graph = new Map(files.map((file) => [file, []]))
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const dependency = resolveImport(file, match[1] || match[2])
      if (dependency && graph.has(dependency)) graph.get(file).push(dependency)
    }
  }
  return graph
}

export function findCycles(graph) {
  const visited = new Set()
  const active = new Set()
  const stack = []
  const cycles = []
  const seen = new Set()
  function visit(node) {
    if (active.has(node)) {
      const cycle = [...stack.slice(stack.indexOf(node)), node]
      const key = [...new Set(cycle)].sort().join('|')
      if (!seen.has(key)) { seen.add(key); cycles.push(cycle) }
      return
    }
    if (visited.has(node)) return
    visited.add(node); active.add(node); stack.push(node)
    for (const dependency of graph.get(node) || []) visit(dependency)
    stack.pop(); active.delete(node)
  }
  for (const node of graph.keys()) visit(node)
  return cycles
}

export function checkBoundaries(root, graph, boundaries = DEFAULT_BOUNDARIES) {
  const failures = []
  for (const boundary of boundaries) {
    const leaf = resolve(root, boundary.leaf)
    for (const dependency of graph.get(leaf) || []) {
      const dependencyPath = relative(root, dependency)
      if (boundary.forbidden.includes(dependencyPath)) failures.push(`${boundary.leaf} must not import ${dependencyPath}`)
    }
  }
  return failures
}

export function validateArchitecture(root, options = {}) {
  const graph = buildImportGraph(root, options.sourceRoots)
  const display = (path) => relative(root, path)
  return [
    ...findCycles(graph).map((cycle) => `Import cycle: ${cycle.map(display).join(' -> ')}`),
    ...checkBoundaries(root, graph, options.boundaries),
  ]
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isCli) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const failures = validateArchitecture(root)
  if (failures.length) {
    console.error(`Module boundary check failed:\n- ${failures.join('\n- ')}`)
    process.exitCode = 1
  } else {
    console.log('Module boundary check passed: no cycles or forbidden reverse imports.')
  }
}

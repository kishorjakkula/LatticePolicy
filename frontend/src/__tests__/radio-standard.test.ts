import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

it('all production radio inputs use the framework RadioGroup', () => {
  const root = path.resolve(process.cwd(), 'src')
  const violations: string[] = []
  function visit(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (entry.name !== '__tests__') visit(file); continue }
      if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\./.test(entry.name)) continue
      if (file === path.join(root, 'components', 'RadioGroup.tsx')) continue
      if (/type\s*=\s*['"]radio['"]/.test(fs.readFileSync(file, 'utf8'))) violations.push(path.relative(root, file))
    }
  }
  visit(root)
  expect(violations, 'Use components/RadioGroup rather than raw radio inputs').toEqual([])
})

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { colorTokenViolations } from '../test/colorTokens'

describe('feature and component color tokens', () => {
  it('allows palette definitions, comments and variable uses', () => {
    expect(colorTokenViolations('a.css', '/* #fff */ :root { --text: #fff; } #abc { color: var(--text); }')).toEqual([])
    expect(colorTokenViolations('a.tsx', '// #fff\nconst x = { "--accent": "#abc", color: "var(--accent)" }')).toEqual([])
  })

  it.each(['#fff', '#12345678', 'rgb(1 2 3)', 'hsl(0 0% 1%)', 'oklch(50% 0 0)', 'var(--text, #fff)'])('rejects hard-coded %s', color => {
    expect(colorTokenViolations('a.css', `.a { color: ${color}; }`)).toEqual([1])
    expect(colorTokenViolations('a.tsx', `const x = { color: '${color}' }`)).toEqual([1])
  })

  it('finds colors inside interpolated templates', () => {
    expect(colorTokenViolations('a.tsx', 'const x = `1px ${width} #fff`')).toEqual([1])
  })

  it('keeps all production features and controls token-based', () => {
    const root = path.resolve(process.cwd(), 'src')
    const violations: string[] = []
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) { if (entry.name !== '__tests__') visit(file); continue }
        if (!/\.(?:tsx?|css)$/.test(file) || /\.(?:test|spec)\./.test(file)) continue
        for (const line of colorTokenViolations(file, fs.readFileSync(file, 'utf8'))) {
          violations.push(`${path.relative(root, file)}:${line}`)
        }
      }
    }
    visit(path.join(root, 'features'))
    visit(path.join(root, 'components'))
    expect(violations, 'Use theme variables; keep literals in custom-property token definitions').toEqual([])
  })
})

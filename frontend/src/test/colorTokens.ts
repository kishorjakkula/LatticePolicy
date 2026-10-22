import { parse } from '@babel/parser'
import type { Node } from '@babel/types'
import postcss from 'postcss'

// Inspect parsed declarations/literals, not comments or selectors containing IDs.
const literalColor = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i

export function colorTokenViolations(file: string, source: string): number[] {
  const lines: number[] = []
  if (file.endsWith('.css')) {
    postcss.parse(source, { from: file }).walkDecls(declaration => {
      if (!declaration.prop.startsWith('--') && literalColor.test(declaration.value)) {
        lines.push(declaration.source?.start?.line ?? 1)
      }
    })
  } else {
    const parsed = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    const visit = (node: Node, parent?: Node) => {
      const value = node.type === 'StringLiteral' ? node.value
        : node.type === 'TemplateElement' ? node.value.cooked ?? node.value.raw : null
      if (value && literalColor.test(value)) {
        // Locally scoped token definitions are allowed, as in CSS palettes.
        const isToken = parent?.type === 'ObjectProperty' && parent.key.type === 'StringLiteral'
          && parent.key.value.startsWith('--')
        if (!isToken) lines.push(node.loc?.start.line ?? 1)
      }
      for (const value of Object.values(node)) {
        const children = Array.isArray(value) ? value : [value]
        for (const child of children) {
          if (child && typeof child === 'object' && 'type' in child && typeof child.type === 'string') visit(child as Node, node)
        }
      }
    }
    visit(parsed)
  }
  return [...new Set(lines)]
}

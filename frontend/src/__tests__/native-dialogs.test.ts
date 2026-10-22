import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// WP-0004 REQ-2: reasons and confirmations use components/Dialog (labelled,
// validated, focus-trapped), never the browser's prompt()/confirm().

const BARE_CALL = /(?<![\w$.\]])(prompt|confirm)\s*\(/g
const GLOBAL_CALL = /\b(?:window|globalThis|self)\s*(?:\?\.|\.)\s*(prompt|confirm)\b|\b(?:window|globalThis|self)\s*\[\s*['"`](prompt|confirm)['"`]\s*\]/g

/** Blanks out comments while keeping line numbers, so commented-out code and prose do not count. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

function findNativeDialogCalls(source: string): number[] {
  const lines = stripComments(source).split('\n')
  const hits: number[] = []
  lines.forEach((line, index) => {
    BARE_CALL.lastIndex = 0
    GLOBAL_CALL.lastIndex = 0
    if (BARE_CALL.test(line) || GLOBAL_CALL.test(line)) hits.push(index + 1)
  })
  return hits
}

describe('native dialog detector', () => {
  it('flags bare, window, globalThis and bracket calls', () => {
    expect(findNativeDialogCalls("const r = prompt('Reason')")).toEqual([1])
    expect(findNativeDialogCalls("if (!confirm('Delete?')) return")).toEqual([1])
    expect(findNativeDialogCalls("ok\nwindow.confirm('x')")).toEqual([2])
    expect(findNativeDialogCalls("window.prompt(\n  'Reason')")).toEqual([1])
    expect(findNativeDialogCalls("globalThis.prompt('x')")).toEqual([1])
    expect(findNativeDialogCalls("window?.confirm('x')")).toEqual([1])
    expect(findNativeDialogCalls("window['confirm']('x')")).toEqual([1])
    expect(findNativeDialogCalls("const ask = window.prompt")).toEqual([1])
    expect(findNativeDialogCalls("prompt ('spaced')")).toEqual([1])
  })

  it('ignores the in-app dialog API, other objects and comments', () => {
    expect(findNativeDialogCalls('await askConfirm({ title: "Delete" })')).toEqual([])
    expect(findNativeDialogCalls('onConfirm(reason)')).toEqual([])
    expect(findNativeDialogCalls('const confirmed = await askReason({})')).toEqual([])
    expect(findNativeDialogCalls('dialog.confirm()')).toEqual([])
    expect(findNativeDialogCalls('// replaces window.prompt(...)')).toEqual([])
    expect(findNativeDialogCalls('/* confirm(\n prompt( */ ok()')).toEqual([])
    expect(findNativeDialogCalls("fetch('http://example.test') // confirm(x)")).toEqual([])
  })
})

it('production code uses components/Dialog instead of prompt() and confirm()', () => {
  const root = path.resolve(process.cwd(), 'src')
  const allowed = path.join(root, 'components', 'Dialog.tsx')
  const violations: string[] = []
  function visit(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (entry.name !== '__tests__') visit(file); continue }
      if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\./.test(entry.name)) continue
      if (file === allowed) continue
      for (const line of findNativeDialogCalls(fs.readFileSync(file, 'utf8'))) {
        violations.push(`${path.relative(root, file)}:${line}`)
      }
    }
  }
  visit(root)
  expect(violations, 'Use useReasonDialog/useConfirmDialog from components/Dialog rather than prompt()/confirm()').toEqual([])
})

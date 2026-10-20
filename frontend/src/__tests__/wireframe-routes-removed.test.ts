import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// WP-0004 REQ-5: prototype wireframe screens are not part of the app.
const src = resolve(__dirname, '..')

describe('wireframe prototype routes', () => {
  it('are not registered in the app router', () => {
    const app = readFileSync(resolve(src, 'App.tsx'), 'utf8')
    expect(app).not.toMatch(/wizard-wireframes|header-wireframes/)
    expect(app).not.toMatch(/WizardWireframesPage|HeaderWireframesPage/)
  })

  it('have no page components left to route to', () => {
    expect(existsSync(resolve(src, 'features/wizard/WizardWireframesPage.tsx'))).toBe(false)
    expect(existsSync(resolve(src, 'features/layout/HeaderWireframesPage.tsx'))).toBe(false)
  })
})

import type { Page } from '@playwright/test'
import { expect } from './fixtures'

/** Every screen uses the shared native radio control with an accessible name. */
export async function auditRadioControls(page: Page) {
  const failures = await page.evaluate(() => {
    const issues: string[] = []
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
      if (!radio.getClientRects().length) continue
      const group = radio.closest('.radio-group[role="radiogroup"]')
      const option = radio.closest('.radio-option')
      const label = option?.querySelector('span')
      if (!group || !option || !label) { issues.push(`Radio ${radio.name} bypasses RadioGroup`); continue }
      const labelledBy = group.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).join(' ')
      if (!(group.getAttribute('aria-label')?.trim() || labelledBy)) issues.push(`Radio ${radio.name} has no group name`)
      const control = radio.getBoundingClientRect()
      const text = label.getBoundingClientRect()
      if (Math.abs(control.y + control.height / 2 - (text.y + 10)) > 2) issues.push(`Radio ${radio.name} is not aligned with its label`)
      if (control.right > innerWidth || control.left < 0) issues.push(`Radio ${radio.name} is outside the viewport`)
    }
    return issues
  })
  expect(failures, 'framework radio control violations').toEqual([])
}

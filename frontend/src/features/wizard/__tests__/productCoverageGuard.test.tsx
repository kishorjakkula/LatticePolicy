import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CoverageSelector, ProductChangeDialog, coverageErrorMessage } from '../QuoteWizard'

// WP-0002: the wizard must never show or apply another product's coverages.
const autoConfig = { product: 'personal-auto', coverages: [{ code: 'BI', name: 'Bodily Injury Liability', limits: [100000] }, { code: 'PD', name: 'Property Damage', limits: [50000] }] }
const homeConfig = { product: 'homeowners', coverages: [{ code: 'A', name: 'Dwelling' }, { code: 'END_WB', name: 'Water Back-Up' }] }

describe('coverage step guard', () => {
  it('shows loading instead of another product\'s coverages when a late configuration arrives', () => {
    const onChange = vi.fn()
    render(<CoverageSelector product="personal-auto" cfg={homeConfig} value={[]} onChange={onChange} />)
    expect(screen.getByText('Loading product config...')).toBeInTheDocument()
    expect(screen.queryByText(/Water Back-Up|Dwelling/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply Default Coverages' })).not.toBeInTheDocument()
  })

  it('applies only the selected product\'s defaults', () => {
    const onChange = vi.fn()
    render(<CoverageSelector product="personal-auto" cfg={autoConfig} value={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply Default Coverages' }))
    expect(onChange.mock.calls[0][0].map((selection: any) => selection.code)).toEqual(['BI', 'PD'])
  })
})

describe('product change confirmation', () => {
  it('explains what is cleared, keeps by default and changes on request', () => {
    const onKeep = vi.fn()
    const onChange = vi.fn()
    render(<ProductChangeDialog from="Homeowners" to="Personal Auto" onKeep={onKeep} onChange={onChange} />)
    expect(screen.getByRole('dialog', { name: 'Change product to Personal Auto?' })).toBeInTheDocument()
    expect(screen.getByText(/Coverages, risk details and qualification answers entered for Homeowners will be cleared/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep Homeowners' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onKeep).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Change product' }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('coverage error wording', () => {
  it('turns a server coverage refusal into a clear instruction', () => {
    const body = { code: 'INVALID_QUOTE', details: { errors: [{ path: '/coverages/2/code', keyword: 'coverage', code: 'END_WB', message: 'Coverage END_WB is not offered by Personal Auto.' }] } }
    expect(coverageErrorMessage(new Error(`API POST /v1/quotes failed 422: ${JSON.stringify(body)}`))).toBe(
      "Coverage END_WB is not offered by Personal Auto. Go back to Coverages and apply the product's coverages.",
    )
    expect(coverageErrorMessage(new Error('API POST /v1/quotes failed 422: {"code":"INVALID_QUOTE","details":{"errors":[{"keyword":"screen","message":"x"}]}}'))).toBeNull()
    expect(coverageErrorMessage(new Error('network down'))).toBeNull()
  })
})

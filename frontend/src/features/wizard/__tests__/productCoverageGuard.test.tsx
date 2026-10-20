import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  CoverageSelector,
  ProductChangeDialog,
  configMatchesProduct,
  coverageErrorMessage,
  createLatestGuard,
  homeownersDefaultsReady,
} from '../QuoteWizard'

// WP-0002: the wizard must never show or apply another product's coverages.
const autoConfig = { product: 'personal-auto', coverages: [{ code: 'BI', name: 'Bodily Injury Liability', limits: [100000] }, { code: 'PD', name: 'Property Damage', limits: [50000] }] }
const homeConfig = { product: 'homeowners', coverages: [{ code: 'A', name: 'Dwelling' }, { code: 'END_WB', name: 'Water Back-Up' }] }

describe('stale product configuration', () => {
  it('ignores a response that arrives after a newer request (the race that caused the defect)', async () => {
    const guard = createLatestGuard()
    let resolveHome!: (value: unknown) => void
    let resolveAuto!: (value: unknown) => void
    const applied: unknown[] = []
    const load = async (code: string, promise: Promise<unknown>) => {
      const isCurrent = guard.begin(code)
      const config = await promise
      if (isCurrent()) applied.push(config)
    }
    const home = load('homeowners', new Promise((resolve) => (resolveHome = resolve)))
    const auto = load('personal-auto', new Promise((resolve) => (resolveAuto = resolve)))
    resolveAuto(autoConfig)
    await auto
    resolveHome(homeConfig) // the older request lands last
    await home
    expect(applied).toEqual([autoConfig])
  })

  it('a reset makes every in-flight response stale', async () => {
    const guard = createLatestGuard()
    const isCurrent = guard.begin('homeowners')
    guard.reset()
    expect(isCurrent()).toBe(false)
  })

  it('matches configurations to products, and builds homeowners defaults only from homeowners configuration', () => {
    expect(configMatchesProduct(autoConfig, 'personal-auto')).toBe(true)
    expect(configMatchesProduct(homeConfig, 'personal-auto')).toBe(false)
    expect(configMatchesProduct(null, 'personal-auto')).toBe(false)
    // Personal Auto → Homeowners: the previous product's configuration is still loaded.
    expect(homeownersDefaultsReady('homeowners', autoConfig)).toBe(false)
    expect(homeownersDefaultsReady('homeowners', homeConfig)).toBe(true)
    expect(homeownersDefaultsReady('personal-auto', homeConfig)).toBe(false)
  })
})

describe('coverage step guard', () => {
  it('shows loading instead of another product\'s coverages when a late configuration arrives', () => {
    render(<CoverageSelector product="personal-auto" cfg={homeConfig} value={[]} onChange={vi.fn()} />)
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

  it('words an underwriting company change, which also clears the product and state', () => {
    const onChange = vi.fn()
    render(
      <ProductChangeDialog
        from="Homeowners"
        to="PA UW Company"
        title="Change underwriting company to PA UW Company?"
        description="The product, state, coverages, risk details and qualification answers entered for Homeowners will be cleared. Insureds are kept."
        confirmLabel="Change company"
        onKeep={() => undefined}
        onChange={onChange}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Change underwriting company to PA UW Company?' })).toBeInTheDocument()
    expect(screen.getByText(/The product, state, coverages/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep Homeowners' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Change company' }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('keeps focus where the user put it across re-renders, and traps Tab inside the dialog', () => {
    const { rerender } = render(<ProductChangeDialog from="Homeowners" to="Personal Auto" onKeep={() => undefined} onChange={() => undefined} />)
    const keep = screen.getByRole('button', { name: 'Keep Homeowners' })
    const change = screen.getByRole('button', { name: 'Change product' })
    change.focus()
    // A parent re-render passes new inline callbacks.
    rerender(<ProductChangeDialog from="Homeowners" to="Personal Auto" onKeep={() => undefined} onChange={() => undefined} />)
    expect(change).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(keep).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(change).toHaveFocus()
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

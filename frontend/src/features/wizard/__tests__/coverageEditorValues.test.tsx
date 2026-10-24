import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CoverageSelector } from '../QuoteWizard'

vi.mock('../../../api/request', async importOriginal => ({ ...await importOriginal<typeof import('../../../api/request')>(), request: vi.fn().mockResolvedValue({ enabled: false }) }))

const config = { product: 'personal-auto', coverages: [
  { code: 'BI', name: 'Bodily Injury Liability', selectable: true, limits: ['25000/50000', '50000/100000', '100000/300000'] },
  { code: 'COLL', name: 'Collision', selectable: true, deductibles: [500, 1000] },
] }

describe('generic coverage editor values', () => {
  it('keeps split limits as offered text and numeric deductibles as numbers', () => {
    const onChange = vi.fn()
    const value = [{ code: 'BI', selected: true, limit: '25000/50000' }, { code: 'COLL', selected: true, deductible: 500 }]
    render(<CoverageSelector product="personal-auto" cfg={config} value={value} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Bodily Injury Liability limit'), { target: { value: '100000/300000' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ code: 'BI', limit: '100000/300000' })]))
    fireEvent.change(screen.getByLabelText('Collision deductible'), { target: { value: '1000' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ code: 'COLL', deductible: 1000 })]))
  })
})

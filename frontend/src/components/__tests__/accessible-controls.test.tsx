import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SearchInput } from '../SearchInput'
import { Checkbox } from '../Checkbox'
import { Pagination } from '../Pagination'

describe('accessible icon-only controls', () => {
  it('SearchInput clear button has an accessible name for screen readers', () => {
    render(<SearchInput value="policy-123" onChange={() => {}} onClear={() => {}} />)

    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument()
  })

  it('Checkbox forwards ariaLabel to the underlying input when no visible label is rendered', () => {
    render(<Checkbox checked={false} onChange={() => {}} ariaLabel="Select policy PL-1001" />)

    expect(screen.getByRole('checkbox', { name: 'Select policy PL-1001' })).toBeInTheDocument()
    // No visible text label is rendered alongside an icon-only checkbox.
    expect(screen.queryByText('Select policy PL-1001')).not.toBeInTheDocument()
  })

  it('Pagination previous/next controls have accessible names distinct from their arrow glyphs', () => {
    render(
      <Pagination page={2} pageSize={10} totalItems={50} onPageChange={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: 'Go to previous page' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to next page' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TablePagination } from '../TablePagination'
import { Pagination } from '../Pagination'

// WP-0004 REQ-6: one pager across screens. TablePagination keeps its props but
// renders the shared numbered Pagination.
describe('TablePagination renders the shared numbered pager', () => {
  it('shows "Page X of Y", numbered pages and labelled previous/next controls', () => {
    render(<TablePagination page={1} pageSize={20} totalItems={183} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />)

    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 10')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Page 10' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to previous page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Go to next page' })).toBeEnabled()
    // The old filled "Prev"/"Next" blocks and "Page 1 / 10" label are gone.
    expect(screen.queryByRole('button', { name: 'Prev' })).not.toBeInTheDocument()
    expect(screen.queryByText('Page 1 / 10')).not.toBeInTheDocument()
  })

  it('disabled previous/next use the outlined pager class, not a filled primary button', () => {
    render(<TablePagination page={1} pageSize={10} totalItems={5} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />)

    for (const name of ['Go to previous page', 'Go to next page']) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDisabled()
      expect(button).toHaveClass('ps-page-btn', 'ps-page-btn--nav')
      expect(button).not.toHaveClass('ps-page-btn--active')
    }
  })

  it('keeps the caller API: page and page-size changes reach the callbacks', async () => {
    const onPageChange = vi.fn()
    const onPageSizeChange = vi.fn()
    render(<TablePagination page={2} pageSize={10} totalItems={45} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
    expect(onPageChange).toHaveBeenLastCalledWith(3)
    await userEvent.click(screen.getByRole('button', { name: 'Page 5' }))
    expect(onPageChange).toHaveBeenLastCalledWith(5)

    const size = screen.getByRole('combobox', { name: 'Results per page' })
    expect(size).toHaveValue('10')
    expect([...size.querySelectorAll('option')].map((o) => o.value)).toEqual(['10', '20', '50'])
    await userEvent.selectOptions(size, '50')
    expect(onPageSizeChange).toHaveBeenCalledWith(50)
  })

  it('clamps an out-of-range page and shows "No results" for an empty list', () => {
    const { rerender } = render(<TablePagination page={99} pageSize={10} totalItems={25} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />)
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()

    rerender(<TablePagination page={1} pageSize={10} totalItems={0} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />)
    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled()
  })
})

describe('Pagination page-size picker', () => {
  it('lists the page size in use even when it is not a preset, so the picker never disagrees with the results', () => {
    render(<Pagination page={1} pageSize={20} totalItems={183} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} pageSizeOptions={[10, 25, 50]} />)

    const size = screen.getByRole('combobox', { name: 'Results per page' })
    expect(size).toHaveValue('20')
    expect([...size.querySelectorAll('option')].map((o) => o.value)).toEqual(['10', '20', '25', '50'])
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CollapsibleSection } from '../CollapsibleSection'

describe('CollapsibleSection', () => {
  it('is expanded by default and collapses and re-expands from the header toggle', () => {
    render(
      <CollapsibleSection className="card" title="Grants">
        <p>Body content</p>
      </CollapsibleSection>,
    )

    expect(screen.getByRole('heading', { name: 'Grants' })).toBeInTheDocument()
    expect(screen.getByText('Body content')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse section' }))
    expect(screen.getByText('Body content')).not.toBeVisible()
    const toggle = screen.getByRole('button', { name: 'Expand section' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)
    expect(screen.getByText('Body content')).toBeVisible()
  })

  it('uses an existing header element as the header and keeps its actions visible when collapsed', () => {
    render(
      <CollapsibleSection className="card stack-card">
        <div className="panel-header">
          <h3>Roles</h3>
          <button type="button">New Role</button>
        </div>
        <p>Role table</p>
      </CollapsibleSection>,
    )

    expect(screen.getAllByRole('heading')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse section' }))
    expect(screen.getByText('Role table')).not.toBeVisible()
    expect(screen.getByRole('button', { name: 'New Role' })).toBeVisible()
  })

  it('keeps the container classes and collapsed form state, and does not submit a form when toggled', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    const { container } = render(
      <CollapsibleSection as="form" className="ps-content-card" onSubmit={onSubmit} data-testid="grant-form">
        <div className="ps-content-card-title">New authority grant</div>
        <input aria-label="Subject" />
      </CollapsibleSection>,
    )

    const form = screen.getByTestId('grant-form')
    expect(form.tagName).toBe('FORM')
    expect(form).toHaveClass('collapsible-section', 'ps-content-card')

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse section' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(form).toHaveClass('is-collapsed')

    fireEvent.click(screen.getByRole('button', { name: 'Expand section' }))
    expect(container.querySelector('input')).toHaveValue('agent')
  })

  it('can start collapsed', () => {
    render(
      <CollapsibleSection title="History" defaultOpen={false}>
        <p>Old entries</p>
      </CollapsibleSection>,
    )
    expect(screen.getByText('Old entries')).not.toBeVisible()
  })
})

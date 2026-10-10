import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminShell } from '../AdminShell'

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'admin', roles: ['admin'] } }),
}))

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/admin/forms']}>
      <AdminShell />
    </MemoryRouter>,
  )
}

describe('AdminShell sidebar', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('collapses to a rail that hides the menu and expands again', () => {
    renderShell()
    expect(screen.getByRole('link', { name: 'Forms' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse administration menu' }))
    expect(screen.queryByRole('link', { name: 'Forms' })).not.toBeInTheDocument()
    expect(screen.queryByText('Administration')).not.toBeInTheDocument()

    const expand = screen.getByRole('button', { name: 'Expand administration menu' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(expand)
    expect(screen.getByRole('link', { name: 'Forms' })).toBeVisible()
  })

  it('remembers the collapsed state across visits', () => {
    const first = renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse administration menu' }))
    first.unmount()

    renderShell()
    expect(screen.getByRole('button', { name: 'Expand administration menu' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Forms' })).not.toBeInTheDocument()
  })
})

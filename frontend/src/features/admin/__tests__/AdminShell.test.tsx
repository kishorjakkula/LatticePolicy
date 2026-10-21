import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminShell } from '../AdminShell'

let currentUser: any = { username: 'admin', roles: ['admin'] }
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: currentUser }),
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
    currentUser = { username: 'admin', roles: ['admin'] }
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

function groupLinks(name: string) {
  const list = screen.getByRole('list', { name })
  return within(list).getAllByRole('link').map((link) => link.textContent)
}

describe('AdminShell grouped menu', () => {
  beforeEach(() => {
    window.localStorage.clear()
    currentUser = { username: 'admin', roles: ['admin'] }
  })

  it('shows four named groups with their items for an administrator', () => {
    renderShell()
    const nav = screen.getByRole('navigation', { name: 'Administration' })
    expect(within(nav).getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      'Products & rules', 'Partners', 'Operations', 'Platform',
    ])
    expect(groupLinks('Products & rules')).toEqual(['Forms', 'Validation Rules', 'Underwriting Rules', 'Underwriting Authority', 'Compliance'])
    expect(groupLinks('Partners')).toEqual(['Underwriting Companies', 'Agency Onboarding', 'Customers'])
    expect(groupLinks('Operations')).toEqual(['Jobs', 'Data Import', 'Operations Dashboard', 'Bordereaux', 'Reinsurance', 'Exposure'])
    expect(groupLinks('Platform')).toEqual(['Users', 'Security', 'Tenant', 'Notifications', 'LLM Releases', 'AI Audit'])
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/admin')
  })

  it('keeps each item behind its permission and drops empty groups', () => {
    currentUser = { username: 'compliance', roles: ['compliance_admin'] }
    renderShell()
    const nav = screen.getByRole('navigation', { name: 'Administration' })
    expect(within(nav).getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Products & rules'])
    expect(groupLinks('Products & rules')).toEqual(['Forms', 'Compliance'])
    expect(within(nav).queryByRole('link', { name: 'Users' })).not.toBeInTheDocument()
  })

  it('shows only Platform items to a technical administrator', () => {
    currentUser = { username: 'tech', roles: ['carrier_technical_admin'] }
    renderShell()
    const nav = screen.getByRole('navigation', { name: 'Administration' })
    expect(within(nav).getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Platform'])
    expect(groupLinks('Platform')).toEqual(['LLM Releases', 'AI Audit'])
  })
})

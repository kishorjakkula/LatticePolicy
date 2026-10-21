import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminHomePage, countExpiringGrants } from '../AdminHomePage'
import { adminApi } from '../../../api/admin.api'
import { apiUw } from '../../../api/uw.api'

let currentUser: any = { username: 'admin', roles: ['admin'] }
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: currentUser }),
}))

function isoInDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminHomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

let listJobRuns: ReturnType<typeof vi.spyOn>
let listForms: ReturnType<typeof vi.spyOn>
let listGrants: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  currentUser = { username: 'admin', roles: ['admin'] }
  listJobRuns = vi.spyOn(adminApi, 'listJobRuns').mockResolvedValue({ items: [] })
  listForms = vi.spyOn(adminApi, 'listForms').mockResolvedValue([])
  listGrants = vi.spyOn(apiUw, 'listAuthorityGrants').mockResolvedValue({ items: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AdminHomePage', () => {
  it('lists each item needing attention with a link to its page', async () => {
    listJobRuns.mockResolvedValue({ items: [{ run_id: 'r1' }, { run_id: 'r2' }] })
    listForms.mockResolvedValue([{ formId: 'f1' }])
    listGrants.mockResolvedValue({
      items: [
        { active: true, expiration_date: isoInDays(10) },
        { active: true, expiration_date: isoInDays(45) },
        { active: false, expiration_date: isoInDays(5) },
        { active: true, expiration_date: null },
      ],
    })
    renderHome()

    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument()
    const jobs = await screen.findByText('2 failed job runs dead-lettered')
    expect(within(jobs.closest('li')!).getByRole('link', { name: 'Review jobs' })).toHaveAttribute('href', '/admin/jobs')
    const forms = screen.getByText('1 form awaiting approval')
    expect(within(forms.closest('li')!).getByRole('link', { name: 'Review forms' })).toHaveAttribute('href', '/admin/forms')
    const authority = screen.getByText('1 underwriting authority grant expires within 30 days')
    expect(within(authority.closest('li')!).getByRole('link', { name: 'Review authority' })).toHaveAttribute('href', '/admin/underwriting-authority')
    expect(screen.queryByText('Nothing needs attention')).not.toBeInTheDocument()

    expect(listJobRuns).toHaveBeenCalledWith({ status: 'DeadLettered', limit: 200 })
    expect(listForms).toHaveBeenCalledWith({ status: 'Reviewed' })
  })

  it('shows the empty state when nothing needs attention', async () => {
    renderHome()
    expect(await screen.findByText('Nothing needs attention')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows "200+" when the job list reaches the API limit', async () => {
    listJobRuns.mockResolvedValue({ items: Array.from({ length: 200 }, (_, i) => ({ run_id: `r${i}` })) })
    renderHome()
    expect(await screen.findByText('200+ failed job runs dead-lettered')).toBeInTheDocument()
  })

  it('hides checks and makes no request without permission', async () => {
    currentUser = { username: 'forms', roles: ['forms_admin'] }
    listForms.mockResolvedValue([{ formId: 'f1' }, { formId: 'f2' }])
    renderHome()
    expect(await screen.findByText('2 forms awaiting approval')).toBeInTheDocument()
    expect(listJobRuns).not.toHaveBeenCalled()
    expect(listGrants).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: 'Review jobs' })).not.toBeInTheDocument()
  })

  it('shows the empty state for an admin user with no permitted checks', async () => {
    currentUser = { username: 'notify', roles: ['notification_admin'] }
    renderHome()
    expect(await screen.findByText('Nothing needs attention')).toBeInTheDocument()
    expect(listJobRuns).not.toHaveBeenCalled()
    expect(listForms).not.toHaveBeenCalled()
    expect(listGrants).not.toHaveBeenCalled()
  })

  it('shows an inline error with Retry when a check fails', async () => {
    listJobRuns.mockRejectedValueOnce(new Error('500')).mockResolvedValue({ items: [{ run_id: 'r1' }] })
    renderHome()
    const error = await screen.findByText('Could not check failed jobs.')
    expect(screen.queryByText('Nothing needs attention')).not.toBeInTheDocument()
    fireEvent.click(within(error.closest('li')!).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('1 failed job run dead-lettered')).toBeInTheDocument()
    await waitFor(() => expect(listJobRuns).toHaveBeenCalledTimes(2))
  })
})

describe('countExpiringGrants', () => {
  const today = new Date(2026, 9, 20)
  it('counts active grants expiring from today through 30 days, inclusive', () => {
    expect(countExpiringGrants([
      { active: true, expiration_date: '2026-10-20' },
      { active: true, expiration_date: '2026-11-19T00:00:00.000Z' },
      { active: true, expiration_date: '2026-11-20' },
      { active: true, expiration_date: '2026-10-19' },
      { active: false, expiration_date: '2026-10-25' },
      { active: true, expiration_date: null },
      { active: true },
    ], today)).toBe(2)
  })
})

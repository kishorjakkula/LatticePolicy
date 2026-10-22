import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppNav, buildAppNavModel } from '../AppNav'
import { apiUw } from '../../api/client'
import { apiSubmissions } from '../../api/submissions.api'
import { useAuthStore } from '../../store/auth.store'

let currentUser: any = null
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: currentUser }),
}))

const users = {
  admin: { username: 'admin', roles: ['admin'] },
  agent: { username: 'agent1', roles: ['agent'] },
  underwriter: { username: 'uw1', roles: ['underwriter'] },
  actuary: { username: 'actuary1', roles: ['actuary'] },
  customer: { username: 'cust', roles: ['customer'], customerId: 'c-1' },
}

function renderNav(path = '/search') {
  useAuthStore.setState({ user: currentUser ? { ...currentUser, id: currentUser.username, tenantId: 'sample-carrier' } : null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppNav />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function mainNav() {
  return screen.getByRole('navigation', { name: 'Main' })
}

function topLevelLabels() {
  const nav = mainNav()
  return Array.from(nav.children).map((child) => {
    const label = child.querySelector('.app-nav-label')
    return label?.textContent ?? ''
  })
}

let listReferrals: ReturnType<typeof vi.spyOn>
let listSubmissions: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  listReferrals = vi.spyOn(apiUw, 'listReferrals').mockResolvedValue({ items: [], total: 4, page: 1, pageSize: 1 })
  listSubmissions = vi.spyOn(apiSubmissions, 'list').mockResolvedValue({ items: [], total: 3, page: 1, pageSize: 1, statusCounts: {} })
})

afterEach(() => {
  vi.restoreAllMocks()
  currentUser = null
  useAuthStore.setState({ user: null, token: null })
})

describe('AppNav model per role', () => {
  it('admin sees Home, Work, Policies, Customers, Rating and Admin', () => {
    const model = buildAppNavModel(users.admin)
    expect(model.map((entry) => entry.label)).toEqual(['Home', 'Work', 'Policies', 'Customers', 'Rating', 'Admin'])
    const work = model.find((entry) => entry.kind === 'group')
    expect(work && work.kind === 'group' && work.items.map((item) => item.label)).toEqual(['Submissions', 'Referrals', 'Placements'])
  })

  it('agent sees Submissions under Work but no Referrals, Placements, Customers, Rating or Admin', () => {
    const model = buildAppNavModel(users.agent)
    expect(model.map((entry) => entry.label)).toEqual(['Home', 'Work', 'Policies'])
    const work = model.find((entry) => entry.kind === 'group')
    expect(work && work.kind === 'group' && work.items.map((item) => item.label)).toEqual(['Submissions'])
  })

  it('underwriter sees all three Work items and no Admin', () => {
    const model = buildAppNavModel(users.underwriter)
    expect(model.map((entry) => entry.label)).toEqual(['Home', 'Work', 'Policies'])
    const work = model.find((entry) => entry.kind === 'group')
    expect(work && work.kind === 'group' && work.items.map((item) => item.label)).toEqual(['Submissions', 'Referrals', 'Placements'])
  })

  it('actuary sees only Rating, and the empty Work group is dropped', () => {
    expect(buildAppNavModel(users.actuary).map((entry) => entry.label)).toEqual(['Rating'])
  })

  it('customer sees Portal only when they have a customer identity', () => {
    expect(buildAppNavModel(users.customer).map((entry) => entry.label)).toEqual(['Portal'])
    expect(buildAppNavModel({ ...users.customer, customerId: undefined }).map((entry) => entry.label)).toEqual([])
  })

  it('a menu permission alone is not enough when the page permission is missing', () => {
    const model = buildAppNavModel({ roles: ['custom'], permissions: ['menu.uw_queue.view', 'menu.search.view'] })
    expect(model.map((entry) => entry.label)).toEqual(['Home', 'Policies'])
  })

  it('no user sees nothing', () => {
    expect(buildAppNavModel(null)).toEqual([])
  })
})

describe('AppNav rendering', () => {
  it('renders the admin header in order with a closed Work menu', () => {
    currentUser = users.admin
    renderNav()
    expect(topLevelLabels()).toEqual(['Home', 'Work', 'Policies', 'Customers', 'Rating', 'Admin'])
    const work = within(mainNav()).getByRole('button', { name: 'Work' })
    expect(work).toHaveAttribute('aria-expanded', 'false')
    expect(within(mainNav()).queryByRole('link', { name: /Referrals/ })).not.toBeInTheDocument()
  })

  it('opens the Work menu, shows counts with accessible text, and closes on Escape', async () => {
    currentUser = users.admin
    renderNav()
    const work = within(mainNav()).getByRole('button', { name: 'Work' })
    fireEvent.click(work)
    expect(work).toHaveAttribute('aria-expanded', 'true')

    const referrals = await within(mainNav()).findByRole('link', { name: 'Referrals, 4 open' })
    expect(referrals).toHaveAttribute('href', '/uw/queue')
    expect(referrals).toHaveTextContent('Referrals4')
    expect(within(mainNav()).getByRole('link', { name: 'Submissions, 3 to review' })).toHaveAttribute('href', '/submissions')
    expect(within(mainNav()).getByRole('link', { name: 'Placements' })).toHaveAttribute('href', '/placements')

    expect(listReferrals).toHaveBeenCalledWith(1, 1, 'Open')
    expect(listSubmissions).toHaveBeenCalledWith('READY_FOR_REVIEW', 1, 1)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(work).toHaveAttribute('aria-expanded', 'false')
    expect(work).toHaveFocus()
  })

  it('shows no count before the request answers (never a default 0)', () => {
    currentUser = users.admin
    listReferrals.mockReturnValue(new Promise(() => {}))
    renderNav()
    fireEvent.click(within(mainNav()).getByRole('button', { name: 'Work' }))
    expect(within(mainNav()).getByRole('link', { name: 'Referrals' })).not.toHaveTextContent(/\d/)
  })

  it('agent without referral permission sees no Referrals and makes no referral count request', async () => {
    currentUser = users.agent
    renderNav()
    fireEvent.click(within(mainNav()).getByRole('button', { name: 'Work' }))
    expect(await within(mainNav()).findByRole('link', { name: 'Submissions, 3 to review' })).toBeInTheDocument()
    expect(within(mainNav()).queryByRole('link', { name: /Referrals/ })).not.toBeInTheDocument()
    expect(within(mainNav()).queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()
    expect(listReferrals).not.toHaveBeenCalled()
  })

  it('actuary makes no count requests at all', () => {
    currentUser = users.actuary
    renderNav('/rating')
    expect(listReferrals).not.toHaveBeenCalled()
    expect(listSubmissions).not.toHaveBeenCalled()
  })

  it('hides the badge and keeps the link when the count request fails', async () => {
    currentUser = users.underwriter
    listReferrals.mockRejectedValue(new Error('boom'))
    renderNav()
    fireEvent.click(within(mainNav()).getByRole('button', { name: 'Work' }))
    await within(mainNav()).findByRole('link', { name: 'Submissions, 3 to review' })
    await waitFor(() => expect(listReferrals).toHaveBeenCalled())
    const referrals = within(mainNav()).getByRole('link', { name: 'Referrals' })
    expect(referrals).toHaveAttribute('href', '/uw/queue')
    expect(referrals.querySelector('.app-nav-count')).toBeNull()
  })

  it('ignores a malformed total instead of showing it', async () => {
    currentUser = users.underwriter
    listReferrals.mockResolvedValue({ items: [], total: 'lots' })
    renderNav()
    fireEvent.click(within(mainNav()).getByRole('button', { name: 'Work' }))
    await within(mainNav()).findByRole('link', { name: 'Submissions, 3 to review' })
    expect(within(mainNav()).getByRole('link', { name: 'Referrals' }).querySelector('.app-nav-count')).toBeNull()
  })

  it('marks the active item for the current page', () => {
    currentUser = users.admin
    renderNav('/policies/abc')
    expect(within(mainNav()).getByRole('link', { name: 'Policies' })).toHaveAttribute('aria-current', 'page')
    expect(within(mainNav()).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })

  it('keeps Admin inactive on the customer list, which has its own item', () => {
    currentUser = users.admin
    renderNav('/admin/customers')
    expect(within(mainNav()).getByRole('link', { name: 'Customers' })).toHaveAttribute('aria-current', 'page')
    expect(within(mainNav()).getByRole('link', { name: 'Admin' })).not.toHaveAttribute('aria-current')
  })

  it('marks Work active on a referral page', () => {
    currentUser = users.admin
    renderNav('/uw/queue')
    expect(within(mainNav()).getByRole('button', { name: 'Work' })).toHaveClass('active')
  })
})

describe('AppNav phone sheet', () => {
  it('opens a sheet with the same groups and counts, and closes after navigating', async () => {
    currentUser = users.underwriter
    renderNav()
    const toggle = screen.getByRole('button', { name: 'Toggle navigation menu' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('navigation', { name: 'Menu' })).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const sheet = screen.getByRole('navigation', { name: 'Menu' })
    expect(within(sheet).getByRole('heading', { name: 'Work' })).toBeInTheDocument()
    const workList = within(sheet).getByRole('list', { name: 'Work' })
    expect(await within(workList).findByRole('link', { name: 'Referrals, 4 open' })).toBeInTheDocument()
    expect(within(workList).getByRole('link', { name: 'Submissions, 3 to review' })).toBeInTheDocument()
    expect(within(workList).getByRole('link', { name: 'Placements' })).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Policies' })).toBeInTheDocument()

    fireEvent.click(within(workList).getByRole('link', { name: 'Placements' }))
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Menu' })).not.toBeInTheDocument())
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})

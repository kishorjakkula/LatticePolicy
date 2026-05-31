import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AgencyOnboardingPage } from '../AgencyOnboardingPage'

const useAuthMock = vi.fn()
const hasPermissionMock = vi.fn()
const getOnboardingAgencyMock = vi.fn()
const useOnboardingAgenciesMock = vi.fn()
const refetchAgenciesMock = vi.fn()

const createAgencyMutateMock = vi.fn()
const updateAgencyMutateMock = vi.fn()
const createContactMutateMock = vi.fn()
const updateContactMutateMock = vi.fn()
const deleteContactMutateMock = vi.fn()

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}))

vi.mock('../../../auth/permissions', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}))

vi.mock('../../../api/client', () => ({
  adminApi: {
    getOnboardingAgency: (...args: any[]) => getOnboardingAgencyMock(...args),
  },
}))

vi.mock('../../../api/hooks', () => ({
  useOnboardingAgencies: (...args: any[]) => useOnboardingAgenciesMock(...args),
  useCreateOnboardingAgencyMutation: () => ({ mutateAsync: createAgencyMutateMock }),
  useUpdateOnboardingAgencyMutation: () => ({ mutateAsync: updateAgencyMutateMock }),
  useCreateOnboardingAgencyContactMutation: () => ({ mutateAsync: createContactMutateMock }),
  useUpdateOnboardingAgencyContactMutation: () => ({ mutateAsync: updateContactMutateMock }),
  useDeleteOnboardingAgencyContactMutation: () => ({ mutateAsync: deleteContactMutateMock }),
}))

function renderPage(initialEntries: string[] = ['/admin/onboarding']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/admin/onboarding/*" element={<AgencyOnboardingPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AgencyOnboardingPage', () => {
  const parentSearchRow = {
    agencyId: 'agency-1',
    agencyCode: 'AG-01',
    agencyKey: 'agency-01',
    parentAgencyId: 'agency-parent-1',
    parentAgencyCode: 'PARENT-01',
    parentAgencyName: 'Parent Agency 01',
    legalName: 'Agency 01',
    agencyType: 'INDEPENDENT',
    commissionRate: 12,
    status: 'PROSPECT',
    updatedAt: '2026-03-09T00:00:00.000Z',
  }

  const childRows = [
    {
      agencyId: 'agency-child-1',
      agencyCode: 'CH-01',
      agencyKey: 'child-01',
      parentAgencyId: 'agency-1',
      parentAgencyCode: 'AG-01',
      parentAgencyName: 'Agency 01',
      legalName: 'Child Agency 01',
      agencyType: 'INDEPENDENT',
      commissionRate: 10,
      status: 'ACTIVE',
      updatedAt: '2026-03-10T00:00:00.000Z',
    },
    {
      agencyId: 'agency-child-2',
      agencyCode: 'CH-02',
      agencyKey: 'child-02',
      parentAgencyId: 'agency-1',
      parentAgencyCode: 'AG-01',
      parentAgencyName: 'Agency 01',
      legalName: 'Child Agency 02',
      agencyType: 'INDEPENDENT',
      commissionRate: 11,
      status: 'ACTIVE',
      updatedAt: '2026-03-11T00:00:00.000Z',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    useAuthMock.mockReturnValue({ user: { roles: ['admin'] } })
    hasPermissionMock.mockReturnValue(true)
    refetchAgenciesMock.mockResolvedValue(undefined)
    useOnboardingAgenciesMock.mockImplementation((opts: any) => {
      if (opts?.parentAgencyId === 'agency-1') {
        return {
          data: childRows,
          isLoading: false,
          refetch: refetchAgenciesMock,
        }
      }
      return {
        data: [parentSearchRow],
        isLoading: false,
        refetch: refetchAgenciesMock,
      }
    })

    getOnboardingAgencyMock.mockImplementation((agencyId: string) => {
      if (agencyId === 'agency-child-1') {
        return Promise.resolve({
          agency: {
            agencyId: 'agency-child-1',
            agencyKey: 'child-01',
            agencyCode: 'CH-01',
            parentAgencyId: 'agency-1',
            parentAgencyCode: 'AG-01',
            parentAgencyName: 'Agency 01',
            legalName: 'Child Agency 01',
            dbaName: '',
            npn: '123456788',
            feinLast4: '1235',
            agencyType: 'INDEPENDENT',
            commissionRate: 10,
            status: 'ACTIVE',
            effectiveFrom: '',
            effectiveTo: '',
          },
          contacts: [],
        })
      }
      return Promise.resolve({
        agency: {
          agencyId: 'agency-1',
          agencyKey: 'agency-01',
          agencyCode: 'AG-01',
          parentAgencyId: 'agency-parent-1',
          parentAgencyCode: 'PARENT-01',
          parentAgencyName: 'Parent Agency 01',
          legalName: 'Agency 01',
          dbaName: '',
          npn: '123456789',
          feinLast4: '1234',
          agencyType: 'INDEPENDENT',
          commissionRate: 12,
          status: 'PROSPECT',
          effectiveFrom: '',
          effectiveTo: '',
        },
        contacts: [],
      })
    })
  })

  it('opens agency details in read-only mode when clicking View', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /View agency AG-01/i }))

    await waitFor(() => {
      expect(getOnboardingAgencyMock).toHaveBeenCalledWith('agency-1')
    })
    expect(await screen.findByRole('heading', { name: /View Agency/i })).toBeInTheDocument()
    expect(screen.getByDisplayValue('agency-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save Agency/i })).toBeDisabled()
    expect(screen.queryByRole('search')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /New Agency/i })).not.toBeInTheDocument()
  })

  it('shows parent agency in search results', () => {
    renderPage()
    expect(screen.getByText('PARENT-01 - Parent Agency 01')).toBeInTheDocument()
  })

  it('opens agency details in edit mode when clicking Edit', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /Edit agency AG-01/i }))

    await waitFor(() => {
      expect(getOnboardingAgencyMock).toHaveBeenCalledWith('agency-1')
    })
    expect(await screen.findByRole('heading', { name: /Edit Agency/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save Agency/i })).toBeEnabled()
    expect(screen.queryByRole('search')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /New Agency/i })).not.toBeInTheDocument()
  })

  it('shows child agencies and navigates to child edit', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /View agency AG-01/i }))
    expect(await screen.findByText('Child Agency 01')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Edit child agency CH-01/i }))

    await waitFor(() => {
      expect(getOnboardingAgencyMock).toHaveBeenCalledWith('agency-child-1')
    })
    expect(await screen.findByRole('heading', { name: /Edit Agency/i })).toBeInTheDocument()
    expect(screen.getByDisplayValue('agency-child-1')).toBeInTheDocument()
  })

  it('shows validation errors before creating an invalid agency', async () => {
    const user = userEvent.setup()
    useOnboardingAgenciesMock.mockImplementation((opts: any) => {
      if (opts?.parentAgencyId) {
        return { data: [], isLoading: false, refetch: refetchAgenciesMock }
      }
      return {
        data: [],
        isLoading: false,
        refetch: refetchAgenciesMock,
      }
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: /New Agency/i }))
    await user.click(screen.getByRole('button', { name: /Create Agency/i }))

    expect(await screen.findByText('Please correct the required fields before saving the agency.')).toBeInTheDocument()
    expect(createAgencyMutateMock).not.toHaveBeenCalled()
  })
})

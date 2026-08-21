import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { ReinsurancePage } from '../ReinsurancePage'

const useTreatiesMock = vi.fn()
const useFacultativeCertificatesMock = vi.fn()
const createTreatyMutateMock = vi.fn()
const createFacultativeMutateMock = vi.fn()

vi.mock('../../../api/hooks', () => ({
  useTreaties: (...args: any[]) => useTreatiesMock(...args),
  useCreateTreatyMutation: () => ({ mutateAsync: createTreatyMutateMock, isPending: false }),
  useFacultativeCertificates: (...args: any[]) => useFacultativeCertificatesMock(...args),
  useCreateFacultativeMutation: () => ({ mutateAsync: createFacultativeMutateMock, isPending: false }),
}))

describe('ReinsurancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTreatiesMock.mockReturnValue({
      data: {
        items: [
          {
            treaty_id: 'treaty-1',
            treaty_name: 'Quota Share 2026',
            treaty_type: 'QUOTA_SHARE',
            status: 'Active',
            effective_date: '2026-01-01',
            expiration_date: '2027-01-01',
            layers: [{ layerId: 'layer-1', layerNumber: 1, layerType: 'QUOTA_SHARE', cededPercent: '40', retainedPercent: '60' }],
          },
        ],
      },
      isLoading: false,
      error: null,
    })
    useFacultativeCertificatesMock.mockReturnValue({
      data: {
        items: [
          {
            certificate_id: 'cert-1',
            policy_id: 'policy-1',
            certificate_number: 'FAC-1',
            status: 'Active',
            effective_date: '2026-01-01',
            expiration_date: '2027-01-01',
            ceded_percent: '75',
            retained_percent: '25',
          },
        ],
      },
      isLoading: false,
      error: null,
    })
  })

  it('renders treaties by default', () => {
    render(<ReinsurancePage />)
    expect(screen.getByText('Reinsurance')).toBeInTheDocument()
    expect(screen.getByText('Quota Share 2026')).toBeInTheDocument()
    expect(screen.getByText('L1: 40% ceded')).toBeInTheDocument()
  })

  it('creates a new treaty from the form', async () => {
    const user = userEvent.setup()
    render(<ReinsurancePage />)

    await user.type(screen.getByLabelText('Treaty Name'), 'Surplus Treaty 2026')
    await user.type(screen.getByLabelText('Effective'), '2026-01-01')
    await user.type(screen.getByLabelText('Expiration'), '2027-01-01')
    await user.type(screen.getByLabelText('Ceded %'), '30')
    await user.type(screen.getByLabelText('Retained %'), '70')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(createTreatyMutateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          treatyName: 'Surplus Treaty 2026',
          effectiveDate: '2026-01-01',
          expirationDate: '2027-01-01',
          layers: [expect.objectContaining({ cededPercent: 30, retainedPercent: 70 })],
        })
      )
    })
  })

  it('switches to the facultative certificates tab', async () => {
    const user = userEvent.setup()
    render(<ReinsurancePage />)

    await user.click(screen.getByRole('button', { name: 'Facultative Certificates' }))
    expect(screen.getByText('FAC-1')).toBeInTheDocument()
    expect(screen.getByText('policy-1')).toBeInTheDocument()
  })

  it('creates a new facultative certificate from the form', async () => {
    const user = userEvent.setup()
    render(<ReinsurancePage />)

    await user.click(screen.getByRole('button', { name: 'Facultative Certificates' }))
    await user.type(screen.getByLabelText('Policy ID'), 'policy-42')
    await user.type(screen.getByLabelText('Effective'), '2026-02-01')
    await user.type(screen.getByLabelText('Expiration'), '2027-02-01')
    await user.type(screen.getByLabelText('Ceded %'), '50')
    await user.type(screen.getByLabelText('Retained %'), '50')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(createFacultativeMutateMock).toHaveBeenCalledWith(
        expect.objectContaining({ policyId: 'policy-42', cededPercent: 50, retainedPercent: 50 })
      )
    })
  })
})

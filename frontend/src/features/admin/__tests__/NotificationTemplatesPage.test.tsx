import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { NotificationTemplatesPage } from '../NotificationTemplatesPage'

const useNotificationTemplatesMock = vi.fn()
const createMutateMock = vi.fn()
const updateMutateMock = vi.fn()
const setActiveMutateMock = vi.fn()
const previewMutateMock = vi.fn()

vi.mock('../../../api/hooks', () => ({
  useNotificationTemplates: (...args: any[]) => useNotificationTemplatesMock(...args),
  useCreateNotificationTemplateMutation: () => ({ mutateAsync: createMutateMock, isPending: false }),
  useUpdateNotificationTemplateMutation: () => ({ mutateAsync: updateMutateMock, isPending: false }),
  useSetNotificationTemplateActiveMutation: () => ({ mutateAsync: setActiveMutateMock }),
  usePreviewNotificationTemplateMutation: () => ({ mutateAsync: previewMutateMock, isPending: false }),
}))

const sampleTemplate = {
  templateId: 'tmpl-1',
  templateCode: 'pa-cancel-ca',
  eventType: 'POLICY_CANCELLED',
  channel: 'EMAIL',
  productCode: 'personal-auto',
  transactionType: 'Cancellation',
  locale: 'en-US',
  subjectTemplate: 'Policy {{policyNumber}} cancellation notice',
  bodyTemplate: 'Policy {{policyNumber}} cancelled effective {{effectiveDate}}. Reason: {{reason}}.',
  visibility: ['customer'],
  active: true,
  effectiveDate: null,
  expirationDate: null,
}

describe('NotificationTemplatesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useNotificationTemplatesMock.mockReturnValue({ data: [sampleTemplate], isLoading: false, error: null })
  })

  it('lists existing notification templates', () => {
    render(<NotificationTemplatesPage />)

    expect(screen.getByText('pa-cancel-ca')).toBeInTheDocument()
    expect(screen.getByText('POLICY_CANCELLED')).toBeInTheDocument()
    expect(screen.getByText('personal-auto / Cancellation')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('shows an empty state when no templates are configured', () => {
    useNotificationTemplatesMock.mockReturnValue({ data: [], isLoading: false, error: null })
    render(<NotificationTemplatesPage />)
    expect(screen.getByText('No notification templates configured.')).toBeInTheDocument()
  })

  it('deactivates an active template from the row action', async () => {
    const user = userEvent.setup()
    setActiveMutateMock.mockResolvedValue({ ...sampleTemplate, active: false })
    render(<NotificationTemplatesPage />)

    await user.click(screen.getByRole('button', { name: 'Deactivate' }))

    await waitFor(() => {
      expect(setActiveMutateMock).toHaveBeenCalledWith({ id: 'tmpl-1', active: false })
    })
  })

  it('loads a template into the form for editing', async () => {
    const user = userEvent.setup()
    render(<NotificationTemplatesPage />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByDisplayValue('pa-cancel-ca')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Policy {{policyNumber}} cancellation notice')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument()
  })

  it('creates a new template from the form', async () => {
    const user = userEvent.setup()
    createMutateMock.mockResolvedValue({ ...sampleTemplate, templateId: 'tmpl-2', templateCode: 'pa-issued-tx' })
    render(<NotificationTemplatesPage />)

    await user.type(screen.getByPlaceholderText('pa-cancel-ca'), 'pa-issued-tx')
    // fireEvent.change (not userEvent.type) for mustache text: userEvent.type
    // parses `{`/`}` as special key syntax, which would corrupt the literal
    // `{{policyNumber}}` placeholders.
    fireEvent.change(screen.getByPlaceholderText('POLICY_CANCELLED'), { target: { value: 'POLICY_ISSUED' } })
    fireEvent.change(screen.getByPlaceholderText('Policy {{policyNumber}} cancellation notice'), {
      target: { value: 'Policy {{policyNumber}} issued' },
    })
    fireEvent.change(
      screen.getByPlaceholderText('Policy {{policyNumber}} is cancelled effective {{effectiveDate}}. Reason: {{reason}}.'),
      { target: { value: 'Issued body' } }
    )

    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(createMutateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          templateCode: 'pa-issued-tx',
          eventType: 'POLICY_ISSUED',
          subjectTemplate: 'Policy {{policyNumber}} issued',
          bodyTemplate: 'Issued body',
        })
      )
    })
  })

  it('renders a preview using sample merge fields', async () => {
    const user = userEvent.setup()
    previewMutateMock.mockResolvedValue({ subject: 'Rendered subject', body: 'Rendered body' })
    render(<NotificationTemplatesPage />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(previewMutateMock).toHaveBeenCalled()
    })
    expect(await screen.findByText('Rendered subject', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Rendered body', { exact: false })).toBeInTheDocument()
  })
})

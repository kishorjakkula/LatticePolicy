import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ValidationAcknowledgeDialog, ValidationFindings, fieldLabel } from '../ValidationFindings'
import { validationStopFrom } from '../../../api/validation-rules.api'

const finding = (ruleCode: string, severity: 'error' | 'warning', message: string, fieldPath: string | null = null) => ({
  ruleCode,
  severity,
  message,
  fieldPath,
  screen: null,
})

describe('validation findings', () => {
  it('separates errors that must be fixed from warnings', () => {
    render(
      <ValidationFindings
        title="Checks for this screen"
        errors={[finding('EMAIL', 'error', 'Email is required', 'applicant.email')]}
        warnings={[finding('VIN', 'warning', 'Check the VIN', 'risks.1.vin'), finding('ZIP', 'warning', 'Check ZIP')]}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('1 error must be fixed')
    expect(screen.getByRole('alert')).toHaveTextContent('Email is required')
    expect(screen.getByRole('status')).toHaveTextContent('2 warnings')
    expect(screen.getByText('Risk 2 › Vin')).toBeInTheDocument()
  })

  it('renders nothing when every check passes', () => {
    const { container } = render(<ValidationFindings title="Checks" errors={[]} warnings={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('labels payload paths for people', () => {
    expect(fieldLabel('mailingAddress.zip')).toBe('Mailing Address › Zip')
    expect(fieldLabel('insureds.0.email')).toBe('Insured 1 › Email')
    expect(fieldLabel('transaction.reasonCode', { 'transaction.reasonCode': 'Cancellation reason' })).toBe('Cancellation reason')
  })

  it('requires an explicit acknowledgement before continuing past warnings', () => {
    const onConfirm = vi.fn()
    render(
      <ValidationAcknowledgeDialog
        action="bind"
        warnings={[finding('A', 'warning', 'First'), finding('A', 'warning', 'First again', 'risks.0.vin'), finding('B', 'warning', 'Second')]}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )
    const continueButton = screen.getByRole('button', { name: 'Acknowledge and bind' })
    expect(continueButton).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/I reviewed these warnings/))
    fireEvent.click(continueButton)
    expect(onConfirm).toHaveBeenCalledWith(['A', 'B'])
  })

  it('reads a validation stop from an API error and ignores other errors', () => {
    const body = {
      code: 'VALIDATION_WARNINGS_UNACKNOWLEDGED',
      details: { level: 'issue', transactionType: 'cancellation', errors: [], warnings: [finding('W', 'warning', 'Check')], pending: [finding('W', 'warning', 'Check')] },
    }
    const stop = validationStopFrom(new Error(`API POST /v1/policies/1/cancel failed 409: ${JSON.stringify(body)}`))
    expect(stop).toMatchObject({ code: 'VALIDATION_WARNINGS_UNACKNOWLEDGED', level: 'issue', transactionType: 'cancellation', pending: [{ ruleCode: 'W' }] })
    expect(validationStopFrom(new Error('API POST /v1/quotes failed 400: {"code":"INVALID_QUOTE"}'))).toBeNull()
    expect(validationStopFrom(new Error('network down'))).toBeNull()
  })
})

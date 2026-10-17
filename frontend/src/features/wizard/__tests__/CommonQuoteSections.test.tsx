import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { AdditionalInterestsFields, BillingFields, commonFieldsFromPayload, CommonQuoteSummary, defaultInterestRole, MailingAddressFields, type CommonQuoteFields } from '../CommonQuoteSections'

function Harness({ initial, productCode = 'homeowners', onState }: { initial: CommonQuoteFields; productCode?: string; onState: (value: CommonQuoteFields) => void }) {
  const [value, setValue] = useState<CommonQuoteFields>(initial)
  const set = (next: CommonQuoteFields) => { setValue(next); onState(next) }
  return (
    <>
      <BillingFields value={value} onChange={set} />
      <MailingAddressFields value={value} onChange={set} insuredAddress={{ street: '9 Oak St', city: 'Austin', state: 'TX', zip: '78704' }} />
      <AdditionalInterestsFields value={value} onChange={set} productCode={productCode} />
      <CommonQuoteSummary value={value} />
    </>
  )
}

describe('common quote sections', () => {
  it('reads common fields back from a saved payload with safe defaults', () => {
    const fields = commonFieldsFromPayload({ paymentPlan: 'monthly', yearsWithPriorCarrier: 4, additionalInterests: [{ role: 'MORTGAGEE', name: 'First Federal' }, { role: 'BOGUS', name: 'X' }] })
    expect(fields).toMatchObject({ paymentPlan: 'monthly', yearsWithPriorCarrier: '4', billingMethod: '', mailingAddress: { street: '', city: '', state: '', zip: '' } })
    expect(fields.additionalInterests?.map((item) => item.role)).toEqual(['MORTGAGEE', 'ADDITIONAL_INTEREST'])
  })

  it('defaults the interest type to what the product usually has', () => {
    expect(defaultInterestRole('homeowners')).toBe('MORTGAGEE')
    expect(defaultInterestRole('personal-auto')).toBe('LOSS_PAYEE')
    expect(defaultInterestRole('cyber')).toBe('ADDITIONAL_INSURED')
  })

  it('edits billing, copies the insured address, and adds and removes interests', () => {
    const onState = vi.fn()
    render(<Harness initial={commonFieldsFromPayload({})} onState={onState} />)

    fireEvent.click(screen.getByRole('radio', { name: /Direct bill/ }))
    fireEvent.change(screen.getByLabelText('Payment Plan'), { target: { value: 'quarterly' } })
    fireEvent.click(screen.getByRole('button', { name: "Use the insured's address" }))
    expect(screen.getByLabelText('City')).toHaveValue('Austin')

    fireEvent.click(screen.getByRole('button', { name: 'Add additional interest' }))
    expect(screen.getByLabelText('Type')).toHaveValue('MORTGAGEE')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'First Federal Bank' } })
    fireEvent.change(screen.getByLabelText('Loan / Reference Number'), { target: { value: 'L-77' } })
    expect(screen.getByText('Mortgagee: First Federal Bank (L-77)')).toBeInTheDocument()
    expect(screen.getByText('Direct bill · Quarterly (4 payments)')).toBeInTheDocument()

    const last = onState.mock.calls[onState.mock.calls.length - 1][0] as CommonQuoteFields
    expect(last).toMatchObject({ billingMethod: 'direct', paymentPlan: 'quarterly', mailingAddress: { street: '9 Oak St', zip: '78704' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove additional interest 1' }))
    expect(screen.getByText('No additional interests.')).toBeInTheDocument()
  })
})

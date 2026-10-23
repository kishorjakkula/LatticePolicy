import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { RerateNotice, serverErrorCode } from '../QuoteWizard'

// WP-0008 REQ-5: the wizard asks for a new rating instead of failing at bind.

describe('serverErrorCode', () => {
  it('reads the code from the error or from the JSON envelope in its message', () => {
    expect(serverErrorCode({ code: 'QUOTE_RERATE_REQUIRED' })).toBe('QUOTE_RERATE_REQUIRED')
    expect(serverErrorCode(new Error('409 Conflict: {"code":"QUOTE_RERATE_REQUIRED","message":"The quote changed after it was rated."}'))).toBe('QUOTE_RERATE_REQUIRED')
    expect(serverErrorCode(new Error('Network down'))).toBeNull()
    expect(serverErrorCode(new Error('bad {json'))).toBeNull()
    expect(serverErrorCode(null)).toBeNull()
  })
})

describe('RerateNotice', () => {
  it('on Premium explains the change and offers Rate again', async () => {
    const onRate = vi.fn()
    render(<RerateNotice onRate={onRate} />)
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('Your changes need a new rating')
    expect(notice).toHaveTextContent('Risk details changed after this quote was rated.')
    await userEvent.click(screen.getByRole('button', { name: 'Rate again' }))
    expect(onRate).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Go to Premium' })).not.toBeInTheDocument()
  })

  it('disables Rate again while rating', () => {
    render(<RerateNotice onRate={vi.fn()} busy />)
    expect(screen.getByRole('button', { name: 'Rate again' })).toBeDisabled()
  })

  it('on Forms & documents points back to Premium', async () => {
    const onGoToPremium = vi.fn()
    render(<RerateNotice onGoToPremium={onGoToPremium} />)
    expect(screen.getByRole('status')).toHaveTextContent('This quote changed after it was rated.')
    await userEvent.click(screen.getByRole('button', { name: 'Go to Premium' }))
    expect(onGoToPremium).toHaveBeenCalled()
  })
})

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { ConfirmDialog, ReasonDialog, useConfirmDialog, useReasonDialog } from '../Dialog'

describe('ReasonDialog', () => {
  it('focuses the labelled field, requires a reason, and submits it trimmed', async () => {
    const onConfirm = vi.fn()
    render(<ReasonDialog title="Approve referral" confirmLabel="Approve" onConfirm={onConfirm} onCancel={vi.fn()} />)
    const field = screen.getByLabelText('Reason (required)')
    expect(screen.getByRole('dialog', { name: 'Approve referral' })).toBeInTheDocument()
    expect(field).toHaveFocus()

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a reason.')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(onConfirm).not.toHaveBeenCalled()

    await userEvent.type(field, '  Roof replaced 2024  ')
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onConfirm).toHaveBeenCalledWith('Roof replaced 2024')
  })

  it('allows a blank optional reason', async () => {
    const onConfirm = vi.fn()
    render(<ReasonDialog title="Request info" confirmLabel="Send" optional onConfirm={onConfirm} onCancel={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onConfirm).toHaveBeenCalledWith('')
  })

  it('cancels on Escape without confirming', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ReasonDialog title="Decline" confirmLabel="Decline" onConfirm={onConfirm} onCancel={onCancel} />)
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('keeps the dialog open with the message when the action fails', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('Above your authority limit.'))
    render(<ReasonDialog title="Approve" confirmLabel="Approve" onConfirm={onConfirm} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Reason (required)'), 'ok')
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Above your authority limit.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('ReasonDialog secret field', () => {
  it('masks the value and sends it untrimmed', async () => {
    const onConfirm = vi.fn()
    render(<ReasonDialog title="Reset password" label="New password" confirmLabel="Reset password" secret onConfirm={onConfirm} onCancel={vi.fn()} />)
    const field = screen.getByLabelText('New password (required)')
    expect(field).toHaveAttribute('type', 'password')
    await userEvent.type(field, ' pass word ')
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(onConfirm).toHaveBeenCalledWith(' pass word ')
  })
})

describe('ConfirmDialog', () => {
  it('uses the danger style for destructive actions', () => {
    render(<ConfirmDialog title="Delete form?" confirmLabel="Delete" danger onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn-danger')
  })
})

describe.each(['confirm', 'reason'] as const)('%s dialog in flight', (kind) => {
  it('blocks dismissal and duplicate submissions, traps focus, and permits retry after failure', async () => {
    let reject: (error: Error) => void = () => {}
    const onConfirm = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail }))
      .mockResolvedValueOnce(undefined)
    const onCancel = vi.fn()
    const props = { title: 'Save decision', confirmLabel: 'Save', onConfirm, onCancel }
    render(kind === 'confirm' ? <ConfirmDialog {...props} /> : <ReasonDialog {...props} initialValue="Reviewed" />)
    const save = screen.getByRole('button', { name: 'Save' })
    await userEvent.dblClick(save)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(save).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await userEvent.keyboard('{Escape}{Tab}')
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    if (kind === 'reason') fireEvent.submit(save.closest('form')!)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await act(async () => { reject(new Error('Please retry')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Please retry')
    expect(save).toBeEnabled()
    if (kind === 'reason') expect(screen.getByLabelText('Reason (required)')).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    await userEvent.click(save)
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  it('wraps keyboard focus within enabled controls', async () => {
    const props = { title: 'Save decision', confirmLabel: 'Save', onConfirm: vi.fn(), onCancel: vi.fn() }
    render(kind === 'confirm' ? <ConfirmDialog {...props} /> : <ReasonDialog {...props} />)
    const first = kind === 'confirm' ? screen.getByRole('button', { name: 'Cancel' }) : screen.getByLabelText('Reason (required)')
    first.focus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
    await userEvent.tab()
    expect(first).toHaveFocus()
  })
})

function Harness({ onResult }: { onResult: (value: unknown) => void }) {
  const { dialog: reasonDialog, askReason } = useReasonDialog()
  const { dialog: confirmDialog, askConfirm } = useConfirmDialog()
  const [, force] = useState(0)
  return (
    <>
      <button type="button" onClick={async () => { onResult(await askReason({ title: 'Why?', confirmLabel: 'Save' })); force(1) }}>Ask reason</button>
      <button type="button" onClick={async () => { onResult(await askConfirm({ title: 'Sure?', confirmLabel: 'Yes' })) }}>Ask confirm</button>
      {reasonDialog}
      {confirmDialog}
    </>
  )
}

describe('dialog hooks', () => {
  it('resolve with the reason, null on cancel, and return focus to the trigger', async () => {
    const onResult = vi.fn()
    render(<Harness onResult={onResult} />)
    const trigger = screen.getByRole('button', { name: 'Ask reason' })
    await userEvent.click(trigger)
    await userEvent.type(screen.getByLabelText('Reason (required)'), 'Because')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith('Because'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(null))
  })

  it('confirm resolves true or false', async () => {
    const onResult = vi.fn()
    render(<Harness onResult={onResult} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ask confirm' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true))
    await userEvent.click(screen.getByRole('button', { name: 'Ask confirm' }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false))
  })
})

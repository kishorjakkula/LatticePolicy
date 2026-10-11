import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RadioGroup } from '../RadioGroup'

describe('framework RadioGroup', () => {
  it('keeps boolean values typed and exposes required/error context', () => {
    const onChange = vi.fn()
    function Harness() {
      const [value, setValue] = useState<boolean | undefined>()
      return <><span id="label">Licensed</span><span id="note">Choose an answer</span><RadioGroup name="licensed" layout="binary" labelledBy="label" describedBy="note" required invalid options={[{ value: true, label: 'Yes' }, { value: false, label: 'No' }]} value={value} onChange={(next) => { setValue(next); onChange(next) }} /></>
    }
    render(<Harness />)
    expect(screen.getByRole('radiogroup', { name: 'Licensed' })).toHaveAttribute('aria-required', 'true')
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true')
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }))
    fireEvent.click(screen.getByRole('radio', { name: 'No' }))
    expect(onChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('radio', { name: 'No' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Yes' })).not.toBeChecked()
  })

  it('supports enum options, blur validation, and disabled controls', () => {
    const onChange = vi.fn()
    const onBlur = vi.fn()
    const { rerender } = render(<RadioGroup name="occupancy" ariaLabel="Occupancy" options={[{ value: 'owner', label: 'Owner occupied' }, { value: 'tenant', label: 'Tenant occupied' }]} value="owner" onChange={onChange} onBlur={onBlur} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Tenant occupied' }))
    expect(onChange).toHaveBeenCalledWith('tenant')
    fireEvent.blur(screen.getByRole('radio', { name: 'Tenant occupied' }))
    expect(onBlur).toHaveBeenCalledOnce()
    rerender(<RadioGroup name="occupancy" ariaLabel="Occupancy" options={[{ value: 'owner', label: 'Owner occupied' }]} value="owner" onChange={onChange} disabled />)
    expect(screen.getByRole('radio')).toBeDisabled()
  })
})

import { useId } from 'react'

type Props<T> = {
  name: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: unknown
  onChange: (value: T) => void
  onBlur?: () => void
  ariaLabel?: string
  labelledBy?: string
  describedBy?: string
  required?: boolean
  invalid?: boolean
  disabled?: boolean
  layout?: 'binary' | 'choices'
  className?: string
}

/** Framework radio control: aligned options, native keyboard behavior, and accessible group naming. */
export function RadioGroup<T>({ name, options, value, onChange, onBlur, ariaLabel, labelledBy, describedBy, required, invalid, disabled, layout = 'choices', className = '' }: Props<T>) {
  const id = useId()
  return (
    <div className={`radio-group radio-group--${layout} ${className}`} role="radiogroup" aria-label={ariaLabel} aria-labelledby={labelledBy} aria-describedby={describedBy} aria-required={required || undefined} aria-invalid={invalid || undefined}>
      {options.map((option, index) => {
        const checked = value !== undefined && value !== null && String(value) === String(option.value)
        return (
          <label key={String(option.value)} className={`radio-option${checked ? ' selected' : ''}`} htmlFor={`${id}-${index}`}>
            <input id={`${id}-${index}`} type="radio" name={name} checked={checked} disabled={disabled} value={String(option.value)} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={() => onChange(option.value)} onBlur={onBlur} />
            <span>{option.label}</span>
          </label>
        )
      })}
    </div>
  )
}

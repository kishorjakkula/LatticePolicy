import { useId, useMemo, useState } from 'react'
import { evaluateScreen, getQuoteValue, type ProductScreen, type ScreenField, type ScreenState } from '@lattice-policy/rules'

/**
 * Renders a risk screen a carrier pack defines: sections or tabs, a column
 * grid, a widget per field, and the pack's visibility, required, and
 * validation rules. The same rules run on the API when the quote is rated
 * (`@lattice-policy/rules`), so what this form allows is what the API accepts.
 */

type Props = {
  screen: ProductScreen
  /** The whole quote; fields read and write by their path on it. */
  value: any
  onChange: (path: string, value: unknown) => void
  disabled?: boolean
  /** Show every problem, not only those on fields the user has already left. */
  showAllErrors?: boolean
}

/** Field problems keyed by field, plus step-level problems under this key. */
export const SCREEN_FORM_ERROR_KEY = '__screen'

export function screenErrors(screen: ProductScreen, quote: any): Record<string, string> {
  const state = evaluateScreen(screen, quote)
  const out: Record<string, string> = { ...state.errors }
  if (state.formErrors.length > 0) out[SCREEN_FORM_ERROR_KEY] = state.formErrors.join(' ')
  return out
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function formatValue(field: ScreenField, value: unknown): string {
  if (value === undefined || value === null || value === '') return '-'
  if (field.dataType === 'bool') {
    const flag = toBoolean(value)
    return flag === null ? String(value) : flag ? 'Yes' : 'No'
  }
  if (field.widget === 'currency' && Number.isFinite(Number(value))) {
    return Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
  }
  return String(value)
}

function FieldControl({ field, id, value, required, invalid, disabled, onChange, onBlur }: {
  field: ScreenField
  id: string
  value: unknown
  required: boolean
  invalid: boolean
  disabled: boolean
  onChange: (value: unknown) => void
  onBlur: () => void
}) {
  const common = {
    id,
    disabled: disabled || field.readOnly === true,
    'aria-required': required || undefined,
    'aria-invalid': invalid || undefined,
    'aria-describedby': `${id}-note`,
    onBlur,
  }
  const text = value === undefined || value === null ? '' : String(value)

  if (field.widget === 'checkbox') {
    return (
      <label className="cfg-check" htmlFor={id}>
        <input {...common} type="checkbox" checked={toBoolean(value) === true} onChange={(event) => onChange(event.target.checked)} />
        <span>{field.label}</span>
      </label>
    )
  }

  if (field.widget === 'radio') {
    const options: Array<{ value: unknown; label: string }> = field.dataType === 'bool'
      ? [{ value: true, label: 'Yes' }, { value: false, label: 'No' }]
      : (field.options || []).map((option) => ({ value: option, label: String(option) }))
    const current = field.dataType === 'bool' ? toBoolean(value) : value
    return (
      <div className="cfg-radios" role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={`${id}-note`}>
        {options.map((option) => (
          <label key={String(option.value)} className="cfg-check">
            <input
              type="radio"
              name={id}
              disabled={common.disabled}
              checked={String(current) === String(option.value)}
              onChange={() => onChange(option.value)}
              onBlur={onBlur}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    )
  }

  if (field.widget === 'select') {
    const options: Array<{ value: string; label: string }> = field.dataType === 'bool'
      ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
      : (field.options || []).map((option) => ({ value: String(option), label: String(option) }))
    return (
      <select
        {...common}
        value={text}
        onChange={(event) => {
          const next = event.target.value
          onChange(next === '' ? '' : field.dataType === 'bool' ? next === 'true' : next)
        }}
      >
        <option value="">Select…</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    )
  }

  if (field.widget === 'textarea') {
    return <textarea {...common} rows={3} value={text} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />
  }

  if (field.widget === 'number' || field.widget === 'currency') {
    const input = (
      <input
        {...common}
        type="number"
        inputMode="decimal"
        step={field.dataType === 'int' ? 1 : 'any'}
        value={text}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
      />
    )
    return field.widget === 'currency' ? <div className="cfg-currency"><span aria-hidden="true">$</span>{input}</div> : input
  }

  return (
    <input
      {...common}
      type={field.widget === 'date' ? 'date' : 'text'}
      value={text}
      placeholder={field.placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export function ConfiguredRiskForm({ screen, value, onChange, disabled = false, showAllErrors = false }: Props) {
  const formId = useId()
  const state: ScreenState = useMemo(() => evaluateScreen(screen, value), [screen, value])
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab] = useState(0)

  const visibleSections = screen.sections.map((section, index) => ({ section, index })).filter(({ index }) => state.sections[index])
  const errorFor = (key: string) => (showAllErrors || touched[key] ? state.errors[key] : undefined)
  const sectionErrorCount = (index: number) =>
    screen.sections[index].fields.filter((field) => state.fields[field.key]?.visible && errorFor(field.key)).length

  // Keep the selected tab valid when a rule hides it.
  const tabbed = screen.layout === 'tabs' && visibleSections.length > 1
  const current = visibleSections.find(({ index }) => index === activeTab) || visibleSections[0]

  const renderSection = ({ section, index }: { section: ProductScreen['sections'][number]; index: number }, withTitle: boolean) => (
    <div className="cfg-section" key={index}>
      {withTitle && section.title && <h4>{section.title}</h4>}
      {section.help && <p className="muted cfg-section-help">{section.help}</p>}
      <div className="cfg-grid" style={{ ['--cfg-columns' as any]: section.columns || 2 }}>
        {section.fields.filter((field) => state.fields[field.key]?.visible).map((field) => {
          const id = `${formId}-${field.key}`
          const required = state.fields[field.key].required
          const error = errorFor(field.key)
          return (
            <div className="cfg-field" key={field.key} style={{ ['--cfg-span' as any]: Math.min(field.span || 1, section.columns || 2) }}>
              {field.widget !== 'checkbox' && (
                <label id={`${id}-label`} htmlFor={field.widget === 'radio' ? undefined : id}>
                  {field.label}{required && <span className="cfg-required" aria-hidden="true"> *</span>}
                </label>
              )}
              <FieldControl
                field={field}
                id={id}
                value={getQuoteValue(value, field.path)}
                required={required}
                invalid={Boolean(error)}
                disabled={disabled}
                onChange={(next) => onChange(field.path, next)}
                onBlur={() => setTouched((previous) => (previous[field.key] ? previous : { ...previous, [field.key]: true }))}
              />
              <div id={`${id}-note`}>
                {error ? <div className="field-error-text" role="alert">{error}</div> : field.help ? <div className="muted">{field.help}</div> : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="cfg-form">
      {showAllErrors && state.formErrors.map((message) => (
        <div key={message} className="error" role="alert">{message}</div>
      ))}
      {tabbed ? (
        <>
          <div className="cfg-tabs" role="tablist" aria-label="Risk details">
            {visibleSections.map(({ section, index }) => {
              const count = sectionErrorCount(index)
              const selected = current?.index === index
              return (
                <button
                  key={index}
                  type="button"
                  role="tab"
                  id={`${formId}-tab-${index}`}
                  aria-selected={selected}
                  aria-controls={`${formId}-panel-${index}`}
                  className={selected ? 'cfg-tab cfg-tab-active' : 'cfg-tab'}
                  onClick={() => setActiveTab(index)}
                >
                  {section.title}
                  {count > 0 && <span className="cfg-tab-count" aria-label={`${count} to fix`}>{count}</span>}
                </button>
              )
            })}
          </div>
          {current && (
            <div role="tabpanel" id={`${formId}-panel-${current.index}`} aria-labelledby={`${formId}-tab-${current.index}`}>
              {renderSection(current, false)}
            </div>
          )}
        </>
      ) : (
        visibleSections.map((entry) => renderSection(entry, true))
      )}
    </div>
  )
}

/** Label and value for each field the screen currently shows; for review summaries. */
export function ConfiguredRiskSummary({ screen, value }: { screen: ProductScreen; value: any }) {
  const state = useMemo(() => evaluateScreen(screen, value), [screen, value])
  const fields = screen.sections.flatMap((section) => section.fields).filter((field) => state.fields[field.key]?.visible)
  if (fields.length === 0) return <div className="muted">No risk details defined for this product.</div>
  return (
    <>
      {fields.map((field) => (
        <div className="kvline" key={field.key}>
          <span className="muted">{field.label}</span>
          <span>{formatValue(field, getQuoteValue(value, field.path))}</span>
        </div>
      ))}
    </>
  )
}

import { RadioGroup } from '../../components/RadioGroup'
import { useId, useMemo, useState } from 'react'
import { evaluateScreen, getQuoteValue, type LookupTable, type ProductScreen, type ScreenField, type ScreenItemField, type ScreenState } from '@lattice-policy/rules'

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
  /** Carrier lookup tables the screen's rules read. */
  tables?: Tables
}

type Tables = Record<string, LookupTable>

/** Field problems keyed by field, plus step-level problems under this key. */
export const SCREEN_FORM_ERROR_KEY = '__screen'

export function screenErrors(screen: ProductScreen, quote: any, tables?: Tables): Record<string, string> {
  const state = evaluateScreen(screen, quote, tables)
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

function optionLabel(field: Pick<ScreenField, 'optionLabels'>, option: unknown): string {
  return field.optionLabels?.[String(option)] ?? String(option)
}

function formatValue(field: ScreenField, value: unknown): string {
  if (field.dataType === 'list') {
    const count = Array.isArray(value) ? value.length : 0
    return count === 0 ? '-' : `${count} ${count === 1 ? 'item' : 'items'}`
  }
  if (value === undefined || value === null || value === '') return '-'
  if (field.dataType === 'enum') return optionLabel(field, value)
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
      : (field.options || []).map((option) => ({ value: option, label: optionLabel(field, option) }))
    const current = field.dataType === 'bool' ? toBoolean(value) : value
    return (
      <RadioGroup
        className="cfg-radios"
        layout={field.dataType === 'bool' ? 'binary' : 'choices'}
        name={id}
        labelledBy={`${id}-label`}
        describedBy={`${id}-note`}
        required={required}
        invalid={invalid}
        options={options}
        value={current}
        disabled={common.disabled}
        onChange={onChange}
        onBlur={onBlur}
      />
    )
  }

  if (field.widget === 'select') {
    const options: Array<{ value: string; label: string }> = field.dataType === 'bool'
      ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
      : (field.options || []).map((option) => ({ value: String(option), label: optionLabel(field, option) }))
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

function ItemCell({ column, id, value, invalid, disabled, onChange, onBlur }: {
  column: ScreenItemField
  id: string
  value: unknown
  invalid: boolean
  disabled: boolean
  onChange: (value: unknown) => void
  onBlur: () => void
}) {
  const common = { id, disabled, 'aria-invalid': invalid || undefined, 'aria-required': column.required || undefined, onBlur }
  const text = value === undefined || value === null ? '' : String(value)
  if (column.dataType === 'bool') {
    return <input {...common} type="checkbox" checked={toBoolean(value) === true} onChange={(event) => onChange(event.target.checked)} />
  }
  if (column.dataType === 'enum') {
    return (
      <select {...common} value={text} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select…</option>
        {(column.options || []).map((option) => <option key={String(option)} value={String(option)}>{optionLabel(column, option)}</option>)}
      </select>
    )
  }
  if (column.dataType === 'int' || column.dataType === 'number') {
    return (
      <input
        {...common}
        type="number"
        inputMode="decimal"
        step={column.dataType === 'int' ? 1 : 'any'}
        value={text}
        onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
      />
    )
  }
  return <input {...common} type={column.dataType === 'date' ? 'date' : 'text'} value={text} onChange={(event) => onChange(event.target.value)} />
}

/** A list field: one row per item, one column per item field, with add and remove. */
function ListTable({ field, id, value, disabled, errorFor, onChange, onTouch }: {
  field: ScreenField
  id: string
  value: unknown
  disabled: boolean
  /** Message for a key such as `<list>.<row>.<column>`, when it should be shown. */
  errorFor: (key: string) => string | undefined
  onChange: (items: unknown[]) => void
  onTouch: (key: string) => void
}) {
  const columns = field.item || []
  const items: Array<Record<string, unknown>> = Array.isArray(value) ? value.map((item) => (item && typeof item === 'object' ? item : {})) : []
  const locked = disabled || field.readOnly === true
  const full = field.maxItems !== undefined && items.length >= field.maxItems
  const setCell = (row: number, key: string, cell: unknown) => onChange(items.map((item, index) => (index === row ? { ...item, [key]: cell } : item)))

  return (
    <div className="cfg-list">
      {items.length === 0 ? (
        <p className="muted cfg-list-empty">None added.</p>
      ) : (
        <div className="cfg-list-scroll">
          <table className="cfg-list-table" aria-labelledby={`${id}-label`}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} scope="col">{column.label}{column.required && <span className="cfg-required" aria-hidden="true"> *</span>}</th>
                ))}
                <th scope="col"><span className="cfg-visually-hidden">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, row) => {
                const rowError = errorFor(`${field.key}.${row}`)
                return (
                  <tr key={row}>
                    {columns.map((column) => {
                      const key = `${field.key}.${row}.${column.key}`
                      const error = errorFor(key)
                      return (
                        <td key={column.key}>
                          <label className="cfg-visually-hidden" htmlFor={`${id}-${row}-${column.key}`}>{`${column.label}, item ${row + 1}`}</label>
                          <ItemCell
                            column={column}
                            id={`${id}-${row}-${column.key}`}
                            value={item[column.key]}
                            invalid={Boolean(error)}
                            disabled={locked}
                            onChange={(cell) => setCell(row, column.key, cell)}
                            onBlur={() => onTouch(key)}
                          />
                          {error && <div className="field-error-text" role="alert">{error}</div>}
                        </td>
                      )
                    })}
                    <td className="cfg-list-actions">
                      <button type="button" className="btn-secondary" disabled={locked} aria-label={`Remove item ${row + 1}`} onClick={() => onChange(items.filter((_, index) => index !== row))}>
                        Remove
                      </button>
                      {rowError && <div className="field-error-text" role="alert">{rowError}</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className="btn-secondary" disabled={locked || full} onClick={() => onChange([...items, {}])}>
        Add {field.label.replace(/s$/, '').toLowerCase()}
      </button>
      {full && <span className="muted cfg-list-limit">Maximum of {field.maxItems} reached.</span>}
    </div>
  )
}

export function ConfiguredRiskForm({ screen, value, onChange, disabled = false, showAllErrors = false, tables }: Props) {
  const formId = useId()
  const state: ScreenState = useMemo(() => evaluateScreen(screen, value, tables), [screen, value, tables])
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab] = useState(0)

  const visibleSections = screen.sections.map((section, index) => ({ section, index })).filter(({ index }) => state.sections[index])
  const errorFor = (key: string) => (showAllErrors || touched[key] ? state.errors[key] : undefined)
  // A list reports problems under `<list>.<row>...` as well as under its own key.
  const sectionErrorCount = (index: number) =>
    screen.sections[index].fields
      .filter((field) => state.fields[field.key]?.visible)
      .reduce((count, field) => count + Object.keys(state.errors).filter((key) => (key === field.key || key.startsWith(`${field.key}.`)) && errorFor(key)).length, 0)
  const touch = (key: string) => setTouched((previous) => (previous[key] ? previous : { ...previous, [key]: true }))

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
            <div className="cfg-field" key={field.key} style={{ ['--cfg-span' as any]: field.widget === 'table' ? section.columns || 2 : Math.min(field.span || 1, section.columns || 2) }}>
              {field.widget !== 'checkbox' && (
                <label id={`${id}-label`} htmlFor={field.widget === 'radio' || field.widget === 'table' ? undefined : id}>
                  {field.label}{required && <span className="cfg-required" aria-hidden="true"> *</span>}
                </label>
              )}
              {field.widget === 'table' ? (
                <ListTable
                  field={field}
                  id={id}
                  value={getQuoteValue(value, field.path)}
                  disabled={disabled}
                  errorFor={errorFor}
                  onChange={(items) => {
                    touch(field.key)
                    onChange(field.path, items)
                  }}
                  onTouch={touch}
                />
              ) : (
              <FieldControl
                field={field}
                id={id}
                value={getQuoteValue(value, field.path)}
                required={required}
                invalid={Boolean(error)}
                disabled={disabled}
                onChange={(next) => onChange(field.path, next)}
                onBlur={() => touch(field.key)}
              />
              )}
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
export function ConfiguredRiskSummary({ screen, value, tables }: { screen: ProductScreen; value: any; tables?: Tables }) {
  const state = useMemo(() => evaluateScreen(screen, value, tables), [screen, value, tables])
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

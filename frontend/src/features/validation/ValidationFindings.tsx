import { useState } from 'react'
import type { ValidationFinding } from '@lattice-policy/rules'
import './validation.css'

/** Readable label for a payload path: risks.1.vin -> Risk 2 › Vin. */
export function fieldLabel(path: string | null, labels: Record<string, string> = {}): string {
  if (!path) return ''
  if (labels[path]) return labels[path]
  return path
    .split('.')
    .map((part, index, parts) => {
      if (/^\d+$/.test(part)) return null
      const next = parts[index + 1]
      const name = part.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
      return next && /^\d+$/.test(next) ? `${name.replace(/s$/, '')} ${Number(next) + 1}` : name
    })
    .filter(Boolean)
    .join(' › ')
}

/**
 * Errors (hard stops) and warnings (soft stops) from the carrier's validation
 * rules, for a screen or for a rate, bind or issue attempt.
 */
export function ValidationFindings({
  title,
  errors,
  warnings,
  labels,
}: {
  title: string
  errors: ValidationFinding[]
  warnings: ValidationFinding[]
  labels?: Record<string, string>
}) {
  if (!errors.length && !warnings.length) return null
  const item = (finding: ValidationFinding, index: number) => (
    <li key={`${finding.ruleCode}-${finding.fieldPath}-${index}`}>
      <span>{finding.message}</span>
      {finding.fieldPath && <span className="validation-findings__field">{fieldLabel(finding.fieldPath, labels)}</span>}
    </li>
  )
  return (
    <section className="validation-findings" aria-label={title}>
      <h4 className="validation-findings__title">{title}</h4>
      {errors.length > 0 && (
        <div className="validation-findings__group validation-findings__group--error" role="alert">
          <strong>{errors.length === 1 ? '1 error must be fixed' : `${errors.length} errors must be fixed`}</strong>
          <ul>{errors.map(item)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="validation-findings__group validation-findings__group--warning" role="status">
          <strong>{warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`}</strong>
          <ul>{warnings.map(item)}</ul>
        </div>
      )}
    </section>
  )
}

/**
 * Bind and issue stop on warnings until a person acknowledges them. Each
 * acknowledgement is recorded with who continued and when.
 */
export function ValidationAcknowledgeDialog({
  action,
  warnings,
  busy,
  onConfirm,
  onCancel,
  labels,
}: {
  action: string
  warnings: ValidationFinding[]
  busy?: boolean
  onConfirm: (ruleCodes: string[]) => void
  onCancel: () => void
  labels?: Record<string, string>
}) {
  const [confirmed, setConfirmed] = useState(false)
  const codes = [...new Set(warnings.map((warning) => warning.ruleCode))]
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="validation-ack-title">
      <div className="modal-panel">
        <div className="modal-header">
          <h3 id="validation-ack-title">Review warnings before you {action}</h3>
        </div>
        <p>These checks did not pass. You can continue, and your acknowledgement is recorded with your name.</p>
        <ul className="validation-ack__list">
          {warnings.map((warning, index) => (
            <li key={`${warning.ruleCode}-${index}`}>
              <span>{warning.message}</span>
              {warning.fieldPath && <span className="validation-findings__field">{fieldLabel(warning.fieldPath, labels)}</span>}
            </li>
          ))}
        </ul>
        <label className="validation-ack__confirm">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I reviewed
          these warnings and want to continue.
        </label>
        <div className="validation-ack__actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Go back
          </button>
          <button type="button" disabled={!confirmed || busy} onClick={() => onConfirm(codes)}>
            Acknowledge and {action}
          </button>
        </div>
      </div>
    </div>
  )
}

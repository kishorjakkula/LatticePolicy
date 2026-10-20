import { useState } from 'react'
import { usePolicyAsOf } from '../../api/hooks'
import { formatDisplayDate } from '../../shared/dateDisplay'
import { CollapsibleSection } from '../../components/CollapsibleSection'

function formatCurrency(value?: { amount: number; currency: string } | null): string {
  if (!value || !Number.isFinite(Number(value.amount))) return '-'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: value.currency || 'USD' }).format(Number(value.amount))
  } catch {
    return String(value.amount)
  }
}

interface PolicyAsOfControlProps {
  /** The date currently being viewed, or null for the live policy. */
  asOf: string | null
  onChange: (asOf: string | null) => void
}

/** "As of" date control for the policy header; drives PolicyAsOfResult. */
export function PolicyAsOfControl({ asOf, onChange }: PolicyAsOfControlProps) {
  const [asOfInput, setAsOfInput] = useState(asOf || '')

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    onChange(asOfInput || null)
  }

  function handleClear() {
    setAsOfInput('')
    onChange(null)
  }

  return (
    <form
      className="policy-asof-control"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
      onSubmit={handleSubmit}
      aria-label="View policy as of a date"
    >
      <label htmlFor="policy-asof-date" className="sr-only">
        As of date
      </label>
      <input
        id="policy-asof-date"
        type="date"
        value={asOfInput}
        onChange={(event) => setAsOfInput(event.target.value)}
      />
      <button type="submit" className="btn-secondary" disabled={!asOfInput}>
        View as of
      </button>
      {asOf ? (
        <button type="button" className="btn-secondary" onClick={handleClear}>
          Clear
        </button>
      ) : null}
    </form>
  )
}

interface PolicyAsOfResultProps {
  policyId: string
  asOf: string | null
}

/** Point-in-time snapshot for the date chosen in the header; nothing when no date is chosen. */
export function PolicyAsOfResult({ policyId, asOf }: PolicyAsOfResultProps) {
  const asOfState = usePolicyAsOf(policyId, asOf)
  if (!asOf) return null
  const shownDate = formatDisplayDate(asOf, { fallback: asOf })

  return (
    <CollapsibleSection
      title={`Policy as of ${shownDate}`}
      className="card stack-card policy-section-card policy-asof-panel"
      data-testid="policy-asof-panel"
    >
      {asOfState.isLoading ? (
        <p className="muted">Loading state as of {shownDate}...</p>
      ) : asOfState.error ? (
        <p className="muted" role="alert">
          Could not load policy state as of {shownDate}.
        </p>
      ) : asOfState.data ? (
        <div data-testid="policy-asof-result">
          <p className="muted">
            State as of {formatDisplayDate(asOfState.data.asOf, { fallback: asOf })} — this is a point-in-time
            snapshot and may differ from the current live policy state shown above.
          </p>
          <div className="row row-spaced">
            <div className="col">
              <div className="policy-summary-label">Segment Start</div>
              <div>{formatDisplayDate(asOfState.data.segmentStart, { fallback: '-' })}</div>
            </div>
            <div className="col">
              <div className="policy-summary-label">Segment End</div>
              <div>{formatDisplayDate(asOfState.data.segmentEnd, { fallback: '-' })}</div>
            </div>
            <div className="col">
              <div className="policy-summary-label">Premium Total</div>
              <div>{formatCurrency(asOfState.data.premium?.total)}</div>
            </div>
            <div className="col">
              <div className="policy-summary-label">Fees / Taxes</div>
              <div>
                {formatCurrency(asOfState.data.premium?.fees)} / {formatCurrency(asOfState.data.premium?.taxes)}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </CollapsibleSection>
  )
}

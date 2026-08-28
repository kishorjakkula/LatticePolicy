import { useState } from 'react'
import { usePolicyAsOf } from '../../api/hooks'
import { formatDisplayDate } from '../../shared/dateDisplay'

interface PolicyAsOfPanelProps {
  policyId: string
}

function formatCurrency(value?: { amount: number; currency: string } | null): string {
  if (!value || !Number.isFinite(Number(value.amount))) return '-'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: value.currency || 'USD' }).format(Number(value.amount))
  } catch {
    return String(value.amount)
  }
}

export function PolicyAsOfPanel({ policyId }: PolicyAsOfPanelProps) {
  const [asOfInput, setAsOfInput] = useState('')
  const [asOfQuery, setAsOfQuery] = useState<string | null>(null)

  const asOfState = usePolicyAsOf(policyId, asOfQuery)

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setAsOfQuery(asOfInput || null)
  }

  function handleClear() {
    setAsOfInput('')
    setAsOfQuery(null)
  }

  return (
    <div className="card stack-card policy-asof-panel" data-testid="policy-asof-panel">
      <details className="policy-collapsible">
        <summary className="policy-collapsible-summary">View policy as of a date</summary>
        <div className="policy-collapsible-body">
          <form className="row row-spaced" onSubmit={handleSubmit}>
            <div className="col">
              <label htmlFor="policy-asof-date">As of date</label>
              <input
                id="policy-asof-date"
                type="date"
                value={asOfInput}
                onChange={(event) => setAsOfInput(event.target.value)}
              />
            </div>
            <div className="col">
              <button type="submit" className="btn" disabled={!asOfInput}>
                View as of
              </button>
              {asOfQuery ? (
                <button type="button" className="btn btn-secondary" onClick={handleClear}>
                  Clear
                </button>
              ) : null}
            </div>
          </form>

          {asOfQuery ? (
            asOfState.isLoading ? (
              <p className="muted">Loading state as of {formatDisplayDate(asOfQuery, { fallback: asOfQuery })}...</p>
            ) : asOfState.error ? (
              <p className="muted" role="alert">
                Could not load policy state as of {formatDisplayDate(asOfQuery, { fallback: asOfQuery })}.
              </p>
            ) : asOfState.data ? (
              <div data-testid="policy-asof-result">
                <p className="muted">
                  State as of {formatDisplayDate(asOfState.data.asOf, { fallback: asOfQuery })} — this is a
                  point-in-time snapshot and may differ from the current live policy state shown above.
                </p>
                <div className="row row-spaced">
                  <div className="col">
                    <label>Segment Start</label>
                    <div>{formatDisplayDate(asOfState.data.segmentStart, { fallback: '-' })}</div>
                  </div>
                  <div className="col">
                    <label>Segment End</label>
                    <div>{formatDisplayDate(asOfState.data.segmentEnd, { fallback: '-' })}</div>
                  </div>
                  <div className="col">
                    <label>Premium Total</label>
                    <div>{formatCurrency(asOfState.data.premium?.total)}</div>
                  </div>
                  <div className="col">
                    <label>Fees / Taxes</label>
                    <div>
                      {formatCurrency(asOfState.data.premium?.fees)} / {formatCurrency(asOfState.data.premium?.taxes)}
                    </div>
                  </div>
                </div>
              </div>
            ) : null
          ) : null}
        </div>
      </details>
    </div>
  )
}

import { useState } from 'react'
import { useExposureSummary } from '../../api/hooks'

function GroupTable({ title, groups }: { title: string; groups: any[] }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ marginBottom: 8 }}>{title}</h3>
      {groups.length === 0 ? (
        <p className="muted">No exposure data for the current filters.</p>
      ) : (
        <table className="ps-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Policies</th>
              <th>Total TIV</th>
              <th>Vehicle/Fleet Count</th>
              <th>Cyber Annual Revenue</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key}>
                <td>{g.key}</td>
                <td>{g.policyCount}</td>
                <td>{g.totalTiv ? g.totalTiv.toLocaleString() : '—'}</td>
                <td>{g.totalVehicleFleetCount || '—'}</td>
                <td>{g.totalCyberAnnualRevenue ? g.totalCyberAnnualRevenue.toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function ExposurePage() {
  const [productCode, setProductCode] = useState('')
  const [state, setState] = useState('')
  const [asOf, setAsOf] = useState('')

  const { data, isLoading, error } = useExposureSummary({
    productCode: productCode || undefined,
    state: state || undefined,
    asOf: asOf || undefined,
  })

  return (
    <div className="ps-admin-page">
      <div className="ps-page-header">
        <div>
          <h2 className="ps-page-title">Exposure Management</h2>
          <p className="muted">Aggregate in-force exposure by product, jurisdiction, and class/industry.</p>
        </div>
      </div>

      <div className="row" style={{ gap: 12, marginBottom: 16 }}>
        <label>
          Product
          <input
            value={productCode}
            onChange={(e) => setProductCode(e.target.value)}
            placeholder="e.g. homeowners"
          />
        </label>
        <label>
          State
          <input value={state} onChange={(e) => setState(e.target.value.toUpperCase())} maxLength={2} placeholder="e.g. TX" />
        </label>
        <label>
          As Of
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
      </div>

      {error && <p className="error">{String(error)}</p>}
      {isLoading && <p>Loading exposure summary…</p>}

      {!isLoading && data && (
        <>
          <div className="row" style={{ gap: 24, marginBottom: 20 }}>
            <div>
              <strong>{data.policyCount}</strong> in-force policies as of {data.asOf}
            </div>
            <div>
              Total TIV: <strong>{data.totalTiv ? data.totalTiv.toLocaleString() : '—'}</strong>
            </div>
          </div>

          <GroupTable title="By Product" groups={data.byProduct || []} />
          <GroupTable title="By State" groups={data.byState || []} />
          <GroupTable title="By Class / Industry" groups={data.byClassOrIndustry || []} />
        </>
      )}
    </div>
  )
}

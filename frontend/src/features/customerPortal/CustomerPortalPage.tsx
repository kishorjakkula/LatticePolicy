import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDisplayDate } from '../../shared/dateDisplay'
import carrierLogo from '../../assets/sample-carrier-logo.svg'
import { loadJsPdf } from '../../lib/pdf'
import { useCustomerPortalSummary, useCustomerPortalPolicy } from '../../api/hooks'

type PortalPolicy = {
  policyId: string
  policyNumber: string
  productCode: string
  status: string
  term?: { effectiveDate?: string; expirationDate?: string }
  premium?: { amount?: number; currency?: string } | null
  updatedAt?: string | null
}

function formatMoney(value: any): string {
  const amount = Number(value?.amount)
  const currency = String(value?.currency || 'USD')
  if (!Number.isFinite(amount)) return '-'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
}

function formatCoverageValue(value: any): string {
  if (value == null || value === '') return '-'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function formatDateForDocument(value: any): string {
  return formatDisplayDate(value, { fallback: '-' })
}

async function loadImageAsPngDataUrl(
  src: string,
  maxWidth: number,
  maxHeight: number
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const naturalWidth = img.naturalWidth || img.width
      const naturalHeight = img.naturalHeight || img.height
      if (!naturalWidth || !naturalHeight) return resolve(null)
      const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1)
      const width = Math.max(1, Math.round(naturalWidth * scale))
      const height = Math.max(1, Math.round(naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(null)
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      resolve({ dataUrl: canvas.toDataURL('image/png'), width, height })
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function openBlobInNewTab(blob: Blob) {
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}

async function buildPortalPolicyPacketPdf(detail: any): Promise<Blob> {
  const jsPDF = await loadJsPdf()
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const marginLeft = 40
  const marginRight = 40
  const top = 44
  const bottom = 44
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const contentWidth = pageWidth - marginLeft - marginRight
  let y = top

  const ensureSpace = (needed: number): void => {
    if (y + needed <= pageHeight - bottom) return
    doc.addPage()
    y = top
  }

  const keyValue = (label: string, value: string): void => {
    const labelText = `${label}: `
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    const labelWidth = doc.getTextWidth(labelText)
    const valueLines = doc.splitTextToSize(value || '-', contentWidth - labelWidth - 4)
    ensureSpace(Math.max(16, valueLines.length * 13))
    doc.text(labelText, marginLeft, y)
    doc.setFont('helvetica', 'normal')
    doc.text(valueLines, marginLeft + labelWidth + 2, y)
    y += Math.max(16, valueLines.length * 13)
  }

  const sectionTitle = (text: string) => {
    y += 10
    ensureSpace(20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(text, marginLeft, y)
    y += 8
  }

  const logo = await loadImageAsPngDataUrl(carrierLogo, 170, 52)
  const headerY = y
  let textX = marginLeft
  let headerBottom = headerY
  if (logo) {
    ensureSpace(logo.height + 8)
    doc.addImage(logo.dataUrl, 'PNG', marginLeft, headerY, logo.width, logo.height)
    textX = marginLeft + logo.width + 14
    headerBottom = headerY + logo.height
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('Policy Packet', textX, headerY + 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Generated: ${formatDateForDocument(new Date().toISOString())}`, textX, headerY + 32)
  doc.text(`Policy #: ${String(detail?.policy?.policyNumber || '-')}`, textX, headerY + 46)
  y = Math.max(headerBottom, headerY + 46) + 14

  sectionTitle('Policy Summary')
  keyValue('Named Insured', String(detail?.declarations?.namedInsured || '-'))
  keyValue('Product', String(detail?.policy?.productCode || '-'))
  keyValue('Status', String(detail?.policy?.status || '-'))
  keyValue('Policy Effective Date', formatDateForDocument(detail?.policy?.term?.effectiveDate))
  keyValue('Policy Expiration Date', formatDateForDocument(detail?.policy?.term?.expirationDate))
  keyValue('Policy Premium', formatMoney(detail?.policy?.premium))

  sectionTitle('Coverage Summary')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  const covCols = { coverage: marginLeft, limit: marginLeft + 210, deductible: marginLeft + 370, percent: marginLeft + 490 }
  doc.text('Coverage', covCols.coverage, y)
  doc.text('Limit', covCols.limit, y)
  doc.text('Deductible', covCols.deductible, y)
  doc.text('%', covCols.percent, y)
  y += 8
  doc.setDrawColor(210, 218, 232)
  doc.line(marginLeft, y, pageWidth - marginRight, y)
  y += 14
  const coverages = Array.isArray(detail?.declarations?.coverages) ? detail.declarations.coverages : []
  if (!coverages.length) {
    keyValue('Coverage', 'No coverage details available')
  } else {
    for (const cov of coverages) {
      const nameLines = doc.splitTextToSize(String(cov?.label || cov?.code || '-'), 190)
      const limitLines = doc.splitTextToSize(formatCoverageValue(cov?.limit), 140)
      const dedLines = doc.splitTextToSize(formatCoverageValue(cov?.deductible), 110)
      const pctLines = doc.splitTextToSize(cov?.percent != null && cov?.percent !== '' ? `${cov.percent}%` : '-', 40)
      const rowHeight = Math.max(nameLines.length, limitLines.length, dedLines.length, pctLines.length, 1) * 12 + 4
      ensureSpace(rowHeight + 4)
      doc.setFont('helvetica', 'normal')
      doc.text(nameLines, covCols.coverage, y)
      doc.text(limitLines, covCols.limit, y)
      doc.text(dedLines, covCols.deductible, y)
      doc.text(pctLines, covCols.percent, y)
      y += rowHeight
      doc.setDrawColor(235, 239, 247)
      doc.line(marginLeft, y - 4, pageWidth - marginRight, y - 4)
    }
  }

  sectionTitle('Vehicle Details')
  const vehicles = Array.isArray(detail?.idCard?.vehicles) ? detail.idCard.vehicles : []
  if (!vehicles.length) {
    keyValue('Vehicles', 'No vehicle details available')
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    const vCols = { idx: marginLeft, year: marginLeft + 45, make: marginLeft + 100, model: marginLeft + 200, vin: marginLeft + 340 }
    doc.text('#', vCols.idx, y)
    doc.text('Year', vCols.year, y)
    doc.text('Make', vCols.make, y)
    doc.text('Model', vCols.model, y)
    doc.text('VIN', vCols.vin, y)
    y += 8
    doc.setDrawColor(210, 218, 232)
    doc.line(marginLeft, y, pageWidth - marginRight, y)
    y += 14
    for (const v of vehicles) {
      const modelLines = doc.splitTextToSize(String(v?.model || '-'), 120)
      const vinLines = doc.splitTextToSize(String(v?.vin || '-'), 190)
      const rowHeight = Math.max(modelLines.length, vinLines.length, 1) * 12 + 4
      ensureSpace(rowHeight + 4)
      doc.setFont('helvetica', 'normal')
      doc.text(String(v?.index ?? '-'), vCols.idx, y)
      doc.text(String(v?.year || '-'), vCols.year, y)
      doc.text(String(v?.make || '-'), vCols.make, y)
      doc.text(modelLines, vCols.model, y)
      doc.text(vinLines, vCols.vin, y)
      y += rowHeight
      doc.setDrawColor(235, 239, 247)
      doc.line(marginLeft, y - 4, pageWidth - marginRight, y - 4)
    }
  }

  return doc.output('blob')
}

async function buildPortalIdCardsPdf(detail: any): Promise<Blob> {
  const jsPDF = await loadJsPdf()
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const marginLeft = 40
  const marginRight = 40
  const top = 44
  const bottom = 44
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const cardWidth = pageWidth - marginLeft - marginRight
  const cardHeight = 156
  let y = top
  const ensureSpace = (needed: number): void => {
    if (y + needed <= pageHeight - bottom) return
    doc.addPage()
    y = top
  }
  const logo = await loadImageAsPngDataUrl(carrierLogo, 130, 40)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Policy ID Cards', marginLeft, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Policy #: ${String(detail?.policy?.policyNumber || '-')}`, marginLeft, y + 18)
  y += 36
  const vehicles = Array.isArray(detail?.idCard?.vehicles) && detail.idCard.vehicles.length ? detail.idCard.vehicles : [{ index: 1, year: '-', make: '-', model: '-', vin: '-' }]
  for (const vehicle of vehicles) {
    ensureSpace(cardHeight + 12)
    const topY = y
    doc.setDrawColor(72, 104, 176)
    doc.roundedRect(marginLeft, topY, cardWidth, cardHeight, 8, 8, 'S')
    if (logo) doc.addImage(logo.dataUrl, 'PNG', marginLeft + 10, topY + 10, logo.width, logo.height)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text('AUTO INSURANCE IDENTIFICATION CARD', marginLeft + 160, topY + 26)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`Insured: ${String(detail?.idCard?.namedInsured || '-')}`, marginLeft + 14, topY + 58)
    doc.text(`Policy Number: ${String(detail?.idCard?.policyNumber || '-')}`, marginLeft + 14, topY + 74)
    doc.text(`Vehicle: ${[vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || '-'}`, marginLeft + 14, topY + 90)
    doc.text(`VIN: ${String(vehicle?.vin || '-')}`, marginLeft + 14, topY + 106)
    doc.text(`State: ${String(detail?.idCard?.state || '-')}`, marginLeft + 14, topY + 122)
    doc.text(
      `Effective: ${formatDateForDocument(detail?.idCard?.term?.effectiveDate)}  Expiration: ${formatDateForDocument(detail?.idCard?.term?.expirationDate)}`,
      marginLeft + 300,
      topY + 74
    )
    y += cardHeight + 14
  }
  return doc.output('blob')
}

export function CustomerPortalPage() {
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>('')

  const { data: summary, isLoading: loading, error: summaryError } = useCustomerPortalSummary()
  const { data: detail, isLoading: detailLoading, error: detailError } = useCustomerPortalPolicy(selectedPolicyId)

  // Auto-select first policy when summary loads
  useMemo(() => {
    if (summary && !selectedPolicyId) {
      const firstPolicyId = String(summary?.policies?.[0]?.policyId || '')
      if (firstPolicyId) setSelectedPolicyId(firstPolicyId)
    }
  }, [summary])

  const error = summaryError ? String(summaryError) : null

  const policies = useMemo<PortalPolicy[]>(() => (Array.isArray(summary?.policies) ? summary.policies : []), [summary])

  const viewDeclarationsPdf = async () => {
    if (!detail) return
    const blob = await buildPortalPolicyPacketPdf(detail)
    openBlobInNewTab(blob)
  }

  const viewIdCardsPdf = async () => {
    if (!detail?.idCard?.available) return
    const blob = await buildPortalIdCardsPdf(detail)
    openBlobInNewTab(blob)
  }

  return (
    <div className="ps-page-shell customer-portal-shell">
      <nav className="ps-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/dashboard" className="ps-breadcrumb-link">Home</Link>
        <span className="ps-breadcrumb-sep" aria-hidden="true">/</span>
        <span className="ps-breadcrumb-current">Customer Portal</span>
      </nav>

      <section className="card page-shell policy-hero customer-portal-hero">
        <div className="ps-page-header policy-page-header">
          <div className="policy-hero-main">
            <div className="policy-hero-kicker">Customer Access</div>
            <h1 className="ps-page-title">Customer Portal</h1>
            <p className="muted policy-hero-subtitle">
              {summary?.customer?.customerName || summary?.customer?.customerKey || 'My Policies'}
            </p>
          </div>
        </div>
      </section>

      {loading && <div className="muted">Loading policies...</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && (
        <>
          <section className="policy-section-card customer-portal-section">
            <div className="panel-header">
              <h3>My Policies</h3>
              <span className="muted">
                {policies.length} {policies.length === 1 ? 'policy' : 'policies'}
              </span>
            </div>
            <div className="ps-table-card">
              <table className="table table-sticky-header">
                <thead>
                  <tr>
                    <th data-mobile-label="Policy #">Policy #</th>
                    <th data-mobile-label="Product">Product</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.length === 0 && (
                    <tr><td colSpan={2} className="muted">No issued policies are available.</td></tr>
                  )}
                  {policies.map((row) => (
                    <tr key={row.policyId}>
                      <td>
                        <button
                          type="button"
                          className="table-link-button"
                          onClick={() => setSelectedPolicyId(row.policyId)}
                        >
                          {row.policyNumber || row.policyId}
                        </button>
                      </td>
                      <td>{row.productCode || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="policy-section-card stack-card customer-portal-section" style={{ marginTop: 12 }}>
            <div className="panel-header">
                <h3>Policy Summary</h3>
                <div className="toolbar-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => { void viewDeclarationsPdf() }}
                    disabled={!detail || detailLoading}
                  >
                    View Declaration
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => { void viewIdCardsPdf() }}
                    disabled={!detail?.idCard?.available || detailLoading}
                  >
                    View ID Cards
                  </button>
                </div>
            </div>

            {detailLoading && <div className="muted">Loading policy summary...</div>}
            {detailError && <div className="error">{String(detailError)}</div>}
            {!detailLoading && !detailError && !detail && <div className="muted">Select a policy to view details.</div>}

            {!detailLoading && !detailError && detail && (
              <>
                <div className="row">
                  <div className="col">
                    <label>Policy #</label>
                    <div>{detail.policy?.policyNumber || '-'}</div>
                  </div>
                  <div className="col">
                    <label>Product</label>
                    <div>{detail.policy?.productCode || '-'}</div>
                  </div>
                  <div className="col">
                    <label>Status</label>
                    <div>{detail.policy?.status || '-'}</div>
                  </div>
                  <div className="col">
                    <label>Policy Premium</label>
                    <div>{formatMoney(detail.policy?.premium)}</div>
                  </div>
                </div>
                <div className="row row-spaced">
                  <div className="col">
                    <label>Named Insured</label>
                    <div>{detail.declarations?.namedInsured || '-'}</div>
                  </div>
                  <div className="col">
                    <label>Policy Effective Date</label>
                    <div>{formatDisplayDate(detail.policy?.term?.effectiveDate, { fallback: '-' })}</div>
                  </div>
                  <div className="col">
                    <label>Policy Expiration Date</label>
                    <div>{formatDisplayDate(detail.policy?.term?.expirationDate, { fallback: '-' })}</div>
                  </div>
                </div>

                <h4 className="section-subtitle">Vehicle Details</h4>
                <table className="table">
                  <thead>
                    <tr>
                      <th data-mobile-label="Vehicle">Vehicle</th>
                      <th data-mobile-label="Year">Year</th>
                      <th data-mobile-label="Make">Make</th>
                      <th data-mobile-label="Model">Model</th>
                      <th data-mobile-label="VIN">VIN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.idCard?.vehicles || []).length === 0 && (
                      <tr><td colSpan={5} className="muted">No vehicle details available.</td></tr>
                    )}
                    {(detail.idCard?.vehicles || []).map((vehicle: any) => (
                      <tr key={`summary-veh-${vehicle.index}`}>
                        <td>{vehicle.index}</td>
                        <td>{vehicle.year || '-'}</td>
                        <td>{vehicle.make || '-'}</td>
                        <td>{vehicle.model || '-'}</td>
                        <td>{vehicle.vin || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <h4 className="section-subtitle">Current Coverages</h4>
                <table className="table">
                  <thead>
                    <tr>
                      <th data-mobile-label="Coverage">Coverage</th>
                      <th data-mobile-label="Limit">Limit</th>
                      <th data-mobile-label="Deductible">Deductible</th>
                      <th data-mobile-label="Percent">Percent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Array.isArray(detail.declarations?.coverages) ? detail.declarations.coverages : []).length === 0 && (
                      <tr><td colSpan={4} className="muted">No coverage details available.</td></tr>
                    )}
                    {(Array.isArray(detail.declarations?.coverages) ? detail.declarations.coverages : []).map((cov: any, index: number) => (
                      <tr key={`${cov.code || cov.label || 'cov'}-${index}`}>
                        <td>{cov.label || cov.code || '-'}</td>
                        <td>{formatCoverageValue(cov.limit)}</td>
                        <td>{formatCoverageValue(cov.deductible)}</td>
                        <td>{cov.percent != null && cov.percent !== '' ? `${cov.percent}%` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}

import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ActionButton } from '../../components/ActionButton'
import { formatDisplayDate, formatDisplayDateTime } from '../../shared/dateDisplay'
import {
  useRatingModels,
  useRatingModelVersion,
  useImportRatingWorkbookMutation,
  usePublishRatingModelVersionMutation,
} from '../../api/hooks'
import { api } from '../../api/client'

type RatingModelVersion = {
  versionId: string
  modelId: string
  versionLabel: string
  publishStatus: string
  isActive: boolean
  parserName: string
  parserVersion: string
  sourceFileName: string
  effectiveDate?: string
  expirationDate?: string
  createdAt?: string
  createdBy?: string
  updatedAt?: string
  updatedBy?: string
  parserSummary?: Record<string, any>
  metadata?: Record<string, any>
  workbookJson?: Record<string, any> | null
}

type RatingModel = {
  modelId: string
  modelCode: string
  productCode: string
  stateCode?: string
  programName?: string
  status: string
  activeVersionId?: string | null
  createdAt?: string
  createdBy?: string
  updatedAt?: string
  updatedBy?: string
  versions: RatingModelVersion[]
}

function statusBadgeClass(status: string) {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'ACTIVE' || normalized === 'PUBLISHED') return 'badge green'
  if (normalized === 'DRAFT') return 'badge gray'
  return 'badge blue'
}

export function RatingWorkbenchPage() {
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [selectedVersionId, setSelectedVersionId] = useState<string>('')

  const [importFile, setImportFile] = useState<File | null>(null)
  const [productCode, setProductCode] = useState('')
  const [stateCode, setStateCode] = useState('')
  const [modelCode, setModelCode] = useState('')
  const [programName, setProgramName] = useState('')
  const [publishingVersionId, setPublishingVersionId] = useState<string>('')
  const [publishedPreview, setPublishedPreview] = useState<any | null>(null)
  const [publishedPreviewError, setPublishedPreviewError] = useState<string | null>(null)

  const { data: modelsData, isLoading: loading, refetch: refetchModels } = useRatingModels()
  const models: RatingModel[] = Array.isArray(modelsData) ? modelsData : []

  const { data: selectedVersionDetail, isLoading: versionLoading } = useRatingModelVersion(selectedModelId, selectedVersionId)

  const importMutation = useImportRatingWorkbookMutation()
  const publishMutation = usePublishRatingModelVersionMutation()

  const selectedModel = useMemo(
    () => models.find((model) => model.modelId === selectedModelId) || null,
    [models, selectedModelId]
  )

  const selectedVersion = useMemo(
    () => selectedModel?.versions?.find((version) => version.versionId === selectedVersionId) || null,
    [selectedModel, selectedVersionId]
  )

  const sortedModels = useMemo(() => {
    return [...models].sort((a, b) => {
      const aUpdated = new Date(String(a.updatedAt || a.createdAt || '')).getTime() || 0
      const bUpdated = new Date(String(b.updatedAt || b.createdAt || '')).getTime() || 0
      if (bUpdated !== aUpdated) return bUpdated - aUpdated
      return String(a.modelCode || '').localeCompare(String(b.modelCode || ''))
    })
  }, [models])

  // Auto-select first model and version when models load
  useEffect(() => {
    if (!models.length) return
    if (!selectedModelId) {
      const firstModel = models[0]
      setSelectedModelId(firstModel.modelId)
      setSelectedVersionId(firstModel.activeVersionId || firstModel.versions?.[0]?.versionId || '')
    }
  }, [models, selectedModelId])

  useEffect(() => {
    if (!selectedModel) {
      setSelectedVersionId('')
      return
    }
    const stillExists = selectedModel.versions?.some((version) => version.versionId === selectedVersionId)
    if (!stillExists) {
      setSelectedVersionId(selectedModel.activeVersionId || selectedModel.versions?.[0]?.versionId || '')
    }
  }, [selectedModelId, selectedModel, selectedVersionId])

  async function handleImport() {
    if (!importFile) {
      setError('Select a rating workbook file (.xlsx) to import.')
      return
    }
    setError(null)
    setMessage(null)
    try {
      const response = await importMutation.mutateAsync({
        file: importFile,
        opts: {
          productCode: productCode.trim() || undefined,
          stateCode: stateCode.trim() || undefined,
          modelCode: modelCode.trim() || undefined,
          programName: programName.trim() || undefined
        }
      })
      setMessage(`Imported ${response?.model?.modelCode || 'rating model'} version ${response?.version?.versionLabel || ''}`.trim())
      setImportFile(null)
      const fileInput = document.getElementById('rating-workbook-file') as HTMLInputElement | null
      if (fileInput) fileInput.value = ''
      if (response?.model?.modelId) setSelectedModelId(response.model.modelId)
      if (response?.version?.versionId) setSelectedVersionId(response.version.versionId)
    } catch (err: any) {
      setError(err?.message || String(err))
    }
  }

  async function handlePublish(modelId: string, versionId: string) {
    setPublishingVersionId(versionId)
    setError(null)
    setMessage(null)
    try {
      const response = await publishMutation.mutateAsync({ modelId, versionId })
      setMessage(
        `Published ${response?.model?.modelCode || modelId} / ${response?.version?.versionLabel || versionId}`
      )
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setPublishingVersionId('')
    }
  }

  async function handleLoadPublishedPreview() {
    const targetModel = selectedModel
    if (!targetModel) return
    setPublishedPreview(null)
    setPublishedPreviewError(null)
    try {
      const response = await api.getPublishedRatingModel({
        modelCode: targetModel.modelCode,
        productCode: targetModel.productCode,
        stateCode: targetModel.stateCode || undefined
      })
      setPublishedPreview(response)
    } catch (err: any) {
      setPublishedPreviewError(err?.message || String(err))
    }
  }

  const versionSummary = selectedVersionDetail?.version || selectedVersionDetail?.versionDetail || selectedVersionDetail?.versionData || selectedVersionDetail?.version
  const workbookJson = selectedVersionDetail?.version?.workbookJson || selectedVersionDetail?.version?.workbook_json || null
  const parserSummary = selectedVersionDetail?.version?.parserSummary || {}
  const sheetPreview = workbookJson?.sheets?.preview || {}
  const sheetNames = workbookJson?.sheets?.names || Object.keys(sheetPreview)
  const selectedModelVersionCount = Array.isArray(selectedModel?.versions) ? selectedModel!.versions.length : 0
  const selectedActiveVersionLabel = selectedModel?.versions?.find((v) => v.versionId === selectedModel?.activeVersionId)?.versionLabel || '-'
  const importFileName = importFile?.name || ''

  return (
    <div className="ps-page-shell rating-workbench-shell">
      <nav className="ps-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/dashboard" className="ps-breadcrumb-link">Home</Link>
        <span className="ps-breadcrumb-sep" aria-hidden="true">/</span>
        <span className="ps-breadcrumb-current">Rating Workbench</span>
      </nav>

      <section className="card page-shell policy-hero rating-hero">
        <div className="ps-page-header policy-page-header">
          <div className="policy-hero-main">
            <div className="policy-hero-kicker">Actuary Workspace</div>
            <h1 className="ps-page-title">Rating Workbench</h1>
            <p className="muted policy-hero-subtitle">
              Workbook import, version control, activation, and published rating API preview.
            </p>
          </div>
          <div className="ps-page-header-actions">
            <ActionButton variant="secondary" onClick={() => void refetchModels()} loading={loading}>Refresh</ActionButton>
          </div>
        </div>
      </section>

      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}

      <section className="card stack-card rating-overview-card">
        <div className="rating-overview-grid">
          <div className="rating-overview-item">
            <label>Total Models</label>
            <strong>{loading ? '-' : sortedModels.length}</strong>
            <span className="muted">Imported rating model definitions</span>
          </div>
          <div className="rating-overview-item">
            <label>Selected Model</label>
            <strong>{selectedModel?.modelCode || 'None selected'}</strong>
            <span className="muted">{selectedModel?.programName || 'Choose a model from the list below'}</span>
          </div>
          <div className="rating-overview-item">
            <label>Versions</label>
            <strong>{selectedModel ? selectedModelVersionCount : '-'}</strong>
            <span className="muted">{selectedModel ? `${selectedModel.productCode || '-'} / ${selectedModel.stateCode || 'ALL'}` : 'No model selected'}</span>
          </div>
          <div className="rating-overview-item">
            <label>Active Version</label>
            <strong>{selectedModel ? selectedActiveVersionLabel : '-'}</strong>
            <span className="muted">{selectedModel?.status || 'Select a model to view status'}</span>
          </div>
        </div>
      </section>

      <section className="card stack-card">
        <div className="card-head">
          <div>
            <h3>Import Workbook</h3>
            <div className="muted rating-section-subtitle">Create a new model or add a version from an Excel workbook.</div>
          </div>
          <span className="muted">.xlsx / .xls</span>
        </div>
        <div className="rating-form-grid">
          <div className="rating-form-field rating-form-field-file">
            <label htmlFor="rating-workbook-file">Workbook File</label>
            <input
              id="rating-workbook-file"
              type="file"
              accept=".xlsx,.xls"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setImportFile(e.target.files?.[0] || null)}
            />
            <div className="rating-input-note">
              {importFileName ? `Selected: ${importFileName}` : 'Choose any product rating workbook (.xlsx/.xls).'}
            </div>
          </div>
          <div className="rating-form-field">
            <label htmlFor="rating-product-code">Product Code (Optional)</label>
            <input
              id="rating-product-code"
              value={productCode}
              onChange={(e) => setProductCode(e.target.value)}
              placeholder="e.g. commercial-auto"
            />
            <div className="rating-input-note">Leave blank to infer from workbook metadata, sheet names, or file name.</div>
          </div>
          <div className="rating-form-field">
            <label htmlFor="rating-state-code">State (Optional)</label>
            <input
              id="rating-state-code"
              value={stateCode}
              maxLength={3}
              placeholder="PA"
              onChange={(e) => setStateCode(e.target.value.toUpperCase())}
            />
            <div className="rating-input-note">Leave blank for multi-state or national models.</div>
          </div>
          <div className="rating-form-field">
            <label htmlFor="rating-model-code">Model Code Override (Optional)</label>
            <input id="rating-model-code" value={modelCode} onChange={(e) => setModelCode(e.target.value)} placeholder="e.g. commercial-auto-tx" />
          </div>
          <div className="rating-form-field rating-form-field-wide">
            <label htmlFor="rating-program-name">Program Name Override (Optional)</label>
            <input id="rating-program-name" value={programName} onChange={(e) => setProgramName(e.target.value)} placeholder="e.g. Commercial Auto" />
          </div>
          <div className="rating-form-actions">
            <button type="button" onClick={() => void handleImport()} disabled={importMutation.isPending || !importFile} aria-disabled={importMutation.isPending || !importFile}>
              {importMutation.isPending ? 'Importing...' : 'Import Workbook'}
            </button>
          </div>
        </div>
      </section>

      <div className="rating-layout rating-layout-rows stack-card">
        <section className="card">
          <div className="card-head">
            <div>
              <h3>Rating Models</h3>
              <div className="muted rating-section-subtitle">Select a model to inspect versions and publish an active version.</div>
            </div>
            <span className="muted">{loading ? 'Loading...' : `${sortedModels.length} model(s)`}</span>
          </div>
          <div className="ps-table-card" style={{ margin: '0 -20px -20px', borderRadius: '0 0 12px 12px', border: 'none', borderTop: '1px solid var(--border)', boxShadow: 'none' }}>
            <table className="table table-mobile-cards rating-models-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Product</th>
                  <th>State</th>
                  <th>Status</th>
                  <th>Active Version</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {sortedModels.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">No rating models imported yet.</td>
                  </tr>
                ) : (
                  sortedModels.map((model) => (
                    <tr
                      key={model.modelId}
                      className={model.modelId === selectedModelId ? 'rating-row-selected' : undefined}
                      aria-selected={model.modelId === selectedModelId}
                      onClick={() => setSelectedModelId(model.modelId)}
                    >
                      <td data-label="Model">
                        <div><strong>{model.modelCode}</strong></div>
                        <div className="muted">{model.programName || '-'}</div>
                      </td>
                      <td data-label="Product">{model.productCode || '-'}</td>
                      <td data-label="State">{model.stateCode || 'ALL'}</td>
                      <td data-label="Status"><span className={statusBadgeClass(model.status)}>{model.status}</span></td>
                      <td data-label="Active Version">{model.versions?.find((v) => v.versionId === model.activeVersionId)?.versionLabel || '-'}</td>
                      <td data-label="Updated">{formatDisplayDateTime(model.updatedAt || model.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h3>Versions</h3>
              <div className="muted rating-section-subtitle">Review effective dates, publish status, and source workbook history.</div>
            </div>
            <span className="muted">{selectedModel ? selectedModel.modelCode : 'Select a model'}</span>
          </div>
          <div className="ps-table-card" style={{ margin: '0 -20px -20px', borderRadius: '0 0 12px 12px', border: 'none', borderTop: '1px solid var(--border)', boxShadow: 'none' }}>
            <table className="table table-mobile-cards rating-versions-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Effective</th>
                  <th>Expiration</th>
                  <th>Source File</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {!selectedModel ? (
                  <tr>
                    <td colSpan={7} className="muted">Select a rating model to view versions.</td>
                  </tr>
                ) : (selectedModel.versions || []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">No versions found.</td>
                  </tr>
                ) : (
                  (selectedModel.versions || []).map((version) => (
                    <tr key={version.versionId} className={version.versionId === selectedVersionId ? 'rating-row-selected' : undefined} aria-selected={version.versionId === selectedVersionId}>
                      <td data-label="Version">
                        <button
                          type="button"
                          className="btn-secondary rating-link-button"
                          onClick={() => setSelectedVersionId(version.versionId)}
                        >
                          {version.versionLabel}
                        </button>
                        {version.isActive && <span className="badge green rating-inline-badge">Active</span>}
                      </td>
                      <td data-label="Status"><span className={statusBadgeClass(version.publishStatus)}>{version.publishStatus}</span></td>
                      <td data-label="Effective">{formatDisplayDate(version.effectiveDate)}</td>
                      <td data-label="Expiration">{formatDisplayDate(version.expirationDate)}</td>
                      <td data-label="Source File" title={version.sourceFileName} className="rating-cell-truncate">{version.sourceFileName || '-'}</td>
                      <td data-label="Created">{formatDisplayDateTime(version.createdAt)}</td>
                      <td data-label="Actions">
                        <div className="table-actions">
                          {!version.isActive && (
                            <button
                              type="button"
                              onClick={() => void handlePublish(selectedModel.modelId, version.versionId)}
                              disabled={publishingVersionId === version.versionId}
                            >
                              {publishingVersionId === version.versionId ? 'Publishing...' : 'Publish'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="rating-layout stack-card">
        <section className="card">
          <div className="card-head">
            <div>
              <h3>Version Detail</h3>
              <div className="muted rating-section-subtitle">Parser metadata and workbook preview for the selected version.</div>
            </div>
            <span className="muted">{versionLoading ? 'Loading...' : (selectedVersion?.versionLabel || 'Select a version')}</span>
          </div>
          {!selectedVersion ? (
            <p className="muted">Select a version to inspect parser metadata and workbook preview.</p>
          ) : (
            <>
              <div className="rating-summary-grid">
                <div><label>Model</label><div>{selectedModel?.modelCode || '-'}</div></div>
                <div><label>Version</label><div>{selectedVersion.versionLabel}</div></div>
                <div><label>Parser</label><div>{selectedVersion.parserName || '-'} {selectedVersion.parserVersion || ''}</div></div>
                <div><label>Status</label><div>{selectedVersion.publishStatus}{selectedVersion.isActive ? ' (Active)' : ''}</div></div>
                <div><label>Effective</label><div>{formatDisplayDate(selectedVersion.effectiveDate)}</div></div>
                <div><label>Expiration</label><div>{formatDisplayDate(selectedVersion.expirationDate)}</div></div>
                <div><label>Created</label><div>{formatDisplayDateTime(selectedVersion.createdAt)}</div></div>
                <div><label>Updated</label><div>{formatDisplayDateTime(selectedVersion.updatedAt)}</div></div>
              </div>
              <div className="stack-card">
                <h4 className="rating-panel-title">Parser Summary</h4>
                <pre className="rating-json-preview">{JSON.stringify(parserSummary || {}, null, 2)}</pre>
              </div>
              <div className="stack-card">
                <h4 className="rating-panel-title">Workbook Sheet Preview</h4>
                {sheetNames.length ? (
                  <table className="table table-mobile-cards rating-sheet-table">
                    <thead>
                      <tr>
                        <th>Sheet</th>
                        <th>Rows</th>
                        <th>Columns / Header</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sheetNames.map((sheetName: string) => {
                        const info = sheetPreview?.[sheetName] || {}
                        const header = Array.isArray(info.header) ? info.header.join(', ') : ''
                        return (
                          <tr key={sheetName}>
                            <td data-label="Sheet">{sheetName}</td>
                            <td data-label="Rows">{info.rowCount ?? '-'}</td>
                            <td data-label="Columns / Header" title={header} className="rating-cell-truncate">{header || '-'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted">No workbook preview found.</p>
                )}
              </div>
            </>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h3>Published API Preview</h3>
              <div className="muted rating-section-subtitle">Preview the response returned to downstream rating consumers.</div>
            </div>
            <span className="muted">Consumer-facing endpoint</span>
          </div>
          <div className="rating-published-controls">
            <div className="rating-endpoint-box">
              <div className="muted rating-endpoint-label">Endpoint</div>
              <code className="rating-endpoint-code">GET /v1/rating/published?modelCode=&lt;modelCode&gt;</code>
            </div>
            <button type="button" className="btn-secondary" onClick={() => void handleLoadPublishedPreview()} disabled={!selectedModel}>
              Load API Preview
            </button>
          </div>
          {publishedPreviewError && <div className="error" style={{ marginTop: 10 }}>{publishedPreviewError}</div>}
          {publishedPreview ? (
            <pre className="rating-json-preview" style={{ marginTop: 10 }}>{JSON.stringify(publishedPreview, null, 2)}</pre>
          ) : (
            <p className="muted" style={{ marginTop: 10 }}>
              Publish a version, then load the API response preview for downstream rating consumers.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

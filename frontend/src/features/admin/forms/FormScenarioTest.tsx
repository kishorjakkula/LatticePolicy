import { useRef, useState } from 'react'
import { apiAdmin as api } from '../../../api/client'
import { AttachmentFieldCatalog } from './FormAttachmentEditor'

export type CatalogOption = { code: string; label: string }
export const FORM_TRANSACTIONS = ['Quote', 'Bind', 'Issue', 'Endorsement', 'Renewal', 'Cancellation', 'Reinstatement', 'Rewrite']
const MAX_SCENARIO_LENGTH = 32768

export function parseFormScenario(source: string): Record<string, unknown> {
  if (source.length > MAX_SCENARIO_LENGTH) throw new Error('Scenario must be at most 32,768 characters.')
  const value: unknown = JSON.parse(source)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Scenario must be a JSON object.')
  let nodes = 0
  const inspect = (item: unknown, depth: number) => {
    if (++nodes > 5000 || depth > 20) throw new Error('Scenario is too complex (maximum depth 20 and 5,000 values).')
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Scenario numbers must be finite.')
    if (item && typeof item === 'object') {
      for (const [key, entry] of Object.entries(item)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`Unsafe scenario key: ${key}`)
        inspect(entry, depth + 1)
      }
    }
  }
  inspect(value, 0)
  // Scope and candidate selection belong to the explicit controls, never the JSON.
  for (const key of ['formId', 'includeDraft', 'productCode', 'state', 'transactionType', 'effectiveDate', 'lineOfBusiness']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`Set ${key} using the scenario controls, not the JSON.`)
  }
  return value as Record<string, unknown>
}

export function FormScenarioTest({ formId, lineOfBusiness, products, states, initialProduct, initialState, revision }: {
  formId: string; lineOfBusiness: string; products: CatalogOption[]; states: CatalogOption[]; initialProduct: string; initialState: string; revision: string
}) {
  const [productCode, setProductCode] = useState(initialProduct)
  const [state, setState] = useState(initialState)
  const [transactionType, setTransactionType] = useState('Quote')
  const [stage, setStage] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10))
  const [source, setSource] = useState('{\n  "payload": {},\n  "policy": {},\n  "transaction": {},\n  "premium": {}\n}')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ signature: string; rows: any[] } | null>(null)
  const signature = JSON.stringify([formId, lineOfBusiness, productCode, state, transactionType, stage, effectiveDate, source, revision])
  const latestSignature = useRef(signature)
  latestSignature.current = signature
  const run = async () => {
    setError('')
    setResult(null)
    try {
      const scenario = parseFormScenario(source)
      if (!formId || !productCode || !state || !effectiveDate) throw new Error('Select a saved form, product, state and effective date.')
      setBusy(true)
      const transaction = scenario.transaction
      if (transaction != null && (typeof transaction !== 'object' || Array.isArray(transaction))) throw new Error('transaction must be a JSON object.')
      // Without an explicit stage, new-business tests use the stage generation would: Bind, or Issue for Issue.
      const defaultStage = transactionType === 'Issue' ? 'Issue' : transactionType === 'Quote' || transactionType === 'Bind' ? 'Bind' : ''
      const testStage = stage || ((transaction as Record<string, unknown> | undefined)?.stage ? '' : defaultStage)
      const rows = await api.previewAdminForms({ ...scenario, ...(testStage ? { transaction: { ...(transaction as Record<string, unknown> || {}), stage: testStage } } : {}), lineOfBusiness, productCode, state, transactionType, effectiveDate, formId, includeDraft: true })
      if (!Array.isArray(rows)) throw new Error('Unexpected attachment preview response.')
      if (signature === latestSignature.current) setResult({ signature, rows })
    } catch (e) { if (signature === latestSignature.current) setError((e as Error).message) } finally { setBusy(false) }
  }
  const currentResult = result?.signature === signature ? result : null
  const selected = currentResult?.rows.find((row) => row.formId === formId)
  return <section aria-label="Synthetic attachment test">
    <p className="muted">Synthetic preview of the saved candidate, including drafts. This does not activate or attach an unpublished form to a live transaction.</p>
    <div className="forms-scenario-grid">
      <label>Test product<select value={productCode} onChange={(e) => setProductCode(e.target.value)}><option value="">Select product</option>{products.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
      <label>Test state<select value={state} onChange={(e) => setState(e.target.value)}><option value="">Select state</option>{states.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
      <label>Test transaction<select value={transactionType} onChange={(e) => setTransactionType(e.target.value)}>{FORM_TRANSACTIONS.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Test new-business stage<select value={stage} onChange={(e) => setStage(e.target.value)}><option value="">Use transaction context</option>{['Bind', 'Issue'].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Test effective date<input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></label>
    </div>
    <label>Synthetic scenario JSON<textarea className="forms-scenario-json" rows={12} maxLength={MAX_SCENARIO_LENGTH} value={source} onChange={(e) => setSource(e.target.value)} spellCheck={false} /></label>
    <AttachmentFieldCatalog productCode={productCode} />
    {error && <p className="error" role="alert">{error}</p>}
    <button type="button" onClick={() => void run()} disabled={busy || !formId}>{busy ? 'Testing...' : 'Run Packet Preview'}</button>
    {result && !currentResult && <p role="status">Scenario or form changed. Run the preview again.</p>}
    {currentResult && <div role="status">
      <h4>{selected ? 'Would attach' : 'Would not attach'}</h4>
      {selected ? <p>{Array.isArray(selected.reasons) && selected.reasons.length ? selected.reasons.join(' | ') : 'The saved candidate matched the server attachment evaluation.'}</p> : <p>The saved candidate was not returned by the server. Check saved product, state, transaction, effective dates and attachment conditions. The API does not return individual exclusion reasons.</p>}
      {selected && <p>{selected.formNumber} - {selected.formTitle} - {selected.editionDate} - {selected.packetPlacement}</p>}
    </div>}
  </section>
}

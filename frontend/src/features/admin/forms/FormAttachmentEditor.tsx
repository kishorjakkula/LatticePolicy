import { useEffect, useState } from 'react'
import { compileExpression } from '@lattice-policy/rules'
import { apiAdmin as api } from '../../../api/client'
import { RadioGroup } from '../../../components/RadioGroup'
import { useConfirmDialog } from '../../../components/Dialog'

export type AttachmentField = { path: string; label: string; type: string; group: string; expressionPath?: string }
type Trigger = { triggerId?: string; triggerType: string; conditionExpression: string; suppressExpression: string; priority: number; active: boolean }
const emptyTrigger = (): Trigger => ({ triggerType: 'Always', conditionExpression: '', suppressExpression: '', priority: 100, active: true })

export function AttachmentFieldCatalog({ productCode, onSelect }: { productCode: string; onSelect?: (path: string) => void }) {
  const [fields, setFields] = useState<AttachmentField[]>([])
  const [roots, setRoots] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let current = true
    setFields([])
    setRoots([])
    setError('')
    setLoading(false)
    if (!productCode) return
    setLoading(true)
    api.getFormAttachmentFields(productCode).then((result) => {
      if (current) { setFields(result.fields); setRoots(result.contextRoots) }
    }).catch((e: Error) => { if (current) setError(e.message) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [productCode])
  const visible = fields.filter((field) => `${field.label} ${field.path} ${field.group}`.toLowerCase().includes(query.toLowerCase()))
  return <details className="forms-field-catalog">
    <summary>Application field catalog</summary>
    {error && <p role="alert">Field catalog unavailable: {error}</p>}
    {loading && <p role="status">Loading application fields...</p>}
    {!productCode && <p>Select a product to load application fields.</p>}
    {roots.length > 0 && <p className="muted">Context roots: {roots.join(', ')}</p>}
    <label>Find application field<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
    <div className="forms-table-scroll"><table className="table table-no-sticky-head">
      <thead><tr><th>Group / field</th><th>Expression path</th><th>Type</th>{onSelect && <th>Condition</th>}</tr></thead>
      <tbody>{visible.map((field) => <tr key={field.expressionPath || field.path}>
        <td>{field.group} / {field.label}</td><td><code>{field.expressionPath || field.path}</code></td><td>{field.type}</td>
        {onSelect && <td><button type="button" className="btn-secondary" onClick={() => onSelect(field.expressionPath || field.path)} aria-label={`Use ${field.label}`}>Use field</button></td>}
      </tr>)}</tbody>
    </table></div>
    {!loading && !error && productCode && visible.length === 0 && <p>No matching fields.</p>}
  </details>
}

export function FormAttachmentEditor({ formId, productCode, canEdit, onChange }: { formId: string; productCode: string; canEdit: boolean; onChange: () => void }) {
  const [triggers, setTriggers] = useState<Trigger[]>([])
  const [draft, setDraft] = useState<Trigger>(emptyTrigger)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const { dialog: confirmDialog, askConfirm } = useConfirmDialog()
  useEffect(() => {
    let current = true
    setTriggers([])
    setDraft(emptyTrigger())
    setLoaded(false)
    setError('')
    if (formId) api.listFormTriggers(formId).then((rows) => { if (current) { setTriggers(rows); setLoaded(true) } }).catch((e: Error) => { if (current) setError(e.message) })
    return () => { current = false }
  }, [formId])
  const reload = async () => { setTriggers(await api.listFormTriggers(formId)); onChange() }
  const save = async () => {
    setError('')
    try {
      if (draft.triggerType === 'Expression') compileExpression(draft.conditionExpression)
      if (draft.suppressExpression.trim()) compileExpression(draft.suppressExpression)
      if (!Number.isInteger(draft.priority)) throw new Error('Priority must be a whole number.')
      setBusy(true)
      const { triggerId, ...payload } = draft
      payload.conditionExpression = payload.triggerType === 'Always' ? '' : payload.conditionExpression.trim()
      if (triggerId) await api.updateFormTrigger(formId, triggerId, payload)
      else await api.addFormTrigger(formId, payload)
      await reload()
      setDraft(emptyTrigger())
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <section aria-label="Attachment rules">
    {confirmDialog}
    <h4>Attachment rules</h4>
    {!formId && <p>Save the form before adding attachment rules.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {formId && !loaded && !error && <p role="status">Loading attachment rules...</p>}
    <fieldset disabled={!canEdit || !formId || busy || !loaded}>
      <legend>{draft.triggerId ? 'Edit rule' : 'New rule'}</legend>
      <RadioGroup name="form-trigger-type" ariaLabel="Attach when" options={[{ value: 'Always', label: 'Always' }, { value: 'Expression', label: 'Policy-data condition' }]} value={draft.triggerType} onChange={(triggerType) => setDraft({ ...draft, triggerType })} />
      {draft.triggerType !== 'Always' && <label>Condition expression<textarea rows={3} maxLength={1000} value={draft.conditionExpression} onChange={(e) => setDraft({ ...draft, conditionExpression: e.target.value })} /></label>}
      <label>Never attach the form when (optional)<textarea rows={2} maxLength={1000} aria-describedby="form-trigger-suppress-help" value={draft.suppressExpression} onChange={(e) => setDraft({ ...draft, suppressExpression: e.target.value })} /></label>
      <p id="form-trigger-suppress-help" className="muted">If this condition is true, the form is left off the transaction, even when another rule says to attach it.</p>
      <label>Priority<input type="number" step="1" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>
      <label className="forms-check"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />Active rule</label>
      <div className="toolbar-actions"><button type="button" onClick={() => void save()}>{draft.triggerId ? 'Update rule' : 'Add rule'}</button><button type="button" className="btn-secondary" onClick={() => setDraft(emptyTrigger())}>Cancel rule edit</button></div>
    </fieldset>
    <AttachmentFieldCatalog productCode={productCode} onSelect={canEdit && loaded ? (path) => setDraft({ ...draft, triggerType: 'Expression', conditionExpression: draft.conditionExpression ? `${draft.conditionExpression} && isSet(${path})` : `isSet(${path})` }) : undefined} />
    <div className="forms-table-scroll"><table className="table table-no-sticky-head"><thead><tr><th>Attach when</th><th>Never attach when</th><th>Priority</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {triggers.map((trigger) => <tr key={trigger.triggerId}><td>{trigger.triggerType === 'Always' ? 'Always' : trigger.conditionExpression}</td><td>{trigger.suppressExpression || '-'}</td><td>{trigger.priority}</td><td>{trigger.active ? 'Active' : 'Inactive'}</td><td className="table-actions">
        <button type="button" className="btn-secondary" disabled={!canEdit || busy} onClick={() => { setDraft({ ...trigger }); setError('') }} aria-label={`Edit rule priority ${trigger.priority}`}>Edit</button>
        <button type="button" className="btn-secondary" disabled={!canEdit || busy} aria-label={`Delete rule priority ${trigger.priority}`} onClick={async () => {
          if (!trigger.triggerId || !(await askConfirm({ title: `Delete attachment rule priority ${trigger.priority}`, confirmLabel: 'Delete', danger: true }))) return
          setBusy(true)
          try { await api.deleteFormTrigger(formId, trigger.triggerId); await reload(); setDraft(emptyTrigger()) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
        }}>Delete</button>
      </td></tr>)}
      {loaded && triggers.length === 0 && <tr><td colSpan={5}>No saved rules. Product, state, transaction and date scope still apply.</td></tr>}
    </tbody></table></div>
  </section>
}

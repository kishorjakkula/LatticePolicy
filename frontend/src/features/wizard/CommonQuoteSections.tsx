// Quote fields shared by every product: prior insurance details, billing,
// mailing address, and additional interests. Stored on the quote payload and
// carried to the policy (additional interests become policy interests at bind).
import { RadioGroup } from '../../components/RadioGroup'
import { AddressFields } from '../../components/AddressFields'
import { ContactAddresses, ContactCommunication } from '../../components/ContactAddresses'
import { contactAddresses, primaryAddress, postalAddress, legacyAddress, formatPostalAddress, type ContactAddress } from '../../shared/postalAddress'

export type QuoteMailingAddress = { street: string; city: string; state: string; zip: string; line2?: string; line3?: string; country?: string; county?: string }

export type QuoteAdditionalInterest = {
  id: string
  role: 'MORTGAGEE' | 'LOSS_PAYEE' | 'ADDITIONAL_INSURED' | 'ADDITIONAL_INTEREST'
  name: string
  loanNumber: string
  street: string
  city: string
  state: string
  zip: string
  line2?: string
  country?: string
  addresses?: ContactAddress[]
  email?: string
  phone?: string
}

export type CommonQuoteFields = {
  priorExpirationDate?: string
  yearsWithPriorCarrier?: string
  billingMethod?: '' | 'agency' | 'direct'
  paymentPlan?: '' | 'annual' | 'semi-annual' | 'quarterly' | 'monthly'
  mailingAddress?: QuoteMailingAddress
  additionalInterests?: QuoteAdditionalInterest[]
}

export const INTEREST_ROLE_LABELS: Record<QuoteAdditionalInterest['role'], string> = {
  MORTGAGEE: 'Mortgagee',
  LOSS_PAYEE: 'Lienholder / loss payee',
  ADDITIONAL_INSURED: 'Additional insured',
  ADDITIONAL_INTEREST: 'Additional interest',
}

export const PAYMENT_PLAN_LABELS: Record<string, string> = {
  annual: 'Annual (paid in full)',
  'semi-annual': 'Semi-annual (2 payments)',
  quarterly: 'Quarterly (4 payments)',
  monthly: 'Monthly (12 payments)',
}

const EMPTY_ADDRESS: QuoteMailingAddress = { street: '', city: '', state: '', zip: '' }

/** Reads the common fields back from a saved quote payload. */
export function commonFieldsFromPayload(payload: any, current: CommonQuoteFields = {}): CommonQuoteFields {
  const address = payload?.mailingAddress && typeof payload.mailingAddress === 'object' ? payload.mailingAddress : current.mailingAddress
  const interests = Array.isArray(payload?.additionalInterests) ? payload.additionalInterests : current.additionalInterests
  return {
    priorExpirationDate: payload?.priorExpirationDate || current.priorExpirationDate || '',
    yearsWithPriorCarrier: payload?.yearsWithPriorCarrier != null && payload.yearsWithPriorCarrier !== '' ? String(payload.yearsWithPriorCarrier) : (current.yearsWithPriorCarrier || ''),
    billingMethod: payload?.billingMethod || current.billingMethod || '',
    paymentPlan: payload?.paymentPlan || current.paymentPlan || '',
    mailingAddress: address ? { ...EMPTY_ADDRESS, ...address } : { ...EMPTY_ADDRESS },
    additionalInterests: (interests || []).map((item: any, index: number) => ({
      ...item,
      id: String(item?.id || `ai-${index}-${Date.now()}`),
      role: (Object.keys(INTEREST_ROLE_LABELS).includes(item?.role) ? item.role : 'ADDITIONAL_INTEREST') as QuoteAdditionalInterest['role'],
      name: String(item?.name || ''),
      loanNumber: String(item?.loanNumber || ''),
      street: String(item?.street || ''),
      city: String(item?.city || ''),
      state: String(item?.state || ''),
      zip: String(item?.zip || ''),
    })),
  }
}

/** The role new interests default to, by product. */
export function defaultInterestRole(productCode: string): QuoteAdditionalInterest['role'] {
  if (productCode === 'homeowners') return 'MORTGAGEE'
  if (productCode === 'personal-auto' || productCode === 'commercial-auto') return 'LOSS_PAYEE'
  return 'ADDITIONAL_INSURED'
}

type Props = { value: CommonQuoteFields; onChange: (next: CommonQuoteFields) => void; disabled?: boolean }

export function PriorInsuranceExtras({ value, onChange, disabled }: Props) {
  return (
    <div className="row">
      <div className="col">
        <label htmlFor="wizard-prior-expiration">Prior Policy Expiration</label>
        <input id="wizard-prior-expiration" type="date" value={value.priorExpirationDate || ''} disabled={disabled}
          onChange={(event) => onChange({ ...value, priorExpirationDate: event.target.value })} />
      </div>
      <div className="col">
        <label htmlFor="wizard-prior-years">Years with Prior Carrier</label>
        <input id="wizard-prior-years" type="number" min={0} max={99} value={value.yearsWithPriorCarrier || ''} disabled={disabled}
          onChange={(event) => onChange({ ...value, yearsWithPriorCarrier: event.target.value })} />
      </div>
    </div>
  )
}

export function BillingFields({ value, onChange, disabled }: Props) {
  return (
    <div className="row">
      <div className="col">
        <span id="wizard-billing-method-label" className="field-label">Billing Method</span>
        <RadioGroup
          name="wizard-billing-method"
          labelledBy="wizard-billing-method-label"
          value={value.billingMethod || ''}
          disabled={disabled}
          onChange={(next: string) => onChange({ ...value, billingMethod: next as CommonQuoteFields['billingMethod'] })}
          options={[{ value: 'direct', label: 'Direct bill (carrier bills the insured)' }, { value: 'agency', label: 'Agency bill' }]}
        />
      </div>
      <div className="col">
        <label htmlFor="wizard-payment-plan">Payment Plan</label>
        <select id="wizard-payment-plan" value={value.paymentPlan || ''} disabled={disabled}
          onChange={(event) => onChange({ ...value, paymentPlan: event.target.value as CommonQuoteFields['paymentPlan'] })}>
          <option value="">Select a plan</option>
          {Object.entries(PAYMENT_PLAN_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
      </div>
    </div>
  )
}

export function MailingAddressFields({ value, onChange, disabled, insuredAddress, insuredAddresses }: Props & { insuredAddress?: QuoteMailingAddress; insuredAddresses?: ContactAddress[] }) {
  const address = { ...EMPTY_ADDRESS, ...(value.mailingAddress || {}) }
  const set = (field: keyof QuoteMailingAddress, next: string) => onChange({ ...value, mailingAddress: { ...address, [field]: next } })
  const canCopy = !!(insuredAddress && (insuredAddress.street || insuredAddress.city))
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>Where notices and bills are sent. It can differ from the insured location on the risk.</p>
      <AddressFields value={postalAddress(address)} disabled={disabled} onChange={a => onChange({ ...value, mailingAddress: legacyAddress(a) })} />
      {!disabled && !!insuredAddresses?.length && <label>Copy contact address<select value="" onChange={e => { if (e.target.value !== '') onChange({ ...value, mailingAddress: legacyAddress(insuredAddresses[Number(e.target.value)]) }) }}><option value="">Select address</option>{insuredAddresses.map((a, i) => <option key={a.addressId || i} value={i}>{a.primary ? 'Primary: ' : ''}{formatPostalAddress(a)}</option>)}</select></label>}
      {canCopy && !disabled && (
        <button type="button" className="btn-secondary" style={{ marginTop: 8 }}
          onClick={() => onChange({ ...value, mailingAddress: legacyAddress(insuredAddress) })}>
          Use the insured's address
        </button>
      )}
    </>
  )
}

export function AdditionalInterestsFields({ value, onChange, disabled, productCode }: Props & { productCode: string }) {
  const items = value.additionalInterests || []
  const update = (id: string, patch: Partial<QuoteAdditionalInterest>) =>
    onChange({ ...value, additionalInterests: items.map((item) => (item.id === id ? { ...item, ...patch } : item)) })
  const add = () => onChange({
    ...value,
    additionalInterests: [...items, { id: `ai-${Date.now()}-${items.length}`, role: defaultInterestRole(productCode), name: '', loanNumber: '', street: '', city: '', state: '', zip: '' }],
  })
  const remove = (id: string) => onChange({ ...value, additionalInterests: items.filter((item) => item.id !== id) })
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>Mortgagees, lienholders, loss payees, or additional insureds. They print on the declarations and receive notices.</p>
      {items.length === 0 && <div className="muted" style={{ marginBottom: 8 }}>No additional interests.</div>}
      {items.map((item, index) => (
        <div key={item.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
          <div className="row">
            <div className="col">
              <label htmlFor={`ai-role-${item.id}`}>Type</label>
              <select id={`ai-role-${item.id}`} value={item.role} disabled={disabled} onChange={(event) => update(item.id, { role: event.target.value as QuoteAdditionalInterest['role'] })}>
                {Object.entries(INTEREST_ROLE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </div>
            <div className="col"><label htmlFor={`ai-name-${item.id}`}>Name</label><input id={`ai-name-${item.id}`} value={item.name} disabled={disabled} onChange={(event) => update(item.id, { name: event.target.value })} /></div>
            <div className="col"><label htmlFor={`ai-loan-${item.id}`}>Loan / Reference Number</label><input id={`ai-loan-${item.id}`} value={item.loanNumber} disabled={disabled} onChange={(event) => update(item.id, { loanNumber: event.target.value })} /></div>
          </div>
          <ContactCommunication email={item.email || ''} phone={item.phone || ''} disabled={disabled} onChange={patch => update(item.id, patch)} />
          <ContactAddresses value={contactAddresses(item.addresses, item)} disabled={disabled} onChange={addresses => update(item.id, { addresses, ...legacyAddress(primaryAddress(addresses)) })} />
          {!disabled && <button type="button" className="btn-secondary" onClick={() => remove(item.id)} aria-label={`Remove additional interest ${index + 1}`}>Remove</button>}
        </div>
      ))}
      {!disabled && <button type="button" className="btn-secondary" onClick={add}>Add additional interest</button>}
    </>
  )
}

/** Read-only summary for the review step. */
export function CommonQuoteSummary({ value }: { value: CommonQuoteFields }) {
  const address = value.mailingAddress
  const addressText = address ? formatPostalAddress(address) : ''
  return (
    <>
      <div className="kvline"><span className="muted">Prior Expiration</span><span>{value.priorExpirationDate || '-'}</span></div>
      <div className="kvline"><span className="muted">Years with Prior Carrier</span><span>{value.yearsWithPriorCarrier || '-'}</span></div>
      <div className="kvline"><span className="muted">Billing</span><span>{[value.billingMethod === 'agency' ? 'Agency bill' : value.billingMethod === 'direct' ? 'Direct bill' : '', value.paymentPlan ? PAYMENT_PLAN_LABELS[value.paymentPlan] : ''].filter(Boolean).join(' · ') || '-'}</span></div>
      <div className="kvline"><span className="muted">Mailing Address</span><span>{addressText || '-'}</span></div>
      <div className="kvline"><span className="muted">Additional Interests</span><span>{(value.additionalInterests || []).filter((item) => item.name).map((item) => `${INTEREST_ROLE_LABELS[item.role]}: ${item.name}${item.loanNumber ? ` (${item.loanNumber})` : ''}`).join('; ') || '-'}</span></div>
    </>
  )
}

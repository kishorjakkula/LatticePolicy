import React from 'react'
import { derivePolicyWorkflowStatus } from '../policies/statusModel'
import { formatDisplayDate } from '../../shared/dateDisplay'
import { StatusBadge } from '../../components/StatusBadge'
import { Checkbox } from '../../components/Checkbox'

function formatPremium(value: any): string {
  const n = Number(value)
  if ((!value && value !== 0) || isNaN(n)) return '\u2014'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface PolicyRowProps {
  policy: any
  isSelected: boolean
  onToggle: (id: string) => void
  onContextMenu: (e: React.MouseEvent, policy: any) => void
  onNavigate: (path: string) => void
}

export const PolicyRow = React.memo(function PolicyRow({
  policy: p,
  isSelected,
  onToggle,
  onContextMenu,
  onNavigate,
}: PolicyRowProps) {
  const policyId: string = p.policyId
  const workflowStatus = derivePolicyWorkflowStatus(p.internalStatus || p.status, p.term)
  const insuredName = p.insuredName || p.customer?.name || ''
  const createdDate = p.createdAt || p.createdDate
  const updatedDate = p.updatedAt || p.updatedDate

  return (
    <tr
      className={`ps-policy-row${isSelected ? ' ps-row--selected' : ''}`}
      onContextMenu={(e) => onContextMenu(e, p)}
      aria-selected={isSelected}
    >
      <td data-col="check" className="ps-col-check" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={isSelected}
          onChange={() => onToggle(policyId)}
          ariaLabel={`Select policy ${p.policyNumber || policyId}`}
        />
      </td>
      <td data-col="policy-num" data-label="Policy #" className="ps-col-policy-num">
        <button
          type="button"
          className="ps-policy-link"
          onClick={() => onNavigate(`/policies/${policyId}`)}
        >
          {p.policyNumber || policyId}
        </button>
      </td>
      <td data-col="insured" data-label="Insured Name" className="ps-col-primary">
        {insuredName || '\u2014'}
      </td>
      <td data-col="product" data-label="Product" className="ps-col-secondary">
        {p.productCode || '\u2014'}
      </td>
      <td data-col="dates" data-label={'Eff \u2192 Exp'} className="ps-col-dates">
        <span className="ps-date-eff">
          {formatDisplayDate(p.term?.effectiveDate, { fallback: '\u2014' })}
        </span>
        <span className="ps-date-arrow" aria-hidden="true">{' \u2192 '}</span>
        <span className="ps-date-exp ps-col-dim">
          {formatDisplayDate(p.term?.expirationDate, { fallback: '\u2014' })}
        </span>
      </td>
      <td data-col="created" data-label="Created" className="ps-col-secondary">
        {formatDisplayDate(createdDate, { fallback: '\u2014' })}
      </td>
      <td data-col="updated" data-label="Updated" className="ps-col-secondary">
        {formatDisplayDate(updatedDate, { fallback: '\u2014' })}
      </td>
      <td data-col="premium" data-label="Premium" className="ps-col-premium">
        {formatPremium(p.premium?.total?.amount ?? p.annualPremium ?? p.totalPremium)}
      </td>
      <td data-col="status" data-label="Status">
        <StatusBadge status={workflowStatus} />
      </td>
    </tr>
  )
})

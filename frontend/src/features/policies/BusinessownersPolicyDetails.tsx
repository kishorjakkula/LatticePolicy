import { CollapsibleSection } from '../../components/CollapsibleSection'
import { CoveragePackageTerms } from '../../components/CoveragePackageTerms'
import { formatPostalAddress, postalAddress } from '../../shared/postalAddress'

const coverageNames: Record<string, string> = {
  BOP_BUILDING: 'Building', BOP_BPP: 'Business personal property',
  BOP_BI_EE: 'Business income and extra expense', BOP_LIAB: 'Business liability',
  BOP_MED: 'Medical expenses (included)', BOP_EQUIP: 'Equipment breakdown', BOP_WATER: 'Water backup'
}

export function BusinessownersPolicyDetails({ payload }: { payload: any }) {
  if (!payload) return null
  const risk = payload.risks?.[0]
  const selected = (Array.isArray(payload.coverages) ? payload.coverages : []).filter((coverage: any) => coverage.selected !== false)
  const money = (value: any) => value === '' || value == null ? '-' : Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  return <CollapsibleSection title="Business premises and package" className="card policy-section-card">
    {risk && <dl>
      <dt>Business name</dt><dd>{risk.businessName || '-'}</dd>
      <dt>Business class</dt><dd>{risk.businessClass || '-'}</dd>
      <dt>Occupancy</dt><dd>{risk.occupancy || '-'}</dd>
      <dt>Building insurable interest</dt><dd>{risk.buildingInterest === true || risk.buildingInterest === 'true' ? 'Yes' : risk.buildingInterest === false || risk.buildingInterest === 'false' ? 'No' : '-'}</dd>
      <dt>Premises address</dt><dd>{formatPostalAddress(postalAddress(risk.locationAddress)) || '-'}</dd>
    </dl>}
    {selected.map((coverage: any) => <div key={coverage.code} style={{ overflowWrap: 'anywhere' }}>
      <h4>{coverageNames[coverage.code] || coverage.code}</h4>
      <p>Limit: {money(coverage.limit)}{coverage.deductible != null ? ` | Deductible: ${money(coverage.deductible)}` : ''}</p>
      <CoveragePackageTerms terms={coverage.packageTerms} />
    </div>)}
  </CollapsibleSection>
}

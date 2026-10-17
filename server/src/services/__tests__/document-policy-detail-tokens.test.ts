import { describe, expect, it } from 'vitest'
import { resolvePolicyDetailTokens } from '../document-template-variables.js'
import { loadProductConfig } from '../../lib/products.js'

const hoPayload = {
  productCode: 'homeowners',
  underwritingCompanyName: 'Sample Carrier Property',
  billingMethod: 'direct',
  paymentPlan: 'monthly',
  priorCarrier: 'Lone Star Home Insurance',
  priorPolicyNumber: 'LSH-HO-2231987',
  priorExpirationDate: '2026-11-15T00:00:00Z',
  mailingAddress: { street: 'PO Box 4410', city: 'Austin', state: 'TX', zip: '78765' },
  additionalInterests: [
    { role: 'ADDITIONAL_INSURED', name: 'Trust A' },
    { role: 'MORTGAGEE', name: 'Capital City Mortgage Corp ISAOA/ATIMA', loanNumber: 'CCM-88412-07', street: '800 Brazos St', city: 'Austin', state: 'TX', zip: '78701' },
  ],
  risks: [{ address: '2214 Live Oak Dr, Austin TX 78704', construction: 'masonry', yearBuilt: 1998 }],
  coverages: [
    { code: 'A', selected: true, limit: 385000, deductible: 1000, windHailPercent: 2 },
    { code: 'B', selected: true, percent: 10 },
    { code: 'C', selected: true, percent: 50, limit: 192500 },
    { code: 'D', selected: true, percent: 20 },
    { code: 'E', selected: true, limit: 300000 },
    { code: 'F', selected: true, limit: 1000 },
    { code: 'END_WB', selected: true, limit: 10000 },
    { code: 'END_ERC', selected: true, percent: 25 },
    { code: 'END_ORD', selected: false, percent: 50 },
  ],
}

describe('resolvePolicyDetailTokens', () => {
  it('resolves homeowners declarations values and common policy details', () => {
    const tokens = resolvePolicyDetailTokens(hoPayload, loadProductConfig('homeowners'))
    expect(tokens).toMatchObject({
      underwritingCompany: 'Sample Carrier Property',
      mailingAddress: 'PO Box 4410, Austin, TX 78765',
      billingMethod: 'Direct bill',
      paymentPlan: 'Monthly',
      priorPolicyNumber: 'LSH-HO-2231987',
      priorExpirationDate: '2026-11-15',
      mortgageeName: 'Capital City Mortgage Corp ISAOA/ATIMA',
      mortgageeLoanNumber: 'CCM-88412-07',
      mortgageeAddress: '800 Brazos St, Austin, TX 78701',
      policyFormName: 'Homeowners Special Form (HO3)',
      premisesAddress: '2214 Live Oak Dr, Austin TX 78704',
      coverageALimit: '$385,000',
      coverageBLimit: '$38,500',
      coverageCLimit: '$192,500',
      coverageDLimit: '$77,000',
      coverageELimit: '$300,000',
      coverageFLimit: '$1,000',
      allPerilDeductible: '$1,000',
      windHailDeductible: '2% of Coverage A ($7,700)',
      endorsementsList: 'Water Back-Up and Sump Overflow: $10,000\nExtended Replacement Cost on Dwelling: 25% of Coverage A',
    })
    expect(tokens.additionalInterests.split('\n')).toEqual([
      'Additional insured, Trust A',
      'Mortgagee, Capital City Mortgage Corp ISAOA/ATIMA, loan CCM-88412-07, 800 Brazos St, Austin, TX 78701',
    ])
  })

  it('leaves homeowners tokens empty for other products and says None without endorsements', () => {
    const auto = resolvePolicyDetailTokens({ productCode: 'personal-auto', coverages: [{ code: 'BI', limit: 100000 }], additionalInterests: [{ role: 'LOSS_PAYEE', name: 'Auto Finance' }] })
    expect(auto).toMatchObject({ coverageALimit: '', endorsementsList: '', premisesAddress: '', mortgageeName: 'Auto Finance' })
    const bare = resolvePolicyDetailTokens({ productCode: 'homeowners', coverages: [{ code: 'A', limit: 300000 }] })
    expect(bare.endorsementsList).toBe('None')
    expect(bare.windHailDeductible).toBe('')
  })
})

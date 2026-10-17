import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { readDocumentLines, documentKind } from '../document-text.js'
import { buildExtractionCatalog, coverageTargetFields } from '../target-fields.js'
import { BuiltinExtractor, type ExtractionDocument } from '../extractors.js'

const SAMPLES = path.resolve(__dirname, '../../../../../examples/intake-samples/homeowners')

async function sampleDocuments(): Promise<ExtractionDocument[]> {
  const out: ExtractionDocument[] = []
  for (const fileName of fs.readdirSync(SAMPLES).sort()) {
    const content = fs.readFileSync(path.join(SAMPLES, fileName))
    const { lines } = await readDocumentLines(fileName, content)
    out.push({ documentId: fileName, fileName, contentType: 'text/plain', kind: documentKind(fileName), lines, content })
  }
  return out
}

describe('homeowners intake (HO-3 sample submission)', () => {
  it('offers coverage fields from the product definition for every product', () => {
    const ho = coverageTargetFields('homeowners').map((field) => field.key)
    expect(ho).toEqual(expect.arrayContaining(['cov.A.limit', 'cov.B.percent', 'cov.E.limit', 'cov.END_WB.limit', 'cov.END_PPRC.selected', 'cov.A.deductible', 'cov.A.windHailPercent']))
    const cyber = coverageTargetFields('cyber').map((field) => field.key)
    expect(cyber).toEqual(expect.arrayContaining(['cov.CYB_LIAB.limit', 'cov.CYB_LIAB.deductible']))
  })

  it('drafts the dwelling, coverages, prior insurance, billing, mortgagee, and qualification answers', async () => {
    const result = await new BuiltinExtractor().extract({ documents: await sampleDocuments(), catalog: buildExtractionCatalog() })
    expect(result.productCode).toBe('homeowners')
    const values = Object.fromEntries(result.values.map((value) => [value.key, value.value]))
    expect(values).toMatchObject({
      insuredName: 'Maria Gonzalez',
      insuredType: 'person',
      insuredDob: '1979-03-14',
      addressLine1: 'PO Box 4410',
      postalCode: '78765',
      effectiveDate: '2026-11-15',
      state: 'TX',
      priorCarrier: 'Lone Star Home Insurance',
      priorPolicyNumber: 'LSH-HO-2231987',
      priorExpirationDate: '2026-11-15',
      yearsWithPriorCarrier: '6',
      paymentPlan: 'monthly',
      billingMethod: 'direct',
      interestRole: 'MORTGAGEE',
      interestName: 'Capital City Mortgage Corp ISAOA/ATIMA',
      interestLoanNumber: 'CCM-88412-07',
      interestAddress: '800 Brazos St, Austin TX 78701',
      'risk.address': '2214 Live Oak Dr, Austin TX 78704',
      'risk.roofType': 'metal',
      'risk.dwellingUnits': '1',
      'risk.stories': '2',
      'risk.distanceToFireStationMiles': '2',
      'risk.occupancy': 'OwnerOccupied',
      'cov.A.limit': '385000',
      'cov.E.limit': '300000',
      'cov.F.limit': '1000',
      'cov.A.deductible': '1000',
      'cov.A.windHailPercent': '2',
      'qual.noPropertyClaims5Years': 'yes',
    })
    // The mortgagee and loan number agree across three documents.
    expect(result.values.find((value) => value.key === 'interestLoanNumber')?.evidence.length).toBe(3)
    expect(result.conflicts.map((conflict) => conflict.key)).toEqual([])
  })
})

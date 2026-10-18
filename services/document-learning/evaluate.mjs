import { digest, validateDataset } from './datasets.mjs'

const normalized = (value) =>
  typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    : ''
const same = (a, b) => normalized(a) === normalized(b)

function evidenced(value, documents) {
  const document = documents.find((doc) => doc.id === value.documentId)
  if (!document || typeof value.quote !== 'string' || !value.quote.trim())
    return false
  if (Number.isInteger(value.line) && value.line > 0 && value.page == null)
    return (
      (document.textLines ||
        document.pages?.find((p) => p.page === null)?.lines)?.[
        value.line - 1
      ]?.includes(value.quote) === true
    )
  if (Number.isInteger(value.page) && value.page > 0 && value.line == null)
    return (
      document.pages?.some(
        (page) =>
          page.page === value.page &&
          (page.lines || []).some((line) => line.includes(value.quote)),
      ) === true
    )
  return false
}

/** Reports contain metric counts and sample IDs, never source/customer values. */
export async function evaluate(
  dataset,
  {
    tenantId,
    extract,
    artifacts,
    signal = AbortSignal.timeout(30 * 60 * 1000),
  },
) {
  validateDataset(dataset, tenantId)
  const heldOut = dataset.samples.filter(
    (sample) => sample.split === 'evaluation',
  )
  if (heldOut.length < 20)
    throw new Error('At least 20 held-out samples are required')
  const totals = {
    checks: 0,
    correct: 0,
    variantChecks: 0,
    variantCorrect: 0,
    evidenceChecks: 0,
    validEvidence: 0,
    criticalErrors: 0,
    extractionErrors: 0,
  }
  const outcomes = []
  for (const sample of heldOut) {
    signal.throwIfAborted()
    let output
    try {
      output = await extract(sample.request)
    } catch {
      signal.throwIfAborted()
      totals.extractionErrors++
      totals.criticalErrors++
      totals.checks++
      outcomes.push({ sampleId: sample.id, status: 'EXTRACTION_FAILED' })
      continue
    }
    signal.throwIfAborted()
    const result = output?.result
    if (
      !result ||
      !Array.isArray(result.values) ||
      !Array.isArray(result.conflicts) ||
      result.values.length > 300 ||
      result.conflicts.length > 300 ||
      output.model !== artifacts.model ||
      output.profile?.id !== artifacts.profileId ||
      output.profile?.version !== artifacts.profileVersion
    )
      throw new Error('Evaluation response provenance or structure mismatch')
    const failures = new Set()
    const known = new Set(
      [
        ...sample.request.schema.fields,
        ...sample.request.schema.variants.flatMap((v) => v.fields),
      ].map((f) => f.key),
    )
    const actual = new Map()
    const duplicates = new Set()
    for (const value of result.values) {
      if (!value || !known.has(value.key)) {
        totals.checks++
        totals.criticalErrors++
        failures.add('unrecognized-output')
        continue
      }
      if (actual.has(value.key)) duplicates.add(value.key)
      actual.set(value.key, value)
      totals.evidenceChecks++
      if (evidenced(value, output.documents || sample.request.documents))
        totals.validEvidence++
      else if (sample.criticalFields.includes(value.key))
        failures.add(value.key)
    }
    const expectedKeys = new Set(
      sample.expected.values.map((value) => value.key),
    )
    for (const expected of sample.expected.values) {
      totals.checks++
      const value = actual.get(expected.key)
      const correct =
        value &&
        !duplicates.has(expected.key) &&
        same(value.value, expected.value) &&
        value.documentId === expected.documentId &&
        value.line === expected.line &&
        value.page === expected.page &&
        same(value.quote, expected.quote) &&
        evidenced(value, output.documents || sample.request.documents)
      if (correct) totals.correct++
      else failures.add(expected.key)
    }
    for (const key of actual.keys()) {
      if (!expectedKeys.has(key)) {
        totals.checks++
        failures.add(key)
      }
    }
    const expectedConflicts = new Map(
      sample.expected.conflicts.map((conflict) => [conflict.key, conflict]),
    )
    const actualConflicts = new Map()
    for (const conflict of result.conflicts) {
      if (
        !conflict ||
        !known.has(conflict.key) ||
        actualConflicts.has(conflict.key)
      ) {
        totals.checks++
        totals.criticalErrors++
        failures.add('invalid-conflict')
        continue
      }
      actualConflicts.set(conflict.key, conflict)
      const expected = expectedConflicts.get(conflict.key)
      totals.checks++
      const options = conflict.options
      if (
        expected &&
        Array.isArray(options) &&
        options.length === expected.options.length &&
        expected.options.every(
          (e) => options.filter((a) => same(a.value, e.value)).length === 1,
        ) &&
        options.every((option) =>
          evidenced(option, output.documents || sample.request.documents),
        )
      )
        totals.correct++
      else failures.add(conflict.key)
    }
    for (const key of expectedConflicts.keys())
      if (!actualConflicts.has(key)) {
        totals.checks++
        failures.add(key)
      }
    totals.variantChecks++
    if ((result.variant ?? null) === sample.expected.variant)
      totals.variantCorrect++
    else {
      failures.add('variant')
      totals.criticalErrors++
    }
    for (const key of failures)
      if (sample.criticalFields.includes(key)) totals.criticalErrors++
    outcomes.push({
      sampleId: sample.id,
      status: failures.size ? 'FAILED' : 'PASSED',
      failedFields: [...failures].sort(),
    })
  }
  const metrics = {
    sampleCount: heldOut.length,
    fieldAccuracy: totals.checks ? totals.correct / totals.checks : 0,
    evidenceAccuracy: totals.evidenceChecks
      ? totals.validEvidence / totals.evidenceChecks
      : 0,
    criticalErrors: totals.criticalErrors,
    datasetSha256: digest({ ...dataset, samples: heldOut }),
  }
  return {
    schemaVersion: 1,
    tenantId,
    artifacts,
    metrics,
    totals,
    outcomes,
    passed:
      metrics.fieldAccuracy >= 0.95 &&
      metrics.evidenceAccuracy >= 0.98 &&
      metrics.criticalErrors === 0 &&
      totals.extractionErrors === 0,
  }
}

export function compareReports(baseline, candidate) {
  if (
    baseline.tenantId !== candidate.tenantId ||
    baseline.metrics.datasetSha256 !== candidate.metrics.datasetSha256
  )
    throw new Error(
      'Drift comparison requires the same carrier and held-out dataset',
    )
  const fieldDelta =
    candidate.metrics.fieldAccuracy - baseline.metrics.fieldAccuracy
  const evidenceDelta =
    candidate.metrics.evidenceAccuracy - baseline.metrics.evidenceAccuracy
  return {
    schemaVersion: 1,
    fieldDelta,
    evidenceDelta,
    passed:
      candidate.passed &&
      fieldDelta >= -0.02 &&
      evidenceDelta >= -0.01 &&
      candidate.metrics.criticalErrors === 0,
  }
}

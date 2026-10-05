import fs from 'fs'
import path from 'path'
import YAML from 'yaml'
import { describe, expect, it } from 'vitest'

function resolveRepoRoot(): string {
  const cwd = process.cwd()
  const candidates = [cwd, path.resolve(cwd, '..')]
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'products'))) return c
  }
  return cwd
}

function loadYaml(relativePath: string): any {
  const filePath = path.join(resolveRepoRoot(), relativePath)
  const content = fs.readFileSync(filePath, 'utf8')
  return YAML.parse(content)
}

describe('example-identity-protection product pack fixtures', () => {
  it('has valid coverage.yaml and rates.yaml with required top-level fields', () => {
    const coverage = loadYaml('products/example-identity-protection/coverage.yaml')
    const rates = loadYaml('products/example-identity-protection/rates.yaml')

    for (const doc of [coverage, rates]) {
      expect(doc.product).toBe('example-identity-protection')
      expect(typeof doc.version).toBe('string')
      expect(doc.version.length).toBeGreaterThan(0)
    }
  })

  it('declares at least one selectable coverage with a matching rating key', () => {
    const coverage = loadYaml('products/example-identity-protection/coverage.yaml')

    expect(Array.isArray(coverage.coverages)).toBe(true)
    expect(coverage.coverages.length).toBeGreaterThan(0)
    expect(coverage.coverages[0]).toMatchObject({ code: 'MONITOR', selectable: true })
    expect(coverage.ratingKeys).toContain('monitoringLimit')
  })

  it('has a rating factor for every declared coverage limit', () => {
    const coverage = loadYaml('products/example-identity-protection/coverage.yaml')
    const rates = loadYaml('products/example-identity-protection/rates.yaml')

    const monitorCoverage = coverage.coverages.find((c: any) => c.code === 'MONITOR')
    const limits: number[] = monitorCoverage.limits

    expect(limits.length).toBeGreaterThan(0)
    for (const limit of limits) {
      expect(rates.monitoringLimitFactors[String(limit)]).toBeGreaterThan(0)
    }
  })

  it('defines base rate, fees, and taxes consistent with the product pack contract shape', () => {
    const rates = loadYaml('products/example-identity-protection/rates.yaml')

    expect(rates.base).toBeTruthy()
    expect(rates.fees.policy).toBeGreaterThanOrEqual(0)
    expect(rates.taxes.rate).toBeGreaterThanOrEqual(0)
  })
})

export type Field = {
  key: string
  label: string
  type: 'text' | 'number' | 'select'
  path: string
  required?: boolean
  options?: any[]
  help?: string
}

export function getRiskFields(productCode: 'personal-auto'|'commercial-auto'|'homeowners'|'cyber'|'professional-liability', cfg: any): Field[] {
  const keys: string[] = Array.isArray(cfg?.ratingKeys) ? cfg.ratingKeys : []
  const out: Field[] = []
  const add = (f: Field) => out.push(f)
  if (productCode === 'personal-auto') {
    if (keys.includes('garagingZip')) add({ key: 'garagingZip', label: 'Garaging ZIP', type: 'text', path: 'risks.0.garagingZip', required: true, help: '5-digit ZIP' })
    if (keys.includes('driverAge')) add({ key: 'driverAge', label: 'Driver Age', type: 'number', path: 'risks.0.driverAge', required: true })
    if (keys.includes('vehicleSymbol')) add({ key: 'symbol', label: 'Vehicle Symbol', type: 'text', path: 'risks.0.symbol', required: false })
    // Always include core vehicle fields
    add({ key: 'year', label: 'Vehicle Year', type: 'number', path: 'risks.0.year', required: true })
    add({ key: 'make', label: 'Make', type: 'text', path: 'risks.0.make', required: true })
    add({ key: 'model', label: 'Model', type: 'text', path: 'risks.0.model', required: true })
    add({ key: 'usage', label: 'Usage', type: 'select', path: 'risks.0.usage', required: true, options: ['pleasure','commute','business'] })
    add({ key: 'annualMiles', label: 'Annual Miles', type: 'number', path: 'risks.0.annualMiles', required: true })
  } else if (productCode === 'commercial-auto') {
    if (keys.includes('garagingZip')) add({ key: 'garagingZip', label: 'Primary Garaging ZIP', type: 'text', path: 'risks.0.garagingZip', required: true, help: '5-digit ZIP' })
    if (keys.includes('vehicleCount')) add({ key: 'vehicleCount', label: 'Vehicle Count', type: 'number', path: 'risks.0.vehicleCount', required: true })
    if (keys.includes('driverCount')) add({ key: 'driverCount', label: 'Driver Count', type: 'number', path: 'risks.0.driverCount', required: true })
    if (keys.includes('useClass')) add({ key: 'useClass', label: 'Use Class', type: 'select', path: 'risks.0.useClass', required: true, options: ['artisan-contractor', 'service', 'retail-delivery', 'wholesale-distribution', 'for-hire', 'livery', 'mixed-business', 'other'] })
    if (keys.includes('radiusClass')) add({ key: 'radiusClass', label: 'Operating Radius', type: 'select', path: 'risks.0.radiusClass', required: true, options: ['local', 'intermediate', 'long-haul'] })
    if (keys.includes('vehicleType')) add({ key: 'vehicleType', label: 'Primary Vehicle Type', type: 'select', path: 'risks.0.vehicleType', required: true, options: ['light-truck', 'service-van', 'pickup', 'box-truck', 'mixed-fleet', 'dump-truck', 'tractor-trailer', 'other'] })
    if (keys.includes('gvwClass')) add({ key: 'gvwClass', label: 'GVW Class', type: 'select', path: 'risks.0.gvwClass', required: true, options: ['light', 'medium', 'heavy'] })
    if (keys.includes('annualMileage')) add({ key: 'annualMileage', label: 'Average Annual Mileage (per vehicle)', type: 'number', path: 'risks.0.annualMileage', required: true })
    if (keys.includes('yearsInBusiness')) add({ key: 'yearsInBusiness', label: 'Years in Business', type: 'number', path: 'risks.0.yearsInBusiness', required: true })
    if (keys.includes('priorLossesCount')) add({ key: 'priorLossesCount', label: 'Prior Auto Losses (3 years)', type: 'number', path: 'risks.0.priorLossesCount', required: true })
    add({ key: 'businessName', label: 'Business Name', type: 'text', path: 'risks.0.businessName', required: false })
  } else if (productCode === 'homeowners') {
    if (keys.includes('construction')) add({ key: 'construction', label: 'Construction', type: 'select', path: 'risks.0.construction', required: true, options: ['frame','masonry','other'] })
    if (keys.includes('protectionClass')) add({ key: 'protectionClass', label: 'Protection Class', type: 'number', path: 'risks.0.protectionClass', required: false })
    if (keys.includes('roofAgeYears')) add({ key: 'roofAgeYears', label: 'Roof Age (years)', type: 'number', path: 'risks.0.roofAgeYears', required: true })
    // Core dwelling fields
    add({ key: 'address', label: 'Address', type: 'text', path: 'risks.0.address', required: true })
    add({ key: 'yearBuilt', label: 'Year Built', type: 'number', path: 'risks.0.yearBuilt', required: true })
    add({ key: 'squareFeet', label: 'Square Feet', type: 'number', path: 'risks.0.squareFeet', required: false })
  } else if (productCode === 'cyber') {
    if (keys.includes('industry')) add({ key: 'industry', label: 'Industry', type: 'select', path: 'risks.0.industry', required: true, options: ['technology', 'healthcare', 'finance', 'retail', 'manufacturing', 'education', 'professional-services', 'other'] })
    if (keys.includes('annualRevenue')) add({ key: 'annualRevenue', label: 'Annual Revenue (USD)', type: 'number', path: 'risks.0.annualRevenue', required: true })
    if (keys.includes('employeeCount')) add({ key: 'employeeCount', label: 'Employee Count', type: 'number', path: 'risks.0.employeeCount', required: true })
    if (keys.includes('recordsCount')) add({ key: 'recordsCount', label: 'Sensitive Records Count', type: 'number', path: 'risks.0.recordsCount', required: true })
    if (keys.includes('mfaEnabled')) add({ key: 'mfaEnabled', label: 'MFA Enabled', type: 'select', path: 'risks.0.mfaEnabled', required: true, options: ['true', 'false'] })
    if (keys.includes('endpointProtection')) add({ key: 'endpointProtection', label: 'Endpoint Protection / EDR', type: 'select', path: 'risks.0.endpointProtection', required: true, options: ['true', 'false'] })
    if (keys.includes('backups')) add({ key: 'backups', label: 'Backup Frequency', type: 'select', path: 'risks.0.backups', required: true, options: ['daily', 'weekly', 'monthly', 'none'] })
    if (keys.includes('priorIncidents')) add({ key: 'priorIncidents', label: 'Prior Incidents (3 years)', type: 'number', path: 'risks.0.priorIncidents', required: true })
    if (keys.includes('publicFacingApps')) add({ key: 'publicFacingApps', label: 'Public-Facing Applications', type: 'number', path: 'risks.0.publicFacingApps', required: true })
    if (keys.includes('domain')) add({ key: 'domain', label: 'Primary Domain', type: 'text', path: 'risks.0.domain', required: true })
  } else {
    if (keys.includes('industry')) add({ key: 'industry', label: 'Professional Service Industry', type: 'select', path: 'risks.0.industry', required: true, options: ['accounting', 'architecture-engineering', 'consulting', 'insurance-agency', 'it-services', 'legal-services', 'management-consulting', 'marketing-media', 'real-estate', 'staffing', 'other'] })
    if (keys.includes('annualRevenue')) add({ key: 'annualRevenue', label: 'Annual Revenue (USD)', type: 'number', path: 'risks.0.annualRevenue', required: true })
    if (keys.includes('employeeCount')) add({ key: 'employeeCount', label: 'Employee Count', type: 'number', path: 'risks.0.employeeCount', required: true })
    if (keys.includes('yearsInBusiness')) add({ key: 'yearsInBusiness', label: 'Years in Business', type: 'number', path: 'risks.0.yearsInBusiness', required: true })
    if (keys.includes('priorClaimsCount')) add({ key: 'priorClaimsCount', label: 'Prior PL Claims (5 years)', type: 'number', path: 'risks.0.priorClaimsCount', required: true })
    if (keys.includes('largestContractValue')) add({ key: 'largestContractValue', label: 'Largest Contract Value (USD)', type: 'number', path: 'risks.0.largestContractValue', required: true })
    if (keys.includes('subcontractorPct')) add({ key: 'subcontractorPct', label: 'Subcontracted Work (%)', type: 'number', path: 'risks.0.subcontractorPct', required: true })
    if (keys.includes('writtenContracts')) add({ key: 'writtenContracts', label: 'Written Contracts Used', type: 'select', path: 'risks.0.writtenContracts', required: true, options: ['true', 'false'] })
    if (keys.includes('qualityControl')) add({ key: 'qualityControl', label: 'Quality Control / Peer Review', type: 'select', path: 'risks.0.qualityControl', required: true, options: ['formal', 'standard', 'limited'] })
    if (keys.includes('retroactiveYears')) add({ key: 'retroactiveYears', label: 'Prior Acts / Retro Years', type: 'number', path: 'risks.0.retroactiveYears', required: true })
  }
  return out
}

export function setByPath(obj: any, path: string, val: any) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    const idx = Number.isInteger(Number(k)) ? Number(k) : null
    if (idx !== null) {
      if (!Array.isArray(cur)) throw new Error('Path expects array segment')
      if (!cur[idx]) cur[idx] = {}
      cur = cur[idx]
    } else {
      cur[k] = cur[k] ?? {}
      cur = cur[k]
    }
  }
  const last = parts[parts.length - 1]
  const idx = Number.isInteger(Number(last)) ? Number(last) : null
  if (idx !== null) cur[idx] = val
  else cur[last] = val
}

export function validateFields(fields: Field[], q: any): Record<string, string> {
  const errs: Record<string, string> = {}
  for (const f of fields) {
    const v = f.path.split('.').reduce((acc: any, k: any) => (acc ? acc[k] : undefined), q)
    if (f.required && (v === undefined || v === null || v === '')) {
      errs[f.key] = 'Required'
      continue
    }
    if (f.key === 'garagingZip' && v && String(v).length !== 5) errs[f.key] = 'Enter 5-digit ZIP'
    if (f.key === 'driverAge' && v && (Number(v) < 16 || Number(v) > 100)) errs[f.key] = 'Enter valid age (16-100)'
    if (f.key === 'year' && v && (Number(v) < 1980 || Number(v) > new Date().getFullYear()+1)) errs[f.key] = 'Enter valid year'
    if (f.key === 'vehicleCount' && Number(v) <= 0) errs[f.key] = 'Enter vehicle count'
    if (f.key === 'driverCount' && Number(v) <= 0) errs[f.key] = 'Enter driver count'
    if (f.key === 'annualMileage' && Number(v) < 0) errs[f.key] = 'Must be >= 0'
    if (f.key === 'priorLossesCount' && Number(v) < 0) errs[f.key] = 'Must be >= 0'
    if (f.key === 'roofAgeYears' && v && Number(v) < 0) errs[f.key] = 'Must be >= 0'
    if (f.key === 'annualRevenue' && Number(v) <= 0) errs[f.key] = 'Enter annual revenue'
    if (f.key === 'employeeCount' && Number(v) <= 0) errs[f.key] = 'Enter employee count'
    if (f.key === 'recordsCount' && Number(v) < 0) errs[f.key] = 'Must be >= 0'
    if (f.key === 'priorIncidents' && Number(v) < 0) errs[f.key] = 'Must be >= 0'
    if (f.key === 'publicFacingApps' && Number(v) < 0) errs[f.key] = 'Must be >= 0'
    if (f.key === 'domain' && v && !String(v).includes('.')) errs[f.key] = 'Enter a valid domain'
    if (f.key === 'yearsInBusiness' && Number(v) < 0) errs[f.key] = 'Must be >= 0'
    if (f.key === 'priorClaimsCount' && Number(v) < 0) errs[f.key] = 'Must be >= 0'
    if (f.key === 'largestContractValue' && Number(v) <= 0) errs[f.key] = 'Enter contract value'
    if (f.key === 'subcontractorPct' && (Number(v) < 0 || Number(v) > 100)) errs[f.key] = 'Enter 0-100'
    if (f.key === 'retroactiveYears' && Number(v) < 0) errs[f.key] = 'Must be >= 0'
  }
  return errs
}
